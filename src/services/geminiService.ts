/**
 * Gemini client utilities for the Campaign pipeline.
 * All Gemini calls go through /api/gemini/* (keys never in browser).
 * CN model probes: multiModelService + /api/multi-model-probe
 */

import { GEMINI_MODELS } from '../config/models';
import { langDisplayName } from '../i18n/translations';

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

export const parseRetrySeconds = (err: unknown): number | null => {
  try {
    const message = (err as { message?: unknown })?.message;
    const raw = typeof message === 'string' ? JSON.parse(message) : err;
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

const is429 = (err: unknown): boolean => {
  try {
    const message = (err as { message?: unknown })?.message;
    const raw = typeof message === 'string' ? JSON.parse(message) : err;
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
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
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
      systemInstruction: `Expert GEO Campaign Assistant. Always reply in ${langDisplayName(uiLang)}. Context: ${JSON.stringify(contextData)}`,
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
  // ── Integrity: compute metadata in CODE so the LLM can never invent it ──
  // A snapshot only counts as REAL data when it has a non-empty response and no error.
  // (runMultiModelProbe always returns 4 snapshots even when every model errored,
  //  so a length check alone would wrongly report "real data" on a failed run.)
  const isRealSnapshot = (s: { rawResponse?: string; error?: string }) =>
    !s.error && !!s.rawResponse && s.rawResponse.trim().length > 0;
  const hasRealMultiModel = probes.some(
    pr => (pr.multiModel?.snapshots || []).some(isRealSnapshot),
  );
  const cnModelsProbed = [
    ...new Set(
      probes.flatMap(pr =>
        (pr.multiModel?.snapshots || []).filter(isRealSnapshot).map(s => s.modelName),
      ),
    ),
  ];
  // Was the CN multi-model proxy invoked at all this run? (true even if every
  // model errored) — lets the report distinguish "ran but failed" from "never ran".
  const cnMultiAttempted = probes.some(pr => !!pr.multiModel);
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

  // Structured strategic report + competitor battle cards (synthesis output,
  // same data shown on the Blueprint) — keeps the report consistent with the UI.
  const sr = syn?.strategicReport?.executiveSummary;
  const strategicReportSeed = sr ? `marketPulse: ${sr.marketPulse}
coreRoadblocks: ${sr.coreRoadblocks}
strategicPivot: ${sr.strategicPivot}
keyInsight: ${sr.keyInsight}
actionPlan:
${(syn?.strategicReport?.actionPlan || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` : '';
  const competitorBattleCards = (syn?.competitorDiagnoses || []).map((comp, idx) => `${idx + 1}. ${comp.name} [tier: ${comp.threatTier}${typeof comp.mentionShare === 'number' ? `, SOV: ${Math.round(comp.mentionShare * 100)}%` : ''}]
- corpusAdvantage: ${comp.corpusAdvantage}
- weakSpot: ${comp.weakSpot}
- interceptionPlay: ${comp.interceptionPlay}`).join('\n');

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
    const snapshots = mm.snapshots.map(s => {
      const ok = isRealSnapshot(s);
      const body = ok
        ? (s.rawResponse || '').slice(0, 240)
        : `<探测失败/无响应: ${s.error || 'empty'}>`;
      return `  - ${s.modelName} (${s.modelId}) [${ok ? 'OK' : 'FAILED'}] | sentiment=${s.sentiment} | latency=${s.latencyMs}ms
    entities: ${(s.keyEntities || []).slice(0, 6).join(', ') || 'N/A'}
    response: ${body}`;
    }).join('\n');
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

  // ── Four-LLM provenance: REAL only when a snapshot truly succeeded ──
  const cnModelsLabel = cnModelsProbed.length ? cnModelsProbed.join(', ') : 'none';
  const fourModelDirective = hasRealMultiModel
    ? `FOUR-LLM SECTION = REAL DATA. Models with a valid response: ${cnModelsLabel}.
- Use ONLY the per-question snapshots in "FOUR LLM VERIFICATION EVIDENCE".
- Snapshots are tagged [OK] or [FAILED]. Report [OK] models' ACTUAL entities/response.
- For [FAILED] models write "探测失败"; for a model with no snapshot on a question write "未探测". NEVER infer what a FAILED/未探测 model "would" say.
- Never paraphrase into hypotheticals ("可能/倾向于/善于").`
    : cnMultiAttempted
      ? `FOUR-LLM SECTION = PROBE RAN BUT ALL MODELS FAILED.
- The CN multi-model proxy was called, but no model returned a valid response (check API keys / mainland connectivity).
- Render the section as ONE status card: "⚠ 真实探测已执行但全部失败 — 待重跑". List the failed models (${probes.flatMap(pr => (pr.multiModel?.snapshots || []).map(s => s.modelName)).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'DeepSeek/Qwen/Doubao/Kimi'}) and their error if shown.
- FORBIDDEN to fabricate, simulate, infer, or speculate any model observation, consensus, or divergence.`
      : `FOUR-LLM SECTION = NO REAL PROBE THIS RUN.
- Real CN multi-model probes (DeepSeek/Qwen/Doubao/Kimi) were NOT executed for this campaign.
- Render the section as ONE status card: "⚠ 待补充真实探测 / Pending real cross-model probe".
- FORBIDDEN to fabricate, simulate, infer, or speculate any model observation, consensus, or divergence.
- Do NOT write "可能"-style hypotheticals. Do NOT invent a "战略模拟与推演" disclaimer and then proceed anyway.`;

  let data = `
REPORT METADATA — USE THESE EXACT VALUES, DO NOT INVENT OR ALTER:
- archiveId (档案编号): ${archiveId}
- groundingModel (情报来源/模型名): ${groundingModel}
- reportDate (报告日期 YYYYMMDD): ${reportDate}
- hasRealMultiModel: ${hasRealMultiModel}
- cnModelsProbed: ${cnModelsLabel}
- synthesisDegraded: ${!!syn?.degraded}
- synthesisDegraded: ${syn?.degraded ? 'true' : 'false'}

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

STRATEGIC REPORT (structured synthesis — use verbatim for the Key Takeaways / executive sections; do not contradict):
${strategicReportSeed || 'N/A'}

COMPETITOR BATTLE CARDS (structured synthesis — prefer these over the raw COMPETITOR DIAGNOSIS SEED counts when present; one matrix row per card, keep threatLevel/corpusAdvantage/strategicOpening):
${competitorBattleCards || 'N/A'}

GEMINI SIMULATION EXECUTIVE EVIDENCE (PER QUESTION):
${geminiExecEvidence || 'N/A'}

FOUR LLM VERIFICATION EVIDENCE (DEEPSEEK / QWEN / DOUBAO / KIMI):
${fourModelDirective}

EVIDENCE:
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
OUTPUT LANGUAGE: ${langDisplayName(c.uiLang)} only — every heading, label and sentence in this language.

CRITICAL QUALITY RULES:
- SCANNABILITY FIRST: a marketer must be able to execute from this in one read. Prefer the timeline, asset table and checklist over prose. NO walls of text, NO analysis essays.
- BREVITY: every chip / row / checklist item ≤ 15 words, verb-first where possible.
- VISUAL HIERARCHY: the timeline is the centrepiece; assets and checklist support it.
- DATA INTEGRITY (highest priority): the header 档案编号, 情报来源/模型名, and 报告日期 MUST be the exact archiveId / groundingModel / reportDate values from REPORT METADATA. NEVER invent an archive number, model version, or date.
- DEGRADED SYNTHESIS: if synthesisDegraded is true, the synthesis failed to parse; render a red warning banner at the top ("⚠ 本报告合成数据不完整 — synthesis 解析失败,请重跑") and do NOT fabricate timeline/asset content to fill gaps.
- NO FABRICATION: every timeline chip, asset and checklist item must trace to a playbook, brief.timeline phase, or channelMixSuggestion. If absent, omit it — never invent KPIs, dates, exposure counts, or analysis.
- INTERNAL IDS: playbook/question/intent ids (pb-/q-/ig-) are internal refs — never show them in the report.

THIS REPORT IS AN EXECUTION PLAN, NOT AN ANALYSIS. ALL analysis, insight, competitor diagnosis, intent diagnosis, KPI scorecards and cross-model (Gemini + DeepSeek/Qwen/Doubao/Kimi) findings live in the Step 2 Blueprint UI — DO NOT repeat or re-derive them here, and DO NOT invent KPI targets, exposure counts or "≈ N times" numbers. This document is purely what the team executes: a dated timeline, the content assets to produce, and a checklist. Everything must map to the synthesis (brief.timeline, playbooks, channelMixSuggestion) — no invented data.

OUTPUT ONLY THESE SECTIONS (use these labels exactly):
1) <div class="sec-label">Campaign Timeline</div>
   - Render the .exec-timeline component (skeleton below): TWO tracks — 内容资产 / Content Assets (what to create) and 推广 / Promotion (how to push it) — across the campaign duration (${c.duration}). Split into 3 phases scaled to the duration (e.g. 90d → Day 0–30 / 30–60 / 60–90; 180d → 0–60 / 60–120 / 120–180). Each chip is a concrete dated deliverable tied to a REAL channel (for a China campaign: 微信服务号 / 知乎 / B站 / 中文论坛 / 百度 / Bing / EDM; global: blog / YouTube / LinkedIn / Google / Bing / EDM). Derive items from the playbooks and brief.timeline.
2) <div class="sec-label">Content & Assets</div>
   - A table: Asset | Type | Channel | Owner | Phase. One row per concrete deliverable derived from the playbooks (geoAction / contentPlatform / tacticsType) and brief — e.g. "STM32C5 知乎技术长文", "B站 评测视频", "微信服务号 推文", "百度品牌专区 落地页", "第三方 EDM". Owner = a role (Content / FAE / Digital / PR), not a person's name.
3) <div class="sec-label">Execution Checklist</div>
   - Actionable checklist grouped by the 3 phases; each item = a verb-first task + owner role + the asset/channel it belongs to. These are things someone ticks off.

.exec-timeline COMPONENT — fill this EXACT skeleton in %%HTML_BODY%% (fixed class names, no <table> for the timeline, no runtime SVG). 3 phase columns; put 2–4 <span class="etl-item"> chips per cell:
<div class="exec-timeline">
  <div class="etl-axis">
    <span class="etl-phase">{Phase 1 label · day range}</span>
    <span class="etl-phase">{Phase 2 label · day range}</span>
    <span class="etl-phase">{Phase 3 label · day range}</span>
  </div>
  <div class="etl-track assets">
    <div class="etl-track-label">内容资产</div>
    <div class="etl-cells">
      <div class="etl-cell"><span class="etl-item">{asset}</span><span class="etl-item">{asset}</span></div>
      <div class="etl-cell"><span class="etl-item">{asset}</span></div>
      <div class="etl-cell"><span class="etl-item">{asset}</span></div>
    </div>
  </div>
  <div class="etl-track promo">
    <div class="etl-track-label">推广</div>
    <div class="etl-cells">
      <div class="etl-cell"><span class="etl-item">{channel push}</span></div>
      <div class="etl-cell"><span class="etl-item">{channel push}</span><span class="etl-item">{channel push}</span></div>
      <div class="etl-cell"><span class="etl-item">{channel push}</span></div>
    </div>
  </div>
</div>

HARD RULES:
- NO analysis, NO scorecard, NO competitor matrix, NO intent/evidence, NO KPI targets, NO invented numbers. If tempted to explain "why", stop — that belongs in Step 2.
- Every timeline chip, asset row and checklist item must trace to a playbook, a brief.timeline phase, or channelMixSuggestion. If the synthesis lacks it, omit it — do not fabricate.
- Owners are roles (Content / FAE / Digital / PR / Web), never invented names.
- Keep the OUTPUT CONTRACT: output STARTS with %%MD_START%% (no preamble); both marker pairs (MD + HTML_BODY) opened and closed; no text after %%HTML_BODY_END%%.
- The MD block (%%MD_START%%…%%MD_END%%) mirrors the same 3 sections in plain markdown (timeline as a phase list, assets as a table, checklist as - [ ] items).

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
Language: ${langDisplayName(campaign.uiLang)}
Topic: ${campaign.topic}
Days since baseline: ${snapshot.daysSinceBaseline}
Question deltas: ${JSON.stringify(snapshot.questionDeltas)}
Intent group deltas: ${JSON.stringify(snapshot.intentGroupDeltas)}
Focus on ST binding improvements and void reduction as campaign effect evidence.` }],
    }],
  });
  return res.text || '';
};
