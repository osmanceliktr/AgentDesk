# AI CLI Agent Rules

## Project Shape

- This is a plain JavaScript Electron desktop app. Do not introduce TypeScript, React, bundlers, or new UI frameworks unless the user explicitly asks for that migration.
- Keep Electron boundaries clear:
  - `src/main/` owns Node/Electron APIs, filesystem access, settings, dialogs, and Claude Agent SDK execution.
  - `src/preload/preload.js` exposes the only renderer-facing API through `contextBridge`.
  - `src/renderer/` stays browser-only HTML/CSS/JS.
- Preserve Turkish user-facing copy unless the user asks for another language.

## Security Rules

- Never expose `ipcRenderer`, Node APIs, environment variables, or plaintext API keys to the renderer.
- API keys must stay in the main process and be stored through `safeStorage` when available.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` in `BrowserWindow` unless a security review justifies a change.
- Route new renderer capabilities through small, explicit preload methods and matching `ipcMain.handle` or `ipcMain.on` handlers.
- Validate and normalize renderer-provided payloads in the main process before using them for filesystem paths, SDK options, or settings.
- Treat `bypassPermissions` as dangerous. Do not make it the default.

## Claude Agent SDK Rules

- Run `@anthropic-ai/claude-agent-sdk` from the main process only.
- Keep SDK loading as dynamic `import()` from CommonJS modules.
- Keep agent execution scoped to the selected `cwd`.
- Preserve streaming behavior: forward SDK messages incrementally through IPC.
- Preserve cancellation behavior through the active query and abort controller.
- When packaging changes touch SDK execution, verify the Electron child-process setup still uses `process.execPath` with `ELECTRON_RUN_AS_NODE`.

## UI Rules

- Keep the renderer dependency-free unless there is a clear reason to add a small dependency.
- Build DOM nodes with `textContent` for untrusted content. If rendering markdown, escape HTML before adding allowed markup.
- Keep the app functional and compact; this is an operational desktop tool, not a landing page.
- Avoid UI changes that break narrow windows. The app minimum size is `800x600`.

## Conversation Storage

- Conversation metadata lives in `index.json`; transcript entries live in per-conversation JSON files under Electron `userData`.
- Do not store API keys, auth tokens, or other secrets in conversation transcripts.
- Keep resume behavior tied to SDK `session_id` from `system/init` messages.

## Validation

- After code changes, run at least:

```bash
npm run build
```

- Use `npm run dev` for manual Electron verification when UI, IPC, dialogs, SDK streaming, or packaging-sensitive behavior changes.
- There is no test suite in this project yet. Prefer adding focused tests only when a test harness is introduced deliberately.
