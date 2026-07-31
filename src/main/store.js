'use strict';

// Ayarların ve API anahtarının kalıcı saklanması.
// - Ayarlar: electron-store (kullanıcı profilinde JSON).
// - API anahtarı: Electron safeStorage ile şifrelenip base64 olarak saklanır.
//   Anahtarın düz metin hali renderer'a ASLA dönmez; sadece main içinde çözülür.

const Store = require('electron-store');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');

const PERMISSION_MODES = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
const PROVIDERS = ['claude', 'codex'];
// Claude Agent SDK: Options.effort
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Codex SDK: ThreadOptions.modelReasoningEffort ('' = Codex CLI varsayılanı)
const CODEX_EFFORTS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh'];
// Arayüz temaları; renk tanımları src/renderer/style.css içindeki [data-theme] blokları.
const THEMES = [
  'gece',
  'gunduz',
  'ceviz-krem',
  'buz-mavisi',
  'gul-kurusu',
  'derin-deniz',
  'bordo-ates',
  'zumrut-orman',
];

const DEFAULT_SETTINGS = {
  // 'plan'            → sadece plan üretir, düzenleme yapmaz
  // 'acceptEdits'     → düzenlemeleri onay istemeden uygular (varsayılan)
  // 'default'         → her araç için onay penceresi çıkarır
  // 'bypassPermissions' → HİÇBİR şey için onay istemez (terminal komutları dahil)
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  model: 'claude-opus-4-5',
  provider: 'claude',
  codexModel: '',
  effort: 'high', // Claude reasoning effort
  codexEffort: '', // Codex reasoning effort (boş → CLI varsayılanı)
  sendOnEnter: false,
  theme: 'gece', // arayüz teması
  allowedTools: ['Read', 'Grep', 'Glob'],
  projects: [],
  activeProjectId: null,
  lastDirectory: null, // legacy: eski profiller i?in son se?ilen ?al??ma dizini
};

const store = new Store({
  name: 'ai-cli-agent',
  defaults: {
    settings: DEFAULT_SETTINGS,
    apiKeyEnc: null, // base64(safeStorage.encryptString(...))
  },
});

function projectIdFromPath(cwd) {
  return crypto.createHash('sha1').update(String(cwd).toLowerCase()).digest('hex').slice(0, 12);
}

function projectNameFromPath(cwd) {
  return path.basename(cwd) || cwd;
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object' || typeof project.cwd !== 'string') return null;
  const rawCwd = project.cwd.trim();
  if (!rawCwd || !path.isAbsolute(rawCwd)) return null;
  const cwd = path.normalize(rawCwd);
  const name = typeof project.name === 'string' && project.name.trim()
    ? project.name.trim().slice(0, 80)
    : projectNameFromPath(cwd);
  const id = typeof project.id === 'string' && project.id.trim()
    ? project.id.trim().slice(0, 80)
    : projectIdFromPath(cwd);
  return { id, name, cwd };
}

// Renderer'dan gelen değerleri beyaz-listeye kıstır: geçersiz değer varsayılana düşer.
function pickFrom(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const projects = [];
  const seen = new Set();
  for (const raw of Array.isArray(merged.projects) ? merged.projects : []) {
    const project = normalizeProject(raw);
    if (!project) continue;
    const key = project.cwd.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    projects.push(project);
  }

  if (projects.length === 0 && typeof merged.lastDirectory === 'string' && merged.lastDirectory.trim()) {
    const legacy = normalizeProject({ cwd: merged.lastDirectory });
    if (legacy) projects.push(legacy);
  }

  const activeExists = projects.some((p) => p.id === merged.activeProjectId);
  const activeProjectId = activeExists ? merged.activeProjectId : (projects[0] && projects[0].id) || null;
  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  const maxTurns = Math.min(100, Math.max(1, Math.round(Number(merged.maxTurns)) || DEFAULT_SETTINGS.maxTurns));
  const allowedTools = Array.isArray(merged.allowedTools)
    ? merged.allowedTools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim())
    : DEFAULT_SETTINGS.allowedTools;

  return {
    ...merged,
    permissionMode: pickFrom(merged.permissionMode, PERMISSION_MODES, DEFAULT_SETTINGS.permissionMode),
    provider: pickFrom(merged.provider, PROVIDERS, DEFAULT_SETTINGS.provider),
    effort: pickFrom(merged.effort, CLAUDE_EFFORTS, DEFAULT_SETTINGS.effort),
    codexEffort: pickFrom(merged.codexEffort, CODEX_EFFORTS, DEFAULT_SETTINGS.codexEffort),
    model: typeof merged.model === 'string' && merged.model.trim() ? merged.model.trim() : DEFAULT_SETTINGS.model,
    codexModel: typeof merged.codexModel === 'string' ? merged.codexModel.trim() : DEFAULT_SETTINGS.codexModel,
    sendOnEnter: Boolean(merged.sendOnEnter),
    theme: pickFrom(merged.theme, THEMES, DEFAULT_SETTINGS.theme),
    maxTurns,
    allowedTools,
    projects,
    activeProjectId,
    lastDirectory: activeProject ? activeProject.cwd : merged.lastDirectory || null,
  };
}

function getSettings() {
  // Varsay?lanlarla birle?tir ki eski profillerde eksik alan kalmas?n.
  return normalizeSettings(store.get('settings') || {});
}

function setSettings(partial) {
  const merged = normalizeSettings({ ...getSettings(), ...(partial || {}) });
  store.set('settings', merged);
  return merged;
}

function setApiKey(plain) {
  if (!plain || typeof plain !== 'string') {
    throw new Error('Geçersiz API anahtarı');
  }
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(plain);
    store.set('apiKeyEnc', enc.toString('base64'));
    store.set('apiKeyPlain', null);
  } else {
    // Fallback: OS şifrelemesi yoksa uyar ve düz sakla (ideal değil).
    console.warn('[store] safeStorage kullanılamıyor; anahtar şifrelenmeden saklanıyor.');
    store.set('apiKeyEnc', null);
    store.set('apiKeyPlain', plain);
  }
}

function getApiKey() {
  const enc = store.get('apiKeyEnc');
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch (err) {
      console.error('[store] API anahtarı çözülemedi:', err.message);
      return null;
    }
  }
  return store.get('apiKeyPlain') || null;
}

function hasApiKey() {
  return Boolean(store.get('apiKeyEnc') || store.get('apiKeyPlain'));
}

function clearApiKey() {
  store.set('apiKeyEnc', null);
  store.set('apiKeyPlain', null);
}

module.exports = {
  DEFAULT_SETTINGS,
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  THEMES,
  getSettings,
  setSettings,
  setApiKey,
  getApiKey,
  hasApiKey,
  clearApiKey,
};

