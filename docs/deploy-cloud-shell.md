# Cloud Shell 一键部署 Cloud Run

无需 GitHub Actions、无需 JSON 密钥。在 GCP 控制台打开 Cloud Shell 即可。

## 步骤

### 1. 打开 Cloud Shell

[Google Cloud Console](https://console.cloud.google.com) → 右上角 **Activate Cloud Shell**  
确认项目为 **`st-china-ai-force`**。

### 2. 复制粘贴执行（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/Yude-Jiang/geo-marketing-campaign/main/scripts/deploy-cloud-shell.sh | bash
```

若脚本尚未 push，在 Cloud Shell 里手动执行：

```bash
export PROJECT_ID=st-china-ai-force
export REGION=asia-east1
export SERVICE=geo-campaign-hub

gcloud config set project $PROJECT_ID

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com --quiet

git clone https://github.com/Yude-Jiang/geo-marketing-campaign.git
cd geo-marketing-campaign

gcloud run deploy $SERVICE \
  --source . \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"

gcloud run services describe $SERVICE --region $REGION --format='value(status.url)'
```

### 3. 确认 Secret Manager（首次部署）

Secret 名称：`VITE_GEMINI_API_KEY` 等 5 个（见 `server.js`）。

给 Cloud Run 运行时账号读 Secret 的权限：

```bash
PROJECT_NUMBER=$(gcloud projects describe st-china-ai-force --format='value(projectNumber)')

gcloud projects add-iam-policy-binding st-china-ai-force \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 4. 验证

浏览器打开上一步输出的 URL，进入 **Campaign 发现** 页，输入主题测试分析。

---

## 更新部署（改代码后）

```bash
cd ~/geo-marketing-campaign
git pull
gcloud run deploy geo-campaign-hub --source . --region asia-east1 --allow-unauthenticated
```

---

## 常见问题

| 现象 | 处理 |
|------|------|
| Build 失败 | Cloud Shell 里看构建日志；确认 `package.json` / `Dockerfile` 存在 |
| 页面能开、API 报错 | 检查 Secret Manager 与 accessor 权限 |
| 权限不足 | 需要 `Cloud Run Admin` + `Cloud Build Editor` 等项目角色 |
