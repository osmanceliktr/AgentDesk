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

function pathEnvKey(env) {
  if (process.platform !== 'win32') return 'PATH';
  const matchingKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
  return matchingKeys.includes('Path') ? 'Path' : matchingKeys.at(-1) || 'PATH';
}

function prependPathDirs(env, dirs) {
  const pathDirs = Array.isArray(dirs) ? dirs.filter(Boolean) : [];
  if (pathDirs.length === 0) return env;

  const path = require('path');
  const key = pathEnvKey(env);
  if (process.platform === 'win32') {
    for (const existingKey of Object.keys(env)) {
      if (existingKey.toLowerCase() === 'path' && existingKey !== key) {
        delete env[existingKey];
      }
    }
  }

  const current = (env[key] || '').split(path.delimiter).filter(Boolean);
  env[key] = [...pathDirs, ...current.filter((entry) => !pathDirs.includes(entry))].join(path.delimiter);
  return env;
}

function buildCodexEnv(pathDirs = []) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return prependPathDirs(env, pathDirs);
}

module.exports = { buildClaudeEnv, buildCodexEnv };
