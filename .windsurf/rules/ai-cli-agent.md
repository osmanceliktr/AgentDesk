# Agent Desk Rules

Apply these rules across the repository.

- This is a plain JavaScript Electron app. Do not migrate to TypeScript, React, or a bundler unless explicitly requested.
- Keep boundaries strict:
  - `src/main/`: Electron main process, Node APIs, storage, dialogs, Claude Agent SDK execution.
  - `src/preload/preload.js`: explicit `contextBridge` API only.
  - `src/renderer/`: browser-only HTML/CSS/JS.
- Never expose `ipcRenderer`, Node APIs, env vars, or plaintext API keys to the renderer.
- Keep API keys in `src/main/store.js`, encrypted with Electron `safeStorage` when available.
- Preserve `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Validate renderer IPC payloads in the main process.
- Keep SDK execution scoped to the selected working directory.
- Preserve streaming messages, permission approvals, cancellation, and SDK resume behavior.
- Keep Turkish UI copy consistent with the existing app.
- Run `npm run build` after meaningful changes. Use `npm run dev` for manual UI/IPC verification.
