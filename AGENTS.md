# AGENTS.md

## Cursor Cloud specific instructions

GEO Campaign Hub is a React + Vite SPA (`src/`) with a small Express API-proxy server (`server.js`). All LLM keys live server-side; the browser only calls same-origin `/api/*` proxies. Dependencies install with `npm install`.

### Services / how to run (dev)

Two processes are needed for the full stack in development:

- Express API server: `node server.js` (or `npm start`) on port `8080`. It serves the built `dist/` and proxies `/api/gemini/*`, `/api/fetch-url`, `/api/multi-model-probe`, and `/config.js`.
- Vite dev server: `npm run dev` on port `5173`. Open the app at `http://localhost:5173`; Vite proxies `/api` and `/config.js` to `:8080` (see `vite.config.ts`).

Standard scripts live in `package.json` (`dev`, `build`, `lint`, `start`, `preview`).

### Non-obvious caveats

- `server.js` refuses to start unless `dist/index.html` exists AND no longer references `/src/main.tsx`. Always run `npm run build` before `node server.js`; after changing frontend code, rebuild so the Express server serves fresh assets (it does not hot-reload the SPA — only Vite on `:5173` does).
- LLM keys are read from env (`VITE_GEMINI_API_KEY`, `VITE_DEEPSEEK_API_KEY`, `VITE_QWEN_API_KEY`, `VITE_DOUBAO_API_KEY`, `VITE_Kimi_API_KEY`) or, in GCP, from Secret Manager. Locally, copy `.env.example` to `.env.local`. Placeholder values containing `your_` are treated as "not configured".
- Without `VITE_GEMINI_API_KEY`, the campaign pipeline ("Run" on Step 1 Discovery) fails with `Gemini API key not configured on server`; the UI still renders and surfaces the error gracefully. Gemini is required for core functionality; the CN model keys are optional (missing ones render per-model "not configured" instead of erroring).
- `npm run lint` currently reports pre-existing `@typescript-eslint/no-explicit-any` errors in the source; these are code issues, not environment problems.
- Health check: `curl localhost:8080/healthz` → `{"ok":true,"hasDist":true}`.
