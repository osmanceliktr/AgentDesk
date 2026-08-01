'use strict';

const api = window.agentAPI;

// --- DOM ---
const el = {
  sidebar: document.getElementById('sidebar'),
  btnNewChat: document.getElementById('btn-new-chat'),
  btnAddProject: document.getElementById('btn-add-project'),
  projectList: document.getElementById('project-list'),
  convSearch: document.getElementById('conv-search'),
  projectName: document.getElementById('project-name'),
  projectPath: document.getElementById('project-path'),
  turnStats: document.getElementById('turn-stats'),
  btnTerminal: document.getElementById('btn-terminal'),
  btnExport: document.getElementById('btn-export'),
  btnStats: document.getElementById('btn-stats'),
  usageBadge: document.getElementById('usage-badge'),
  statsOverlay: document.getElementById('stats-overlay'),
  statsStatus: document.getElementById('stats-status'),
  statsContent: document.getElementById('stats-content'),
  btnStatsRefresh: document.getElementById('btn-stats-refresh'),
  btnStatsClose: document.getElementById('btn-stats-close'),
  providerSelect: document.getElementById('provider-select'),
  inlineModelSelect: document.getElementById('inline-model-select'),
  effortSelect: document.getElementById('effort-select'),
  modeSelect: document.getElementById('mode-select'),
  btnUsage: document.getElementById('btn-usage'),
  btnSettings: document.getElementById('btn-settings'),
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  btnSend: document.getElementById('btn-send'),
  btnCancel: document.getElementById('btn-cancel'),
  // settings
  settingsOverlay: document.getElementById('settings-overlay'),
  setApiKey: document.getElementById('set-apikey'),
  apiKeyStatus: document.getElementById('apikey-status'),
  setMode: document.getElementById('set-mode'),
  setModel: document.getElementById('set-model'),
  setEffort: document.getElementById('set-effort'),
  setCodexModel: document.getElementById('set-codex-model'),
  setCodexEffort: document.getElementById('set-codex-effort'),
  setSendOnEnter: document.getElementById('set-send-on-enter'),
  themePicker: document.getElementById('theme-picker'),
  setMaxTurns: document.getElementById('set-maxturns'),
  setTools: document.getElementById('set-tools'),
  btnClearKey: document.getElementById('btn-clear-key'),
  btnSettingsCancel: document.getElementById('btn-settings-cancel'),
  btnSettingsSave: document.getElementById('btn-settings-save'),
  usageOverlay: document.getElementById('usage-overlay'),
  usageStatus: document.getElementById('usage-status'),
  usageContent: document.getElementById('usage-content'),
  btnUsageRefresh: document.getElementById('btn-usage-refresh'),
  btnUsageClose: document.getElementById('btn-usage-close'),
  // permission
  permOverlay: document.getElementById('perm-overlay'),
  permTool: document.getElementById('perm-tool'),
  permDetail: document.getElementById('perm-detail'),
  permInput: document.getElementById('perm-input'),
  btnPermDeny: document.getElementById('btn-perm-deny'),
  btnPermAllow: document.getElementById('btn-perm-allow'),
  btnPermAllowSession: document.getElementById('btn-perm-allow-session'),
};

// --- Durum ---
let selectedDir = null;
let running = false;
let typingNode = null;
let currentPermId = null;
let currentPermTool = '';
let lastUserPrompt = '';
let searchMatches = null; // null = arama yok, Map(id -> snippet)
const expandedProjects = new Set(); // sol menüde açık olan proje id'leri
let sidebarInitialized = false;
let terminalFallbackNotified = false;
let usageTimer = null;
let modelsCache = null; // SDK'dan gelen model yetenekleri (efor seviyeleri)
let effortUnsupported = false; // seçili model efor kabul etmiyorsa true
const drafts = new Map(); // conversationId ('' = yeni konuşma) -> taslak metin
// Açık konuşmanın toplam token/maliyeti (transcript'teki result mesajlarından).
const turnTotals = { input: 0, output: 0, reasoning: 0, cost: 0 };
let currentConversationId = null; // null = henüz kaydedilmemiş "yeni konuşma"
let conversationsCache = [];
let projectsCache = [];
let activeProjectId = null;
let currentProvider = 'claude';
let settingsCache = null;
let lastAssistantText = '';
let pendingTheme = null; // ayarlar panelinde seçilen ama henüz kaydedilmemiş tema

const CLAUDE_MODEL_GROUPS = [
  { label: 'En yetenekli', options: [{ value: 'claude-fable-5', label: 'Claude Fable 5' }] },
  {
    label: 'Opus',
    options: [
      { value: 'claude-opus-5', label: 'Claude Opus 5' },
      { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    ],
  },
  {
    label: 'Sonnet',
    options: [
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    ],
  },
  { label: 'Haiku', options: [{ value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }] },
  { label: 'Özel erişim', options: [{ value: 'claude-mythos-5', label: 'Claude Mythos 5' }] },
];

// Efor (reasoning effort) seçenekleri — iki SDK'nın seviye listeleri aynı değil.
const CLAUDE_EFFORT_OPTIONS = [
  { value: 'low', label: 'Efor: Düşük' },
  { value: 'medium', label: 'Efor: Orta' },
  { value: 'high', label: 'Efor: Yüksek' },
  { value: 'xhigh', label: 'Efor: Çok yüksek' },
  { value: 'max', label: 'Efor: Maksimum' },
];

const CODEX_EFFORT_OPTIONS = [
  { value: '', label: 'Efor: Codex varsayılanı' },
  { value: 'minimal', label: 'Efor: Minimal' },
  { value: 'low', label: 'Efor: Düşük' },
  { value: 'medium', label: 'Efor: Orta' },
  { value: 'high', label: 'Efor: Yüksek' },
  { value: 'xhigh', label: 'Efor: Çok yüksek' },
];

// Arayüz temaları. value → src/main/store.js THEMES ve style.css [data-theme] blokları
// ile birebir aynı olmalı. dots: kartta gösterilen zemin/yüzey/vurgu örnekleri.
const THEME_OPTIONS = [
  { value: 'gece', label: 'Gece', dots: ['#1e1e2e', '#2f3147', '#7c93ff'] },
  { value: 'gunduz', label: 'Gündüz', dots: ['#f4f6fb', '#eaeef7', '#4a5bd0'] },
  { value: 'ceviz-krem', label: 'Ceviz Krem', dots: ['#f4ecdf', '#eadfcc', '#94521f'] },
  { value: 'buz-mavisi', label: 'Buz Mavisi', dots: ['#eef3fa', '#e1eaf6', '#1160bd'] },
  { value: 'gul-kurusu', label: 'Gül Kurusu', dots: ['#faf1f2', '#f2e2e4', '#a82f52'] },
  { value: 'derin-deniz', label: 'Derin Deniz', dots: ['#0c1622', '#17293e', '#3fb6f0'] },
  { value: 'bordo-ates', label: 'Bordo Ateş', dots: ['#1a1113', '#2e1c20', '#e8556c'] },
  { value: 'zumrut-orman', label: 'Zümrüt Orman', dots: ['#0d1a14', '#182f23', '#2fd6b0'] },
];
const DEFAULT_THEME = 'gece';

const CODEX_MODEL_GROUPS = [
  {
    label: 'Codex',
    options: [
      { value: '', label: 'Codex varsayılanı' },
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      { value: 'gpt-5.5', label: 'GPT-5.5' },
      { value: 'gpt-5.2', label: 'GPT-5.2' },
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function updateSendState() {
  el.btnSend.disabled = running || !selectedDir || el.input.value.trim() === '';
  el.btnCancel.disabled = !running;
  el.providerSelect.disabled = running;
  el.inlineModelSelect.disabled = running;
  el.effortSelect.disabled = running || effortUnsupported;
  el.modeSelect.disabled = running;
  el.btnUsage.disabled = running;
  el.btnStats.disabled = running;
  el.btnExport.disabled = running;
  // Terminal açmak agent turunu etkilemez; yalnızca dizin yoksa kapalı.
  el.btnTerminal.disabled = !selectedDir;
  el.btnTerminal.title = selectedDir
    ? `Komut istemi (cmd) aç: ${selectedDir}`
    : 'Önce bir proje seçin';
  el.btnAddProject.disabled = running;
  el.btnNewChat.disabled = running || !selectedDir;
  // Bir yan?t akarken proje/konu?ma de?i?tirmeyi engelle.
  el.sidebar.classList.toggle('disabled', running);
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

// Composer içeriğe göre büyür (en fazla ~200px).
function autoGrowInput() {
  // Boşken satır sayısına dayalı CSS yüksekliğine dön: boş textarea'da
  // scrollHeight ölçümü güvenilir değil.
  if (!el.input.value) {
    el.input.style.height = '';
    return;
  }
  el.input.style.height = '0px';
  el.input.style.height = `${Math.min(200, Math.max(64, el.input.scrollHeight))}px`;
}

function draftKey() {
  return currentConversationId || '';
}

function saveDraft() {
  const value = el.input.value;
  if (value.trim()) drafts.set(draftKey(), value);
  else drafts.delete(draftKey());
}

function restoreDraft() {
  el.input.value = drafts.get(draftKey()) || '';
  autoGrowInput();
  updateSendState();
}

function insertAtCursor(text) {
  const start = el.input.selectionStart ?? el.input.value.length;
  const end = el.input.selectionEnd ?? start;
  const before = el.input.value.slice(0, start);
  const after = el.input.value.slice(end);
  const spacer = before && !/\s$/.test(before) ? ' ' : '';
  el.input.value = `${before}${spacer}${text}${after}`;
  const caret = (before + spacer + text).length;
  el.input.setSelectionRange(caret, caret);
  el.input.focus();
  autoGrowInput();
  updateSendState();
}

function clearMessages() {
  el.messages.innerHTML = '';
  lastAssistantText = '';
}

// ---------------------------------------------------------------------------
// Hafif Markdown -> HTML dönüştürücü (bağımlılıksız).
// Önce HTML özel karakterleri escape edilir, ardından yalnızca bilinen
// güvenli etiketler (strong/em/code/pre/h1-3/ul/ol/li) eklenir — ham HTML
// asla geçirilmez. Kod blokları/satır içi kod, escape'ten önce ayrılıp
// yer tutucuyla korunur ki içindeki ** _ # gibi karakterler markdown
// olarak yorumlanmasın.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function groupMarkdownLists(text) {
  const lines = text.split('\n');
  const ulRe = /^\s*[-*]\s+(.*)$/;
  const olRe = /^\s*\d+\.\s+(.*)$/;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (ulRe.test(lines[i])) {
      const items = [];
      while (i < lines.length && ulRe.test(lines[i])) {
        items.push(`<li>${lines[i].match(ulRe)[1]}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
    } else if (olRe.test(lines[i])) {
      const items = [];
      while (i < lines.length && olRe.test(lines[i])) {
        items.push(`<li>${lines[i].match(olRe)[1]}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  return out.join('\n');
}

function markdownToHtml(raw) {
  if (!raw) return '';

  // 1) Kod bloklarını ve satır içi kodu önce çıkar, yer tutucuyla değiştir.
  const placeholders = [];
  const stash = (html) => {
    const token = ` ${placeholders.length} `;
    placeholders.push(html);
    return token;
  };

  let t = String(raw).replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const cls = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    return stash(`<pre class="md-code"${cls}><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
  });
  t = t.replace(/`([^`\n]+)`/g, (_m, code) => stash(`<code class="md-inline-code">${escapeHtml(code)}</code>`));

  // 2) Kalan her şeyi HTML-escape et (kod içeriği zaten yukarıda escape edildi).
  t = escapeHtml(t);

  // 3) Başlıklar
  t = t.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  t = t.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  t = t.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 4) Listeler
  t = groupMarkdownLists(t);

  // 5) Kalın / italik
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

  // 6) Yer tutucuları geri koy.
  t = t.replace(/ (\d+) /g, (_m, i) => placeholders[Number(i)]);

  return t;
}

// Mesajın sağ üstünde hover ile beliren küçük eylem düğmesi.
function addMessageAction(node, text, title, onClick) {
  let bar = node.querySelector('.msg-actions');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'msg-actions';
    node.appendChild(bar);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-action';
  btn.textContent = text;
  btn.title = title;
  btn.addEventListener('click', onClick);
  bar.appendChild(btn);
  return btn;
}

function attachCopyAction(node, getText) {
  addMessageAction(node, 'Kopyala', 'Metni panoya kopyala', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(getText());
      btn.textContent = 'Kopyalandı';
    } catch {
      btn.textContent = 'Kopyalanamadı';
    }
    setTimeout(() => {
      btn.textContent = 'Kopyala';
    }, 1500);
  });
}

function normalizeTechnicalSummaryText(value) {
  return String(value || '').replace(/\\{2,}/g, '\\').replace(/\\"/g, '"');
}

function trimMiddle(value, max = 120) {
  const text = normalizeTechnicalSummaryText(value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const head = Math.ceil((max - 3) * 0.62);
  const tail = Math.floor((max - 3) * 0.38);
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function parseMaybeJson(text) {
  const raw = String(text || '').trim();
  if (!raw || !/^[{[]/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function unwrapShellCommand(command) {
  const raw = String(command || '').trim();
  const match = raw.match(/(?:^|\s)-Command\s+(['"])([\s\S]*)\1\s*$/i);
  if (match && match[2]) return match[2].trim();
  return raw;
}

function summarizeTechnicalPayload(text, fallbackLabel) {
  const payload = parseMaybeJson(text);
  const raw = String(text || '');
  const lineCount = raw ? raw.split(/\r?\n/).length : 0;
  const size = raw.length >= 1000 ? `${Math.round(raw.length / 100) / 10} KB` : `${raw.length} karakter`;

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const command = payload.command || (payload.input && payload.input.command) || '';
    const output = typeof payload.output === 'string' ? payload.output : '';
    const parts = [];
    if (typeof payload.exit_code === 'number') {
      parts.push(payload.exit_code === 0 ? 'başarılı' : `çıkış ${payload.exit_code}`);
    } else if (payload.status) {
      parts.push(String(payload.status));
    }
    if (output) parts.push(`${output.split(/\r?\n/).filter(Boolean).length || 1} satır çıktı`);
    else parts.push(size);

    if (command) {
      return {
        title: `Komut çıktısı: ${trimMiddle(unwrapShellCommand(command), 110)}`,
        meta: parts.join(' · '),
      };
    }

    if (payload.error || payload.message) {
      return {
        title: trimMiddle(payload.error || payload.message, 120),
        meta: parts.join(' · '),
      };
    }
  }

  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) || fallbackLabel || 'Teknik çıktı';
  return {
    title: trimMiddle(firstLine, 120),
    meta: lineCount > 1 ? `${lineCount} satır · ${size}` : size,
  };
}

function addTechnicalMessage(cls, label, body, { copyText = null, open = false } = {}) {
  const text = String(body || '');
  const div = document.createElement('div');
  div.className = `msg ${cls} msg-technical`;

  const lbl = document.createElement('span');
  lbl.className = 'msg-label';
  lbl.textContent = label;
  div.appendChild(lbl);

  if (copyText) attachCopyAction(div, () => copyText());

  const summaryInfo = summarizeTechnicalPayload(text, label);
  const details = document.createElement('details');
  details.className = 'technical-details';
  details.open = Boolean(open);

  const summary = document.createElement('summary');
  summary.className = 'technical-summary';
  const title = document.createElement('span');
  title.className = 'technical-summary-title';
  title.textContent = summaryInfo.title;
  summary.appendChild(title);
  if (summaryInfo.meta) {
    const meta = document.createElement('span');
    meta.className = 'technical-summary-meta';
    meta.textContent = summaryInfo.meta;
    summary.appendChild(meta);
  }
  details.appendChild(summary);

  const pre = document.createElement('pre');
  pre.className = 'technical-pre';
  pre.textContent = text;
  details.appendChild(pre);
  details.addEventListener('toggle', () => scrollToBottom());

  div.appendChild(details);
  el.messages.appendChild(div);
  scrollToBottom();
  return div;
}
function addMessage(cls, label, body, { pre = false, meta = null, markdown = false, copyText = null } = {}) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;

  const lbl = document.createElement('span');
  lbl.className = 'msg-label';
  lbl.textContent = label;
  div.appendChild(lbl);

  if (copyText) attachCopyAction(div, () => copyText());

  if (body != null && body !== '') {
    if (pre) {
      const p = document.createElement('pre');
      p.textContent = body;
      div.appendChild(p);
    } else if (markdown) {
      // Başlık/liste/kod bloğu gibi blok elemanları içerebileceğinden
      // <span> yerine <div> kullanılır.
      const wrap = document.createElement('div');
      wrap.className = 'msg-body';
      wrap.innerHTML = markdownToHtml(body);
      div.appendChild(wrap);
    } else {
      const span = document.createElement('span');
      span.textContent = body;
      div.appendChild(span);
    }
  }

  if (meta) {
    const m = document.createElement('span');
    m.className = 'msg-meta';
    m.textContent = meta;
    div.appendChild(m);
  }

  el.messages.appendChild(div);
  scrollToBottom();
  return div;
}

function showTyping() {
  if (typingNode) return;
  typingNode = document.createElement('div');
  typingNode.className = 'msg msg-system';
  typingNode.innerHTML =
    '<span class="typing"><span></span><span></span><span></span></span>';
  el.messages.appendChild(typingNode);
  scrollToBottom();
}

function hideTyping() {
  if (typingNode) {
    typingNode.remove();
    typingNode = null;
  }
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function providerLabel(provider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function labelWithProvider(label, provider) {
  return provider ? `${label} (${providerLabel(provider)})` : label;
}

function normalizeForDuplicate(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// Kullanıcı mesajı: kopyala + composer'a geri yükleyip düzenleyerek yeniden gönder.
function addUserMessage(prompt, provider) {
  const node = addMessage('msg-user', `sen (${providerLabel(provider)})`, prompt, {
    copyText: () => prompt,
  });
  addMessageAction(node, 'Yeniden gönder', 'Bu istemi düzenlemek için composer alanına yükle', () => {
    el.input.value = prompt;
    autoGrowInput();
    saveDraft();
    updateSendState();
    el.input.focus();
  });
  return node;
}

function addModelOption(parent, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  parent.appendChild(option);
}

function fillModelSelect(select, provider, selectedValue) {
  select.innerHTML = '';
  const groups = provider === 'codex' ? CODEX_MODEL_GROUPS : CLAUDE_MODEL_GROUPS;
  for (const group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const option of group.options) addModelOption(optgroup, option.value, option.label);
    select.appendChild(optgroup);
  }
  select.value = selectedValue || '';
  if (select.value !== (selectedValue || '')) select.value = '';
}

function effortOptionsFor(provider) {
  return provider === 'codex' ? CODEX_EFFORT_OPTIONS : CLAUDE_EFFORT_OPTIONS;
}

// SDK'nın bildirdiği model yetenekleri (supportsEffort / supportedEffortLevels).
// Alınamazsa tüm seviyeler açık kalır.
function claudeEffortCapability(modelId) {
  if (!modelsCache || !modelsCache.length || !modelId) return null;
  const wanted = String(modelId).toLowerCase();
  const info = modelsCache.find((model) => {
    const resolved = String(model.resolvedModel || '').toLowerCase();
    return resolved === wanted || resolved.startsWith(`${wanted}-`) || wanted.startsWith(resolved);
  });
  if (!info) return null;
  return {
    supportsEffort: info.supportsEffort,
    levels: info.supportedEffortLevels || [],
  };
}

function effortValueFor(provider) {
  if (!settingsCache) return provider === 'codex' ? '' : 'high';
  return provider === 'codex' ? settingsCache.codexEffort || '' : settingsCache.effort || 'high';
}

function fillEffortSelect(select, provider, selectedValue, { plainLabels = false, modelId = null } = {}) {
  if (!select) return;
  const capability = provider === 'codex' ? null : claudeEffortCapability(modelId);

  select.innerHTML = '';
  for (const option of effortOptionsFor(provider)) {
    const label = plainLabels ? option.label.replace(/^Efor:\s*/, '') : option.label;
    addModelOption(select, option.value, label);
    if (capability && capability.levels.length && !capability.levels.includes(option.value)) {
      select.lastChild.disabled = true;
      select.lastChild.textContent = `${label} (desteklenmiyor)`;
    }
  }

  select.value = selectedValue || '';
  if (select.value !== (selectedValue || '') || (select.selectedOptions[0] && select.selectedOptions[0].disabled)) {
    const fallback = provider === 'codex' ? '' : 'high';
    select.value = capability && capability.levels.length && !capability.levels.includes(fallback)
      ? capability.levels[capability.levels.length - 1]
      : fallback;
  }

  // Model efor kabul etmiyorsa (ör. Haiku) seçim tamamen kapatılır.
  const unsupported = Boolean(capability && capability.supportsEffort === false);
  if (select === el.effortSelect) effortUnsupported = unsupported;
  select.disabled = unsupported || running;
  select.title = unsupported
    ? 'Seçili model akıl yürütme eforu desteklemiyor.'
    : 'Akıl yürütme eforu';
}

function syncSettingsPanelModelFields() {
  if (!settingsCache) return;
  fillModelSelect(el.setModel, 'claude', settingsCache.model || 'claude-opus-4-5');
  fillModelSelect(el.setCodexModel, 'codex', settingsCache.codexModel || '');
  fillEffortSelect(el.setEffort, 'claude', settingsCache.effort || 'high', {
    plainLabels: true,
    modelId: settingsCache.model || 'claude-opus-4-5',
  });
  fillEffortSelect(el.setCodexEffort, 'codex', settingsCache.codexEffort || '', { plainLabels: true });
  if (el.setSendOnEnter) el.setSendOnEnter.checked = Boolean(settingsCache.sendOnEnter);
}

function syncTopbarControls() {
  if (!settingsCache) return;
  currentProvider = settingsCache.provider === 'codex' ? 'codex' : 'claude';
  el.providerSelect.value = currentProvider;
  el.modeSelect.value = settingsCache.permissionMode || 'plan';
  const selectedModel = currentProvider === 'codex'
    ? settingsCache.codexModel || ''
    : settingsCache.model || 'claude-opus-4-5';
  fillModelSelect(el.inlineModelSelect, currentProvider, selectedModel);
  fillEffortSelect(el.effortSelect, currentProvider, effortValueFor(currentProvider), {
    modelId: currentProvider === 'codex' ? null : selectedModel,
  });
}

async function updateSettings(partial) {
  const updated = await api.setSettings(partial);
  settingsCache = updated || { ...(settingsCache || {}), ...partial };
  syncTopbarControls();
  syncSettingsPanelModelFields();
  syncProjectState();
  applyTheme(settingsCache.theme);
}

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
// Açılıştaki ilk uygulama theme-boot.js içinde yapılır (flaş olmasın diye);
// buradaki çağrılar sonraki değişiklikler ve canlı önizleme içindir.
function applyTheme(theme) {
  const valid = THEME_OPTIONS.some((t) => t.value === theme);
  document.documentElement.dataset.theme = valid ? theme : DEFAULT_THEME;
}

function renderThemePicker(selected) {
  if (!el.themePicker) return;
  el.themePicker.textContent = '';
  for (const theme of THEME_OPTIONS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = theme.value === selected ? 'theme-card active' : 'theme-card';
    card.dataset.theme = theme.value;
    card.setAttribute('aria-pressed', String(theme.value === selected));

    const dots = document.createElement('span');
    dots.className = 'theme-dots';
    for (const color of theme.dots) {
      const dot = document.createElement('span');
      dot.className = 'theme-dot';
      dot.style.background = color;
      dots.appendChild(dot);
    }

    const name = document.createElement('span');
    name.className = 'theme-card-name';
    name.textContent = theme.label;

    const check = document.createElement('span');
    check.className = 'theme-card-check';
    check.textContent = '✓';

    card.append(dots, name, check);
    card.addEventListener('click', () => selectTheme(theme.value));
    el.themePicker.appendChild(card);
  }
}

// Tıklayınca anında önizlenir; kalıcı olması için Kaydet gerekir.
function selectTheme(theme) {
  pendingTheme = theme;
  applyTheme(theme);
  renderThemePicker(theme);
}

// ---------------------------------------------------------------------------
// SDK mesajlarını render et
// ---------------------------------------------------------------------------
function allModelOptions(provider) {
  const groups = provider === 'codex' ? CODEX_MODEL_GROUPS : CLAUDE_MODEL_GROUPS;
  return groups.flatMap((group) => group.options);
}

function normalizePathForCompare(cwd) {
  return String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function nameFromPath(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || cwd || 'Proje';
}

function activeProject() {
  return projectsCache.find((p) => p.id === activeProjectId) || projectsCache[0] || null;
}

function conversationsForCwd(cwd) {
  const key = normalizePathForCompare(cwd);
  if (!key) return [];
  return conversationsCache.filter((conv) => normalizePathForCompare(conv.cwd) === key);
}

function conversationsForActiveProject() {
  return conversationsForCwd(selectedDir);
}

// Hiçbir projeyle eşleşmeyen konuşmalar (proje listeden kaldırılmış olabilir).
function orphanConversations() {
  const known = new Set(projectsCache.map((project) => normalizePathForCompare(project.cwd)));
  return conversationsCache.filter((conv) => !known.has(normalizePathForCompare(conv.cwd)));
}

function syncProjectState() {
  if (!settingsCache) return;
  projectsCache = Array.isArray(settingsCache.projects) ? settingsCache.projects : [];
  activeProjectId = settingsCache.activeProjectId || (projectsCache[0] && projectsCache[0].id) || null;
  // İlk çizimde aktif proje açık gelsin; sonrasında aç/kapa kullanıcının.
  if (!sidebarInitialized && activeProjectId) {
    expandedProjects.add(activeProjectId);
    sidebarInitialized = true;
  }
  const project = activeProject();
  selectedDir = project ? project.cwd : null;
  el.projectName.textContent = project ? project.name : 'Proje se\u00e7ilmedi';
  el.projectPath.textContent = project ? project.cwd : 'Sol panelden proje ekleyin';
  el.projectPath.title = project ? project.cwd : '';
  renderProjects();
  updateSendState();
}

function renderProjects() {
  // Sol men\u00fc tek a\u011fa\u00e7 halinde \u00e7izilir; projeler ve sohbetler birlikte gelir.
  renderSidebar();
}

async function addProject() {
  if (running) return;
  const dir = await api.selectDirectory();
  if (!dir) return;
  const existing = projectsCache.find((p) => normalizePathForCompare(p.cwd) === normalizePathForCompare(dir));
  if (existing) {
    await switchProject(existing.id);
    return;
  }
  const project = {
    id: 'project-' + Date.now().toString(36),
    name: nameFromPath(dir),
    cwd: dir,
  };
  await updateSettings({
    projects: [...projectsCache, project],
    activeProjectId: project.id,
    lastDirectory: dir,
  });
  await refreshConversationList();
  startNewChat();
}

async function switchProject(projectId) {
  if (running || projectId === activeProjectId) return;
  const project = projectsCache.find((p) => p.id === projectId);
  if (!project) return;
  await updateSettings({ activeProjectId: project.id, lastDirectory: project.cwd });
  await refreshConversationList();
  const first = conversationsForActiveProject()[0];
  if (first) await openConversation(first.id);
  else startNewChat();
}

async function handleDeleteProject(projectId) {
  if (running) return;
  const project = projectsCache.find((p) => p.id === projectId);
  if (!project) return;
  const ok = window.confirm('"' + project.name + '" proje listesinden kald\u0131r\u0131ls\u0131n m\u0131? Konu\u015fmalar silinmez.');
  if (!ok) return;
  const remaining = projectsCache.filter((p) => p.id !== projectId);
  const next = remaining.find((p) => p.id === activeProjectId) || remaining[0] || null;
  await updateSettings({
    projects: remaining,
    activeProjectId: next ? next.id : null,
    lastDirectory: next ? next.cwd : null,
  });
  await refreshConversationList();
  const first = conversationsForActiveProject()[0];
  if (first) await openConversation(first.id);
  else startNewChat();
}

function closeUsage() {
  el.usageOverlay.classList.add('hidden');
}

function formatResetTime(timestamp) {
  if (!timestamp) return '';
  const target = new Date(timestamp);
  if (Number.isNaN(target.getTime())) return '';
  const absolute = target.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  const diffMinutes = Math.round((timestamp - Date.now()) / 60000);
  if (diffMinutes <= 0) return 'S\u0131f\u0131rlanma: ' + absolute;
  if (diffMinutes < 60) return 'S\u0131f\u0131rlanma: ' + absolute + ' (' + diffMinutes + ' dk sonra)';
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) {
    const minutes = diffMinutes % 60;
    return 'S\u0131f\u0131rlanma: ' + absolute + ' (' + hours + ' sa ' + minutes + ' dk sonra)';
  }
  const days = Math.floor(hours / 24);
  return 'S\u0131f\u0131rlanma: ' + absolute + ' (' + days + ' g\u00fcn ' + (hours % 24) + ' sa sonra)';
}

function usageLevel(usedPercent) {
  if (typeof usedPercent !== 'number') return 'normal';
  if (usedPercent >= 90) return 'critical';
  if (usedPercent >= 75) return 'warn';
  return 'normal';
}

function renderUsageWindow(win) {
  const row = document.createElement('div');
  row.className = 'usage-window';

  const head = document.createElement('div');
  head.className = 'usage-window-head';

  const label = document.createElement('span');
  label.className = 'usage-window-label';
  label.textContent = win.label;

  const value = document.createElement('span');
  value.className = 'usage-window-value';
  value.textContent = typeof win.remainingPercent === 'number'
    ? '%' + win.remainingPercent + ' kald\u0131'
    : 'Bilinmiyor';

  head.appendChild(label);
  head.appendChild(value);
  row.appendChild(head);

  const bar = document.createElement('div');
  bar.className = 'usage-bar';
  const fill = document.createElement('div');
  fill.className = 'usage-bar-fill ' + usageLevel(win.usedPercent);
  fill.style.width = (typeof win.usedPercent === 'number' ? win.usedPercent : 0) + '%';
  bar.appendChild(fill);
  row.appendChild(bar);

  const meta = document.createElement('div');
  meta.className = 'usage-window-meta';
  const used = typeof win.usedPercent === 'number' ? '%' + win.usedPercent + ' kullan\u0131ld\u0131' : '';
  const reset = formatResetTime(win.resetsAt);
  meta.textContent = [used, reset].filter(Boolean).join(' \u00b7 ');
  row.appendChild(meta);

  return row;
}

function renderUsageProvider(provider, data) {
  const card = document.createElement('section');
  card.className = 'usage-provider';

  const h = document.createElement('h3');
  h.textContent = (data && data.label) || providerLabel(provider);
  if (data && data.plan) {
    const badge = document.createElement('span');
    badge.className = 'usage-plan-badge';
    badge.textContent = data.plan;
    h.appendChild(badge);
  }
  card.appendChild(h);

  const status = document.createElement('p');
  status.className = 'usage-provider-status';
  status.textContent = (data && (data.error || data.status)) || 'Durum al\u0131namad\u0131';
  if (data && data.error) status.classList.add('usage-error');
  card.appendChild(status);

  const windows = (data && Array.isArray(data.windows) ? data.windows : []).filter(Boolean);
  if (windows.length > 0) {
    const list = document.createElement('div');
    list.className = 'usage-window-list';
    for (const win of windows) list.appendChild(renderUsageWindow(win));
    card.appendChild(list);
  } else if (!data || !data.error) {
    const empty = document.createElement('p');
    empty.className = 'usage-empty';
    empty.textContent = 'Kalan kota penceresi bildirilmedi.';
    card.appendChild(empty);
  }

  for (const note of (data && Array.isArray(data.notes) ? data.notes : [])) {
    const line = document.createElement('p');
    line.className = 'usage-note';
    line.textContent = note;
    card.appendChild(line);
  }

  return card;
}

async function openUsage(force = false) {
  el.usageOverlay.classList.remove('hidden');
  el.usageStatus.textContent = 'Limit bilgileri kontrol ediliyor...';
  el.usageContent.innerHTML = '';
  try {
    const usage = await api.getUsageLimits(force ? { force: true } : undefined);
    const date = usage && usage.updatedAt ? new Date(usage.updatedAt).toLocaleString('tr-TR') : 'bilinmiyor';
    el.usageStatus.textContent = ((usage && usage.message) || '') + ' Son kontrol: ' + date;
    el.usageContent.appendChild(renderUsageProvider('claude', usage.providers && usage.providers.claude));
    el.usageContent.appendChild(renderUsageProvider('codex', usage.providers && usage.providers.codex));
    applyUsageBadge(usage);
  } catch (err) {
    el.usageStatus.textContent = (err && err.message) || 'Limit bilgisi al\u0131namad\u0131.';
  }
}

// --- Canlı akış (assistant_delta) ---------------------------------------------
// main süreci iki sağlayıcıyı da tek bir delta sözleşmesine çevirir:
//   { type:'assistant_delta', provider, streamId, kind:'text'|'thinking', text, replace, done }
const activeStreams = new Map(); // streamId -> entry
let turnStreams = []; // bu turda açılmış tüm akışlar (tekrar bastırma için)

function streamClass(kind) {
  return kind === 'thinking' ? 'msg-system' : 'msg-text';
}

function streamLabel(kind, provider) {
  return labelWithProvider(kind === 'thinking' ? 'düşünüyor' : 'asistan', provider);
}

function finalizeStream(entry) {
  entry.body.classList.remove('streaming');
  if (entry.kind === 'thinking') {
    entry.body.textContent = entry.text;
  } else {
    entry.body.innerHTML = markdownToHtml(entry.text);
    lastAssistantText = entry.text;
  }
  entry.finalized = true;
  scrollToBottom();
}

function renderAssistantDelta(msg) {
  let entry = activeStreams.get(msg.streamId);
  if (!entry) {
    // Delta gelmemiş bloğun kapanışı (ör. tool_use) — görmezden gel.
    if (msg.done) return;
    hideTyping();
    const node = addMessage(streamClass(msg.kind), streamLabel(msg.kind, msg.provider), '');
    const body = document.createElement('div');
    body.className = 'msg-body streaming';
    node.appendChild(body);
    entry = {
      streamId: msg.streamId,
      node,
      body,
      text: '',
      kind: msg.kind || 'text',
      finalized: false,
      consumed: false,
    };
    attachCopyAction(node, () => entry.text);
    activeStreams.set(msg.streamId, entry);
    turnStreams.push(entry);
  }

  if (msg.text) entry.text = msg.replace ? msg.text : entry.text + msg.text;

  if (msg.done) {
    finalizeStream(entry);
    activeStreams.delete(msg.streamId);
    return;
  }

  entry.body.textContent = entry.text;
  scrollToBottom();
}

// Tam mesaj geldiğinde aynı metin akmışsa yeni balon açma, mevcut balonu tamamla.
function consumeStreamedText(text, kind) {
  const normalized = normalizeForDuplicate(text);
  if (!normalized) return false;
  const entry = turnStreams.find(
    (candidate) => candidate.kind === kind && !candidate.consumed && normalizeForDuplicate(candidate.text) === normalized
  );
  if (!entry) return false;
  entry.consumed = true;
  entry.text = text;
  finalizeStream(entry);
  activeStreams.delete(entry.streamId);
  return true;
}

// --- Konuşma toplamları ve kota rozeti ----------------------------------------
function formatTokens(count) {
  if (!count) return '0';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function resetTurnTotals() {
  turnTotals.input = 0;
  turnTotals.output = 0;
  turnTotals.reasoning = 0;
  turnTotals.cost = 0;
  renderTurnTotals();
}

function accumulateTurnTotals(msg) {
  const usage = msg && msg.usage;
  if (usage) {
    turnTotals.input += Number(usage.input_tokens || usage.input || 0) || 0;
    turnTotals.output += Number(usage.output_tokens || usage.output || 0) || 0;
    turnTotals.reasoning += Number(usage.reasoning_output_tokens || 0) || 0;
  }
  if (typeof msg.total_cost_usd === 'number') turnTotals.cost += msg.total_cost_usd;
  renderTurnTotals();
}

function renderTurnTotals() {
  const hasData = turnTotals.input || turnTotals.output || turnTotals.cost;
  el.turnStats.classList.toggle('hidden', !hasData);
  if (!hasData) {
    el.turnStats.textContent = '';
    return;
  }
  const parts = [`${formatTokens(turnTotals.input)} giriş / ${formatTokens(turnTotals.output)} çıkış`];
  if (turnTotals.reasoning) parts.push(`${formatTokens(turnTotals.reasoning)} akıl yürütme`);
  if (turnTotals.cost) parts.push(`$${turnTotals.cost.toFixed(4)}`);
  el.turnStats.textContent = `Bu sohbet: ${parts.join(' · ')}`;
}

// Topbar rozeti: aktif sağlayıcının en kritik penceresinden kalan yüzde.
function applyUsageBadge(usage) {
  const data = usage && usage.providers && usage.providers[currentProvider];
  const windows = (data && data.windows) || [];
  const remaining = windows
    .map((win) => win.remainingPercent)
    .filter((value) => typeof value === 'number');

  if (!remaining.length) {
    el.usageBadge.classList.add('hidden');
    el.usageBadge.textContent = '';
    return;
  }

  const lowest = Math.min(...remaining);
  el.usageBadge.textContent = `%${lowest}`;
  el.usageBadge.className = `usage-badge ${usageLevel(100 - lowest)}`;
  el.btnUsage.title = `${providerLabel(currentProvider)}: kalan kota %${lowest}`;
}

async function refreshUsageBadge(force = false) {
  try {
    const usage = await api.getUsageLimits(force ? { force: true } : undefined);
    applyUsageBadge(usage);
  } catch {
    el.usageBadge.classList.add('hidden');
  }
}

function finishStreams() {
  for (const entry of turnStreams) {
    if (!entry.finalized) finalizeStream(entry);
  }
  activeStreams.clear();
  turnStreams = [];
}

// --- Proje bazlı maliyet ekranı ------------------------------------------------
function closeStats() {
  el.statsOverlay.classList.add('hidden');
}

function formatCost(value, reported) {
  if (!reported) return '—';
  if (!value) return '$0.0000';
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function statsRow(label, value, muted = false) {
  const row = document.createElement('div');
  row.className = 'stats-row' + (muted ? ' muted' : '');
  const key = document.createElement('span');
  key.textContent = label;
  const val = document.createElement('span');
  val.textContent = value;
  row.appendChild(key);
  row.appendChild(val);
  return row;
}

function tokenSummary(bucket) {
  const parts = [`${formatTokens(bucket.input)} giriş`, `${formatTokens(bucket.output)} çıkış`];
  if (bucket.cacheRead) parts.push(`${formatTokens(bucket.cacheRead)} önbellek okuma`);
  if (bucket.cacheCreate) parts.push(`${formatTokens(bucket.cacheCreate)} önbellek yazma`);
  if (bucket.reasoning) parts.push(`${formatTokens(bucket.reasoning)} akıl yürütme`);
  return parts.join(' · ');
}

function renderStatsTable(rows, headers) {
  const table = document.createElement('table');
  table.className = 'stats-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const cells of rows) {
    const tr = document.createElement('tr');
    for (const cell of cells) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function renderStatsProject(project) {
  const card = document.createElement('section');
  card.className = 'stats-project';

  const head = document.createElement('div');
  head.className = 'stats-project-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'stats-project-title';
  const name = document.createElement('h3');
  name.textContent = project.name;
  if (!project.known) {
    const tag = document.createElement('span');
    tag.className = 'stats-tag';
    tag.textContent = 'listede yok';
    name.appendChild(tag);
  }
  const cwd = document.createElement('span');
  cwd.className = 'stats-project-path';
  cwd.textContent = project.cwd || '';
  cwd.title = project.cwd || '';
  titleWrap.appendChild(name);
  titleWrap.appendChild(cwd);

  const cost = document.createElement('div');
  cost.className = 'stats-project-cost';
  cost.textContent = formatCost(project.totals.cost, project.totals.costReported);

  head.appendChild(titleWrap);
  head.appendChild(cost);
  card.appendChild(head);

  card.appendChild(statsRow(
    `${project.totals.conversations} sohbet · ${project.totals.turns} tur`,
    tokenSummary(project.totals)
  ));

  for (const [key, label] of [['claude', 'Claude'], ['codex', 'Codex']]) {
    const bucket = project.providers[key];
    if (!bucket || (!bucket.turns && !bucket.input && !bucket.output)) continue;
    card.appendChild(statsRow(
      `${label} · ${bucket.turns} tur · ${formatCost(bucket.cost, bucket.costReported)}`,
      tokenSummary(bucket),
      true
    ));
  }

  if (project.models.length) {
    card.appendChild(renderStatsTable(
      project.models.map((model) => [
        model.name,
        formatTokens(model.input),
        formatTokens(model.output),
        formatTokens(model.cacheRead + model.cacheCreate),
        formatCost(model.cost, model.costReported),
      ]),
      ['Model', 'Giriş', 'Çıkış', 'Önbellek', 'Maliyet']
    ));
  }

  if (project.topConversations.length) {
    const details = document.createElement('details');
    details.className = 'stats-details';
    const summary = document.createElement('summary');
    summary.textContent = 'En maliyetli sohbetler';
    details.appendChild(summary);
    details.appendChild(renderStatsTable(
      project.topConversations.map((conv) => [
        conv.title,
        `${conv.turns} tur`,
        formatTokens(conv.input + conv.output),
        formatCost(conv.cost, conv.cost > 0),
      ]),
      ['Sohbet', 'Tur', 'Token', 'Maliyet']
    ));
    card.appendChild(details);
  }

  return card;
}

async function openStats(force = false) {
  el.statsOverlay.classList.remove('hidden');
  if (force || !el.statsContent.childNodes.length) {
    el.statsStatus.textContent = 'Konuşma kayıtları taranıyor...';
    el.statsContent.innerHTML = '';
  }

  try {
    const stats = await api.getUsageStats();
    el.statsContent.innerHTML = '';

    const projects = (stats.projects || []).filter(
      (project) => project.totals.turns > 0 || project.totals.conversations > 0
    );

    const date = new Date(stats.generatedAt).toLocaleString('tr-TR');
    el.statsStatus.textContent =
      `Toplam ${formatCost(stats.grand.cost, stats.grand.costReported)} · ` +
      `${stats.grand.turns} tur · ${tokenSummary(stats.grand)} · ${date}. ` +
      'Maliyet, Claude SDK\'nın her tur için bildirdiği tutardır; Codex maliyet bildirmediği için token bazında gösterilir.';

    if (projects.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'usage-empty';
      empty.textContent = 'Henüz kayıtlı bir sohbet yok.';
      el.statsContent.appendChild(empty);
      return;
    }

    for (const project of projects) el.statsContent.appendChild(renderStatsProject(project));
  } catch (err) {
    el.statsStatus.textContent = (err && err.message) || 'İstatistik alınamadı.';
  }
}

function renderAgentMessage(msg) {
  if (!msg || !msg.type) return;
  const provider = msg.provider || null;

  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        const info = [];
        if (provider) info.push(`sağlayıcı: ${providerLabel(provider)}`);
        if (msg.model) info.push(`model: ${msg.model}`);
        if (msg.effort) info.push(`efor: ${msg.effort}`);
        if (msg.permissionMode) info.push(`mod: ${msg.permissionMode}`);
        if (msg.cwd) info.push(`dizin: ${msg.cwd}`);
        if (msg.thread_id) info.push(`thread: ${msg.thread_id}`);
        addMessage('msg-system', labelWithProvider('oturum başladı', provider), info.join('  •  '));
      }
      break;
    }

    case 'assistant_delta': {
      renderAssistantDelta(msg);
      break;
    }

    case 'assistant': {
      const content = (msg.message && msg.message.content) || [];
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      for (const block of blocks) {
        if (block.type === 'text' && block.text && block.text.trim()) {
          lastAssistantText = block.text;
          if (consumeStreamedText(block.text, 'text')) continue;
          addMessage('msg-text', labelWithProvider('asistan', provider), block.text, {
            markdown: true,
            copyText: () => block.text,
          });
        } else if (block.type === 'tool_use') {
          const text = stringify(block.input);
          addTechnicalMessage('msg-tool', labelWithProvider(`araç: ${block.name}`, provider), text, {
            copyText: () => text,
          });
        } else if (block.type === 'thinking' && block.thinking) {
          if (consumeStreamedText(block.thinking, 'thinking')) continue;
          addMessage('msg-system', labelWithProvider('düşünüyor', provider), block.thinking);
        }
      }
      break;
    }

    case 'user': {
      const content = (msg.message && msg.message.content) || [];
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          let text = block.content;
          if (Array.isArray(text)) {
            text = text
              .map((c) => (typeof c === 'string' ? c : c.text || stringify(c)))
              .join('\n');
          } else if (typeof text !== 'string') {
            text = stringify(text);
          }
          const label = block.is_error ? 'araç sonucu (hata)' : 'araç sonucu';
          addTechnicalMessage('msg-toolresult', labelWithProvider(label, provider), text, {
            copyText: () => text,
            open: Boolean(block.is_error),
          });
        }
      }
      break;
    }

    case 'result': {
      finishStreams();
      const ok = msg.subtype === 'success' && !msg.is_error;
      const cls = ok ? 'msg-result-success' : 'msg-result-error';
      const label = ok ? 'sonuç' : `sonuç: ${msg.subtype || 'hata'}`;
      const parts = [];
      if (typeof msg.num_turns === 'number') parts.push(`${msg.num_turns} tur`);
      if (typeof msg.duration_ms === 'number') parts.push(`${(msg.duration_ms / 1000).toFixed(1)} sn`);
      if (typeof msg.total_cost_usd === 'number') parts.push(`$${msg.total_cost_usd.toFixed(4)}`);
      if (msg.usage && typeof msg.usage.input_tokens === 'number') {
        parts.push(`${msg.usage.input_tokens} in / ${msg.usage.output_tokens || 0} out`);
      }
      const resultText = msg.result || '';
      const isDuplicate = ok && resultText && normalizeForDuplicate(resultText) === normalizeForDuplicate(lastAssistantText);
      addMessage(cls, labelWithProvider(label, provider), isDuplicate ? '' : resultText, {
        markdown: true,
        meta: parts.length ? parts.join('  •  ') : null,
        copyText: isDuplicate || !resultText ? null : () => resultText,
      });
      accumulateTurnTotals(msg);
      break;
    }

    default:
      break;
  }
}
// ---------------------------------------------------------------------------
// Gönderme / iptal
// ---------------------------------------------------------------------------
function send() {
  const prompt = el.input.value.trim();
  if (!prompt || !selectedDir || running) return;

  addUserMessage(prompt, currentProvider);
  lastUserPrompt = prompt;
  el.input.value = '';
  drafts.delete(draftKey());
  autoGrowInput();
  finishStreams();
  running = true;
  updateSendState();
  showTyping();

  api.run({ prompt, cwd: selectedDir, conversationId: currentConversationId, provider: currentProvider });
}

function onDone() {
  running = false;
  finishStreams();
  hideTyping();
  updateSendState();
  // Tur bitti: kota değişmiş olabilir (60 sn önbelleğe takılırsa atlanır).
  refreshUsageBadge();
}

function showCodexLoginHelp() {
  const node = addMessage('msg-system', 'Codex giriş yardımı', 'Codex kullanmak için terminalde şu komutu çalıştırın:', {
    pre: false,
  });
  const pre = document.createElement('pre');
  pre.textContent = 'codex login';
  node.appendChild(pre);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-small';
  btn.textContent = 'Komutu kopyala';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('codex login');
      btn.textContent = 'Kopyalandı';
    } catch {
      btn.textContent = 'Kopyalanamadı';
    }
  });
  node.appendChild(btn);
  scrollToBottom();
}

function onError(err) {
  running = false;
  finishStreams();
  hideTyping();
  const message = (err && err.message) || 'Bilinmeyen hata';
  addMessage('msg-error', 'hata', message);
  if (message.includes('codex login')) showCodexLoginHelp();
  updateSendState();
}

// ---------------------------------------------------------------------------
// Sol menü: konuşma geçmişi
// ---------------------------------------------------------------------------
function createConversationItem(conv) {
  const item = document.createElement('div');
  item.className = 'conv-item' + (conv.id === currentConversationId ? ' active' : '');
  item.dataset.id = conv.id;

  const title = document.createElement('span');
  title.className = 'conv-item-title';
  title.textContent = conv.title || 'Yeni Konu\u015fma';
  title.title = conv.title || '';
  item.appendChild(title);

  const snippet = searchMatches && searchMatches.get(conv.id);
  if (snippet) {
    const hint = document.createElement('span');
    hint.className = 'conv-item-snippet';
    hint.textContent = snippet;
    item.appendChild(hint);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'conv-item-delete';
  del.textContent = '\u00d7';
  del.title = 'Sohbeti sil';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDeleteConversation(conv.id);
  });
  item.appendChild(del);

  item.addEventListener('click', () => openConversation(conv.id));
  return item;
}

// Hen\u00fcz kaydedilmemi\u015f "yeni sohbet": ilk mesaj g\u00f6nderilene kadar kay\u0131t olu\u015fmaz,
// bu y\u00fczden aktif projenin alt\u0131nda yer tutucu olarak g\u00f6sterilir.
function createDraftItem() {
  const draft = document.createElement('div');
  draft.className = 'conv-item active conv-item-draft';
  const title = document.createElement('span');
  title.className = 'conv-item-title';
  title.textContent = 'Yeni sohbet';
  title.title = 'Hen\u00fcz kaydedilmedi \u2014 ilk mesaj\u0131 g\u00f6nderince listeye eklenir.';
  draft.appendChild(title);
  return draft;
}

function createGroupHint(text) {
  const hint = document.createElement('div');
  hint.className = 'conv-empty conv-empty-nested';
  hint.textContent = text;
  return hint;
}

// Bir proje ba\u015fl\u0131\u011f\u0131 + alt\u0131ndaki sohbetler.
function renderProjectGroup(project) {
  const group = document.createElement('div');
  group.className = 'project-group';

  const isActive = project.id === activeProjectId;
  const all = conversationsForCwd(project.cwd);
  const items = searchMatches ? all.filter((conv) => searchMatches.has(conv.id)) : all;
  // Arama s\u0131ras\u0131nda e\u015fle\u015fme olan her proje a\u00e7\u0131l\u0131r; normalde kullan\u0131c\u0131 se\u00e7imi ge\u00e7erli.
  const expanded = searchMatches ? items.length > 0 : expandedProjects.has(project.id);

  const header = document.createElement('div');
  header.className = 'project-item' + (isActive ? ' active' : '');
  header.dataset.id = project.id;

  const caret = document.createElement('span');
  caret.className = 'project-caret';
  caret.textContent = expanded ? '\u25be' : '\u25b8';
  header.appendChild(caret);

  const title = document.createElement('span');
  title.className = 'project-item-title';
  title.textContent = project.name || nameFromPath(project.cwd);
  title.title = project.cwd || '';
  header.appendChild(title);

  const count = document.createElement('span');
  count.className = 'project-count';
  count.textContent = String(searchMatches ? items.length : all.length);
  header.appendChild(count);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'project-item-delete';
  del.textContent = '\u00d7';
  del.title = 'Projeyi listeden kald\u0131r';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDeleteProject(project.id);
  });
  header.appendChild(del);

  header.addEventListener('click', () => {
    if (project.id === activeProjectId) {
      // Aktif projede t\u0131klama a\u00e7/kapa yapar.
      if (expandedProjects.has(project.id)) expandedProjects.delete(project.id);
      else expandedProjects.add(project.id);
      renderSidebar();
      return;
    }
    expandedProjects.add(project.id);
    switchProject(project.id);
  });

  group.appendChild(header);

  if (expanded) {
    const list = document.createElement('div');
    list.className = 'project-convs';
    if (isActive && !currentConversationId && !searchMatches) list.appendChild(createDraftItem());
    for (const conv of items) list.appendChild(createConversationItem(conv));
    if (list.childNodes.length === 0) {
      list.appendChild(createGroupHint(searchMatches ? 'E\u015fle\u015fme yok' : 'Sohbet yok'));
    }
    group.appendChild(list);
  }

  return group;
}

function renderSidebar() {
  el.projectList.innerHTML = '';

  if (projectsCache.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'conv-empty';
    empty.textContent = 'Hen\u00fcz proje yok \u2014 sa\u011f \u00fcstteki + ile ekleyin';
    el.projectList.appendChild(empty);
    return;
  }

  let shown = 0;
  for (const project of projectsCache) {
    const group = renderProjectGroup(project);
    // Aramada e\u015fle\u015fmeyen projeleri gizle (aktif proje her zaman g\u00f6r\u00fcn\u00fcr kal\u0131r).
    const matched = !searchMatches
      || project.id === activeProjectId
      || conversationsForCwd(project.cwd).some((conv) => searchMatches.has(conv.id));
    if (!matched) continue;
    shown += 1;
    el.projectList.appendChild(group);
  }

  // Projesi silinmi\u015f sohbetler kaybolmas\u0131n.
  const orphans = orphanConversations();
  const visibleOrphans = searchMatches ? orphans.filter((conv) => searchMatches.has(conv.id)) : orphans;
  if (visibleOrphans.length > 0) {
    const group = document.createElement('div');
    group.className = 'project-group';
    const header = document.createElement('div');
    header.className = 'project-item project-item-orphan';
    const title = document.createElement('span');
    title.className = 'project-item-title';
    title.textContent = 'Projesiz sohbetler';
    title.title = 'Bu sohbetlerin dizini kay\u0131tl\u0131 projelerden hi\u00e7biriyle e\u015fle\u015fmiyor.';
    header.appendChild(title);
    const count = document.createElement('span');
    count.className = 'project-count';
    count.textContent = String(visibleOrphans.length);
    header.appendChild(count);
    group.appendChild(header);

    const list = document.createElement('div');
    list.className = 'project-convs';
    for (const conv of visibleOrphans) list.appendChild(createConversationItem(conv));
    group.appendChild(list);
    el.projectList.appendChild(group);
    shown += 1;
  }

  if (shown === 0) {
    el.projectList.appendChild(createGroupHint('E\u015fle\u015fen sohbet yok'));
  }
}

async function refreshConversationList() {
  conversationsCache = (await api.listConversations()) || [];
  renderSidebar();
}

// Başlık + transcript içeriğinde arama (main süreci dosyaları tarar).
async function runConversationSearch() {
  const query = el.convSearch.value.trim();
  if (!query) {
    searchMatches = null;
    renderSidebar();
    return;
  }
  try {
    const results = (await api.searchConversations(query)) || [];
    searchMatches = new Map(results.map((row) => [row.id, row.snippet || '']));
  } catch {
    searchMatches = new Map();
  }
  renderSidebar();
}

// Seçili proje dizininde işletim sistemi terminalini açar.
// Windows Terminal varsa aynı pencereye sekme eklenir.
async function openTerminalHere() {
  if (!selectedDir) {
    addMessage('msg-system', 'terminal', 'Önce sol panelden bir proje seçin.');
    return;
  }
  const result = await api.openTerminal(selectedDir);
  if (!result || !result.ok) {
    addMessage('msg-error', 'terminal açılamadı', (result && result.error) || 'Bilinmeyen hata');
    return;
  }
  // Sekme yerine ayrı pencere açıldıysa sebebini bir kez açıkla.
  if (result.mode === 'window' && !terminalFallbackNotified) {
    terminalFallbackNotified = true;
    addMessage(
      'msg-system',
      'terminal',
      'Windows Terminal (wt.exe) bulunamadığı için sekme yerine ayrı bir komut istemi penceresi açıldı. ' +
        'Sekme davranışı için Microsoft Store\'dan Windows Terminal kurabilirsiniz.'
    );
  }
}

async function exportCurrentConversation() {
  if (!currentConversationId) {
    addMessage('msg-system', 'dışa aktarma', 'Önce kaydedilmiş bir konuşma açın.');
    return;
  }
  const result = await api.exportConversation(currentConversationId);
  if (result && result.ok) {
    addMessage('msg-system', 'dışa aktarıldı', result.path);
  } else if (result && !result.canceled) {
    addMessage('msg-error', 'dışa aktarma hatası', (result && result.error) || 'Kaydedilemedi.');
  }
}

// Ana veya sunucudan gelen tek bir konuşma kaydını listeye ekler/günceller.
function upsertConversationInCache(conv) {
  if (!conv) return;
  const i = conversationsCache.findIndex((c) => c.id === conv.id);
  if (i === -1) conversationsCache.unshift(conv);
  else conversationsCache[i] = conv;
  conversationsCache.sort((a, b) => b.updatedAt - a.updatedAt);
  renderSidebar();
}

// Kaydedilmiş bir konuşmayı sol menüden açar: mesajları geri oynatır ve
// o konuşmanın dizinine geçer.
async function openConversation(id) {
  if (running || id === currentConversationId) return;
  const data = await api.loadConversation(id);
  if (!data) return;

  saveDraft();

  // Başka bir projenin sohbeti açıldıysa aktif proje de oraya geçsin.
  const owner = projectsCache.find(
    (project) => normalizePathForCompare(project.cwd) === normalizePathForCompare(data.meta.cwd)
  );
  if (owner && owner.id !== activeProjectId) {
    expandedProjects.add(owner.id);
    await updateSettings({ activeProjectId: owner.id, lastDirectory: owner.cwd });
  }

  currentConversationId = id;
  applyDirectory(data.meta.cwd);
  clearMessages();
  resetTurnTotals();

  for (const entry of data.transcript) {
    if (entry.kind === 'user') {
      lastUserPrompt = entry.text || lastUserPrompt;
      addUserMessage(entry.text, entry.provider || 'claude');
    } else if (entry.kind === 'sdk') {
      renderAgentMessage(entry.message);
    }
  }

  renderSidebar();
  restoreDraft();
  updateSendState();
}

function startNewChat() {
  if (running) return;
  saveDraft();
  currentConversationId = null;
  clearMessages();
  resetTurnTotals();
  const project = activeProject();
  const text = project
    ? 'Yeni konu\u015fma bu proje dizininde ba\u015flayacak: ' + project.cwd
    : 'Sol paneldeki + ile bir proje ekleyin.';
  addMessage('msg-system', 'yeni konu\u015fma', text);
  renderSidebar();
  restoreDraft();
  el.input.focus();
  updateSendState();
}

async function handleDeleteConversation(id) {
  if (running) return;
  const conv = conversationsCache.find((c) => c.id === id);
  const label = (conv && conv.title) || 'Bu konuşma';
  const ok = window.confirm(`"${label}" silinsin mi? Bu işlem geri alınamaz.`);
  if (!ok) return;

  await api.deleteConversation(id);
  conversationsCache = conversationsCache.filter((c) => c.id !== id);
  renderSidebar();

  if (id === currentConversationId) {
    startNewChat();
  }
}

// ---------------------------------------------------------------------------
// İzin onay penceresi
// ---------------------------------------------------------------------------
function shortenPath(value) {
  const raw = String(value || '');
  if (!selectedDir) return raw;
  const base = normalizePathForCompare(selectedDir);
  const candidate = normalizePathForCompare(raw);
  if (base && candidate.startsWith(base + '/')) return raw.slice(selectedDir.length + 1);
  return raw;
}

function appendDiffLines(parent, text, mode) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = `diff-line diff-${mode}`;
    row.textContent = (mode === 'add' ? '+ ' : '- ') + line;
    parent.appendChild(row);
  }
}

function appendEditDiff(parent, edit) {
  const block = document.createElement('div');
  block.className = 'perm-diff';
  if (edit.old_string) appendDiffLines(block, edit.old_string, 'del');
  if (edit.new_string) appendDiffLines(block, edit.new_string, 'add');
  parent.appendChild(block);
}

// Araç girdisini okunur biçimde göster: dosya düzenlemelerinde diff,
// komutlarda kod bloğu, diğerlerinde ham JSON.
function renderPermissionDetail(req) {
  const detail = el.permDetail;
  detail.innerHTML = '';
  const input = req.input || {};
  const tool = req.toolName || '';
  let handled = false;

  const addLabel = (text) => {
    const line = document.createElement('div');
    line.className = 'perm-detail-label';
    line.textContent = text;
    detail.appendChild(line);
  };

  if (tool === 'Bash' && input.command) {
    if (input.description) addLabel(input.description);
    const pre = document.createElement('pre');
    pre.className = 'perm-command';
    pre.textContent = input.command;
    detail.appendChild(pre);
    handled = true;
  } else if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') && input.file_path) {
    addLabel(shortenPath(input.file_path));
    if (tool === 'Write') {
      const block = document.createElement('div');
      block.className = 'perm-diff';
      appendDiffLines(block, input.content, 'add');
      detail.appendChild(block);
    } else if (Array.isArray(input.edits)) {
      for (const edit of input.edits) appendEditDiff(detail, edit || {});
    } else {
      appendEditDiff(detail, input);
    }
    handled = true;
  } else if (input.file_path || input.path) {
    addLabel(shortenPath(input.file_path || input.path));
  }

  detail.classList.toggle('hidden', detail.childNodes.length === 0);
  el.permInput.classList.toggle('hidden', handled);
  el.permInput.textContent = handled ? '' : stringify(input);
}

function showPermission(req) {
  currentPermId = req.id;
  currentPermTool = req.toolName || '';
  el.permTool.textContent = req.toolName || '(bilinmeyen araç)';
  renderPermissionDetail(req);
  el.btnPermAllowSession.disabled = !currentPermTool;
  el.permOverlay.classList.remove('hidden');
}

function respondPermission(allow, remember = 'once') {
  if (currentPermId == null) return;
  api.respondPermission({ id: currentPermId, allow, remember, toolName: currentPermTool });
  currentPermId = null;
  currentPermTool = '';
  el.permOverlay.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Ayarlar paneli
// ---------------------------------------------------------------------------
async function openSettings() {
  const s = await api.getSettings();
  settingsCache = s;
  const hasKey = await api.hasApiKey();
  el.setApiKey.value = '';
  el.apiKeyStatus.textContent = hasKey
    ? '✓ Kayıtlı bir anahtar var (değiştirmek için yenisini girin).'
    : 'Anahtar yok - mevcut Claude aboneliğiniz (claude CLI oturumu) kullanılacak.';
  el.setMode.value = s.permissionMode || 'plan';
  pendingTheme = s.theme || DEFAULT_THEME;
  renderThemePicker(pendingTheme);
  syncSettingsPanelModelFields();
  el.setMaxTurns.value = s.maxTurns || 10;
  el.setTools.value = (s.allowedTools || []).join(', ');
  el.settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  // Kaydedilmemiş tema önizlemesini geri al (Kapat ve Escape için de geçerli).
  applyTheme((settingsCache && settingsCache.theme) || DEFAULT_THEME);
  pendingTheme = null;
  el.settingsOverlay.classList.add('hidden');
}

async function saveSettings() {
  const key = el.setApiKey.value.trim();
  if (key) {
    await api.setApiKey(key);
  }
  const tools = el.setTools.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  await updateSettings({
    permissionMode: el.setMode.value,
    model: el.setModel.value || 'claude-opus-4-5',
    effort: el.setEffort.value || 'high',
    codexModel: el.setCodexModel.value,
    codexEffort: el.setCodexEffort.value,
    sendOnEnter: Boolean(el.setSendOnEnter && el.setSendOnEnter.checked),
    theme: pendingTheme || DEFAULT_THEME,
    provider: currentProvider,
    maxTurns: Number(el.setMaxTurns.value) || 10,
    allowedTools: tools,
  });

  closeSettings();
}

async function clearKey() {
  await api.clearApiKey();
  el.apiKeyStatus.textContent = '⚠ Anahtar silindi.';
  el.setApiKey.value = '';
}

// ---------------------------------------------------------------------------
// Aktif proje dizini
// ---------------------------------------------------------------------------
function applyDirectory(dir) {
  selectedDir = dir || null;
  const project = activeProject();
  el.projectName.textContent = project ? project.name : 'Proje se\u00e7ilmedi';
  el.projectPath.textContent = selectedDir || 'Sol panelden proje ekleyin';
  el.projectPath.title = selectedDir || '';
  updateSendState();
}

// ---------------------------------------------------------------------------
// Ba?lang??
// ---------------------------------------------------------------------------
async function init() {
  // Olay köprüleri
  api.onMessage(renderAgentMessage);
  api.onDone(onDone);
  api.onError(onError);
  api.onPermissionRequest(showPermission);
  api.onConversationCreated((conv) => {
    // main.js, "yeni konuşma" durumundayken ilk mesajı alınca kaydı oluşturur.
    currentConversationId = conv.id;
    upsertConversationInCache(conv);
  });
  api.onConversationUpdated((conv) => upsertConversationInCache(conv));

  // Buton olayları
  el.btnNewChat.addEventListener('click', startNewChat);
  el.btnAddProject.addEventListener('click', addProject);
  el.providerSelect.addEventListener('change', async () => {
    currentProvider = el.providerSelect.value === 'codex' ? 'codex' : 'claude';
    await updateSettings({ provider: currentProvider });
  });
  el.inlineModelSelect.addEventListener('change', async () => {
    if (currentProvider === 'codex') {
      await updateSettings({ codexModel: el.inlineModelSelect.value });
    } else {
      await updateSettings({ model: el.inlineModelSelect.value || 'claude-opus-4-5' });
    }
  });
  el.effortSelect.addEventListener('change', async () => {
    if (currentProvider === 'codex') {
      await updateSettings({ codexEffort: el.effortSelect.value });
    } else {
      await updateSettings({ effort: el.effortSelect.value || 'high' });
    }
  });
  el.modeSelect.addEventListener('change', async () => {
    await updateSettings({ permissionMode: el.modeSelect.value });
  });
  el.btnSend.addEventListener('click', send);
  el.btnCancel.addEventListener('click', () => api.cancel());
  el.btnTerminal.addEventListener('click', openTerminalHere);
  el.btnExport.addEventListener('click', exportCurrentConversation);
  el.btnStats.addEventListener('click', () => openStats(true));
  el.btnStatsRefresh.addEventListener('click', () => openStats(true));
  el.btnStatsClose.addEventListener('click', closeStats);
  el.btnUsage.addEventListener('click', () => openUsage());
  el.btnUsageRefresh.addEventListener('click', () => openUsage(true));
  el.btnUsageClose.addEventListener('click', closeUsage);
  el.btnSettings.addEventListener('click', openSettings);
  el.btnSettingsCancel.addEventListener('click', closeSettings);
  el.btnSettingsSave.addEventListener('click', saveSettings);
  el.btnClearKey.addEventListener('click', clearKey);
  el.btnPermAllow.addEventListener('click', () => respondPermission(true));
  el.btnPermAllowSession.addEventListener('click', () => respondPermission(true, 'session'));
  el.btnPermDeny.addEventListener('click', () => respondPermission(false));

  let searchTimer = null;
  el.convSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runConversationSearch, 200);
  });
  el.convSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      el.convSearch.value = '';
      runConversationSearch();
      el.input.focus();
    }
  });

  el.input.addEventListener('input', () => {
    autoGrowInput();
    saveDraft();
    updateSendState();
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && settingsCache && settingsCache.sendOnEnter) {
      e.preventDefault();
      send();
      return;
    }
    // Boş composer'da yukarı ok → son gönderilen istemi geri getir.
    if (e.key === 'ArrowUp' && !el.input.value && lastUserPrompt) {
      e.preventDefault();
      el.input.value = lastUserPrompt;
      autoGrowInput();
      saveDraft();
      updateSendState();
    }
  });

  // Dosya sürükle-bırak → yolu composer'a ekle.
  el.input.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.input.classList.add('drag-over');
  });
  el.input.addEventListener('dragleave', () => el.input.classList.remove('drag-over'));
  el.input.addEventListener('drop', (e) => {
    e.preventDefault();
    el.input.classList.remove('drag-over');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const paths = files
      .map((file) => (api.getDroppedFilePath ? api.getDroppedFilePath(file) : ''))
      .filter(Boolean);
    if (paths.length) insertAtCursor(paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' '));
  });

  // Pencereye bırakılan dosya uygulamayı o dosyaya yönlendirmesin.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Genel kısayollar.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // İzin diyaloğu bilinçli yanıt ister; Esc ile kapanmaz.
      if (!el.permOverlay.classList.contains('hidden')) return;
      if (!el.settingsOverlay.classList.contains('hidden')) {
        closeSettings();
        return;
      }
      if (!el.usageOverlay.classList.contains('hidden')) {
        closeUsage();
        return;
      }
      if (!el.statsOverlay.classList.contains('hidden')) {
        closeStats();
        return;
      }
      if (running) api.cancel();
      return;
    }

    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'n') {
      e.preventDefault();
      startNewChat();
    } else if (key === 'k') {
      e.preventDefault();
      el.convSearch.focus();
      el.convSearch.select();
    } else if (key === ',') {
      e.preventDefault();
      openSettings();
    }
  });

  const settings = await api.getSettings();
  settingsCache = settings;
  // theme-boot.js zaten uyguladı; bu, senkron köprü başarısız olduysa emniyet ağı.
  applyTheme(settings.theme);
  syncTopbarControls();
  syncProjectState();
  autoGrowInput();

  // Model yetenekleri ve kota rozeti: açılışı bloklamadan arka planda yüklenir.
  if (api.getModels) {
    api
      .getModels()
      .then((models) => {
        modelsCache = Array.isArray(models) ? models : [];
        if (modelsCache.length) syncTopbarControls();
      })
      .catch(() => {});
  }
  refreshUsageBadge();
  usageTimer = setInterval(() => refreshUsageBadge(), 5 * 60 * 1000);

  // Sol menüyü doldur.
  await refreshConversationList();

  const firstVisible = conversationsForActiveProject()[0];
  if (firstVisible) {
    await openConversation(firstVisible.id);
  } else {
    const hasKey = await api.hasApiKey();
    const project = activeProject();
    const dirHint = project
      ? 'Aktif proje: ' + project.name + '\n' + project.cwd
      : 'Sol paneldeki + ile bir proje ekleyin ve komutunuzu yaz\u0131n.';

    if (!hasKey) {
      addMessage(
        'msg-system',
        'ho\u015f geldiniz',
        dirHint + '\n\n' +
          'API anahtar\u0131 zorunlu de\u011fildir: anahtar girmezseniz, "claude" CLI ile giri\u015f ' +
          'yapt\u0131\u011f\u0131n\u0131z mevcut Claude aboneli\u011finiz kullan\u0131l\u0131r. \u0130sterseniz Ayarlar' +
          "'dan bir ANTHROPIC_API_KEY de girebilirsiniz."
      );
    } else {
      addMessage('msg-system', 'haz\u0131r', dirHint);
    }
  }

  updateSendState();
}

init();













