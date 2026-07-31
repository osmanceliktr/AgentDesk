'use strict';

// Konuşma geçmişi: her konuşma kullanıcı profilinde ayrı bir JSON dosyasında
// saklanır. Index kaydı sağlayıcı session/thread id'lerini tutar; transcript
// dosyası UI'da geri oynatılacak kullanıcı ve agent mesajlarını içerir.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

function getDir() {
  const dir = path.join(app.getPath('userData'), 'conversations');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath() {
  return path.join(getDir(), 'index.json');
}

function transcriptPath(id) {
  return path.join(getDir(), `${id}.json`);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const providerSessions = { ...(record.providerSessions || {}) };
  if (record.sessionId && (!providerSessions.claude || !providerSessions.claude.sessionId)) {
    providerSessions.claude = { ...(providerSessions.claude || {}), sessionId: record.sessionId };
  }
  return { ...record, providerSessions };
}

function readIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    return Array.isArray(list) ? list.map(normalizeRecord) : [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  fs.writeFileSync(indexPath(), JSON.stringify(list.map(normalizeRecord), null, 2), 'utf8');
}

function readTranscript(id) {
  try {
    const transcript = JSON.parse(fs.readFileSync(transcriptPath(id), 'utf8'));
    return Array.isArray(transcript) ? transcript : [];
  } catch {
    return [];
  }
}

function writeTranscript(id, entries) {
  fs.writeFileSync(transcriptPath(id), JSON.stringify(entries), 'utf8');
}

function list() {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

function get(id) {
  return readIndex().find((c) => c.id === id) || null;
}

function create({ cwd }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const record = {
    id,
    title: null,
    cwd,
    sessionId: null,
    providerSessions: {},
    createdAt: now,
    updatedAt: now,
  };
  const idx = readIndex();
  idx.push(record);
  writeIndex(idx);
  writeTranscript(id, []);
  return record;
}

function update(id, partial) {
  const idx = readIndex();
  const i = idx.findIndex((c) => c.id === id);
  if (i === -1) return null;
  idx[i] = normalizeRecord({ ...idx[i], ...partial, updatedAt: Date.now() });
  writeIndex(idx);
  return idx[i];
}

function updateProviderSession(id, provider, sessionPatch) {
  const current = get(id);
  if (!current || !provider) return null;
  const providerSessions = {
    ...(current.providerSessions || {}),
    [provider]: {
      ...((current.providerSessions && current.providerSessions[provider]) || {}),
      ...(sessionPatch || {}),
    },
  };
  const legacy = provider === 'claude' && sessionPatch && sessionPatch.sessionId
    ? { sessionId: sessionPatch.sessionId }
    : {};
  return update(id, { ...legacy, providerSessions });
}

function touch(id) {
  return update(id, {});
}

function appendEntry(id, entry) {
  const t = readTranscript(id);
  t.push(entry);
  writeTranscript(id, t);
}

function load(id) {
  const meta = get(id);
  if (!meta) return null;
  return { meta, transcript: readTranscript(id) };
}

function remove(id) {
  const idx = readIndex().filter((c) => c.id !== id);
  writeIndex(idx);
  try {
    fs.unlinkSync(transcriptPath(id));
  } catch {
    // dosya zaten yoksa sorun değil
  }
}

function titleFromPrompt(prompt) {
  const oneLine = String(prompt).replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine || 'Yeni Konuşma';
}

module.exports = {
  list,
  get,
  create,
  update,
  updateProviderSession,
  touch,
  appendEntry,
  load,
  remove,
  titleFromPrompt,
};
