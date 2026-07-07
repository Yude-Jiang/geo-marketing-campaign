/**
 * Gemini client utilities for the Campaign pipeline.
 * All Gemini calls go through /api/gemini/* (keys never in browser).
 * CN model probes: multiModelService + /api/multi-model-probe
 */

import { GEMINI_MODELS } from '../config/models';
import { getProbeScoreView } from './probeScoreAccess';
import { PROBE_PROTOCOL_V2 } from '../config/probeProtocol';

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

  const isRealAttempt = (a: { rawResponse?: string; error?: string }) =>
    !a.error && !!a.rawResponse?.trim();
  const hasRealProbes = probes.some(pr => pr.scored && !pr.scored.degraded);
  const cnModelsProbed = [
    ...new Set(
      probes.flatMap(pr =>
        (pr.scored?.attempts || []).filter(isRealAttempt).map(a => a.modelId),
      ),
    ),
  ];
  const probeProtocol = c.intentFrame?.probeProtocolVersion || PROBE_PROTOCOL_V2;
  const runsPerModel = c.intentFrame?.probeRunsPerModel ?? probes[0]?.scored?.runsPerModel ?? 2;
  const reportDate = (
    p.progressSnapshot ? new Date() : new Date(c.createdAt || Date.now())
  )
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, ''); // YYYYMMDD, from real campaign data — not guessed
  const archiveId = `ST-GEO-${(c.ecosystem || 'GL').toUpperCase()}-${reportDate}`;
  const groundingModel = GEMINI_MODELS.analysis; // the model actually used, no version guessing

  const competitorCounts = new Map<string, number>();
  for (const pr of probes) {
    const score = getProbeScoreView(pr);
    if (!score?.scoreable) continue;
    for (const name of score.dominantCompetitors || []) {
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

  const realProbeEvidence = probes.map((pr, idx) => {
    const s = pr.scored;
    const score = getProbeScoreView(pr);
    if (pr.probeSkipReason) {
      return `Q${idx + 1}: ${pr.questionText}\n- status: CN ecosystem required — no real probe`;
    }
    if (!s || s.degraded || !score?.scoreable) {
      return `Q${idx + 1}: ${pr.questionText}\n- status: degraded/insufficient (${s?.degradedReason || 'no score'})`;
    }
    const attemptLines = s.attempts.filter(isRealAttempt).map(a =>
      `  - ${a.modelId} run${a.runIndex + 1}: ${a.rawResponse.slice(0, 280)}`,
    ).join('\n');
    return `Q${idx + 1}: ${pr.questionText}
- protocol: ${s.protocolVersion} | N=${s.runsPerModel} | mentionRate=${(s.stMentionRate * 100).toFixed(0)}% (${s.stMentionCount}/${s.successfulAttempts})
- mentionForm: ${s.dominantMentionForm} | binding: ${s.stBindingStrength} | void: ${s.voidSize} (${s.voidSeverity}/10)
- competitors: ${s.dominantCompetitors.map(c => c.name).join(', ') || 'N/A'}
- failure: ${s.primaryFailure} | volatility: ${s.volatility}
RAW RESPONSES:
${attemptLines}`;
  }).join('\n\n');

  const legacyGeminiEvidence = probes
    .filter(pr => pr.gemini && !pr.scored)
    .map((pr, idx) => `Q${idx + 1} [LEGACY v1]: ${pr.questionText}
- ST: ${pr.gemini!.stBindingStrength} | void: ${pr.gemini!.voidSize} (${pr.gemini!.voidSeverity}/10)
- NOTE: v1 simulated data — not comparable to v2 real probes`)
    .join('\n\n');

  const intentDeepDive = (syn?.intentDiagnoses || []).map((ig, i) => `Intent ${i + 1} — ${ig.label}
- metrics: ST rate=${Math.round((ig.metrics?.stMentionRate || 0) * 100)}%, avg void=${(ig.metrics?.avgVoidSeverity || 0).toFixed(1)}, critical=${ig.metrics?.criticalVoidCount || 0}
- dominant competitors: ${(ig.metrics?.dominantCompetitors || []).join(', ') || 'N/A'}
- primary failure: ${ig.metrics?.primaryFailure || ig.failureDiagnosis?.primaryFailure || 'UNKNOWN'}
- failure diagnosis: ${ig.failureDiagnosis?.explanation || 'N/A'} (severity=${ig.failureDiagnosis?.severity || 'N/A'}, urgency=${ig.failureDiagnosis?.repairUrgency ?? 'N/A'})
- narrative: ${(ig.narrative || '').slice(0, 420)}
- recommended playbooks: ${(ig.recommendedPlaybookIds || []).join(', ') || 'N/A'}`).join('\n\n');

  const cnModelsLabel = cnModelsProbed.length ? cnModelsProbed.join(', ') : 'none';
  const fourModelDirective = hasRealProbes
    ? `FOUR-LLM SECTION = REAL v2 PROBE DATA (protocol ${probeProtocol}, N=${runsPerModel}/model).
- Use ONLY "REAL PROBE EVIDENCE" below — raw responses from DeepSeek/Qwen/Doubao/Kimi.
- Report mentionRate as frequency (k/N), not binary single-shot.
- mentionForm distinguishes company vs product_line vs sub_brand — mention ≠ positioning.
- NEVER infer what a failed/degraded probe "would" say.`
    : probes.some(pr => pr.probeSkipReason)
      ? `FOUR-LLM SECTION = ECOSYSTEM NOT SUPPORTED.
- Real probes require CN ecosystem. Render status card only — no fabricated metrics.`
      : `FOUR-LLM SECTION = NO VALID REAL PROBE DATA.
- Render ONE status card: "⚠ 待补充真实探测". FORBIDDEN to fabricate model observations.`;

  let data = `
REPORT METADATA — USE THESE EXACT VALUES, DO NOT INVENT OR ALTER:
- archiveId (档案编号): ${archiveId}
- groundingModel (情报来源/模型名): ${groundingModel}
- reportDate (报告日期 YYYYMMDD): ${reportDate}
- hasRealProbes: ${hasRealProbes}
- probeProtocol: ${probeProtocol}
- runsPerModel: ${runsPerModel}
- cnModelsProbed: ${cnModelsLabel}
- synthesisDegraded: ${syn?.degraded ? 'true' : 'false'}
${p.progressSnapshot?.protocolMismatch ? '- PROTOCOL WARNING: baseline and current probes use different protocols — do NOT compare trends.' : ''}

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

REAL PROBE EVIDENCE (v2 — DeepSeek/Qwen/Doubao/Kimi zero-hint, N=${runsPerModel}):
${realProbeEvidence || 'N/A'}

${legacyGeminiEvidence ? `LEGACY v1 SIMULATION (not scored — reference only):\n${legacyGeminiEvidence}` : ''}

FOUR-LLM SECTION DIRECTIVE:
${fourModelDirective}

COMPETITOR DIAGNOSIS SEED:
${competitorDiagnosisSeed || 'N/A'}

INTENT DEEP-DIVE EVIDENCE:
${intentDeepDive || 'N/A'}

T0 PROBE BASELINE:
${probes.map(pr => {
  const score = getProbeScoreView(pr);
  if (!score?.scoreable) return `- Q: ${pr.questionText}\n  [no scoreable probe]`;
  return `- Q: ${pr.questionText}
  ST rate: ${(score.stMentionRate * 100).toFixed(0)}% form=${score.stMentionForm} | binding: ${score.stBindingStrength}
  void: ${score.voidSize} (${score.voidSeverity}/10) | volatility: ${score.volatility || 'N/A'}
  Competitors: ${score.dominantCompetitors.join(', ')}
  Failure: ${score.primaryFailure}`;
}).join('\n')}
`;

  if (p.progressSnapshot) {
    data += `
PROGRESS (day ${p.progressSnapshot.daysSinceBaseline}):
${p.progressSnapshot.protocolMismatch ? '⚠ CROSS-PROTOCOL — deltas not comparable\n' : ''}
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
- DATA INTEGRITY (highest priority): the header 档案编号, 情报来源/模型名, and 报告日期 MUST be the exact archiveId / groundingModel / reportDate values from REPORT METADATA. NEVER invent an archive number, model version (e.g. do not write "Gemini 1.5 Pro" or any version you were not given), or date.
- DEGRADED SYNTHESIS: if synthesisDegraded is true, the campaign synthesis failed to parse and most sections are empty. Render a prominent red warning banner at the very top ("⚠ 本报告合成数据不完整 — synthesis 解析失败,请重跑") and do NOT fabricate brief/intent/playbook content to fill the gaps.
- NO FABRICATION: every model-specific claim, competitor corpus-advantage claim, and metric must trace to provided probe/snapshot data. If data is absent, state "数据缺失/待补充" — never speculate to fill a section.
- PROVENANCE SEPARATION: Gemini simulation and real CN multi-model probes are DIFFERENT confidence tiers. Never label Gemini's own output as cross-model "evidence". Follow the FOUR-LLM SECTION directive in DATA exactly.
- METRIC RECONCILIATION: if a probe shows ST binding=none/weak but voidSeverity is near 0, flag it as a scoring anomaly ("指标待复核") instead of writing narrative that contradicts the number.
- INTERNAL IDS: playbook/question/intent ids (pb-/q-/ig-) are internal refs; if shown, render as small muted footnote-style tags, never inline in executive prose.
- Must explicitly include Gemini simulation executive evidence; include four-LLM comparison ONLY per the FOUR-LLM SECTION directive.
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
   - Render strictly per the FOUR-LLM SECTION directive in DATA.
   - If real data exists: compare only the models actually probed, by question, using their real responses; mark unprobed models "未探测".
   - If no real data: render a single "⚠ 待补充真实探测" status card and STOP. Do not fabricate model insights or a "模拟与推演" disclaimer.
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
- Four-LLM section: depth requirement applies ONLY when hasRealMultiModel is true; when false, the section is a single status card and the minimum-block rule is VOID (do not pad it).
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
Focus on ST binding improvements and void reduction as campaign effect evidence.
${snapshot.protocolMismatch ? 'IMPORTANT: probe protocol changed between baseline and current — explicitly state that deltas are NOT comparable; do not trend-analyze.' : ''}` }],
    }],
  });
  return res.text || '';
};
