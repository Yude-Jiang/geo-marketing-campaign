# GEO Campaign Hub

AI-driven GEO marketing campaign planner: minimal input → cognitive probes → campaign blueprint → report.

## Local dev

```bash
npm install
cp .env.example .env.local   # add VITE_GEMINI_API_KEY
npm run dev                  # Vite only — use two terminals or:
# Terminal 1: npm run build && npm start
```

For full stack (API proxy + secrets), run `npm run build && npm start` on port 8080.

## Deploy via GitHub → Cloud Run (recommended)

1. Complete one-time GCP setup: [docs/deploy-github-cloud-run.md](docs/deploy-github-cloud-run.md)
2. Push this repo to GitHub
3. Add secrets `GCP_PROJECT_ID` and `GCP_SA_KEY`
4. Push to `main` — GitHub Actions deploys automatically

Workflow file: `.github/workflows/deploy-cloud-run.yml`

## Deploy locally (alternative)

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
- **Server**: Express (`server.js`) — `/config.js`, `/api/fetch-url`, `/api/multi-model-probe`
- **Gemini**: preprocess, probes, synthesis, reports
- **CN LLMs**: DeepSeek / Qwen / Doubao / Kimi via server proxy (keys never in browser)
