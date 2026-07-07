/**
 * Campaign pipeline orchestration (M1: real-probe-driven scoring).
 */

import type {
  Campaign,
  CampaignCreateInput,
  CampaignDurationType,
  CampaignPipelineProgress,
  ProbePhase,
  QuestionProbe,
  TargetEcosystem,
} from '../types/campaign';
import {
  preprocessSeedQuestions,
  synthesizeCampaign,
} from './campaignGeminiService';
import { runZeroHintProbes } from './multiModelService';
import { PROBE_MODEL_IDS } from '../config/probeProtocol';
import { fetchUrlContent } from './geminiService';
import { enrichIntentDiagnoses } from './intentMetrics';
import {
  DEFAULT_FRAMEWORK,
  DEFAULT_FRAMEWORK_ID,
  DEFAULT_FRAMEWORK_VERSION,
} from '../config/intentFramework';
import {
  CURRENT_PROBE_PROTOCOL,
  DEFAULT_RUNS_PER_MODEL,
} from '../config/probeProtocol';
import { refereeExtractObservations } from './probeReferee';
import { aggregateProbeScore } from './probeAggregation';

function newCampaignId() {
  return `camp-${Date.now()}`;
}

function newProbeId() {
  return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function durationToPromptText(duration: CampaignDurationType): string {
  switch (duration) {
    case '30d': return '30 days';
    case '90d': return '90 days';
    case 'quarter': return 'Quarter (3 months)';
    case '180d': return 'Half year (180 days)';
    case '365d': return '1 year (365 days)';
    default: return 'Custom';
  }
}

export function isCnEcosystem(ecosystem: TargetEcosystem, region: string): boolean {
  const regionIsCn = /\b(cn|china|prc)\b|中国|大陆|大陸/i.test(region || '');
  return ecosystem === 'cn' || regionIsCn;
}

async function gatherSourceContext(urls?: string[]): Promise<string> {
  if (!urls?.length) return '';
  const chunks: string[] = [];
  for (const url of urls.slice(0, 3)) {
    try {
      const text = await fetchUrlContent(url);
      if (text?.body) chunks.push(`--- ${url} ---\n${text.body.slice(0, 3000)}`);
    } catch { /* skip */ }
  }
  return chunks.join('\n\n');
}

async function runProbesForQuestions(
  campaign: Campaign,
  phase: ProbePhase,
  onProgress?: (p: CampaignPipelineProgress) => void,
): Promise<QuestionProbe[]> {
  const { preprocess, ecosystem, region } = campaign;
  if (!preprocess) return [];

  const questions = preprocess.questions;
  const runsPerModel = campaign.intentFrame?.probeRunsPerModel ?? DEFAULT_RUNS_PER_MODEL;
  const runCn = isCnEcosystem(ecosystem, region);
  const totalAttemptsPerQ = PROBE_MODEL_IDS.length * runsPerModel;

  const probes: QuestionProbe[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    if (!runCn) {
      onProgress?.({
        stage: 'probe_questions',
        detail: `Q${i + 1}/${questions.length}: CN ecosystem required for real probes`,
        completedQuestions: i,
        totalQuestions: questions.length,
      });
      probes.push({
        id: newProbeId(),
        campaignId: campaign.id,
        questionId: q.id,
        questionText: q.text,
        phase,
        probedAt: new Date().toISOString(),
        ecosystem,
        region,
        probeSkipReason: 'ecosystem_not_supported',
      });
      continue;
    }

    onProgress?.({
      stage: 'probe_questions',
      detail: `Q${i + 1}/${questions.length}: real probes (N=${runsPerModel})`,
      completedQuestions: i,
      totalQuestions: questions.length,
      completedAttempts: 0,
      totalAttempts: totalAttemptsPerQ,
    });

    const attempts = await runZeroHintProbes(q.text, {
      runsPerModel,
      uiLang: campaign.uiLang,
      onAttemptComplete: (done, total) => {
        onProgress?.({
          stage: 'probe_questions',
          detail: `Q${i + 1}/${questions.length}: attempt ${done}/${total}`,
          completedQuestions: i,
          totalQuestions: questions.length,
          completedAttempts: done,
          totalAttempts: total,
        });
      },
    });

    onProgress?.({
      stage: 'multi_model_verify',
      detail: `Q${i + 1}/${questions.length}: referee scoring`,
      completedQuestions: i,
      totalQuestions: questions.length,
      completedAttempts: totalAttemptsPerQ,
      totalAttempts: totalAttemptsPerQ,
    });

    const observations = await refereeExtractObservations(q.text, attempts, q.anchor);
    const scored = aggregateProbeScore({
      attempts,
      observations,
      runsPerModel,
      protocolVersion: CURRENT_PROBE_PROTOCOL,
    });

    probes.push({
      id: newProbeId(),
      campaignId: campaign.id,
      questionId: q.id,
      questionText: q.text,
      phase,
      probedAt: new Date().toISOString(),
      ecosystem,
      region,
      scored,
    });
  }

  return probes;
}

export interface RunCampaignPipelineOptions {
  input: CampaignCreateInput;
  ecosystem: TargetEcosystem;
  region: string;
  uiLang: string;
  onProgress?: (p: CampaignPipelineProgress) => void;
}

/** Full T0 pipeline: preprocess → real probe → synthesize */
export async function runCampaignPipeline(
  options: RunCampaignPipelineOptions,
): Promise<Campaign> {
  const { input, ecosystem, region, uiLang, onProgress } = options;
  const duration: CampaignDurationType = input.duration || '90d';
  const seedTexts = (input.seedQuestions || []).map(s => s.trim()).filter(Boolean);

  const campaign: Campaign = {
    id: newCampaignId(),
    topic: input.topic.trim(),
    status: 'preprocessing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    duration,
    ecosystem,
    region,
    uiLang,
    input,
    intentFrame: {
      frameworkId: DEFAULT_FRAMEWORK_ID,
      frameworkVersion: DEFAULT_FRAMEWORK_VERSION,
      frozen: false,
      activeDimensionIds: [],
      probeProtocolVersion: CURRENT_PROBE_PROTOCOL,
      probeRunsPerModel: DEFAULT_RUNS_PER_MODEL,
    },
    probes: [],
  };

  onProgress?.({ stage: 'preprocess', detail: 'Classifying seed questions...' });
  const preprocess = await preprocessSeedQuestions(
    campaign.topic, seedTexts, uiLang, ecosystem, region, DEFAULT_FRAMEWORK,
  );
  campaign.preprocess = preprocess;
  campaign.intentFrame!.activeDimensionIds = [
    ...new Set(preprocess.questions.map(q => q.dimensionId)),
  ];
  campaign.status = 'probing';

  const baselineProbes = await runProbesForQuestions(campaign, 'baseline', onProgress);
  campaign.probes = baselineProbes;
  campaign.status = 'synthesizing';

  onProgress?.({ stage: 'synthesize_campaign', detail: 'Building campaign plan...' });
  const sourceContext = await gatherSourceContext(input.sourceUrls);
  const rawSynthesis = await synthesizeCampaign(
    campaign.topic,
    preprocess,
    baselineProbes,
    uiLang,
    ecosystem,
    region,
    durationToPromptText(duration),
    sourceContext,
  );
  campaign.synthesis = {
    ...rawSynthesis,
    intentDiagnoses: enrichIntentDiagnoses(
      preprocess,
      baselineProbes,
      rawSynthesis.intentDiagnoses,
    ),
  };
  campaign.status = 'ready';
  campaign.updatedAt = new Date().toISOString();

  onProgress?.({ stage: 'done' });
  return campaign;
}

export async function rerunCampaignProbes(
  campaign: Campaign,
  phase: ProbePhase,
  onProgress?: (p: CampaignPipelineProgress) => void,
): Promise<QuestionProbe[]> {
  return runProbesForQuestions(campaign, phase, onProgress);
}

export function getBaselineProbes(campaign: Campaign): QuestionProbe[] {
  return campaign.probes.filter(p => p.phase === 'baseline');
}

export function getLatestProbesByQuestion(campaign: Campaign): QuestionProbe[] {
  const map = new Map<string, QuestionProbe>();
  for (const p of campaign.probes) {
    const prev = map.get(p.questionId);
    if (!prev || p.probedAt > prev.probedAt) map.set(p.questionId, p);
  }
  return [...map.values()];
}
