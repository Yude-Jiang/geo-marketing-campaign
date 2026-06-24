/**
 * Campaign pipeline orchestration.
 * Gemini: preprocess, probe simulation, synthesis, report.
 * CN models: optional per-question real probe via multiModelService.
 */

import type {
  Campaign,
  CampaignCreateInput,
  CampaignDurationType,
  CampaignPipelineProgress,
  CampaignSynthesis,
  ProbePhase,
  QuestionProbe,
  TargetEcosystem,
} from '../types/campaign';
import {
  preprocessSeedQuestions,
  runGeminiQuestionProbe,
  synthesizeCampaign,
} from './campaignGeminiService';
import { runMultiModelVerificationForQuestion } from './multiModelService';
import { fetchUrlContent } from './geminiService';

function newCampaignId() {
  return `camp-${Date.now()}`;
}

function newProbeId() {
  return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function gatherSourceContext(urls?: string[]): Promise<string> {
  if (!urls?.length) return '';
  const chunks: string[] = [];
  for (const url of urls.slice(0, 3)) {
    try {
      const text = await fetchUrlContent(url);
      if (text?.body) chunks.push(`--- ${url} ---\n${text.body.slice(0, 3000)}`);
    } catch { /* skip failed URLs */ }
  }
  return chunks.join('\n\n');
}

async function runProbesForQuestions(
  campaign: Campaign,
  phase: ProbePhase,
  onProgress?: (p: CampaignPipelineProgress) => void,
): Promise<QuestionProbe[]> {
  const { preprocess, topic, ecosystem, region } = campaign;
  if (!preprocess) return [];

  const questions = preprocess.questions;
  const probes: QuestionProbe[] = [];
  const runCnMulti = ecosystem === 'cn';

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    onProgress?.({
      stage: 'probe_questions',
      detail: `Probing ${i + 1}/${questions.length}`,
      completedQuestions: i,
      totalQuestions: questions.length,
    });

    const gemini = await runGeminiQuestionProbe(
      topic, q, campaign.uiLang, ecosystem, region,
    );

    let multiModel;
    if (runCnMulti) {
      onProgress?.({
        stage: 'multi_model_verify',
        detail: `CN models: question ${i + 1}/${questions.length}`,
        completedQuestions: i,
        totalQuestions: questions.length,
      });
      multiModel = await runMultiModelVerificationForQuestion(
        q.text, topic, campaign.uiLang,
      );
    }

    probes.push({
      id: newProbeId(),
      campaignId: campaign.id,
      questionId: q.id,
      questionText: q.text,
      phase,
      probedAt: new Date().toISOString(),
      ecosystem,
      region,
      gemini,
      multiModel,
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

/** Full T0 pipeline: preprocess → probe → synthesize */
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
    probes: [],
  };

  onProgress?.({ stage: 'preprocess', detail: 'Classifying seed questions...' });
  const preprocess = await preprocessSeedQuestions(
    campaign.topic, seedTexts, uiLang, ecosystem, region,
  );
  campaign.preprocess = preprocess;
  campaign.status = 'probing';

  const baselineProbes = await runProbesForQuestions(
    campaign, 'baseline', onProgress,
  );
  campaign.probes = baselineProbes;
  campaign.status = 'synthesizing';

  onProgress?.({ stage: 'synthesize_campaign', detail: 'Building campaign plan...' });
  const sourceContext = await gatherSourceContext(input.sourceUrls);
  const synthesis: CampaignSynthesis = await synthesizeCampaign(
    campaign.topic,
    preprocess,
    baselineProbes,
    uiLang,
    ecosystem,
    region,
    duration,
    sourceContext,
  );
  campaign.synthesis = synthesis;
  campaign.status = 'ready';
  campaign.updatedAt = new Date().toISOString();

  onProgress?.({ stage: 'done' });
  return campaign;
}

/** Re-run probes for progress tracking (same questions, new phase) */
export async function rerunCampaignProbes(
  campaign: Campaign,
  phase: ProbePhase,
  onProgress?: (p: CampaignPipelineProgress) => void,
): Promise<QuestionProbe[]> {
  const newProbes = await runProbesForQuestions(campaign, phase, onProgress);
  return newProbes;
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
