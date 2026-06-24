#!/usr/bin/env bash
# Run this in Google Cloud Shell (https://console.cloud.google.com → Activate Cloud Shell)
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-st-china-ai-force}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-geo-campaign-hub}"
REPO_URL="${REPO_URL:-https://github.com/Yude-Jiang/geo-marketing-campaign.git}"
WORKDIR="${WORKDIR:-geo-marketing-campaign}"

echo "==> Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE"

gcloud config set project "$PROJECT_ID"

echo "==> Enabling APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com --quiet

if [ ! -d "$WORKDIR" ]; then
  echo "==> Cloning $REPO_URL"
  git clone "$REPO_URL" "$WORKDIR"
else
  echo "==> Updating existing $WORKDIR"
  git -C "$WORKDIR" pull --ff-only || true
fi

cd "$WORKDIR"

echo "==> Deploying to Cloud Run (build + deploy, ~3–8 min)..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
echo ""
echo "==> Deployed: $URL"
echo ""
echo "If API calls fail, grant Secret Manager access to the Cloud Run runtime SA:"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "  gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "    --member=serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \\"
echo "    --role=roles/secretmanager.secretAccessor"
