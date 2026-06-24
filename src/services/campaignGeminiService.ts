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

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();
  return JSON.parse(cleaned) as T;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  return {
    questions: raw.questions,
    intentGroups: raw.intentGroups,
    preprocessedAt: new Date().toISOString(),
  };
}

// ─── ② Per-question Gemini probe ─────────────────────────────────────────────

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

  return parseJson<GeminiProbeSnapshot>(result.text || '{}');
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
      config: { responseMimeType: 'application/json' },
    })
  );

  const parsed = parseJson<{
    brief: CampaignBriefDraft;
    intentDiagnoses: IntentGroupDiagnosis[];
    playbooks: CampaignPlaybook[];
    executiveSummary: string;
    innovationPlays: string[];
  }>(result.text || '{}');

  return {
    synthesizedAt: new Date().toISOString(),
    brief: parsed.brief,
    intentDiagnoses: parsed.intentDiagnoses || [],
    playbooks: (parsed.playbooks || []).map(pb => ({
      ...pb,
      id: pb.id || newId('pb'),
      anchorIds: pb.anchorIds || pb.targetQuestionIds || [],
    })),
    executiveSummary: parsed.executiveSummary || '',
    innovationPlays: parsed.innovationPlays || [],
  };
}
