# Agent Desk Guidance

This repository is a plain JavaScript Electron app that wraps `@anthropic-ai/claude-agent-sdk`.

Follow these rules when editing:

- Keep main/preload/renderer responsibilities separate.
- Do not introduce TypeScript, React, bundlers, or new UI frameworks without an explicit request.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Never expose plaintext API keys, `ipcRenderer`, Node APIs, or environment variables to the renderer.
- Store API keys only through `src/main/store.js`; use Electron `safeStorage` when available.
- Add renderer features through explicit preload methods and main-process IPC handlers.
- Run the Claude Agent SDK only in the main process and keep execution scoped to the selected `cwd`.
- Preserve streaming IPC updates, permission approval flow, cancellation, and SDK session resume behavior.
- Keep Turkish copy consistent with the existing UI and README.

Useful commands:

```bash
npm run dev
npm run build
```
