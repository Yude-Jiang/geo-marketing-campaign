# Deploy GEO Campaign Hub to Google Cloud Run
# Prerequisites: gcloud CLI, Docker (optional if using --source), project st-china-ai-force
#
# Usage:
#   .\scripts\deploy-cloud-run.ps1
#   .\scripts\deploy-cloud-run.ps1 -ProjectId my-gcp-project -Region asia-east1

param(
  [string]$ProjectId = "st-china-ai-force",
  [string]$ServiceName = "geo-campaign-hub",
  [string]$Region = "asia-east1"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "==> Setting project: $ProjectId"
gcloud config set project $ProjectId

Write-Host "==> Enabling APIs (if needed)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com --quiet

Write-Host "==> Deploying $ServiceName to Cloud Run ($Region) from source..."
Set-Location $Root

gcloud run deploy $ServiceName `
  --source . `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --memory 512Mi `
  --cpu 1 `
  --timeout 300 `
  --min-instances 0 `
  --max-instances 5 `
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$ProjectId"

Write-Host ""
Write-Host "==> Done. Service URL:"
gcloud run services describe $ServiceName --region $Region --format "value(status.url)"
Write-Host ""
Write-Host "Ensure the Cloud Run service account has Secret Manager Secret Accessor on:"
Write-Host "  VITE_GEMINI_API_KEY, VITE_DEEPSEEK_API_KEY, VITE_QWEN_API_KEY, VITE_DOUBAO_API_KEY, VITE_Kimi_API_KEY"
