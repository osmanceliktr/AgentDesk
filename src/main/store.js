'use strict';

// Ayarların ve API anahtarının kalıcı saklanması.
// - Ayarlar: electron-store (kullanıcı profilinde JSON).
// - API anahtarı: Electron safeStorage ile şifrelenip base64 olarak saklanır.
//   Anahtarın düz metin hali renderer'a ASLA dönmez; sadece main içinde çözülür.

const Store = require('electron-store');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');

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

  return {
    ...merged,
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
  getSettings,
  setSettings,
  setApiKey,
  getApiKey,
  hasApiKey,
  clearApiKey,
};

