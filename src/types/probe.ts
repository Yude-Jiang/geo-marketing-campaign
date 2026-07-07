/**
 * M1 probe integrity types — real responses, referee observations, scored snapshots.
 */

import type { ModelId } from '../services/multiModelService';
import type { AnchorVerificationStatus, GeoFailureCategory } from '../types';
import type {
  StBindingStrength,
  VoidSize,
} from './campaign';

export type ProbeProtocolVersion = 'v1-simulated-guided' | 'v2-real-probe';

/**
 * Layered mention form — mention ≠ correct positioning.
 * `company` < `product_line` < `sub_brand` in specificity.
 */
export type StMentionForm = 'none' | 'company' | 'product_line' | 'sub_brand';

/** Single real probe attempt (evidence chain). */
export interface ModelProbeAttempt {
  id: string;
  modelId: ModelId;
  runIndex: number;
  promptText: string;
  rawResponse: string;
  probedAt: string;
  latencyMs: number;
  error?: string;
}

export type EvidenceField =
  | 'stMentioned'
  | 'stMentionForm'
  | 'competitors'
  | 'failure'
  | 'anchor'
  | 'binding';

export interface EvidenceQuote {
  field: EvidenceField;
  quote: string;
}

/** Referee read of one transcript — must trace to rawResponse via evidenceQuotes. */
export interface RefereeObservation {
  attemptId: string;
  modelId: ModelId;
  runIndex: number;
  stMentioned: boolean;
  stMentionForm: StMentionForm;
  stBindingStrength: StBindingStrength;
  dominantCompetitors: string[];
  primaryFailure: GeoFailureCategory;
  anchorStatus?: AnchorVerificationStatus;
  evidenceQuotes: EvidenceQuote[];
}

export interface CompetitorMention {
  name: string;
  mentionCount: number;
}

/** Aggregated scored snapshot — primary rail for v2 scoring / delta / reports. */
export interface ScoredProbeSnapshot {
  protocolVersion: ProbeProtocolVersion;
  runsPerModel: number;
  modelsProbed: ModelId[];
  attempts: ModelProbeAttempt[];
  observations: RefereeObservation[];
  stMentionCount: number;
  stMentionRate: number;
  dominantMentionForm: StMentionForm;
  mentionFormCounts: Record<StMentionForm, number>;
  stBindingStrength: StBindingStrength;
  voidSeverity: number;
  voidSize: VoidSize;
  dominantCompetitors: CompetitorMention[];
  primaryFailure: GeoFailureCategory;
  anchorStatus?: AnchorVerificationStatus;
  volatility: 'stable' | 'mixed' | 'sparse';
  successfulAttempts: number;
  failedAttempts: number;
  refereeModel: string;
  scoredAt: string;
  /** True when evidence validation failed or sample too sparse — excluded from aggregation. */
  degraded?: boolean;
  degradedReason?: string;
}
