'use strict';

// Proje bazlı token/maliyet istatistiği.
// Kaynak: konuşma transcript'lerindeki `result` mesajları.
//  - Claude: SDK her tur için `total_cost_usd` ve model kırılımı (`modelUsage`) bildirir.
//  - Codex: yalnızca token sayıları gelir, maliyet bildirilmez.
// Hesaplama tahmine dayanmaz; yalnızca sağlayıcıların bildirdiği değerler toplanır.

const path = require('path');

const store = require('./store');
const conversations = require('./conversations');

function normalizeKey(cwd) {
  return String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function emptyBucket() {
  return {
    conversations: 0,
    turns: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    reasoning: 0,
    cost: 0,
    costReported: false,
  };
}

function addBucket(target, source) {
  target.conversations += source.conversations;
  target.turns += source.turns;
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheCreate += source.cacheCreate;
  target.reasoning += source.reasoning;
  target.cost += source.cost;
  target.costReported = target.costReported || source.costReported;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Tek bir `result` mesajını kovaya işler.
function applyResult(bucket, message, modelTotals, fallbackModel) {
  bucket.turns += 1;

  const usage = message.usage || {};
  bucket.input += num(usage.input_tokens);
  bucket.output += num(usage.output_tokens);
  bucket.cacheRead += num(usage.cache_read_input_tokens) + num(usage.cached_input_tokens);
  bucket.cacheCreate += num(usage.cache_creation_input_tokens) + num(usage.cache_write_input_tokens);
  bucket.reasoning += num(usage.reasoning_output_tokens);

  if (typeof message.total_cost_usd === 'number') {
    bucket.cost += message.total_cost_usd;
    bucket.costReported = true;
  }

  // Model kırılımı: Claude modelUsage verirse onu, yoksa oturumun modelini kullan.
  const modelUsage = message.modelUsage && typeof message.modelUsage === 'object' ? message.modelUsage : null;
  if (modelUsage) {
    for (const [name, entry] of Object.entries(modelUsage)) {
      const row = modelTotals.get(name) || { name, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0, costReported: false };
      row.input += num(entry.inputTokens);
      row.output += num(entry.outputTokens);
      row.cacheRead += num(entry.cacheReadInputTokens);
      row.cacheCreate += num(entry.cacheCreationInputTokens);
      if (typeof entry.costUSD === 'number') {
        row.cost += entry.costUSD;
        row.costReported = true;
      }
      modelTotals.set(name, row);
    }
    return;
  }

  const name = fallbackModel || '(bilinmeyen model)';
  const row = modelTotals.get(name) || { name, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0, costReported: false };
  row.input += num(usage.input_tokens);
  row.output += num(usage.output_tokens);
  row.cacheRead += num(usage.cached_input_tokens) + num(usage.cache_read_input_tokens);
  row.cacheCreate += num(usage.cache_write_input_tokens) + num(usage.cache_creation_input_tokens);
  modelTotals.set(name, row);
}

function makeGroup({ id, name, cwd, known }) {
  return {
    id,
    name,
    cwd,
    known,
    totals: emptyBucket(),
    providers: { claude: emptyBucket(), codex: emptyBucket() },
    models: new Map(),
    lastActivity: 0,
    conversations: [],
  };
}

function finalizeGroup(group) {
  const models = [...group.models.values()]
    .filter((row) => row.input || row.output || row.cost)
    .sort((a, b) => b.cost - a.cost || b.output - a.output);
  const topConversations = group.conversations
    .filter((row) => row.turns > 0)
    .sort((a, b) => b.cost - a.cost || b.output - a.output)
    .slice(0, 5);

  return {
    id: group.id,
    name: group.name,
    cwd: group.cwd,
    known: group.known,
    totals: group.totals,
    providers: group.providers,
    models,
    topConversations,
    lastActivity: group.lastActivity,
  };
}

/**
 * Tüm konuşmaları tarar ve proje bazlı token/maliyet özetini döndürür.
 */
function getUsageStats() {
  const settings = store.getSettings();
  const projects = Array.isArray(settings.projects) ? settings.projects : [];

  const groups = new Map();
  for (const project of projects) {
    groups.set(normalizeKey(project.cwd), makeGroup({
      id: project.id,
      name: project.name || path.basename(project.cwd || '') || project.cwd,
      cwd: project.cwd,
      known: true,
    }));
  }

  for (const meta of conversations.list()) {
    const key = normalizeKey(meta.cwd);
    if (!groups.has(key)) {
      groups.set(key, makeGroup({
        id: `unknown:${key}`,
        name: path.basename(meta.cwd || '') || meta.cwd || 'Bilinmeyen dizin',
        cwd: meta.cwd,
        known: false,
      }));
    }
    const group = groups.get(key);
    group.totals.conversations += 1;
    group.lastActivity = Math.max(group.lastActivity, num(meta.updatedAt));

    const data = conversations.load(meta.id);
    if (!data) continue;

    const convBucket = emptyBucket();
    let currentModel = null;

    for (const entry of data.transcript) {
      if (entry.kind !== 'sdk' || !entry.message) continue;
      const message = entry.message;
      const provider = message.provider === 'codex' ? 'codex' : entry.provider === 'codex' ? 'codex' : 'claude';

      if (message.type === 'system' && message.subtype === 'init' && message.model) {
        currentModel = message.model;
        continue;
      }
      if (message.type !== 'result') continue;

      const providerBucket = group.providers[provider];
      providerBucket.conversations = providerBucket.conversations || 0;
      applyResult(providerBucket, message, group.models, currentModel);
      applyResult(convBucket, message, new Map(), currentModel);
    }

    addBucket(group.totals, { ...convBucket, conversations: 0 });
    group.conversations.push({
      id: meta.id,
      title: meta.title || 'Yeni Konuşma',
      turns: convBucket.turns,
      cost: convBucket.cost,
      input: convBucket.input,
      output: convBucket.output,
      updatedAt: num(meta.updatedAt),
    });
  }

  const list = [...groups.values()].map(finalizeGroup);
  list.sort((a, b) => b.totals.cost - a.totals.cost || b.totals.output - a.totals.output || b.lastActivity - a.lastActivity);

  const grand = emptyBucket();
  for (const group of list) addBucket(grand, group.totals);

  return {
    generatedAt: Date.now(),
    projects: list,
    grand,
  };
}

module.exports = { getUsageStats };
