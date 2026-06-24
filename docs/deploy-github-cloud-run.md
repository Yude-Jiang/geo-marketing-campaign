# GitHub → Cloud Run 部署指南

推送代码到 GitHub `main` / `master` 分支后，GitHub Actions 自动构建并部署到 Cloud Run。

## 一、一次性 GCP 配置

### 1. 创建部署用服务账号

```bash
export PROJECT_ID=st-china-ai-force
gcloud config set project $PROJECT_ID

gcloud iam service-accounts create github-cloud-run-deploy \
  --display-name="GitHub Actions Cloud Run Deploy"

export SA_EMAIL=github-cloud-run-deploy@${PROJECT_ID}.iam.gserviceaccount.com
```

### 2. 授予部署权限

```bash
for ROLE in \
  roles/run.admin \
  roles/iam.serviceAccountUser \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/serviceusage.serviceUsageConsumer
do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE"
done
```

### 3. 生成 JSON 密钥（仅用于 GitHub Secret）

```bash
gcloud iam service-accounts keys create github-sa-key.json \
  --iam-account=$SA_EMAIL
```

> 将 `github-sa-key.json` 完整内容存入 GitHub Secret，**不要提交到仓库**。

### 4. Cloud Run **运行时**服务账号访问 Secret Manager

应用启动时从 Secret Manager 读取 API Key（见 `server.js`）。  
确保 Cloud Run 默认计算服务账号（或你指定的运行时 SA）有：

```bash
# 查看 Cloud Run 运行时 SA（部署后）或项目默认：
# PROJECT_NUMBER-compute@developer.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Secret Manager 中需存在：

- `VITE_GEMINI_API_KEY`
- `VITE_DEEPSEEK_API_KEY`
- `VITE_QWEN_API_KEY`
- `VITE_DOUBAO_API_KEY`
- `VITE_Kimi_API_KEY`

---

## 二、GitHub 仓库配置

### 1. 创建仓库并推送代码

```bash
cd geo-strategic-hub-experimental-claude-kind-maxwell-BeNiS
git init
git add .
git commit -m "feat: GEO Campaign Hub with GitHub Actions deploy"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/geo-campaign-hub.git
git push -u origin main
```

### 2. 配置 Secrets（Settings → Secrets and variables → Actions）

| Secret | 值 |
|--------|-----|
| `GCP_PROJECT_ID` | `st-china-ai-force` |
| `GCP_SA_KEY` | `github-sa-key.json` 的**完整 JSON 内容** |

### 3. 可选 Variables

| Variable | 默认值 |
|----------|--------|
| `GCP_REGION` | `asia-east1` |
| `CLOUD_RUN_SERVICE` | `geo-campaign-hub` |

---

## 三、触发部署

- **自动**：推送到 `main` 或 `master`
- **手动**：GitHub → Actions → Deploy to Cloud Run → Run workflow

部署成功后，Actions 日志末尾会打印服务 URL。

---

## 四、故障排查

| 问题 | 处理 |
|------|------|
| `Permission denied` on deploy | 检查部署 SA 的 5 个 IAM 角色 |
| 构建成功但 `/config.js` 无 Key | 检查运行时 SA 的 Secret Manager 权限 |
| CN 模型 502 | 确认对应 Secret 在 GSM 中已配置 |
| Actions 未触发 | 确认分支名为 `main` 或 `master` |
