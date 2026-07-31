'use strict';

// Provider orchestrator: Claude ve Codex akışlarını main process içinde çalıştırır,
// renderer'a tek tip stream mesajları gönderir.

const store = require('./store');
const { withBridgeContext } = require('./contextBridgeBuilder');
const { buildClaudeEnv, buildCodexEnv } = require('./providerEnv');

let activeAbortController = null;
let activeQuery = null;
let activeProvider = null;

function providerLabel(provider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function mapCodexPermissions(mode) {
  switch (mode) {
    case 'plan':
      return { sandboxMode: 'read-only', approvalPolicy: 'on-request' };
    case 'bypassPermissions':
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
    case 'default':
    case 'acceptEdits':
    default:
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' };
  }
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeClaudeMessage(message) {
  if (!message || typeof message !== 'object') return message;
  return { ...message, provider: 'claude' };
}

function makeSystemInit({ provider, model, permissionMode, cwd, sessionId, threadId }) {
  return {
    type: 'system',
    subtype: 'init',
    provider,
    model,
    permissionMode,
    cwd,
    session_id: sessionId,
    thread_id: threadId,
  };
}

function makeAssistantText(provider, text) {
  return {
    type: 'assistant',
    provider,
    message: { content: [{ type: 'text', text: text || '' }] },
  };
}

function makeAssistantThinking(provider, text) {
  return {
    type: 'assistant',
    provider,
    message: { content: [{ type: 'thinking', thinking: text || '' }] },
  };
}

function makeToolUse(provider, name, input) {
  return {
    type: 'assistant',
    provider,
    message: { content: [{ type: 'tool_use', name, input }] },
  };
}

function makeToolResult(provider, content, isError = false) {
  return {
    type: 'user',
    provider,
    message: { content: [{ type: 'tool_result', content, is_error: Boolean(isError) }] },
  };
}

function makeResult({ provider, ok, result, durationMs, usage }) {
  return {
    type: 'result',
    provider,
    subtype: ok ? 'success' : 'error',
    is_error: !ok,
    result: result || '',
    duration_ms: durationMs,
    usage,
  };
}

function normalizeCodexItem(item, phase) {
  if (!item || !item.type) return null;

  if (item.type === 'agent_message' && item.text) {
    return makeAssistantText('codex', item.text);
  }
  if (item.type === 'reasoning' && item.text) {
    return makeAssistantThinking('codex', item.text);
  }
  if (item.type === 'command_execution') {
    if (phase === 'started' || item.status === 'in_progress') {
      return makeToolUse('codex', 'command_execution', { command: item.command, status: item.status });
    }
    return makeToolResult(
      'codex',
      stringify({ command: item.command, exit_code: item.exit_code, output: item.aggregated_output || '' }),
      item.status === 'failed'
    );
  }
  if (item.type === 'file_change') {
    const label = item.changes.map((change) => `${change.kind}: ${change.path}`).join('\n');
    return makeToolResult('codex', label || stringify(item), item.status === 'failed');
  }
  if (item.type === 'mcp_tool_call') {
    if (phase === 'started' || item.status === 'in_progress') {
      return makeToolUse('codex', `mcp:${item.server}/${item.tool}`, item.arguments);
    }
    return makeToolResult('codex', stringify(item.error || item.result || {}), item.status === 'failed');
  }
  if (item.type === 'web_search') {
    return makeToolUse('codex', 'web_search', { query: item.query });
  }
  if (item.type === 'todo_list') {
    const lines = item.items.map((todo) => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`).join('\n');
    return makeToolResult('codex', lines, false);
  }
  if (item.type === 'error') {
    return makeResult({ provider: 'codex', ok: false, result: item.message });
  }
  return null;
}

function normalizeCodexError(err) {
  const raw = err && err.message ? err.message : String(err || 'Bilinmeyen Codex hatası');
  if (/login|auth|unauthorized|api key|credential|CODEX_API_KEY|OPENAI_API_KEY/i.test(raw)) {
    return 'Codex CLI oturumu bulunamadı. Lütfen terminalde codex login komutunu çalıştırın.';
  }
  if (/Unable to locate Codex CLI binaries|Cannot find package|module not found|ENOENT/i.test(raw)) {
    return 'Codex CLI/SDK bulunamadı. Lütfen @openai/codex-sdk kurulumunu ve Codex CLI erişimini kontrol edin.';
  }
  return raw;
}

async function runClaude({ prompt, cwd, resumeSessionId, bridgeContext, onMessage, requestPermission }) {
  const apiKey = store.getApiKey();
  const settings = store.getSettings();
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const abortController = new AbortController();
  activeAbortController = abortController;

  const canUseTool = async (toolName, input) => {
    try {
      const decision = await requestPermission({ provider: 'claude', toolName, input });
      if (decision && decision.allow) {
        return { behavior: 'allow', updatedInput: input };
      }
      return {
        behavior: 'deny',
        message: (decision && decision.message) || 'Kullanıcı bu aracı reddetti.',
      };
    } catch (err) {
      return { behavior: 'deny', message: `Onay hatası: ${err.message}` };
    }
  };

  const options = {
    cwd,
    model: settings.model || 'claude-opus-4-5',
    permissionMode: settings.permissionMode || 'plan',
    maxTurns: Number(settings.maxTurns) || 10,
    allowedTools: settings.allowedTools,
    canUseTool,
    abortController,
    includePartialMessages: false,
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    executable: process.execPath,
    executableArgs: [],
    env: buildClaudeEnv(apiKey),
    stderr: (data) => console.error('[claude-agent-sdk stderr]', String(data).trim()),
  };

  const q = query({ prompt: withBridgeContext(prompt, bridgeContext), options });
  activeQuery = q;

  for await (const message of q) {
    onMessage(normalizeClaudeMessage(message));
  }
}

async function runCodex({ prompt, cwd, resumeThreadId, bridgeContext, onMessage }) {
  const settings = store.getSettings();
  const { Codex } = await import('@openai/codex-sdk');
  const abortController = new AbortController();
  activeAbortController = abortController;

  const permission = mapCodexPermissions(settings.permissionMode || 'plan');
  const model = (settings.codexModel || '').trim() || undefined;
  const codex = new Codex({ env: buildCodexEnv() });
  const threadOptions = {
    ...permission,
    ...(model ? { model } : {}),
    workingDirectory: cwd,
    skipGitRepoCheck: true,
  };
  const thread = resumeThreadId
    ? codex.resumeThread(resumeThreadId, threadOptions)
    : codex.startThread(threadOptions);

  const startedAt = Date.now();
  let threadId = resumeThreadId || null;
  let finalResponse = '';
  let usage = null;
  let initSent = false;

  const { events } = await thread.runStreamed(withBridgeContext(prompt, bridgeContext), {
    signal: abortController.signal,
  });

  for await (const event of events) {
    if (event.type === 'thread.started') {
      threadId = event.thread_id;
      initSent = true;
      onMessage(makeSystemInit({
        provider: 'codex',
        model: model || 'codex varsayılanı',
        permissionMode: `${permission.sandboxMode}/${permission.approvalPolicy}`,
        cwd,
        threadId,
      }));
      continue;
    }

    if (event.type === 'turn.started' && !initSent) {
      initSent = true;
      onMessage(makeSystemInit({
        provider: 'codex',
        model: model || 'codex varsayılanı',
        permissionMode: `${permission.sandboxMode}/${permission.approvalPolicy}`,
        cwd,
        threadId: thread.id || threadId,
      }));
      continue;
    }

    if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
      const normalized = normalizeCodexItem(event.item, event.type.split('.')[1]);
      if (event.item && event.item.type === 'agent_message') finalResponse = event.item.text || finalResponse;
      if (normalized) onMessage(normalized);
      continue;
    }

    if (event.type === 'turn.completed') {
      usage = event.usage || null;
      onMessage(makeResult({
        provider: 'codex',
        ok: true,
        result: finalResponse,
        durationMs: Date.now() - startedAt,
        usage,
      }));
      continue;
    }

    if (event.type === 'turn.failed') {
      onMessage(makeResult({
        provider: 'codex',
        ok: false,
        result: event.error && event.error.message,
        durationMs: Date.now() - startedAt,
        usage,
      }));
      throw new Error(event.error && event.error.message ? event.error.message : 'Codex turu başarısız oldu.');
    }

    if (event.type === 'error') {
      throw new Error(event.message || 'Codex stream hatası.');
    }
  }
}

async function runQuery(params) {
  const provider = params.provider === 'codex' ? 'codex' : 'claude';
  if (activeProvider) {
    throw new Error('Zaten aktif bir agent oturumu var.');
  }
  if (!params.cwd) {
    throw new Error('Çalışma dizini seçilmedi.');
  }

  activeProvider = provider;
  try {
    if (provider === 'codex') {
      await runCodex(params);
    } else {
      await runClaude(params);
    }
  } catch (err) {
    if (provider === 'codex') {
      throw new Error(normalizeCodexError(err));
    }
    throw err;
  } finally {
    activeQuery = null;
    activeAbortController = null;
    activeProvider = null;
  }
}

function cancel() {
  try {
    if (activeQuery && typeof activeQuery.interrupt === 'function') {
      activeQuery.interrupt();
    }
  } catch (err) {
    console.warn(`[${providerLabel(activeProvider)}] interrupt hatası:`, err.message);
  }
  if (activeAbortController) {
    activeAbortController.abort();
  }
}

function isRunning() {
  return Boolean(activeProvider);
}

module.exports = { runQuery, cancel, isRunning };
