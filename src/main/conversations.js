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

// Transcript girdisinden düz metin çıkarır (arama ve dışa aktarma için).
function entryText(entry) {
  if (!entry) return '';
  if (entry.kind === 'user') return String(entry.text || '');
  const message = entry.message;
  if (!message) return '';
  if (message.type === 'result') return String(message.result || '');
  const content = message.message && message.message.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block) return '';
      if (block.type === 'text') return block.text || '';
      if (block.type === 'thinking') return block.thinking || '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// Başlık ve transcript içeriğinde düz metin araması yapar.
function search(query, { limit = 50 } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  const results = [];
  for (const record of list()) {
    const title = String(record.title || '');
    let snippet = '';
    let matched = title.toLowerCase().includes(needle);

    if (!matched) {
      for (const entry of readTranscript(record.id)) {
        const text = entryText(entry);
        const index = text.toLowerCase().indexOf(needle);
        if (index === -1) continue;
        matched = true;
        const start = Math.max(0, index - 40);
        snippet = `${start > 0 ? '…' : ''}${text.slice(start, index + needle.length + 60).replace(/\s+/g, ' ')}…`;
        break;
      }
    }

    if (matched) results.push({ id: record.id, snippet });
    if (results.length >= limit) break;
  }
  return results;
}

function providerName(provider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

// Konuşmayı Markdown'a çevirir.
function toMarkdown(id) {
  const data = load(id);
  if (!data) return null;
  const { meta, transcript } = data;
  const lines = [
    `# ${meta.title || 'Konuşma'}`,
    '',
    `- Dizin: \`${meta.cwd || ''}\``,
    `- Oluşturulma: ${new Date(meta.createdAt).toLocaleString('tr-TR')}`,
    `- Güncelleme: ${new Date(meta.updatedAt).toLocaleString('tr-TR')}`,
    '',
  ];

  for (const entry of transcript) {
    if (entry.kind === 'user') {
      lines.push(`## Sen (${providerName(entry.provider)})`, '', String(entry.text || ''), '');
      continue;
    }
    const message = entry.message;
    if (!message) continue;

    if (message.type === 'assistant') {
      const content = (message.message && message.message.content) || [];
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === 'text' && block.text) {
          lines.push(`## Asistan (${providerName(entry.provider)})`, '', block.text, '');
        } else if (block.type === 'tool_use') {
          lines.push(`### Araç: ${block.name}`, '', '```json', JSON.stringify(block.input, null, 2), '```', '');
        }
      }
    } else if (message.type === 'result' && message.result) {
      lines.push('### Sonuç', '', String(message.result), '');
    }
  }

  return { meta, markdown: lines.join('\n') };
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
  search,
  toMarkdown,
  titleFromPrompt,
};
