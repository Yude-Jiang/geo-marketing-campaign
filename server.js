import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECRET_NAMES = [
  'VITE_GEMINI_API_KEY',
  'VITE_DEEPSEEK_API_KEY',
  'VITE_QWEN_API_KEY',
  'VITE_DOUBAO_API_KEY',
  'VITE_Kimi_API_KEY',
];

// Fetches each secret from Google Cloud Secret Manager and writes it into
// process.env, skipping any key that is already set (e.g. via Cloud Run env
// var binding or a local .env.local file).  Requires the service account to
// have the "Secret Manager Secret Accessor" role.
async function loadSecretsFromGSM() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'st-china-ai-force';

  // Verify Application Default Credentials are available before touching the
  // gRPC client — avoids an unhandled async crash when running locally without
  // gcloud credentials.
  try {
    await new GoogleAuth().getApplicationDefault();
  } catch {
    console.log('No GCP credentials found — skipping Secret Manager, using process.env directly.');
    return;
  }

  console.log(`Fetching secrets from project: ${projectId}`);
  const client = new SecretManagerServiceClient();
  await Promise.all(
    SECRET_NAMES.map(async (name) => {
      if (process.env[name]) return; // already provided via env var binding
      try {
        const [version] = await client.accessSecretVersion({
          name: `projects/${projectId}/secrets/${name}/versions/latest`,
        });
        const value = version.payload?.data?.toString('utf8');
        if (value) {
          process.env[name] = value;
          console.log(`Loaded secret: ${name}`);
        }
      } catch (err) {
        console.warn(`Could not load secret ${name}: ${err.message}`);
      }
    })
  );
}

async function startServer() {
  await loadSecretsFromGSM();

  const app = express();
  const port = process.env.PORT || 8080;

  // Baseline security headers. CSP is disabled because the SPA injects an
  // inline /config.js script tag; COEP is disabled to avoid breaking embeds.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  // Dynamic endpoint for runtime environment variables.
  // All VITE_ keys are populated here (from Secret Manager or env var binding)
  // so the frontend picks them up via window.env without a rebuild.
  app.get('/config.js', (req, res) => {
    // Only the Gemini key is exposed to the browser. The CN model keys
    // (DeepSeek/Qwen/Doubao/Kimi) stay server-side and are used exclusively by
    // the /api/multi-model-probe proxy below, so they never reach DevTools.
    const envVars = {
      VITE_GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY || '',
    };
    res.set('Content-Type', 'application/javascript');
    res.send(`window.env = ${JSON.stringify(envVars)};`);
  });

  // Proxy route: fetch a URL via Jina Reader on the server side, avoiding
  // browser-level firewall/CORS blocks on r.jina.ai.
  app.get('/api/fetch-url', async (req, res) => {
    const url = req.query.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    // ── Defense-in-depth: refuse private / link-local / metadata targets ──────
    // NOTE: this is a lightweight string blocklist, NOT a complete SSRF defense.
    // The actual upstream fetch goes through r.jina.ai (Jina's servers), so this
    // primarily stops us handing internal addresses to Jina to fetch. It does
    // NOT protect against DNS rebinding, decimal/hex IP encodings, or redirects.
    try {
      const { hostname } = new URL(url);
      const BLOCKED_PATTERNS = [
        /^127\./,                       // loopback
        /^10\./,                        // RFC1918
        /^172\.(1[6-9]|2\d|3[01])\./,   // RFC1918
        /^192\.168\./,                  // RFC1918
        /^169\.254\./,                  // link-local (GCP/AWS metadata)
        /^::1$/,                        // IPv6 loopback
        /^fd[0-9a-f]{2}:/i,             // IPv6 ULA
        /^localhost$/i,
        /^metadata\.google\.internal$/i,
      ];
      if (BLOCKED_PATTERNS.some(p => p.test(hostname))) {
        return res.status(403).json({ error: 'Blocked: private or metadata address' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const upstream = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal });
      clearTimeout(timer);
      const text = await upstream.text();
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(text);
    } catch (err) {
      clearTimeout(timer);
      res.status(502).json({ error: err.message || 'Upstream fetch failed' });
    }
  });

  // Multi-model probe proxy — keeps CN model API keys server-side only.
  // The browser POSTs { modelId, prompt }; the server attaches the secret key
  // and forwards to the model's OpenAI-compatible endpoint.
  app.use(express.json());
  app.post('/api/multi-model-probe', async (req, res) => {
    const { modelId, prompt } = req.body || {};
    if (!modelId || !prompt) {
      return res.status(400).json({ error: 'Missing modelId or prompt' });
    }
    const MODEL_CONFIGS = {
      deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: process.env.VITE_DEEPSEEK_API_KEY || '',
        model: 'deepseek-chat',
      },
      qwen: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: process.env.VITE_QWEN_API_KEY || '',
        model: 'qwen-plus',
      },
      doubao: {
        // 火山引擎豆包：支持 "apiKey|endpointId" 组合，否则用默认模型名
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (process.env.VITE_DOUBAO_API_KEY || '').split('|')[0],
        model: (process.env.VITE_DOUBAO_API_KEY || '').split('|')[1] || 'doubao-pro-32k',
      },
      kimi: {
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: process.env.VITE_Kimi_API_KEY || '',
        model: 'moonshot-v1-8k',
      },
    };
    const config = MODEL_CONFIGS[modelId];
    if (!config) return res.status(400).json({ error: 'Unknown modelId' });
    // Treat unconfigured / placeholder keys as "not configured" (HTTP 200 so the
    // client renders a per-model "not configured" snapshot rather than an error).
    if (!config.apiKey || config.apiKey.includes('your_')) {
      return res.json({ error: 'API key not configured', rawResponse: '' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const t0 = Date.now();
      const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 512,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await upstream.json();
      const rawResponse = json.choices?.[0]?.message?.content || '';
      res.json({ rawResponse, latencyMs: Date.now() - t0 });
    } catch (err) {
      clearTimeout(timer);
      res.status(502).json({ error: err.message || 'Upstream failed', rawResponse: '' });
    }
  });

  // Serve static files from the build directory
  app.use(express.static(path.join(__dirname, 'dist')));

  // Support SPA routing (redirect all non-file requests to index.html)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

startServer();
