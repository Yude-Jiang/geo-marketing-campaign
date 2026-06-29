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
${(syn?.strategicReport?.actionPlan || []).map((s, i) => {
  const item = typeof s === 'string' ? { priority: '', action: s } : s;
  return `  ${i + 1}. [${item.priority || 'P1'}] ${item.action}`;
}).join('\n')}` : '';
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

THE %%HTML_BODY%% IS A "Campaign Proposal" SLIDE DECK following the STMicroelectronics brand. It is a complete proposal: campaign target, current AI cognition, competitor status, our product message, and the execution timeline — all DERIVED FROM THE DATA below. Do NOT invent numbers/dates/quotes; if the synthesis lacks something, omit it.

ST BRAND RULES (mandatory):
- Palette: ST Dark Blue #03234B (titles, dark bars), ST Yellow #FFD200 (value-prop headers / ONE highlight — ALWAYS dark-blue text on yellow, NEVER white), ST Light Blue #3CB4E6 (top message bar / supporting). Max 2–3 colours per slide.
- Every content slide has a Title Only header (.slide-title) AND one key message bar (.msg-bar = the single thing to remember).

DEPTH & SUBSTANCE (most important — the deck must NOT read hollow):
- Every bullet carries a SPECIFIC fact: a number, a named competitor/product, a concrete platform/corpus ("知乎 X 万阅读的替换帖", "CSDN 教程密度"), a real spec, or a precise action. BAN generic filler ("提升性能", "增强认知", "扩大影响", "更好的内容") — if a line has no concrete noun/number, delete or replace it.
- Cards carry 3–4 substantive bullets (not 1). Competitor cards use ALL fields (corpusAdvantage / weakSpot / interceptionPlay / crossModelValidation). Message-hierarchy proof boxes give 2–3 concrete specs each (pull real numbers/specs from brief.offer.differentiators & painPoints).
- AI-cognition slide cites the ACTUAL probe findings: the binding/visibility %, the specific dominant competitors by name, the precise void areas, and a short real quote/paraphrase from marketPulse — not abstractions.
- GIFBP rows are specific: Goal is quantified + time-bound; Insight names the competitor/void; Focus names the audience segment & ecosystem; Benefit states the concrete value with a spec; Proof lists real product facts.
- Prefer fewer slides done deeply over padding. Substance over brevity, but still no run-on paragraphs — dense, specific bullets.

%%HTML_BODY%% = a sequence of <section class="slide"> blocks. Use these EXACT classes (already styled — no <style>, no SmartArt, no <table> for the timeline):

SLIDE 1 — Title:
<section class="slide slide--title">
  <div class="kicker">Campaign Proposal</div>
  <h1>{campaign topic}</h1>
  <div class="subtitle">{region · ${c.duration} · ${c.uiLang === 'zh' ? '提案日期' : 'date'} ${reportDate}}</div>
  <div class="st-mark">ST</div>
</section>

SLIDE 2 — Executive Summary / Campaign Target, written with the GIFBP model (G=Goal 目标, I=Insight 洞察, F=Focus 受众与聚焦, B=Benefit 受众收益, P=Proof 证据). One tight sentence per row, derived from strategicReport + brief.objectives/audience/offer:
<section class="slide">
  <div class="slide-title">Executive Summary · Campaign Target</div>
  <div class="msg-bar msg-bar--navy">{the campaign's single goal in one line}</div>
  <div class="slide-body"><div class="gifbp">
    <div class="gifbp-k">G · Goal<small>目标</small></div><div class="gifbp-v">{campaign goal/target}</div>
    <div class="gifbp-k">I · Insight<small>洞察</small></div><div class="gifbp-v">{market/AI-cognition insight}</div>
    <div class="gifbp-k">F · Focus<small>聚焦</small></div><div class="gifbp-v">{target audience & focus}</div>
    <div class="gifbp-k">B · Benefit<small>收益</small></div><div class="gifbp-v">{benefit to the audience}</div>
    <div class="gifbp-k">P · Proof<small>证据</small></div><div class="gifbp-v">{proof points}</div>
  </div></div>
</section>

SLIDE 3 — Current AI Cognition (目前的 AI 认知), from the T0 probes + strategicReport.marketPulse + ST binding. cards-Nup, 3–4 cards (e.g. ST 当前可见度 / 主要认知空白 / 主导竞品 / 跨模型共识):
<section class="slide">
  <div class="slide-title">Current AI Cognition</div>
  <div class="msg-bar msg-bar--blue">{the one takeaway on how AI sees us today}</div>
  <div class="slide-body"><div class="cards">
    <div class="card navy"><div class="card-head">{aspect e.g. ST 可见度}</div><div class="card-body"><ul><li>{specific stat e.g. 加权绑定率 31%}</li><li>{where ST is absent, concretely}</li><li>{a real marketPulse paraphrase}</li></ul></div></div>
    ...3–4 cards, each with 3 specific bullets...
  </div></div>
</section>

SLIDE 4 — Competitor Status Analysis, from COMPETITOR BATTLE CARDS (one .card per competitor). card-head = competitor name; body = threatTier + corpusAdvantage (why AI prefers them) + weakSpot + our interceptionPlay:
<section class="slide">
  <div class="slide-title">Competitor Status</div>
  <div class="msg-bar msg-bar--navy">{the one competitive takeaway}</div>
  <div class="slide-body"><div class="cards">
    <div class="card"><div class="card-head">{competitor} · {threatTier}</div><div class="card-body"><div class="card-sub">为何 AI 偏好</div><ul><li>{corpusAdvantage}</li></ul><div class="card-sub">弱点 / 拦截</div><ul><li>{weakSpot}</li><li>{interceptionPlay}</li></ul></div></div>
    ...one card per top competitor...
  </div></div>
</section>

SLIDE 5 — Message Hierarchy (our product's Top message → Value propositions → Proof points → Use cases), from brief.offer (summary/differentiators/painPoints) + brief.market (keyApplications). 2–3 value-prop columns (set --n). Yellow value-prop headers (dark-blue text), gray proof boxes:
<section class="slide">
  <div class="slide-title">Message Hierarchy · {product}</div>
  <div class="slide-body"><div class="mh">
    <div class="mh-cap">Top message</div>
    <div class="mh-top">{the single top message / positioning sentence}</div>
    <div class="mh-cap">Value proposition · Proof points</div>
    <div class="mh-cols" style="--n:3">
      <div class="mh-col"><div class="mh-vp">{value prop 1}</div><div class="mh-proof"><ul><li>{proof}</li><li>{proof}</li></ul></div></div>
      <div class="mh-col"><div class="mh-vp">{value prop 2}</div><div class="mh-proof"><ul><li>{proof}</li></ul></div></div>
      <div class="mh-col"><div class="mh-vp">{value prop 3}</div><div class="mh-proof"><ul><li>{proof}</li></ul></div></div>
    </div>
    <div class="mh-foot"><b>Use cases:</b> {key applications, comma-separated}</div>
  </div></div>
</section>

SLIDE 6 — Content Clusters, from the playbooks grouped by content TYPE (文章/长文, 视频, 博客, 社媒, 引流/付费, EDM…). cards-Nup, one .card per cluster: head = content type, body = the specific pieces + their channel:
<section class="slide">
  <div class="slide-title">Content Clusters</div>
  <div class="msg-bar msg-bar--blue">{the one content-strategy takeaway}</div>
  <div class="slide-body"><div class="cards">
    <div class="card blue"><div class="card-head">{content type e.g. 技术文章}</div><div class="card-body"><ul><li>{specific piece + angle · channel · target question}</li><li>{specific piece · channel}</li><li>{specific piece · channel}</li></ul></div></div>
    <div class="card"><div class="card-head">{e.g. 视频}</div><div class="card-body"><ul><li>{specific piece + angle · channel}</li><li>{specific piece · channel}</li></ul></div></div>
    <div class="card"><div class="card-head">{e.g. 引流/付费}</div><div class="card-body"><ul><li>{百度品牌专区 + 关键词 · 目标}</li><li>{Bing/EDM piece · 目标}</li></ul></div></div>
    ...one card per content type; each 2–3 specific pieces...
  </div></div>
</section>

SLIDE 7 — Campaign Timeline (ST activation-plan style: CENTRAL horizontal axis with dated markers; CONTENT ASSETS hang ABOVE, PROMOTION sits BELOW). Choose 5–7 milestone dates across ${c.duration}; set --n to that count. Every row (.tl-assets, .tl-axis, .tl-promo) has exactly --n columns (empty <div class="tl-col"></div> where a date has no item). Deliverable goes above its ship date, channel push below its run date. Mark gated/launch with class "hl" (yellow), unconfirmed with "tbc". Real channels (China: 微信服务号/知乎/B站/中文论坛/百度/Bing/EDM; global: blog/YouTube/LinkedIn/Google/Bing/EDM). Multi-month campaign = a .tl-span bar with style="grid-column:{start}/{end}":
<section class="slide">
  <div class="slide-title">Campaign Timeline</div>
  <div class="msg-bar msg-bar--navy">{the one launch-sequence takeaway}</div>
  <div class="slide-body">
    <div class="tl-legend"><span><i style="background:#FFD200"></i>{gated/launch}</span><span><i style="background:#DBDEE1"></i>TBC</span></div>
    <div class="tl">
      <div class="tl-side"><span class="tl-side-label assets">CONTENT ASSETS</span><span class="tl-side-label promo">PROMOTION</span></div>
      <div class="tl-main" style="--n:6">
        <div class="tl-assets"><div class="tl-col on"><div class="tl-item">{asset}</div></div><div class="tl-col on"><div class="tl-item hl">{gated asset}</div></div><div class="tl-col"></div><div class="tl-col on"><div class="tl-item">{asset}</div></div><div class="tl-col"></div><div class="tl-col on"><div class="tl-item">{asset}</div></div></div>
        <div class="tl-axis"><div class="tl-date"><i></i><em>{date1}</em></div><div class="tl-date"><i></i><em>{date2}</em></div><div class="tl-date"><i></i><em>{date3}</em></div><div class="tl-date"><i></i><em>{date4}</em></div><div class="tl-date"><i></i><em>{date5}</em></div><div class="tl-date"><i></i><em>{date6}</em></div></div>
        <div class="tl-promo"><div class="tl-col on"><div class="tl-item">{push}</div></div><div class="tl-col"></div><div class="tl-col on"><div class="tl-item">{push}</div></div><div class="tl-col on"><div class="tl-item">{push}</div></div><div class="tl-col"></div><div class="tl-col on"><div class="tl-item">{push}</div></div></div>
        <div class="tl-spans"><div class="tl-span" style="grid-column:4 / 7">{multi-month campaign}</div></div>
      </div>
    </div>
  </div>
</section>

SLIDE 8 — Closing (mandatory trademark slide):
<section class="slide slide--closing">
  <h2>Our technology starts with You</h2>
  <div class="tm-band">© STMicroelectronics — All rights reserved. ST logo is a trademark or a registered trademark of STMicroelectronics International NV or its affiliates in the EU and/or other countries. For additional information about ST trademarks, please refer to www.st.com/trademarks. All other product or service names are the property of their respective owners.</div>
</section>

OUTPUT CONTRACT:
- Output STARTS with %%MD_START%% (no preamble). The MD block mirrors the deck as plain markdown (one section per slide). Close with %%MD_END%%, then %%HTML_BODY_START%% + the <section class="slide"> deck + %%HTML_BODY_END%%. No text after it.
- Slide text is in ${langDisplayName(c.uiLang)}; keep ST brand terms (ST, Cube2, channel names) as-is.
- Every line traces to the DATA (strategicReport / brief / competitorDiagnoses / probes / playbooks). Omit anything the synthesis lacks — never fabricate.

DATA:
${data}`;
}

export const generateCampaignReportStream = async (params: CampaignReportParams) => {
  const prompt = buildCampaignReportPrompt(params);
  const response = await getGenAI().models.generateContentStream({
    // Use the pro/analysis model for the final proposal — depth over speed.
    model: GEMINI_MODELS.analysis,
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
