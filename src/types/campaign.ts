/**
 * Campaign planning pipeline — type contract
 *
 * Data flows in four layers:
 *   SeedQuestion → QuestionProbe → IntentGroupDiagnosis → CampaignSynthesis
 *
 * LLM architecture:
 *   • Gemini (server via POST /api/gemini/* — key never in browser):
 *       preprocessing, simulated per-question probes, intent/campaign synthesis, report generation.
 *   • Four CN models (server via POST /api/multi-model-probe — keys never in browser):
 *       DeepSeek, Qwen, Doubao, Kimi — real responses for cross-model verification.
 *       Used on CN-ecosystem campaigns and optionally to validate Gemini simulation.
 *
 * Progress tracking is GEO-only (Track A): Probe deltas over time. No manual B/C KPIs.
 */

import type {
  AnchorVerificationStatus,
  GeoFailureCategory,
  GroundingUrl,
  ModelVerificationResult,
  StrategicPlaybookItem,
} from '../types';
import type { MultiModelVerificationResult } from '../services/multiModelService';

// ─── Shared enums ────────────────────────────────────────────────────────────

export type TargetEcosystem = 'global' | 'cn' | 'jp' | 'kr';

export type CampaignDurationType = '30d' | '90d' | 'quarter' | '180d' | '365d' | 'custom';

export type CampaignStatus =
  | 'draft'       // created, not yet probed
  | 'preprocessing'
  | 'probing'
  | 'synthesizing'
  | 'ready'       // confirm page — user can generate report
  | 'active'      // report issued, campaign in flight
  | 'completed';

export type SeedQuestionTier = 'category' | 'sub_node';

export type CampaignPriority = 'P0' | 'P1' | 'P2';

/** Probe cadence label — baseline is T0; mid/end map to scheduled re-runs */
export type ProbePhase = 'baseline' | 'mid' | 'end' | 'ad_hoc';

export type StBindingStrength = 'none' | 'weak' | 'strong';

export type VoidSize = 'critical' | 'large' | 'medium' | 'small' | 'none';

export type BriefSource = 'ai_inferred' | 'from_upload' | 'user_edited';

export type FunnelStage = 'awareness' | 'consideration' | 'decision';

export type EffortTier = 'S' | 'M' | 'L';

// ─── Layer 0: Minimal user input ─────────────────────────────────────────────

/** Only required field is `topic`; everything else is AI-filled or optional */
export interface CampaignCreateInput {
  topic: string;
  /** Raw question strings (3–9 recommended). Omitted → AI generates before probe */
  seedQuestions?: string[];
  /** st.com pages, uploaded brief URLs, etc. — optional RAG enrichment */
  sourceUrls?: string[];
  duration?: CampaignDurationType;
  customDateRange?: { start?: string; end?: string };
}

// ─── Layer 1: SeedQuestion (after AI preprocessing) ──────────────────────────

export interface SeedQuestion {
  id: string;
  /** Exact prompt text — frozen for reproducible T0 / T+N re-probes */
  text: string;
  tier: SeedQuestionTier;
  intentGroupId: string;
  priority: CampaignPriority;
  /** ST entity AI expects to appear in answers (e.g. product line, part family) */
  expectedAnchor?: string;
  /** sub_node → parent category question id */
  parentCategoryId?: string;
}

export interface IntentGroup {
  id: string;
  label: string;
  questionIds: string[];
  description?: string;
}

/** Output of preprocessing step ① — classify, cluster, prioritise */
export interface SeedQuestionPreprocessResult {
  questions: SeedQuestion[];
  intentGroups: IntentGroup[];
  preprocessedAt: string;
}

// ─── Layer 2: QuestionProbe (per seed question, per time point) ──────────────

/** Gemini-simulated cognitive snapshot for one seed question */
export interface GeminiProbeSnapshot {
  /** Gemini role-play answer to the seed question */
  simulatedAnswer: string;
  marketPulse: string;
  /** category tier: does AI explain the category correctly? */
  categoryUnderstood?: boolean;
  stMentioned: boolean;
  stBindingStrength: StBindingStrength;
  stBindingDetail?: string;
  voidSize: VoidSize;
  /** 1–10; drives heat-map and KPI targets */
  voidSeverity: number;
  dominantCompetitors: string[];
  primaryFailure: GeoFailureCategory;
  anchorStatus?: AnchorVerificationStatus;
  groundingUrls?: GroundingUrl[];
}

/**
 * One probe run for one seed question at one point in time.
 * Re-probes reuse the same questionId + questionText for delta comparison.
 */
export interface QuestionProbe {
  id: string;
  campaignId: string;
  questionId: string;
  /** Redundant copy of SeedQuestion.text at probe time — survives text edits in UI */
  questionText: string;
  phase: ProbePhase;
  probedAt: string;
  ecosystem: TargetEcosystem;
  region: string;
  /** Primary: Gemini simulation + optional Google Search grounding */
  gemini: GeminiProbeSnapshot;
  /** Optional: Google Search claim verification on Gemini marketPulse */
  modelVerification?: ModelVerificationResult;
  /**
   * Real CN model responses via /api/multi-model-probe (DeepSeek, Qwen, Doubao, Kimi).
   * Typically run when ecosystem === 'cn'; may also run on global for cross-check.
   */
  multiModel?: MultiModelVerificationResult;
}

// ─── Layer 3: IntentGroupDiagnosis (aggregated from probes) ───────────────────

export interface IntentGroupMetrics {
  questionCount: number;
  /** Fraction of questions in this group where ST is mentioned (0–1) */
  stMentionRate: number;
  avgVoidSeverity: number;
  criticalVoidCount: number;
  dominantCompetitors: string[];
  primaryFailure: GeoFailureCategory;
}

/** Strategic roll-up for one intent group — feeds report narrative sections */
export interface IntentGroupDiagnosis {
  intentGroupId: string;
  label: string;
  questionIds: string[];
  probeIds: string[];
  metrics: IntentGroupMetrics;
  /** AI-written synthesis paragraph for the report */
  narrative: string;
  failureDiagnosis?: {
    primaryFailure: GeoFailureCategory;
    severity: 'critical' | 'high' | 'medium' | 'low';
    explanation: string;
    repairUrgency: number;
  };
  recommendedPlaybookIds?: string[];
}

// ─── Layer 4: CampaignSynthesis ──────────────────────────────────────────────

/** AI-generated Brief (ST 7-section style) — no manual Track B/C KPIs */
export interface CampaignBriefDraft {
  source: BriefSource;
  objectives: {
    positioning: string[];
    commercial: string[];
    enablement: string[];
  };
  audience: {
    primary: string[];
    secondary: string[];
    geographies: string[];
    funnelFocus: FunnelStage[];
  };
  offer: {
    summary: string;
    productLines: string[];
    painPoints: string[];
    differentiators: string[];
  };
  market: {
    keyApplications: string[];
    competitorsByLine: { line: string; competitors: string[] }[];
    competitiveStrategy: string[];
  };
  /** GEO-only success metrics — auto-derived from probe baselines */
  geoKpis: GeoPhaseKpi[];
  timeline: {
    preparation: string;
    production: string;
    launch: string;
    probeSchedule: string[];
  };
  channelMixSuggestion: string;
  budgetTier: EffortTier;
}

export interface GeoPhaseKpi {
  phase: string;
  targets: {
    label: string;
    metric: string;
    baseline: string;
    target: string;
  }[];
}

export interface CampaignPlaybook extends StrategicPlaybookItem {
  id: string;
  intentGroupIds: string[];
  targetQuestionIds: string[];
  funnelStage?: FunnelStage;
  effortTier?: EffortTier;
  channelMix?: { owned: number; paid: number; earned: number; shared: number };
}

/** Full AI synthesis output after probes + intent roll-up */
export interface CampaignSynthesis {
  synthesizedAt: string;
  brief: CampaignBriefDraft;
  intentDiagnoses: IntentGroupDiagnosis[];
  playbooks: CampaignPlaybook[];
  executiveSummary: string;
  innovationPlays: string[];
}

// ─── Campaign aggregate (persisted) ─────────────────────────────────────────

export interface Campaign {
  id: string;
  topic: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  duration: CampaignDurationType;
  ecosystem: TargetEcosystem;
  region: string;
  uiLang: string;
  input: CampaignCreateInput;
  preprocess?: SeedQuestionPreprocessResult;
  /** Time-series: filter by phase for baseline vs progress */
  probes: QuestionProbe[];
  synthesis?: CampaignSynthesis;
  reportGeneratedAt?: string;
  progressSnapshots?: CampaignProgressSnapshot[];
}

// ─── Progress (GEO Track A only) ─────────────────────────────────────────────

export interface ProbeDelta {
  questionId: string;
  questionText: string;
  fromProbeId: string;
  toProbeId: string;
  stBindingDelta: string;
  voidSizeDelta: string;
  voidSeverityDelta: number;
  anchorStatusDelta?: string;
  failureCategoryChanged: boolean;
  competitorsDelta: string;
  /** CN ecosystem: consensus level change, if multiModel present on both probes */
  multiModelConsensusDelta?: string;
}

export interface IntentGroupDelta {
  intentGroupId: string;
  label: string;
  stMentionRateDelta: number;
  avgVoidSeverityDelta: number;
  improvedQuestionCount: number;
  totalQuestions: number;
}

export interface CampaignProgressSnapshot {
  id: string;
  campaignId: string;
  phase: ProbePhase;
  probedAt: string;
  daysSinceBaseline: number;
  questionDeltas: ProbeDelta[];
  intentGroupDeltas: IntentGroupDelta[];
  /** Short AI interpretation for Progress appendix */
  narrative: string;
}

// ─── UI: confirm page before report generation ────────────────────────────────

export interface CampaignConfirmPayload {
  campaign: Campaign;
  /** User may delete or tweak questions before locking baseline */
  editableQuestions: SeedQuestion[];
  selectedPlaybookIds: string[];
}

// ─── Pipeline stage markers (for loading UI) ─────────────────────────────────

export type CampaignPipelineStage =
  | 'preprocess'
  | 'probe_questions'
  | 'multi_model_verify'
  | 'synthesize_intents'
  | 'synthesize_campaign'
  | 'done';

export interface CampaignPipelineProgress {
  stage: CampaignPipelineStage;
  /** e.g. "Probing question 3/9" */
  detail?: string;
  completedQuestions?: number;
  totalQuestions?: number;
}
