'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const store = require('./store');
const agent = require('./agent');
const dialogs = require('./dialogs');
const conversations = require('./conversations');
const usageLimits = require('./usageLimits');
const usageStats = require('./usageStats');
const terminal = require('./terminal');
const { withIdleClaudeSession } = require('./claudeSession');
const { buildBridgeContext } = require('./contextBridgeBuilder');

let mainWindow = null;

// Bekleyen izin isteklerini (canUseTool) id ile eşleştirir.
const pendingPermissions = new Map();
let permissionSeq = 0;

// "Bu oturumda hep izin ver" ile onaylanan araçlar. Yalnızca uygulama çalıştığı
// sürece geçerlidir; diske yazılmaz ve izin modu değişince temizlenir.
const sessionToolAllow = new Set();

// Kullanım limiti önbelleği: her okuma bir Claude CLI oturumu + Codex app-server
// süreci başlattığı için sık sorgulama pahalıdır.
const USAGE_CACHE_MS = 60000;
let usageCache = { at: 0, data: null, inflight: null };

function getUsageCached(force) {
  const fresh = usageCache.data && Date.now() - usageCache.at < USAGE_CACHE_MS;
  if (!force && fresh) return Promise.resolve(usageCache.data);
  if (usageCache.inflight) return usageCache.inflight;

  usageCache.inflight = usageLimits
    .getUsageLimits()
    .then((data) => {
      usageCache = { at: Date.now(), data, inflight: null };
      return data;
    })
    .catch((err) => {
      usageCache.inflight = null;
      throw err;
    });
  return usageCache.inflight;
}

// Model yetenekleri (efor seviyeleri) uygulama ömrü boyunca önbelleklenir.
let modelsCache = null;

async function getModelsCached() {
  if (modelsCache) return modelsCache;
  try {
    const models = await withIdleClaudeSession((q) => q.supportedModels(), {
      label: 'models:claude',
      timeoutMs: 25000,
      timeoutMessage: 'Model listesi zaman aşımına uğradı.',
    });
    modelsCache = (Array.isArray(models) ? models : []).map((model) => ({
      value: model.value,
      resolvedModel: model.resolvedModel,
      displayName: model.displayName,
      supportsEffort: model.supportsEffort !== false,
      supportedEffortLevels: Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels : [],
    }));
    return modelsCache;
  } catch (err) {
    console.warn('[models] alınamadı:', err.message);
    return [];
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Renderer'a canUseTool onay isteği gönderir, yanıtı bekler.
function requestPermissionFromRenderer(req) {
  return new Promise((resolve) => {
    if (req && req.toolName && sessionToolAllow.has(req.toolName)) {
      resolve({ allow: true });
      return;
    }
    const id = ++permissionSeq;
    pendingPermissions.set(id, resolve);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:permission-request', { id, ...req });
    } else {
      // Pencere yoksa güvenli tarafta kal: reddet.
      pendingPermissions.delete(id);
      resolve({ allow: false, message: 'Pencere kapalı.' });
    }
  });
}

function registerIpc() {
  // --- Ayarlar ---
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, partial) => {
    const before = store.getSettings();
    const updated = store.setSettings(partial);
    // İzin modu değişirse oturum içi "hep izin ver" listesi güvenli tarafta sıfırlanır.
    if (before.permissionMode !== updated.permissionMode) sessionToolAllow.clear();
    return updated;
  });

  // --- API anahtarı (değeri renderer'a asla dönmez) ---
  ipcMain.handle('apiKey:has', () => store.hasApiKey());
  ipcMain.handle('apiKey:set', (_e, key) => {
    store.setApiKey(key);
    return true;
  });
  ipcMain.handle('apiKey:clear', () => {
    store.clearApiKey();
    return true;
  });

  // --- Dizin seçimi ---
  ipcMain.handle('dialog:selectDirectory', () => dialogs.selectDirectory());

  // --- Seçili dizinde terminal aç ---
  ipcMain.handle('terminal:open', (_e, cwd) => terminal.openTerminal(cwd));

  // --- Kullan?m limitleri / oturum durumu ---
  // Her okuma bir CLI oturumu açtığı için kısa süreli önbellek kullanılır.
  ipcMain.handle('usage:get', (_e, options) => getUsageCached(Boolean(options && options.force)));

  // --- Model listesi (efor yeteneği için) ---
  ipcMain.handle('models:get', () => getModelsCached());

  // --- Proje bazlı token/maliyet istatistiği ---
  ipcMain.handle('stats:get', () => usageStats.getUsageStats());

  // --- Konuşma geçmişi (sol menü) ---
  ipcMain.handle('conversation:list', () => conversations.list());
  ipcMain.handle('conversation:load', (_e, id) => conversations.load(id));
  ipcMain.handle('conversation:delete', (_e, id) => {
    conversations.remove(id);
    return true;
  });
  ipcMain.handle('conversation:search', (_e, query) => conversations.search(query));
  ipcMain.handle('conversation:export', async (_e, id) => {
    const exported = conversations.toMarkdown(id);
    if (!exported) return { ok: false, error: 'Konuşma bulunamadı.' };
    const safeTitle = String(exported.meta.title || 'konusma')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 60)
      .trim() || 'konusma';
    try {
      const result = await dialogs.saveTextFile({
        title: 'Konuşmayı Markdown olarak kaydet',
        defaultPath: `${safeTitle}.md`,
        content: exported.markdown,
      });
      if (result.canceled) return { ok: false, canceled: true };
      return { ok: true, path: result.path };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- Agent oturumu ---
  ipcMain.on('agent:run', async (event, payload) => {
    const send = (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
      }
    };

    const settings = store.getSettings();
    const provider = payload.provider === 'codex' || payload.provider === 'claude'
      ? payload.provider
      : settings.provider || 'claude';
    const activeProject = (settings.projects || []).find((p) => p.id === settings.activeProjectId) || null;

    // Konu?ma kayd?n? ??z: mevcutsa kendi dizininde devam eder, yoksa aktif proje diziniyle olu?turulur.
    let conv = payload.conversationId ? conversations.get(payload.conversationId) : null;
    if (!conv) {
      if (!activeProject || !activeProject.cwd) {
        send('agent:error', { message: '\u00d6nce sol panelden bir proje ekleyin veya se\u00e7in.' });
        return;
      }
      conv = conversations.create({ cwd: activeProject.cwd });
      send('conversation:created', conv);
    }

    const transcriptBeforeTurn = conversations.load(conv.id).transcript;
    const providerSessions = conv.providerSessions || {};
    const providerSession = providerSessions[provider] || {};
    const hasNativeSession = provider === 'codex'
      ? Boolean(providerSession.threadId)
      : Boolean(providerSession.sessionId || conv.sessionId);
    const lastProviderEntry = [...transcriptBeforeTurn]
      .reverse()
      .find((entry) => entry && entry.provider && (entry.kind === 'user' || entry.kind === 'sdk'));
    const isProviderSwitch = Boolean(lastProviderEntry && lastProviderEntry.provider !== provider);
    const bridgeContext = !hasNativeSession || isProviderSwitch
      ? buildBridgeContext({ transcript: transcriptBeforeTurn, targetProvider: provider })
      : '';

    // Kullanıcı mesajını kaydet; ilk mesajsa başlığı türet.
    conversations.appendEntry(conv.id, { kind: 'user', provider, text: payload.prompt, ts: Date.now() });
    if (!conv.title) {
      conv = conversations.update(conv.id, { title: conversations.titleFromPrompt(payload.prompt) });
      send('conversation:updated', conv);
    }

    try {
      await agent.runQuery({
        provider,
        prompt: payload.prompt,
        cwd: conv.cwd,
        resumeSessionId: providerSession.sessionId || conv.sessionId || undefined,
        resumeThreadId: providerSession.threadId || undefined,
        bridgeContext,
        onMessage: (msg) => {
          // Akış deltaları yalnızca canlı gösterim içindir; transcript'e tam mesajlar yazılır.
          if (msg && msg.type === 'assistant_delta') {
            send('agent:message', msg);
            return;
          }
          conversations.appendEntry(conv.id, { kind: 'sdk', provider: msg.provider || provider, message: msg });
          if (msg && msg.type === 'system' && msg.subtype === 'init') {
            if ((msg.provider || provider) === 'claude' && msg.session_id) {
              const updated = conversations.updateProviderSession(conv.id, 'claude', { sessionId: msg.session_id });
              if (updated) send('conversation:updated', updated);
            } else if ((msg.provider || provider) === 'codex' && msg.thread_id) {
              const updated = conversations.updateProviderSession(conv.id, 'codex', { threadId: msg.thread_id });
              if (updated) send('conversation:updated', updated);
            }
          }
          send('agent:message', msg);
        },
        requestPermission: requestPermissionFromRenderer,
      });
      const updated = conversations.touch(conv.id);
      send('conversation:updated', updated);
      send('agent:done', {});
    } catch (err) {
      conversations.touch(conv.id);
      send('agent:error', { message: err.message });
    }
  });

  ipcMain.on('agent:cancel', () => {
    agent.cancel();
  });

  // --- İzin yanıtı (renderer -> main) ---
  ipcMain.on('permission:response', (_e, res) => {
    const resolve = pendingPermissions.get(res.id);
    if (!resolve) return;
    pendingPermissions.delete(res.id);
    if (res.allow && res.remember === 'session' && typeof res.toolName === 'string' && res.toolName.trim()) {
      sessionToolAllow.add(res.toolName.trim());
    }
    resolve({ allow: Boolean(res.allow), message: res.message });
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


