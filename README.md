# GEO Campaign Hub

AI-driven GEO marketing campaign planner: minimal input → cognitive probes → campaign blueprint → report.

## Local dev

```bash
npm install
cp .env.example .env.local   # VITE_GEMINI_API_KEY + CN keys (server reads at runtime)
npm run dev                  # Vite :5173 — run server in another terminal:
npm run build && npm start   # Express :8080 (proxies /api from Vite)
```

For full stack (API proxy + secrets), run `npm run build && npm start` on port 8080.

## Deploy via Cloud Shell (recommended — no JSON keys)

1. Open [Cloud Shell](https://shell.cloud.google.com) with project `st-china-ai-force`
2. Follow [docs/deploy-cloud-shell.md](docs/deploy-cloud-shell.md) (clone repo + `gcloud run deploy --source .`)

## Deploy via GitHub Actions (later)

Org policy may block SA JSON keys; use WIF when ready. See [docs/deploy-github-cloud-run.md](docs/deploy-github-cloud-run.md).

## Deploy from local machine

**Prerequisites**

- `gcloud` CLI logged in (`gcloud auth login`)
- Project: `st-china-ai-force` (or override)
- Secrets in Secret Manager: `VITE_GEMINI_API_KEY`, `VITE_DEEPSEEK_API_KEY`, `VITE_QWEN_API_KEY`, `VITE_DOUBAO_API_KEY`, `VITE_Kimi_API_KEY`
- Cloud Run service account: **Secret Manager Secret Accessor**

**One-command deploy**

```powershell
npm run deploy:cloud-run
```

Or manually:

```powershell
gcloud run deploy geo-campaign-hub --source . --region asia-east1 --allow-unauthenticated --set-env-vars GOOGLE_CLOUD_PROJECT=st-china-ai-force
```

**CI via Cloud Build**

```bash
gcloud builds submit --config cloudbuild.yaml
```

## Architecture

- **Frontend**: React + Vite → static `dist/`
- **Server**: Express (`server.js`) — `/api/gemini/*`, `/api/fetch-url`, `/api/multi-model-probe`
- **Gemini + CN LLMs**: all keys server-side only; browser calls same-origin API proxies

## Security model

- **No user authentication** — app stays publicly reachable (`--allow-unauthenticated`).
- **All LLM keys stay on the server** (Secret Manager / env). `/config.js` does not inject secrets; the browser calls `/api/gemini/*` and `/api/multi-model-probe` instead.
