'use strict';

// Gerçek kalan kota bilgisi:
// - Claude: Agent SDK'nın /usage verisini döndüren kontrol isteği (plan bazlı rate limit pencereleri).
// - Codex: Codex CLI app-server üzerinden JSON-RPC `account/rateLimits/read`.
// İki tarafta da kullanılan hesap oturumu (subscription) gereklidir; API anahtarı ile
// çalışan oturumlarda plan limiti kavramı yoktur.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const store = require('./store');
const { buildClaudeEnv, buildCodexEnv } = require('./providerEnv');

const CLAUDE_TIMEOUT_MS = 30000;
const CODEX_TIMEOUT_MS = 20000;

const CLAUDE_WINDOW_LABELS = {
  five_hour: '5 saatlik pencere',
  seven_day: 'Haftalık (tüm modeller)',
  seven_day_opus: 'Haftalık (Opus)',
  seven_day_sonnet: 'Haftalık (Sonnet)',
  seven_day_oauth_apps: 'Haftalık (bağlı uygulamalar)',
  seven_day_overage_included: 'Haftalık (ek kullanım dahil)',
};

const CODEX_PLATFORM_PACKAGES = {
  'win32:x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
  'win32:arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
  'darwin:x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
  'darwin:arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
  'linux:x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
  'linux:arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
};

function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function makeWindow(key, label, usedPercent, resetsAtMs) {
  const used = clampPercent(usedPercent);
  return {
    key,
    label,
    usedPercent: used,
    remainingPercent: used === null ? null : 100 - used,
    resetsAt: typeof resetsAtMs === 'number' && Number.isFinite(resetsAtMs) ? resetsAtMs : null,
  };
}

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

// --- Claude ---

function claudeWindowsFromRateLimits(rateLimits) {
  const windows = [];
  if (!rateLimits || typeof rateLimits !== 'object') return windows;

  for (const [key, value] of Object.entries(rateLimits)) {
    if (key === 'extra_usage' || key === 'limits' || key === 'model_scoped') continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (typeof value.utilization !== 'number') continue;
    const resetsAt = value.resets_at ? Date.parse(value.resets_at) : NaN;
    windows.push(makeWindow(key, CLAUDE_WINDOW_LABELS[key] || key, value.utilization, resetsAt));
  }

  for (const scoped of Array.isArray(rateLimits.model_scoped) ? rateLimits.model_scoped : []) {
    if (!scoped || typeof scoped.utilization !== 'number') continue;
    const resetsAt = scoped.resets_at ? Date.parse(scoped.resets_at) : NaN;
    windows.push(makeWindow(
      `model:${scoped.display_name}`,
      `Haftalık (${scoped.display_name})`,
      scoped.utilization,
      resetsAt
    ));
  }

  return windows;
}

function claudeNotes(usage) {
  const notes = [];
  const extra = usage && usage.rate_limits && usage.rate_limits.extra_usage;
  if (extra && typeof extra === 'object') {
    if (extra.is_enabled) {
      const used = clampPercent(extra.utilization);
      notes.push(`Ek kullanım kredisi açık${used === null ? '' : ` · %${used} kullanıldı`}`);
    } else {
      notes.push('Ek kullanım kredisi kapalı');
    }
  }
  const cost = usage && usage.session && usage.session.total_cost_usd;
  if (typeof cost === 'number' && cost > 0) {
    notes.push(`Bu sorgu oturumunun maliyeti: $${cost.toFixed(4)}`);
  }
  return notes;
}

async function readClaudeUsage() {
  const apiKey = store.getApiKey();
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
        env: buildClaudeEnv(apiKey),
        stderr: (data) => console.error('[usage:claude stderr]', String(data).trim()),
      },
    });

    // Akışı boşalt: mesaj beklemiyoruz ama iterator'ın hatası yakalanmalı.
    const drain = (async () => {
      try {
        for await (const _message of q) {
          void _message;
        }
      } catch {
        // oturum kapatılırken oluşan hatalar limit sorgusunu etkilemez
      }
    })();

    const usage = await withTimeout(
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      CLAUDE_TIMEOUT_MS,
      'Claude limit sorgusu zaman aşımına uğradı.'
    );

    release();
    drain.catch(() => {});

    const windows = usage.rate_limits_available ? claudeWindowsFromRateLimits(usage.rate_limits) : [];
    const plan = usage.subscription_type || null;

    let status;
    if (usage.rate_limits_available && windows.length > 0) {
      status = plan ? `${plan} planı · kalan kota okunuyor` : 'Kalan kota okunuyor';
    } else if (apiKey) {
      status = 'API anahtarı ile çalışılıyor: plan bazlı kota limiti yok (kullandıkça öde).';
    } else {
      status = 'Bu oturum için plan limiti bildirilmiyor.';
    }

    return {
      label: 'Claude',
      ok: true,
      plan,
      status,
      windows,
      notes: claudeNotes(usage),
      error: null,
    };
  } catch (err) {
    return {
      label: 'Claude',
      ok: false,
      plan: null,
      status: 'Limit bilgisi alınamadı',
      windows: [],
      notes: [],
      error: normalizeClaudeError(err),
    };
  } finally {
    release();
    try {
      abortController.abort();
    } catch {
      // yoksay
    }
  }
}

function normalizeClaudeError(err) {
  const raw = err && err.message ? err.message : String(err || 'Bilinmeyen hata');
  if (/not a function|usage_EXPERIMENTAL/i.test(raw)) {
    return 'Kurulu Claude Agent SDK sürümü kullanım verisi API\'sini desteklemiyor. SDK\'yı güncelleyin.';
  }
  if (/auth|oauth|unauthorized|401|login/i.test(raw)) {
    return 'Claude oturumu doğrulanamadı. Terminalde `claude` ile giriş yapın veya API anahtarını kontrol edin.';
  }
  return raw;
}

// --- Codex ---

function resolveCodexBinary() {
  const entry = CODEX_PLATFORM_PACKAGES[`${process.platform}:${process.arch}`];
  if (!entry) return null;
  const [pkg, triple] = entry;
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';

  try {
    const pkgRoot = path.dirname(require.resolve(`${pkg}/package.json`));
    const candidates = [pkgRoot];
    if (pkgRoot.includes('app.asar')) {
      candidates.push(pkgRoot.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'));
    }
    for (const root of candidates) {
      const binary = path.join(root, 'vendor', triple, 'bin', exe);
      if (fs.existsSync(binary)) return binary;
    }
  } catch {
    // paket bulunamadı
  }
  return null;
}

function codexWindowLabel(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return 'Kullanım penceresi';
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080;
    return weeks === 1 ? 'Haftalık' : `${weeks} haftalık`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? 'Günlük' : `${days} günlük`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} saatlik pencere`;
  return `${minutes} dakikalık pencere`;
}

function codexWindowsFromSnapshot(snapshot, prefix) {
  const windows = [];
  for (const [key, slot] of [['primary', snapshot.primary], ['secondary', snapshot.secondary]]) {
    if (!slot || typeof slot.usedPercent !== 'number') continue;
    const label = codexWindowLabel(slot.windowDurationMins);
    windows.push(makeWindow(
      `${prefix || 'codex'}:${key}`,
      prefix ? `${prefix} · ${label}` : label,
      slot.usedPercent,
      typeof slot.resetsAt === 'number' ? slot.resetsAt * 1000 : NaN
    ));
  }
  return windows;
}

function mapCodexRateLimits(result) {
  const byLimitId = result && result.rateLimitsByLimitId;
  const buckets = byLimitId && typeof byLimitId === 'object' && Object.keys(byLimitId).length > 0
    ? Object.entries(byLimitId)
    : [[null, (result && result.rateLimits) || {}]];

  const windows = [];
  let plan = null;
  const notes = [];

  for (const [limitId, snapshot] of buckets) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    if (!plan && snapshot.planType && snapshot.planType !== 'unknown') plan = snapshot.planType;
    windows.push(...codexWindowsFromSnapshot(snapshot, buckets.length > 1 ? (limitId || 'limit') : null));
    if (snapshot.credits && typeof snapshot.credits === 'object') {
      if (snapshot.credits.unlimited) notes.push('Kredi: sınırsız');
      else if (snapshot.credits.balance) notes.push(`Kredi bakiyesi: ${snapshot.credits.balance}`);
    }
    if (snapshot.spendControlReached) notes.push('Harcama limiti doldu.');
  }

  return { windows, plan, notes: [...new Set(notes)] };
}

function requestCodexRateLimits(binary) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: buildCodexEnv(),
      });
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    let buffer = '';
    let stderrTail = '';

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // yoksay
      }
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error('Codex limit sorgusu zaman aşımına uğradı.'));
    }, CODEX_TIMEOUT_MS);

    const send = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (err) {
        finish(err);
      }
    };

    child.on('error', (err) => finish(err));
    child.on('exit', (code) => {
      finish(new Error(stderrTail.trim() || `Codex app-server beklenmedik şekilde kapandı (kod ${code}).`));
    });

    child.stderr.on('data', (data) => {
      stderrTail = `${stderrTail}${data}`.slice(-400);
    });

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.id === 1) {
          if (message.error) {
            finish(new Error(message.error.message || 'Codex app-server başlatılamadı.'));
            return;
          }
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} });
          continue;
        }

        if (message.id === 2) {
          if (message.error) {
            finish(new Error(message.error.message || 'Codex kota bilgisi alınamadı.'));
            return;
          }
          finish(null, message.result || {});
          return;
        }
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'ai-cli-agent', title: 'AI CLI Agent', version: '1.0.0' } },
    });
  });
}

async function readCodexUsage() {
  const binary = resolveCodexBinary();
  if (!binary) {
    return {
      label: 'Codex',
      ok: false,
      plan: null,
      status: 'Codex CLI bulunamadı',
      windows: [],
      notes: [],
      error: 'Codex çalıştırılabilir dosyası bulunamadı. `npm install` ile @openai/codex-sdk kurulumunu kontrol edin.',
    };
  }

  try {
    const result = await requestCodexRateLimits(binary);
    const { windows, plan, notes } = mapCodexRateLimits(result);
    return {
      label: 'Codex',
      ok: true,
      plan,
      status: windows.length
        ? (plan ? `${plan} planı · kalan kota okunuyor` : 'Kalan kota okunuyor')
        : 'Bu hesap için kota penceresi bildirilmiyor.',
      windows,
      notes,
      error: null,
    };
  } catch (err) {
    const raw = err && err.message ? err.message : String(err);
    const friendly = /login|auth|unauthorized|401|credential/i.test(raw)
      ? 'Codex oturumu bulunamadı. Terminalde `codex login` komutunu çalıştırın.'
      : raw;
    return {
      label: 'Codex',
      ok: false,
      plan: null,
      status: 'Limit bilgisi alınamadı',
      windows: [],
      notes: [],
      error: friendly,
    };
  }
}

async function getUsageLimits() {
  const [claude, codex] = await Promise.all([readClaudeUsage(), readCodexUsage()]);
  const anyWindows = claude.windows.length > 0 || codex.windows.length > 0;

  return {
    updatedAt: Date.now(),
    supportsRemaining: anyWindows,
    message: anyWindows
      ? 'Kalan kota, sağlayıcıların bildirdiği kullanım pencerelerinden okunur (yüzde bazlı).'
      : 'Sağlayıcılar bu oturum için kota penceresi bildirmedi.',
    providers: { claude, codex },
  };
}

module.exports = { getUsageLimits };
