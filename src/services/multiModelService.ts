/**
 * Multi-Model Verification Service
 *
 * Calls DeepSeek, Alibaba Qwen (百炼) and Doubao (豆包/火山引擎) APIs in
 * parallel using their OpenAI-compatible endpoints.
 *
 * Purpose: provide REAL cross-model cognitive snapshots to validate (or
 * refute) the Gemini-simulated "cross-model consensus" in marketPulse.
 */

export type ModelId = 'deepseek' | 'qwen' | 'doubao' | 'kimi';

export interface ModelSnapshot {
  modelId: ModelId;
  modelName: string;         // human-readable display name
  rawResponse: string;       // full text from the model
  keyEntities: string[];     // extracted brand / product mentions
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  latencyMs: number;
  error?: string;            // set if the call failed
}

export interface MultiModelVerificationResult {
  snapshots: ModelSnapshot[];
  consensusLevel: 'full' | 'partial' | 'divergent' | 'insufficient';
  consensusSummary: string;  // short human-readable diff/agreement summary
  verifiedAt: string;        // ISO timestamp
}

// ─── Server-side proxy call ──────────────────────────────────────────────────
// CN model API keys never reach the browser. We POST to the local
// /api/multi-model-probe endpoint (see server.js) which attaches the secret
// key server-side and forwards to the model's OpenAI-compatible endpoint.

async function callViaProxy(
  modelId: ModelId,
  prompt: string,
  timeoutMs = 20000
): Promise<{ rawResponse: string; latencyMs: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/multi-model-probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, prompt }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { rawResponse: '', latencyMs: 0, error: err.error || `HTTP ${res.status}` };
    }
    return res.json();
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    return { rawResponse: '', latencyMs: 0, error: isTimeout ? 'Request timeout' : (err?.message || 'Network error') };
  }
}

// ─── Entity extraction (lightweight, no extra API call) ────────────────────

function extractKeyEntities(text: string): string[] {
  // Pull out capitalised proper nouns, model numbers, and quoted terms
  const patterns = [
    /["「『]([^"」』]{2,40})["」』]/g,           // quoted/bracketed terms
    /\b([A-Z][A-Za-z0-9]{2,}(?:[-_][A-Za-z0-9]+)*)\b/g, // CamelCase / model numbers
    /\b([\u4e00-\u9fa5]{2,8}(?:公司|科技|芯片|模型|大模型))\b/g, // Chinese org names
  ];
  const found = new Set<string>();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const e = m[1].trim();
      if (e.length >= 2 && e.length <= 40) found.add(e);
    }
  }
  return [...found].slice(0, 12);
}

function inferSentiment(text: string): ModelSnapshot['sentiment'] {
  const pos = (text.match(/推荐|优秀|领先|首选|最佳|recommend|excellent|leading|prefer|best/gi) || []).length;
  const neg = (text.match(/不推荐|落后|较差|avoid|inferior|outdated|not recommend/gi) || []).length;
  if (pos > 0 && neg > 0) return 'mixed';
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

// ─── Per-model caller (unified, via server-side proxy) ──────────────────────

async function queryModel(modelId: ModelId, modelName: string, prompt: string): Promise<ModelSnapshot> {
  const t0 = Date.now();
  try {
    const result = await callViaProxy(modelId, prompt);
    if (result.error) {
      return {
        modelId, modelName, rawResponse: '', keyEntities: [],
        sentiment: 'neutral', latencyMs: Date.now() - t0, error: result.error,
      };
    }
    return {
      modelId,
      modelName,
      rawResponse: result.rawResponse,
      keyEntities: extractKeyEntities(result.rawResponse),
      sentiment: inferSentiment(result.rawResponse),
      latencyMs: result.latencyMs || (Date.now() - t0),
    };
  } catch (err: any) {
    return {
      modelId, modelName, rawResponse: '', keyEntities: [],
      sentiment: 'neutral', latencyMs: Date.now() - t0,
      error: err?.message || 'Unknown error',
    };
  }
}

// ─── Consensus analysis ───────────────────────────────────────────────────

function analyseConsensus(snapshots: ModelSnapshot[]): {
  level: MultiModelVerificationResult['consensusLevel'];
  summary: string;
} {
  const successful = snapshots.filter(s => !s.error);
  if (successful.length < 2) {
    return {
      level: 'insufficient',
      summary: `Only ${successful.length} model(s) responded successfully — cannot determine consensus.`,
    };
  }

  // Compare entity overlap
  const entitySets = successful.map(s => new Set(s.keyEntities));
  const allEntities = [...new Set(successful.flatMap(s => s.keyEntities))];
  const sharedEntities = allEntities.filter(e => entitySets.every(set => set.has(e)));

  const overlapRatio = allEntities.length > 0 ? sharedEntities.length / allEntities.length : 0;
  const sentiments = successful.map(s => s.sentiment);
  const sentimentAgreed = sentiments.every(s => s === sentiments[0]);

  let level: MultiModelVerificationResult['consensusLevel'];
  let summary: string;

  if (overlapRatio >= 0.5 && sentimentAgreed) {
    level = 'full';
    summary = `All models agree — shared entities: ${sharedEntities.slice(0, 5).join(', ') || 'none detected'}. Sentiment: ${sentiments[0]}.`;
  } else if (overlapRatio >= 0.25 || sentimentAgreed) {
    level = 'partial';
    const diffs = successful.map(s => {
      const unique = s.keyEntities.filter(e => !sharedEntities.includes(e));
      return `${s.modelName}: ${unique.slice(0, 3).join(', ') || '–'}`;
    });
    summary = `Partial consensus. Shared: [${sharedEntities.slice(0, 4).join(', ')}]. Diverging: ${diffs.join(' | ')}.`;
  } else {
    level = 'divergent';
    const perModel = successful.map(s => `${s.modelName} → ${s.keyEntities.slice(0, 3).join(', ')}`);
    summary = `Models diverge significantly. ${perModel.join(' | ')}.`;
  }

  return { level, summary };
}

// ─── Main export ──────────────────────────────────────────────────────────

/**
 * Runs the same probe query against DeepSeek and Qwen in parallel,
 * then analyses consensus between the real responses.
 *
 * @param seedText   The product/technology keywords from Step 1
 * @param uiLang     Output language for the probe prompt
 */
export async function runMultiModelVerification(
  seedText: string,
  uiLang: string
): Promise<MultiModelVerificationResult> {
  const langHint = uiLang === 'zh' ? '请用中文回答。' : uiLang === 'jp' ? '日本語で答えてください。' : 'Please answer in English.';

  const probe = `${langHint}
You are an AI assistant with knowledge of the technology market.
Based on your training data, answer these questions about the following product/technology area:
"${seedText.slice(0, 300)}"

1. Which brands or specific products do you most commonly recommend or associate with this area?
2. What is your general perception of this technology space?
3. Are there any well-known competitors or alternatives you typically mention?

Be direct and concise (max 200 words). Mention specific product names, model numbers, or brand names where possible.`;

  return runMultiModelProbe(probe, uiLang);
}

/**
 * Per seed-question probe for campaign pipeline — same 4-model proxy, question as prompt.
 */
export async function runMultiModelVerificationForQuestion(
  questionText: string,
  campaignTopic: string,
  uiLang: string,
): Promise<MultiModelVerificationResult> {
  const langHint = uiLang === 'zh' ? '请用中文回答。' : uiLang === 'jp' ? '日本語で答えてください。' : 'Please answer in English.';
  const probe = `${langHint}
Campaign context: ${campaignTopic.slice(0, 200)}
Answer this question as an AI assistant would today:
"${questionText.slice(0, 500)}"

Mention specific semiconductor vendors, product families, and part numbers where relevant. Be direct (max 200 words).`;
  return runMultiModelProbe(probe, uiLang);
}

async function runMultiModelProbe(
  probe: string,
  _uiLang: string,
): Promise<MultiModelVerificationResult> {
  // a snapshot with error 'API key not configured' from the proxy.
  const [deepseekSnapshot, qwenSnapshot, doubaoSnapshot, kimiSnapshot] = await Promise.all([
    queryModel('deepseek', 'DeepSeek Chat', probe),
    queryModel('qwen', '通义千问 Qwen-Plus', probe),
    queryModel('doubao', '豆包 Doubao', probe),
    queryModel('kimi', 'Kimi (Moonshot)', probe),
  ]);

  const snapshots = [deepseekSnapshot, qwenSnapshot, doubaoSnapshot, kimiSnapshot];
  const { level, summary } = analyseConsensus(snapshots);

  return {
    snapshots,
    consensusLevel: level,
    consensusSummary: summary,
    verifiedAt: new Date().toISOString(),
  };
}
