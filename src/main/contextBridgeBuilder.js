'use strict';

const MAX_CONTEXT_CHARS = 12000;
const MAX_RECENT_MESSAGES = 8;
const MAX_TOOL_SUMMARIES = 5;
const MAX_CODE_BLOCK_CHARS = 1200;

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODEX_API_KEY)\s*[:=]\s*["']?[^"'\s]+/gi,
  /\b(bearer|token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+/gi,
];

function redactSecrets(text) {
  let out = String(text || '');
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, label) => {
      if (!label) return '[REDACTED_SECRET]';
      return `${label}=[REDACTED_SECRET]`;
    });
  }
  return out;
}

function collapseCodeBlocks(text) {
  return String(text || '').replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
    if (code.length <= MAX_CODE_BLOCK_CHARS) return match;
    const fence = lang || '';
    return `\`\`\`${fence}\n[kod bloğu özetlendi: ${code.length} karakter]\n\`\`\``;
  });
}

function trimText(text, max = 1600) {
  const safe = collapseCodeBlocks(redactSecrets(text)).replace(/\s+\n/g, '\n').trim();
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max)}\n[metin kısaltıldı: ${safe.length - max} karakter çıkarıldı]`;
}

function stringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function providerLabel(provider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function normalizeForDuplicate(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractAssistantText(message) {
  if (!message) return '';
  if (message.type === 'result' && message.result) return message.result;
  if (message.type !== 'assistant') return '';
  const blocks = (message.message && message.message.content) || [];
  if (!Array.isArray(blocks)) return trimText(blocks);
  return blocks
    .filter((block) => block && block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n\n');
}

function summarizeToolMessage(message) {
  if (!message) return '';
  if (message.type === 'assistant') {
    const blocks = (message.message && message.message.content) || [];
    const tool = Array.isArray(blocks) && blocks.find((block) => block && block.type === 'tool_use');
    if (tool) return `Araç: ${tool.name || 'bilinmeyen'}; girdi: ${trimText(stringify(tool.input), 600)}`;
  }
  if (message.type === 'user') {
    const blocks = (message.message && message.message.content) || [];
    const result = Array.isArray(blocks) && blocks.find((block) => block && block.type === 'tool_result');
    if (result) {
      const content = Array.isArray(result.content)
        ? result.content.map((c) => (typeof c === 'string' ? c : c.text || stringify(c))).join('\n')
        : result.content;
      return `Araç sonucu${result.is_error ? ' (hata)' : ''}: ${trimText(content, 600)}`;
    }
  }
  return '';
}

function buildBridgeContext({ transcript, targetProvider }) {
  if (!Array.isArray(transcript) || transcript.length === 0) return '';

  const recent = [];
  const recentTextKeys = new Set();
  const tools = [];
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i];
    if (!entry) continue;
    if (recent.length < MAX_RECENT_MESSAGES && entry.kind === 'user' && entry.text) {
      recent.unshift(`Kullanıcı: ${trimText(entry.text)}`);
    } else if (recent.length < MAX_RECENT_MESSAGES && entry.kind === 'sdk') {
      const text = extractAssistantText(entry.message);
      const key = normalizeForDuplicate(text);
      if (text && !recentTextKeys.has(key)) {
        recentTextKeys.add(key);
        recent.unshift(`${providerLabel(entry.provider || entry.message.provider)} asistan: ${trimText(text)}`);
      }
    }

    if (tools.length < MAX_TOOL_SUMMARIES && entry.kind === 'sdk') {
      const summary = summarizeToolMessage(entry.message);
      if (summary) tools.unshift(`${providerLabel(entry.provider || entry.message.provider)} ${summary}`);
    }

    if (recent.length >= MAX_RECENT_MESSAGES && tools.length >= MAX_TOOL_SUMMARIES) break;
  }

  const body = [
    `Aşağıdaki bölüm, bu konuşmada daha önce başka sağlayıcıyla oluşan sınırlı bağlam özetidir. Hedef sağlayıcı: ${providerLabel(targetProvider)}.`,
    '',
    'Son mesajlar:',
    recent.length ? recent.join('\n\n') : '- Yok',
    '',
    'Son araç/dosya işlem özetleri:',
    tools.length ? tools.map((t) => `- ${t}`).join('\n') : '- Yok',
    '',
    'Bu bağlamı önceki konuşmanın özeti olarak kullan; kullanıcının yeni isteği aşağıdadır.',
  ].join('\n');

  return trimText(body, MAX_CONTEXT_CHARS);
}

function withBridgeContext(prompt, bridgeContext) {
  if (!bridgeContext) return prompt;
  return `${bridgeContext}\n\n---\n\nYeni kullanıcı isteği:\n${prompt}`;
}

module.exports = { buildBridgeContext, withBridgeContext, redactSecrets, trimText };

