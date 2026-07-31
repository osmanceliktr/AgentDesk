'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const store = require('./store');
const agent = require('./agent');
const dialogs = require('./dialogs');
const conversations = require('./conversations');
const usageLimits = require('./usageLimits');
const { buildBridgeContext } = require('./contextBridgeBuilder');

let mainWindow = null;

// Bekleyen izin isteklerini (canUseTool) id ile eşleştirir.
const pendingPermissions = new Map();
let permissionSeq = 0;

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
  ipcMain.handle('settings:set', (_e, partial) => store.setSettings(partial));

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

  // --- Kullan?m limitleri / oturum durumu ---
  ipcMain.handle('usage:get', () => usageLimits.getUsageLimits());

  // --- Konuşma geçmişi (sol menü) ---
  ipcMain.handle('conversation:list', () => conversations.list());
  ipcMain.handle('conversation:load', (_e, id) => conversations.load(id));
  ipcMain.handle('conversation:delete', (_e, id) => {
    conversations.remove(id);
    return true;
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
    if (resolve) {
      pendingPermissions.delete(res.id);
      resolve({ allow: Boolean(res.allow), message: res.message });
    }
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


