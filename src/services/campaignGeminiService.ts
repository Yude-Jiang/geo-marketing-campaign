/**
 * Gemini calls for the Campaign pipeline.
 * CN real-model probes stay in multiModelService + /api/multi-model-probe.
 */

import { Type } from '@google/genai';
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
OUTPUT LANGUAGE for labels: ${uiLang}

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
        responseSchema: preprocessSchema as any,
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

Language for simulatedAnswer and marketPulse: ${uiLang}
Return JSON only.`;

  const result = await withRetry(() =>
    getGenAI().models.generateContent({
      model: GEMINI_MODELS.grounding,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: probeSchema as any,
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

  const prompt = `You are a senior automotive semiconductor marketing strategist writing a GEO Campaign plan.

CAMPAIGN TOPIC: ${topic}
DURATION: ${duration}
ECOSYSTEM: ${ecosystem} | REGION: ${region || 'Global'}
OUTPUT LANGUAGE: ${uiLang} — all narrative fields in this language.

PROBE DATA (T0 baseline):
${JSON.stringify(probeSummary, null, 2)}

INTENT GROUPS:
${JSON.stringify(preprocess.intentGroups, null, 2)}

${sourceContext ? `SOURCE MATERIALS:\n${sourceContext.slice(0, 6000)}` : ''}

Produce a complete campaign synthesis as JSON with:
- brief: ST-style campaign brief (objectives, audience, offer, market, geoKpis with phase targets derived from probe baselines, timeline phases, channelMixSuggestion, budgetTier S/M/L)
- intentDiagnoses: one per intentGroup with metrics computed from probes, narrative, failureDiagnosis, recommendedPlaybookIds
- playbooks: 4-8 CampaignPlaybook items (extend StrategicPlaybookItem fields: id, intentGroupIds, targetQuestionIds, funnelStage, effortTier, plus sourceLogic, tacticsType, contentPlatform, structuredDataStrategy, geoAction, targetSnippet, anchorIds)
- executiveSummary: 3-4 sentences
- innovationPlays: 3-5 unconventional GEO ideas

geoKpis must be GEO-only (ST binding rate, void severity, anchor verification) — no web traffic or lead counts.
Use probe voidSeverity as baselines for KPI targets.

Return valid JSON matching the structure.`;

  const result = await withRetry(() =>
    getGenAI().models.generateContent({
      model: GEMINI_MODELS.analysis,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: synthesisSchema as any,
      },
    })
  );

  let parsed: {
    brief: CampaignBriefDraft;
    intentDiagnoses: IntentGroupDiagnosis[];
    playbooks: CampaignPlaybook[];
    executiveSummary: string;
    innovationPlays: string[];
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
        config: { responseMimeType: 'application/json', responseSchema: synthesisSchema as any },
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
  };
}
