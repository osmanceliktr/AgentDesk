'use strict';

const fs = require('fs');
const path = require('path');

const CLAUDE_PLATFORM_PACKAGES = {
  'win32:x64': '@anthropic-ai/claude-agent-sdk-win32-x64',
  'win32:arm64': '@anthropic-ai/claude-agent-sdk-win32-arm64',
  'darwin:x64': '@anthropic-ai/claude-agent-sdk-darwin-x64',
  'darwin:arm64': '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  'linux:x64': '@anthropic-ai/claude-agent-sdk-linux-x64',
  'linux:arm64': '@anthropic-ai/claude-agent-sdk-linux-arm64',
};

const CODEX_PLATFORM_PACKAGES = {
  'win32:x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
  'win32:arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
  'darwin:x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
  'darwin:arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
  'linux:x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
  'linux:arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
};

function platformKey() {
  return `${process.platform}:${process.arch}`;
}

function asarUnpackedPath(filePath) {
  return filePath.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked');
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function packagePathParts(packageName) {
  return packageName.split('/');
}

function packageRootFromResolve(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
}

function packageRootFromResources(packageName) {
  if (!process.resourcesPath) return null;
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', ...packagePathParts(packageName));
}

function packageRootFromSource(packageName) {
  return path.resolve(__dirname, '..', '..', 'node_modules', ...packagePathParts(packageName));
}

function candidatePackageRoots(packageName) {
  const roots = [];
  for (const root of [
    packageRootFromResolve(packageName),
    packageRootFromResources(packageName),
    packageRootFromSource(packageName),
  ]) {
    if (!root) continue;
    const unpackedRoot = asarUnpackedPath(root);
    if (unpackedRoot !== root) addUnique(roots, unpackedRoot);
    addUnique(roots, root);
  }
  return roots;
}

function existingFile(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // siradaki adaya gec
    }
  }
  return null;
}

function existingDirs(candidates) {
  return candidates.filter((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

function resolveClaudeExecutable() {
  const packageName = CLAUDE_PLATFORM_PACKAGES[platformKey()];
  if (!packageName) return null;

  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  return existingFile(candidatePackageRoots(packageName).map((root) => path.join(root, binaryName)));
}

function resolveCodexNativePackage() {
  const entry = CODEX_PLATFORM_PACKAGES[platformKey()];
  if (!entry) return null;
  const [packageName, triple] = entry;
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';

  for (const root of candidatePackageRoots(packageName)) {
    const packageRoot = path.join(root, 'vendor', triple);
    const executablePath = path.join(packageRoot, 'bin', binaryName);
    const manifestPath = path.join(packageRoot, 'codex-package.json');
    if (!existingFile([executablePath]) || !existingFile([manifestPath])) continue;
    return {
      executablePath,
      pathDirs: existingDirs([
        path.join(packageRoot, 'codex-path'),
        path.join(packageRoot, 'path'),
      ]),
    };
  }

  return null;
}

module.exports = { resolveClaudeExecutable, resolveCodexNativePackage };
