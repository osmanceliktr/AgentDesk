'use strict';

// Claude/Codex alt süreçleri için ortam değişkeni hazırlığı.
// Hem agent akışı hem de kullanım limiti sorguları aynı ortamı kullanır.

function buildClaudeEnv(apiKey) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  } else {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}

function buildCodexEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

module.exports = { buildClaudeEnv, buildCodexEnv };
