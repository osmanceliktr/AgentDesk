'use strict';

// Kısa ömürlü, mesaj göndermeyen Claude oturumu.
// Kullanım limiti ve model listesi gibi kontrol isteklerini çalıştırmak için
// SDK oturumu açar, iş bitince kapatır. Hiç prompt gönderilmediği için token
// harcamaz.

const fs = require('fs');
const os = require('os');

const store = require('./store');
const { buildClaudeEnv } = require('./providerEnv');
const { resolveClaudeExecutable } = require('./nativeBinaries');

const DEFAULT_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function pickCwd() {
  const settings = store.getSettings();
  const candidates = [settings.lastDirectory, process.cwd(), os.homedir()];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // sıradaki adaya geç
    }
  }
  return os.homedir();
}

/**
 * Boş bir Claude oturumu açar, `fn(query)` sonucunu döndürür ve oturumu kapatır.
 * @param {(q: any) => Promise<any>} fn
 * @param {{ timeoutMs?: number, timeoutMessage?: string, label?: string }} [options]
 */
async function withIdleClaudeSession(fn, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timeoutMessage = options.timeoutMessage || 'Claude oturum sorgusu zaman aşımına uğradı.';
  const label = options.label || 'claude-session';

  let release = () => {};
  const idle = new Promise((resolve) => {
    release = resolve;
  });

  async function* idlePrompt() {
    // Hiç mesaj göndermeyen akış: oturum açılır, sadece kontrol isteği çalışır.
    await idle;
  }

  const abortController = new AbortController();

  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const claudeExecutable = resolveClaudeExecutable();
    const q = query({
      prompt: idlePrompt(),
      options: {
        cwd: pickCwd(),
        permissionMode: 'plan',
        maxTurns: 1,
        allowedTools: [],
        abortController,
        includePartialMessages: false,
        executable: process.execPath,
        executableArgs: [],
        ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
        env: buildClaudeEnv(store.getApiKey()),
        stderr: (data) => console.error(`[${label} stderr]`, String(data).trim()),
      },
    });

    // Akışı boşalt: mesaj beklemiyoruz ama iterator'ın hatası yakalanmalı.
    const drain = (async () => {
      try {
        for await (const _message of q) {
          void _message;
        }
      } catch {
        // oturum kapatılırken oluşan hatalar sorguyu etkilemez
      }
    })();

    const result = await withTimeout(fn(q), timeoutMs, timeoutMessage);

    release();
    drain.catch(() => {});
    return result;
  } finally {
    release();
    try {
      abortController.abort();
    } catch {
      // yoksay
    }
  }
}

module.exports = { withIdleClaudeSession, withTimeout, pickCwd };
