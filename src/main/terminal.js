'use strict';

// Seçili proje dizininde işletim sistemi terminalini açar.
// Renderer'dan gelen yol doğrudan kullanılmaz: yalnızca kayıtlı projelerin veya
// mevcut konuşmaların dizinlerinden biriyse kabul edilir.

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const store = require('./store');
const conversations = require('./conversations');

// Windows Terminal penceresi adı: her açılışta yeni pencere yerine bu pencereye
// sekme eklenir. Kullanıcının kendi terminal pencereleri rahatsız edilmez.
const WT_WINDOW_NAME = 'agent-desktop';

let windowsTerminalPath; // undefined = henüz aranmadı, null = yok

function normalizeKey(dir) {
  return String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// İzin verilen dizinler: kayıtlı projeler + kaydedilmiş konuşmaların dizinleri.
function allowedDirectories() {
  const dirs = new Set();
  const settings = store.getSettings();
  for (const project of settings.projects || []) {
    if (project && project.cwd) dirs.add(normalizeKey(project.cwd));
  }
  for (const conv of conversations.list()) {
    if (conv && conv.cwd) dirs.add(normalizeKey(conv.cwd));
  }
  return dirs;
}

function resolveDirectory(requested) {
  const settings = store.getSettings();
  const active = (settings.projects || []).find((project) => project.id === settings.activeProjectId);
  const fallback = (active && active.cwd) || settings.lastDirectory || null;
  const wanted = typeof requested === 'string' && requested.trim() ? requested.trim() : fallback;

  if (!wanted) return { error: 'Önce sol panelden bir proje seçin.' };
  if (!allowedDirectories().has(normalizeKey(wanted))) {
    return { error: 'Bu dizin proje/konuşma listesinde bulunmuyor.' };
  }
  try {
    if (!fs.statSync(wanted).isDirectory()) return { error: `Dizin bulunamadı: ${wanted}` };
  } catch {
    return { error: `Dizin bulunamadı: ${wanted}` };
  }
  return { cwd: path.normalize(wanted) };
}

// Windows Terminal (wt.exe) kurulu mu? Sonuç önbelleklenir.
// Not: wt.exe bir "App Execution Alias" (reparse point) olduğu için
// fs.existsSync/statSync onu göremez (EACCES) — bu yüzden where.exe ve
// accessSync ile aranır.
function findWindowsTerminal() {
  if (windowsTerminalPath !== undefined) return windowsTerminalPath;
  windowsTerminalPath = null;

  try {
    const found = execFileSync('where.exe', ['wt.exe'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) {
      windowsTerminalPath = found;
      return windowsTerminalPath;
    }
  } catch {
    // PATH üzerinde yok; alias yolunu dene
  }

  if (process.env.LOCALAPPDATA) {
    const alias = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe');
    try {
      fs.accessSync(alias, fs.constants.F_OK);
      windowsTerminalPath = alias;
    } catch {
      // Windows Terminal kurulu değil
    }
  }
  return windowsTerminalPath;
}

// Yeni konsol penceresi (Windows Terminal yoksa kullanılır).
function spawnCmdWindow(cwd) {
  const shell = process.env.ComSpec || 'cmd.exe';
  return spawn(shell, ['/c', 'start', '""', '/D', cwd, 'cmd.exe'], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
}

function openTerminal(requested) {
  const resolved = resolveDirectory(requested);
  if (resolved.error) return { ok: false, error: resolved.error };
  const cwd = resolved.cwd;
  const title = path.basename(cwd) || cwd;

  try {
    if (process.platform === 'win32') {
      const wt = findWindowsTerminal();
      if (wt) {
        // -w <ad>: aynı adlı pencere varsa ona SEKME ekler, yoksa oluşturur.
        const child = spawn(wt, ['-w', WT_WINDOW_NAME, 'new-tab', '--title', title, '-d', cwd], {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.on('error', (err) => {
          console.error('[terminal] Windows Terminal açılamadı, cmd penceresine düşülüyor:', err.message);
          windowsTerminalPath = null;
          try {
            spawnCmdWindow(cwd).unref();
          } catch {
            // yoksay
          }
        });
        child.unref();
        return { ok: true, cwd, mode: 'tab' };
      }

      const child = spawnCmdWindow(cwd);
      child.on('error', (err) => console.error('[terminal] açılamadı:', err.message));
      child.unref();
      return { ok: true, cwd, mode: 'window' };
    }

    if (process.platform === 'darwin') {
      const child = spawn('open', ['-a', 'Terminal', cwd], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => console.error('[terminal] açılamadı:', err.message));
      child.unref();
      return { ok: true, cwd, mode: 'window' };
    }

    const linuxTerminal = process.env.TERMINAL || 'x-terminal-emulator';
    const child = spawn(linuxTerminal, [], { cwd, detached: true, stdio: 'ignore' });
    child.on('error', (err) => console.error('[terminal] açılamadı:', err.message));
    child.unref();
    return { ok: true, cwd, mode: 'window' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { openTerminal };
