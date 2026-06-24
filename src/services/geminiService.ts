/**
 * Gemini client utilities for the Campaign pipeline.
 * All Gemini calls go through /api/gemini/* (keys never in browser).
 * CN model probes: multiModelService + /api/multi-model-probe
 */

import { GEMINI_MODELS } from '../config/models';

export { GEMINI_MODELS };

interface GenerateContentParams {
  model: string;
  contents: unknown;
  config?: unknown;
}

async function postGemini(path: string, params: GenerateContentParams) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(JSON.stringify({
      error: {
        message: body.error || res.statusText,
        code: body.code,
        status: res.status === 429 ? 'RESOURCE_EXHAUSTED' : undefined,
      },
    }));
  }
  return body as { text: string };
}

async function* streamGemini(params: GenerateContentParams) {
  const res = await fetch('/api/gemini/generate-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Stream failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      const parsed = JSON.parse(payload) as { text?: string; error?: string };
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.text) yield { text: parsed.text };
    }
  }
}

/** Server-side Gemini proxy — no API key in the browser. */
export const getGenAI = () => ({
  models: {
    generateContent: (params: GenerateContentParams) =>
      postGemini('/api/gemini/generate', params).then((r) => ({ text: r.text })),
    generateContentStream: (params: GenerateContentParams) => streamGemini(params),
  },
});

export const parseRetrySeconds = (err: any): number | null => {
  try {
    const raw = typeof err?.message === 'string' ? JSON.parse(err.message) : err;
    const details = raw?.error?.details || [];
    for (const d of details) {
      if (d?.retryDelay) {
        const match = String(d.retryDelay).match(/([\d.]+)/);
        if (match) return Math.ceil(parseFloat(match[1]));
      }
    }
    const inner = raw?.error?.message || raw?.message || '';
    const match = inner.match(/retry in ([\d.]+)s/i);
    if (match) return Math.ceil(parseFloat(match[1]));
  } catch { /* non-fatal */ }
  return null;
};

const is429 = (err: any): boolean => {
  try {
    const raw = typeof err?.message === 'string' ? JSON.parse(err.message) : err;
    return raw?.error?.code === 429 || raw?.error?.status === 'RESOURCE_EXHAUSTED';
  } catch { return false; }
};

export const withTimeout = <T>(
  fn: () => Promise<T>,
  ms = 90_000,
  label = 'request',
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s: ${label}`)),
      ms,
    );
    fn().then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
};

export const withRetry = async <T>(
  fn: () => Promise<T>,
  onCountdown?: (secondsLeft: number) => void,
  maxRetries = 3,
): Promise<T> => {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (is429(err) && attempt < maxRetries) {
        const seconds = parseRetrySeconds(err) || 60;
        for (let s = seconds; s > 0; s--) {
          onCountdown?.(s);
          await new Promise(r => setTimeout(r, 1000));
        }
        onCountdown?.(0);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
};

export const fetchUrlContent = async (url: string) => {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = '';
    try { detail = JSON.parse(body).error; } catch { detail = body; }
    throw new Error(detail || `Fetch failed (${res.status})`);
  }
  const text = await res.text();
  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const bodyStart = text.indexOf('\n\n');
  const body = bodyStart !== -1 ? text.slice(bodyStart).trim() : text;
  return { title, content: text, body, wordCount: body.split(/\s+/).filter(Boolean).length };
};

export const chatWithAssistant = async (
  message: string,
  history: { role: string; content: string }[],
  contextData: unknown,
  uiLang: string,
) => {
  const response = await getGenAI().models.generateContent({
    model: GEMINI_MODELS.chat,
    contents: [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ],
    config: {
      systemInstruction: `Expert GEO Campaign Assistant. UI Lang: ${uiLang}. Context: ${JSON.stringify(contextData)}`,
    },
  });
  return response.text;
};

// ─── Campaign Report ─────────────────────────────────────────────────────────

export interface CampaignReportParams {
  campaign: import('../types/campaign').Campaign;
  selectedPlaybookIds?: string[];
  progressSnapshot?: import('../types/campaign').CampaignProgressSnapshot;
}

function buildCampaignReportPrompt(p: CampaignReportParams): string {
  const c = p.campaign;
  const syn = c.synthesis;
  const probes = c.probes.filter(pr => pr.phase === 'baseline');
  const playbooks = syn?.playbooks.filter(pb =>
    !p.selectedPlaybookIds?.length || p.selectedPlaybookIds.includes(pb.id),
  ) ?? [];
  const competitorCounts = new Map<string, number>();
  for (const pr of probes) {
    for (const name of pr.gemini.dominantCompetitors || []) {
      competitorCounts.set(name, (competitorCounts.get(name) || 0) + 1);
    }
  }
  const topCompetitors = [...competitorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const competitorDiagnosisSeed = topCompetitors.map(([name, mentions], idx) => {
    const relatedIntent = (syn?.intentDiagnoses || []).find(ig =>
      (ig.metrics?.dominantCompetitors || []).includes(name),
    );
    return `${idx + 1}. ${name}
- mentionCountInProbes: ${mentions}
- relatedIntentGroup: ${relatedIntent?.label || 'N/A'}
- relatedFailure: ${relatedIntent?.metrics?.primaryFailure || relatedIntent?.failureDiagnosis?.primaryFailure || 'UNKNOWN'}
- relatedVoidSeverity: ${(relatedIntent?.metrics?.avgVoidSeverity ?? 0).toFixed(1)}`;
  }).join('\n');

  const geminiExecEvidence = probes.map((pr, idx) => `Q${idx + 1}: ${pr.questionText}
- simulatedAnswer: ${pr.gemini.simulatedAnswer.slice(0, 380)}
- marketPulse: ${pr.gemini.marketPulse.slice(0, 240)}
- ST binding: ${pr.gemini.stBindingStrength} | void: ${pr.gemini.voidSize} (${pr.gemini.voidSeverity}/10)
- competitors: ${(pr.gemini.dominantCompetitors || []).join(', ') || 'N/A'}
- failure: ${pr.gemini.primaryFailure}`).join('\n\n');

  const fourModelEvidence = probes.map((pr, idx) => {
    const mm = pr.multiModel;
    if (!mm) {
      return `Q${idx + 1}: ${pr.questionText}\n- 4-model verification: not available`;
    }
    const snapshots = mm.snapshots.map(s => `  - ${s.modelName} (${s.modelId}) | sentiment=${s.sentiment} | latency=${s.latencyMs}ms
    entities: ${(s.keyEntities || []).slice(0, 6).join(', ') || 'N/A'}
    response: ${(s.rawResponse || '').slice(0, 240) || s.error || 'N/A'}`).join('\n');
    return `Q${idx + 1}: ${pr.questionText}
- consensusLevel: ${mm.consensusLevel}
- consensusSummary: ${mm.consensusSummary}
${snapshots}`;
  }).join('\n\n');

  const intentDeepDive = (syn?.intentDiagnoses || []).map((ig, i) => `Intent ${i + 1} — ${ig.label}
- metrics: ST rate=${Math.round((ig.metrics?.stMentionRate || 0) * 100)}%, avg void=${(ig.metrics?.avgVoidSeverity || 0).toFixed(1)}, critical=${ig.metrics?.criticalVoidCount || 0}
- dominant competitors: ${(ig.metrics?.dominantCompetitors || []).join(', ') || 'N/A'}
- primary failure: ${ig.metrics?.primaryFailure || ig.failureDiagnosis?.primaryFailure || 'UNKNOWN'}
- failure diagnosis: ${ig.failureDiagnosis?.explanation || 'N/A'} (severity=${ig.failureDiagnosis?.severity || 'N/A'}, urgency=${ig.failureDiagnosis?.repairUrgency ?? 'N/A'})
- narrative: ${(ig.narrative || '').slice(0, 420)}
- recommended playbooks: ${(ig.recommendedPlaybookIds || []).join(', ') || 'N/A'}`).join('\n\n');

  let data = `
CAMPAIGN TOPIC: ${c.topic}
DURATION: ${c.duration}
ECOSYSTEM: ${c.ecosystem} | REGION: ${c.region || 'Global'}
UI LANGUAGE: ${c.uiLang}

EXECUTIVE SUMMARY:
${syn?.executiveSummary || 'N/A'}

BRIEF DRAFT:
${JSON.stringify(syn?.brief, null, 2).slice(0, 8000)}

INTENT GROUP DIAGNOSES:
${JSON.stringify(syn?.intentDiagnoses, null, 2).slice(0, 6000)}

SELECTED PLAYBOOKS (${playbooks.length}):
${playbooks.map((pb, i) => `${i + 1}. [${pb.tacticsType}] ${pb.geoAction}\n   Snippet: ${pb.targetSnippet}`).join('\n')}

INNOVATION PLAYS:
${(syn?.innovationPlays || []).join('\n')}

GEMINI SIMULATION EXECUTIVE EVIDENCE (PER QUESTION):
${geminiExecEvidence || 'N/A'}

FOUR LLM VERIFICATION EVIDENCE (DEEPSEEK / QWEN / DOUBAO / KIMI):
${fourModelEvidence || 'N/A'}

COMPETITOR DIAGNOSIS SEED:
${competitorDiagnosisSeed || 'N/A'}

INTENT DEEP-DIVE EVIDENCE:
${intentDeepDive || 'N/A'}

T0 PROBE BASELINE:
${probes.map(pr => `- Q: ${pr.questionText}
  ST: ${pr.gemini.stBindingStrength} | void: ${pr.gemini.voidSize} (${pr.gemini.voidSeverity}/10)
  Competitors: ${pr.gemini.dominantCompetitors.join(', ')}
  Failure: ${pr.gemini.primaryFailure}`).join('\n')}
`;

  if (p.progressSnapshot) {
    data += `
PROGRESS (day ${p.progressSnapshot.daysSinceBaseline}):
${JSON.stringify(p.progressSnapshot.questionDeltas, null, 2)}
${JSON.stringify(p.progressSnapshot.intentGroupDeltas, null, 2)}
`;
  }

  return `ROLE: Senior GEO Campaign Strategist at STMicroelectronics.
TASK: Generate a GEO Marketing Campaign Report in TWO formats:
1) %%MD_START%%...%%MD_END%%
2) %%HTML_BODY_START%%...%%HTML_BODY_END%%
OUTPUT LANGUAGE: [${c.uiLang}] only.

CRITICAL QUALITY RULES:
- This report must feel like a strategic war-archive, not plain text notes.
- Use timeline/archive presentation structure, with strong visual hierarchy.
- Do NOT collapse intent analysis into one sentence.
- Must explicitly include Gemini simulation executive evidence and four-LLM comparison evidence.
- Must explicitly include competitor diagnosis (threat matrix + why competitor wins + interception plan).
- Every major claim must map to concrete probe evidence.

MANDATORY HTML BODY STRUCTURE (use these section labels exactly):
1) <div class="sec-label">Archive Snapshot</div>
   - 4-card summary (risk/opportunity/ST visibility/priority)
2) <div class="sec-label">Timeline: T0 → T30 → T60 → T90</div>
   - Present as a true timeline table with milestones, actions, expected GEO signal lift
3) <div class="sec-label">Gemini Simulation Executive Evidence</div>
   - Per-question evidence bullets (what Gemini answered, why it matters)
4) <div class="sec-label">Four-LLM Cross-Model Evidence</div>
   - Explicitly compare DeepSeek/Qwen/Doubao/Kimi by question
   - Include consensus/divergence and implications
5) <div class="sec-label">Competitor Diagnosis Matrix</div>
   - At least top 5 competitors
   - For each competitor: threat level, why AI prefers them (corpus advantage), weak spot, interception action
   - Must be evidence-based from probes and model outputs, not generic statements
6) <div class="sec-label">Intent Deep-Dive (Not One-Line)</div>
   - For each intent group: metrics + failure diagnosis + root cause + repair logic + linked playbooks
7) <div class="sec-label">GEO Cognitive Baseline Table</div>
8) <div class="sec-label">Playbook Deployment Board</div>
9) <div class="sec-label">Innovation Lab</div>
10) <div class="sec-label">Execution Checklist</div>

MANDATORY DEPTH RULES:
- Intent section: minimum 5-8 sentences per intent group.
- Four-LLM section: minimum 1 comparison block per question with model-specific observations.
- Timeline section: include phase goals, channel actions, KPI targets, and probe checkpoints.
- Avoid fluff adjectives; prioritize evidence + causality + actionability.

DATA:
${data}`;
}

export const generateCampaignReportStream = async (params: CampaignReportParams) => {
  const prompt = buildCampaignReportPrompt(params);
  const response = await getGenAI().models.generateContentStream({
    model: GEMINI_MODELS.contentGen,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  async function* stream() {
    for await (const chunk of response) {
      if (chunk.text) yield chunk.text;
    }
  }
  return stream();
};

export const generateProgressNarrative = async (
  campaign: import('../types/campaign').Campaign,
  snapshot: import('../types/campaign').CampaignProgressSnapshot,
): Promise<string> => {
  const res = await getGenAI().models.generateContent({
    model: GEMINI_MODELS.contentGen,
    contents: [{
      role: 'user',
      parts: [{ text: `Write 2-3 paragraphs interpreting campaign GEO probe progress for executives.
Language: ${campaign.uiLang}
Topic: ${campaign.topic}
Days since baseline: ${snapshot.daysSinceBaseline}
Question deltas: ${JSON.stringify(snapshot.questionDeltas)}
Intent group deltas: ${JSON.stringify(snapshot.intentGroupDeltas)}
Focus on ST binding improvements and void reduction as campaign effect evidence.` }],
    }],
  });
  return res.text || '';
};
