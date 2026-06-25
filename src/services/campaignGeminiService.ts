/**
 * Gemini calls for the Campaign pipeline.
 * CN real-model probes stay in multiModelService + /api/multi-model-probe.
 */

import { Type, type Schema } from '@google/genai';
import { GEMINI_MODELS } from '../config/models';
import type {
  CampaignBriefDraft,
  CampaignPlaybook,
  CampaignSynthesis,
  GeminiProbeSnapshot,
  IntentGroupDiagnosis,
  QuestionProbe,
  SeedQuestion,
  SeedQuestionPreprocessResult,
  TargetEcosystem,
} from '../types/campaign';
import { getGenAI, withRetry } from './geminiService';
import { langDisplayName } from '../i18n/translations';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const preprocessSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING },
          tier: { type: Type.STRING },
          intentGroupId: { type: Type.STRING },
          priority: { type: Type.STRING },
          expectedAnchor: { type: Type.STRING },
          parentCategoryId: { type: Type.STRING },
        },
        required: ['id', 'text', 'tier', 'intentGroupId', 'priority'],
      },
    },
    intentGroups: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          questionIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          description: { type: Type.STRING },
        },
        required: ['id', 'label', 'questionIds'],
      },
    },
  },
  required: ['questions', 'intentGroups'],
};

const probeSchema = {
  type: Type.OBJECT,
  properties: {
    simulatedAnswer: { type: Type.STRING },
    marketPulse: { type: Type.STRING },
    categoryUnderstood: { type: Type.BOOLEAN },
    stMentioned: { type: Type.BOOLEAN },
    stBindingStrength: { type: Type.STRING },
    stBindingDetail: { type: Type.STRING },
    voidSize: { type: Type.STRING },
    voidSeverity: { type: Type.NUMBER },
    dominantCompetitors: { type: Type.ARRAY, items: { type: Type.STRING } },
    primaryFailure: { type: Type.STRING },
    anchorStatus: { type: Type.STRING },
  },
  required: [
    'simulatedAnswer', 'marketPulse', 'stMentioned', 'stBindingStrength',
    'voidSize', 'voidSeverity', 'dominantCompetitors', 'primaryFailure',
  ],
};

const strList = { type: Type.ARRAY, items: { type: Type.STRING } };

// Stage ④ — full synthesis schema so the model can't return a malformed /
// half-empty object that silently degrades into a hollow report.
const synthesisSchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: { type: Type.STRING },
    innovationPlays: strList,
    brief: {
      type: Type.OBJECT,
      properties: {
        source: { type: Type.STRING },
        objectives: {
          type: Type.OBJECT,
          properties: { positioning: strList, commercial: strList, enablement: strList },
        },
        audience: {
          type: Type.OBJECT,
          properties: {
            primary: strList, secondary: strList,
            geographies: strList, funnelFocus: strList,
          },
        },
        offer: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING }, productLines: strList,
            painPoints: strList, differentiators: strList,
          },
        },
        market: {
          type: Type.OBJECT,
          properties: {
            keyApplications: strList,
            competitorsByLine: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { line: { type: Type.STRING }, competitors: strList },
              },
            },
            competitiveStrategy: strList,
          },
        },
        geoKpis: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              phase: { type: Type.STRING },
              targets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING }, metric: { type: Type.STRING },
                    baseline: { type: Type.STRING }, target: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
        timeline: {
          type: Type.OBJECT,
          properties: {
            preparation: { type: Type.STRING }, production: { type: Type.STRING },
            launch: { type: Type.STRING }, probeSchedule: strList,
          },
        },
        channelMixSuggestion: { type: Type.STRING },
        budgetTier: { type: Type.STRING },
      },
    },
    intentDiagnoses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          intentGroupId: { type: Type.STRING },
          label: { type: Type.STRING },
          questionIds: strList,
          probeIds: strList,
          metrics: {
            type: Type.OBJECT,
            properties: {
              questionCount: { type: Type.NUMBER },
              stMentionRate: { type: Type.NUMBER },
              avgVoidSeverity: { type: Type.NUMBER },
              criticalVoidCount: { type: Type.NUMBER },
              dominantCompetitors: strList,
              primaryFailure: { type: Type.STRING },
            },
          },
          narrative: { type: Type.STRING },
          failureDiagnosis: {
            type: Type.OBJECT,
            properties: {
              primaryFailure: { type: Type.STRING },
              severity: { type: Type.STRING },
              explanation: { type: Type.STRING },
              repairUrgency: { type: Type.NUMBER },
            },
          },
          recommendedPlaybookIds: strList,
        },
        required: ['intentGroupId', 'label', 'narrative'],
      },
    },
    playbooks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          intentGroupIds: strList,
          targetQuestionIds: strList,
          funnelStage: { type: Type.STRING },
          effortTier: { type: Type.STRING },
          sourceLogic: { type: Type.STRING },
          tacticsType: { type: Type.STRING },
          contentPlatform: { type: Type.STRING },
          structuredDataStrategy: { type: Type.STRING },
          geoAction: { type: Type.STRING },
          targetSnippet: { type: Type.STRING },
          anchorIds: strList,
        },
        required: ['geoAction', 'tacticsType', 'targetSnippet'],
      },
    },
    strategicReport: {
      type: Type.OBJECT,
      properties: {
        executiveSummary: {
          type: Type.OBJECT,
          properties: {
            marketPulse: { type: Type.STRING },
            coreRoadblocks: { type: Type.STRING },
            strategicPivot: { type: Type.STRING },
            keyInsight: { type: Type.STRING },
          },
        },
        actionPlan: strList,
      },
    },
    competitorDiagnoses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          threatTier: { type: Type.STRING },
          corpusAdvantage: { type: Type.STRING },
          weakSpot: { type: Type.STRING },
          interceptionPlay: { type: Type.STRING },
          crossModelValidation: { type: Type.STRING },
          anchorIds: strList,
        },
        required: ['name', 'threatTier', 'corpusAdvantage', 'weakSpot', 'interceptionPlay'],
      },
    },
  },
  required: ['brief', 'intentDiagnoses', 'playbooks', 'executiveSummary', 'innovationPlays'],
};

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fallback: salvage the outermost JSON object if the model wrapped it in prose.
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1)) as T;
    }
    throw new SyntaxError('No parseable JSON object found in model output');
  }
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.playName === 'string' && typeof obj.description === 'string') {
      return `${obj.playName}: ${obj.description}`;
    }
    if (typeof obj.description === 'string') return obj.description;
    if (typeof obj.summary === 'string') return obj.summary;
    if (typeof obj.text === 'string') return obj.text;
  }
  return JSON.stringify(value);
}

// ─── ① Preprocess seed questions ─────────────────────────────────────────────

export async function preprocessSeedQuestions(
  topic: string,
  seedQuestionTexts: string[],
  uiLang: string,
  ecosystem: TargetEcosystem,
  region: string,
): Promise<SeedQuestionPreprocessResult> {
  const hasUserQuestions = seedQuestionTexts.length > 0;
  const prompt = `You are a GEO campaign strategist for semiconductor B2B.

CAMPAIGN TOPIC: ${topic}
ECOSYSTEM: ${ecosystem}
REGION: ${region || 'Global'}
OUTPUT LANGUAGE for labels: ${langDisplayName(uiLang)}

${hasUserQuestions ? `USER SEED QUESTIONS (one per line — preserve exact text):
${seedQuestionTexts.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Tasks:
1. Keep each user question text EXACTLY as given (assign stable ids q-1, q-2, ...).
2. Classify tier: "category" (broad category cognition + vendor binding) or "sub_node" (specific sub-topic void).
3. Group into 2-4 intentGroups.
4. Assign priority P0/P1/P2 based on likely GEO void severity.
5. Infer expectedAnchor (ST product line or proof point) where possible.` : `No user questions provided. Generate 6-8 seed questions:
- 3-4 category tier (category cognition + which vendors AI mentions)
- 3-4 sub_node tier (specific sub-topic void)
Group into 2-4 intentGroups. Assign ids q-1, q-2, ... and ig-1, ig-2, ...`}

Return JSON only.`;

  const result = await withRetry(() =>
    getGenAI().models.generateContent({
      model: GEMINI_MODELS.analysis,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: preprocessSchema as Schema,
      },
    })
  );

  const raw = parseJson<{
    questions: SeedQuestion[];
    intentGroups: SeedQuestionPreprocessResult['intentGroups'];
  }>(result.text || '{}');

  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error('Preprocess returned no questions — cannot run probes. Check seed input / model output.');
  }

  return {
    questions: raw.questions,
    intentGroups: Array.isArray(raw.intentGroups) ? raw.intentGroups : [],
    preprocessedAt: new Date().toISOString(),
  };
}

// ─── ② Per-question Gemini probe ─────────────────────────────────────────────

/**
 * Deterministic post-processing: clamp ranges and reconcile the four mutually
 * dependent fields (binding ↔ severity ↔ voidSize ↔ failure) so the probe can
 * never contain self-contradictory signals (e.g. ST absent but voidSeverity=0).
 * voidSeverity is treated as the single source of truth for voidSize.
 */
function normalizeProbe(s: GeminiProbeSnapshot): GeminiProbeSnapshot {
  const binding = (['none', 'weak', 'strong'].includes(s.stBindingStrength)
    ? s.stBindingStrength
    : 'none') as GeminiProbeSnapshot['stBindingStrength'];
  const stMentioned = binding === 'none' ? false : (s.stMentioned ?? true);
  const competitors = Array.isArray(s.dominantCompetitors) ? s.dominantCompetitors : [];

  // 1) clamp severity, then reconcile against binding
  let severity = Math.round(Number(s.voidSeverity));
  if (!Number.isFinite(severity)) severity = stMentioned ? 3 : 7;
  severity = Math.min(10, Math.max(1, severity));
  if (!stMentioned) severity = Math.max(severity, 6);   // absence is never a trivial void
  if (binding === 'strong') severity = Math.min(severity, 4); // strong binding ⇒ small void

  // 2) derive voidSize from the reconciled severity (single source of truth)
  const voidSize: GeminiProbeSnapshot['voidSize'] =
    severity >= 9 ? 'critical' :
    severity >= 7 ? 'large' :
    severity >= 5 ? 'medium' :
    severity >= 3 ? 'small' : 'none';

  // 3) reconcile primaryFailure with presence/absence
  let failure = s.primaryFailure || 'UNKNOWN';
  if (!stMentioned && (failure === 'UNKNOWN' || !failure)) {
    failure = competitors.length ? 'COMPETITOR_DOMINANCE' : 'CORPUS_ABSENCE';
  }
  if (binding === 'strong' && (failure === 'CORPUS_ABSENCE' || failure === 'COMPETITOR_DOMINANCE')) {
    failure = severity <= 2 ? 'UNKNOWN' : 'STRUCTURAL_WEAKNESS';
  }

  return {
    ...s,
    stMentioned,
    stBindingStrength: binding,
    voidSeverity: severity,
    voidSize,
    dominantCompetitors: competitors,
    primaryFailure: failure as GeminiProbeSnapshot['primaryFailure'],
  };
}

export async function runGeminiQuestionProbe(
  campaignTopic: string,
  question: SeedQuestion,
  uiLang: string,
  ecosystem: TargetEcosystem,
  region: string,
): Promise<GeminiProbeSnapshot> {
  const tierHint = question.tier === 'category'
    ? 'This is a CATEGORY-level probe: assess if AI understands the category and whether STMicroelectronics (ST) is mentioned/bound as a vendor.'
    : 'This is a SUB-NODE probe: assess void size — how absent or weak ST is vs competitors for this specific topic.';

  const prompt = `Role-play as a generative AI assistant answering an automotive engineer's question.
${tierHint}

CAMPAIGN: ${campaignTopic}
ECOSYSTEM: ${ecosystem} | REGION: ${region || 'Global'}
QUESTION: ${question.text}
${question.expectedAnchor ? `EXPECTED ST ANCHOR (if fairly cited): ${question.expectedAnchor}` : ''}

Simulate how AI would answer today. Then analyse:
- stMentioned, stBindingStrength (none/weak/strong)
- voidSize (critical/large/medium/small/none) and voidSeverity 1-10
- dominantCompetitors (semiconductor vendors)
- primaryFailure (CORPUS_ABSENCE|ATTRIBUTE_MISMATCH|BURIED_ANSWER|COMPETITOR_DOMINANCE|SEMANTIC_IRRELEVANCE|OUTDATED_CONTENT|TRUST_CREDIBILITY|STRUCTURAL_WEAKNESS|UNKNOWN)
- categoryUnderstood (only if category tier)
- anchorStatus (verified/partial/unverified) if expectedAnchor provided

SCORING CONSISTENCY (mandatory — these fields must not contradict each other):
- If stMentioned=false, ST is absent → voidSeverity MUST be >= 6, voidSize MUST be medium/large/critical, and primaryFailure MUST be COMPETITOR_DOMINANCE (if competitors are listed) or CORPUS_ABSENCE (if not). voidSize "none"/"small" with stMentioned=false is forbidden.
- If stBindingStrength="strong", voidSeverity MUST be <= 4 and primaryFailure must NOT be CORPUS_ABSENCE or COMPETITOR_DOMINANCE (ST is present); use STRUCTURAL_WEAKNESS/ATTRIBUTE_MISMATCH/UNKNOWN instead.
- voidSize must track voidSeverity: 1-2=none, 3-4=small, 5-6=medium, 7-8=large, 9-10=critical.
- primaryFailure="UNKNOWN" is only allowed when stBindingStrength="strong" and voidSeverity<=2.

Language for simulatedAnswer and marketPulse: ${langDisplayName(uiLang)}
Return JSON only.`;

  const result = await withRetry(() =>
    getGenAI().models.generateContent({
      model: GEMINI_MODELS.grounding,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: probeSchema as Schema,
      },
    })
  );

  return normalizeProbe(parseJson<GeminiProbeSnapshot>(result.text || '{}'));
}

// ─── ③④ Campaign synthesis (intent roll-up + brief + playbooks) ─────────────

export async function synthesizeCampaign(
  topic: string,
  preprocess: SeedQuestionPreprocessResult,
  probes: QuestionProbe[],
  uiLang: string,
  ecosystem: TargetEcosystem,
  region: string,
  duration: string,
  sourceContext?: string,
): Promise<CampaignSynthesis> {
  const probeSummary = probes.map(p => ({
    questionId: p.questionId,
    text: p.questionText,
    tier: preprocess.questions.find(q => q.id === p.questionId)?.tier,
    intentGroupId: preprocess.questions.find(q => q.id === p.questionId)?.intentGroupId,
    gemini: p.gemini,
    multiModelConsensus: p.multiModel?.consensusLevel,
  }));

  // Real China-local LLM evidence (DeepSeek/Qwen/Doubao/Kimi) per question —
  // so competitor analysis is cross-validated against actual local-model output,
  // not just Gemini's simulation. Empty when no CN probes ran (non-CN campaign).
  const crossModelEvidence = probes
    .filter(p => (p.multiModel?.snapshots || []).some(s => !s.error && s.rawResponse?.trim()))
    .map(p => {
      const snaps = (p.multiModel!.snapshots || []).filter(s => !s.error && s.rawResponse?.trim());
      return `Q: ${p.questionText}\n` + snaps.map(s =>
        `  - ${s.modelName} [${s.sentiment}] entities: ${(s.keyEntities || []).slice(0, 8).join(', ') || '—'}\n    excerpt: ${(s.rawResponse || '').slice(0, 220)}`,
      ).join('\n');
    }).join('\n\n');
  const hasCrossModel = crossModelEvidence.length > 0;
  const regionIsCn = ecosystem === 'cn' || /\b(cn|china|prc)\b|中国|大陆|大陸/i.test(region || '');

  const prompt = `You are a senior automotive semiconductor marketing strategist writing a GEO Campaign plan.

CAMPAIGN TOPIC: ${topic}
DURATION: ${duration}
ECOSYSTEM: ${ecosystem} | REGION: ${region || 'Global'}
OUTPUT LANGUAGE: ${langDisplayName(uiLang)} — all narrative fields in this language.

PROBE DATA (T0 baseline):
${JSON.stringify(probeSummary, null, 2)}

INTENT GROUPS:
${JSON.stringify(preprocess.intentGroups, null, 2)}

${sourceContext ? `SOURCE MATERIALS:\n${sourceContext.slice(0, 6000)}` : ''}

${hasCrossModel ? `CHINA-LOCAL MODEL EVIDENCE (REAL responses from DeepSeek / Qwen / Doubao / Kimi — NOT simulation):
${crossModelEvidence.slice(0, 7000)}
` : ''}
Produce a complete campaign synthesis as JSON with:
- brief: ST-style campaign brief (objectives, audience, offer, market, geoKpis with phase targets derived from probe baselines, timeline phases, channelMixSuggestion, budgetTier S/M/L)
- intentDiagnoses: one per intentGroup with metrics computed from probes, narrative, failureDiagnosis, recommendedPlaybookIds
- playbooks: 4-8 CampaignPlaybook items (extend StrategicPlaybookItem fields: id, intentGroupIds, targetQuestionIds, funnelStage, effortTier, plus sourceLogic, tacticsType, contentPlatform, structuredDataStrategy, geoAction, targetSnippet, anchorIds)
- executiveSummary: 3-4 sentences
- innovationPlays: 3-5 unconventional GEO ideas
- strategicReport: a structured executive report with executiveSummary = { marketPulse (how AI sees this category today), coreRoadblocks (what blocks ST from being the cited answer), strategicPivot (the core move to make), keyInsight (the single sharpest takeaway) } and actionPlan (4-6 concrete step-by-step GEO tasks). Each field 1-2 tight sentences.
- competitorDiagnoses: a real MARKET analysis of the competitors recurring across the probes' dominantCompetitors AND named in the China-local model evidence. COVER AT LEAST THE 5 MOST FREQUENT. Do NOT just restate GEO void metrics — analyse the competitive market. Every field must be concrete, specific and traceable to evidence; no generic filler. For each:
    • name
    • threatTier (dominant/strong/emerging — dominant = named across many probes/models and driving severe voids)
    • corpusAdvantage: the SPECIFIC market + corpus reasons AI favors/cites them — products/platforms they own, design-win footprint, where their content dominates (e.g. "owns the ADAS SoC reference-design narrative; saturates CSDN/zhihu teardown posts"). Go beyond "they are mentioned more".
    • weakSpot: a concrete, attackable gap (product, ecosystem, region, or corpus blind spot), not a vague "less coverage".
    • interceptionPlay: ST's specific counter-move tied to that weak spot.
    • crossModelValidation: ${hasCrossModel ? 'how the China-local models (DeepSeek/Qwen/Doubao/Kimi) corroborate or DIVERGE from the Gemini view on this competitor — cite which local models named them and any disagreement. This is mandatory grounding, not optional.' : 'set to a short note that local-model (DeepSeek/Qwen/Doubao/Kimi) validation is pending for this campaign (no CN probe ran).'}
    • anchorIds: question ids where they dominate, for traceability.

CHANNEL & TACTICS GUIDANCE — playbooks.contentPlatform, playbooks.tacticsType and brief.channelMixSuggestion MUST use real, region-appropriate channels and tactics:
${regionIsCn ? `This is a CHINA campaign — use the China media landscape, NOT Western defaults (do not propose Google Search, Reddit, X/Twitter, LinkedIn as primary):
- Owned media: WeChat Service Account (微信服务号), Zhihu (知乎), Bilibili (B站), Chinese technical forums/communities (中文论坛, e.g. CSDN / EEWORLD / 21ic).
- Vertical & earned media: industry vertical media (垂直媒体), engineer KOL/community seeding.
- Tactics: Email (owned lists + third-party EDM/垂直媒体邮件), Baidu paid search (百度竞价/品牌专区), Bing paid search, structured Q&A seeding (Zhihu/百度知道) for GEO.
Map each playbook to a concrete channel from this list and say whether it is owned / vertical / paid.` : `Use region-appropriate channels for a global/Western campaign (e.g. Google paid search, Bing, LinkedIn, YouTube, owned email + third-party EDM, technical blogs and developer communities). Label each as owned / earned / paid.`}

geoKpis must be GEO-only (ST binding rate, void severity, anchor verification) — no web traffic or lead counts.
Use probe voidSeverity as baselines for KPI targets.

Return valid JSON matching the structure.`;

  const result = await withRetry(() =>
    getGenAI().models.generateContent({
      model: GEMINI_MODELS.analysis,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: synthesisSchema as Schema,
      },
    })
  );

  let parsed: {
    brief: CampaignBriefDraft;
    intentDiagnoses: IntentGroupDiagnosis[];
    playbooks: CampaignPlaybook[];
    executiveSummary: string;
    innovationPlays: string[];
    strategicReport?: CampaignSynthesis['strategicReport'];
    competitorDiagnoses?: CampaignSynthesis['competitorDiagnoses'];
  };
  let degraded = false;
  try {
    parsed = parseJson(result.text || '{}');
  } catch (firstErr) {
    // With responseSchema this should be rare. One repair attempt before degrading.
    console.warn('[synthesizeCampaign] first parse failed, attempting JSON repair…', firstErr);
    try {
      const repair = await getGenAI().models.generateContent({
        model: GEMINI_MODELS.analysis,
        contents: [{ role: 'user', parts: [{ text:
          `The following text should be a single valid JSON object but failed to parse. Return ONLY the corrected JSON, no prose, no code fences.\n\n${(result.text || '').slice(0, 12000)}` }] }],
        config: { responseMimeType: 'application/json', responseSchema: synthesisSchema as Schema },
      });
      parsed = parseJson(repair.text || '{}');
    } catch (secondErr) {
      // Degrade gracefully — but FLAG it so the report/UI never presents an
      // empty shell as a complete plan. Intent metrics are still recomputed
      // deterministically downstream via enrichIntentDiagnoses.
      console.error('[synthesizeCampaign] JSON parse failed after repair, degrading:', secondErr);
      degraded = true;
      parsed = {
        brief: {} as CampaignBriefDraft,
        intentDiagnoses: [],
        playbooks: [],
        executiveSummary: '',
        innovationPlays: [],
        strategicReport: undefined,
        competitorDiagnoses: [],
      };
    }
  }

  return {
    synthesizedAt: new Date().toISOString(),
    degraded,
    brief: parsed.brief,
    intentDiagnoses: parsed.intentDiagnoses || [],
    playbooks: (parsed.playbooks || []).map(pb => ({
      ...pb,
      id: pb.id || newId('pb'),
      anchorIds: pb.anchorIds || pb.targetQuestionIds || [],
    })),
    executiveSummary: toText(parsed.executiveSummary),
    innovationPlays: (parsed.innovationPlays || []).map(item => toText(item)).filter(Boolean),
    strategicReport: parsed.strategicReport,
    competitorDiagnoses: withMentionShare(
      Array.isArray(parsed.competitorDiagnoses) ? parsed.competitorDiagnoses : [],
      probes,
    ),
  };
}

/**
 * Deterministically compute each competitor's mention share (SOV) from the
 * probes' dominantCompetitors — never let the LLM guess this number. Share =
 * (times this competitor is named) / (total competitor mentions across probes).
 * Matched case-insensitively by name.
 */
function withMentionShare(
  diagnoses: CampaignSynthesis['competitorDiagnoses'],
  probes: QuestionProbe[],
): CampaignSynthesis['competitorDiagnoses'] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const p of probes) {
    for (const name of p.gemini?.dominantCompetitors || []) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
      total += 1;
    }
  }
  return diagnoses.map(d => ({
    ...d,
    anchorIds: Array.isArray(d.anchorIds) ? d.anchorIds : [],
    mentionShare: total > 0 ? (counts.get((d.name || '').trim().toLowerCase()) || 0) / total : 0,
  }));
}
