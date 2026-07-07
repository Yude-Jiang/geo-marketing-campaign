/**
 * Evidence validation + deterministic aggregation of referee observations.
 */

import type { GeoFailureCategory } from '../types';
import type {
  StBindingStrength,
  VoidSize,
} from '../types/campaign';
import type { AnchorVerificationStatus } from '../types';
import type {
  ModelProbeAttempt,
  RefereeObservation,
  ScoredProbeSnapshot,
  StMentionForm,
} from '../types/probe';
import type { ModelId } from './multiModelService';
import {
  CURRENT_PROBE_PROTOCOL,
  MENTION_FORM_RANK,
  PROBE_MODEL_IDS,
} from '../config/probeProtocol';
import { GEMINI_MODELS } from '../config/models';

function voidSizeFromSeverity(severity: number): VoidSize {
  if (severity >= 9) return 'critical';
  if (severity >= 7) return 'large';
  if (severity >= 5) return 'medium';
  if (severity >= 3) return 'small';
  return 'none';
}

function clampSeverity(n: number): number {
  return Math.min(10, Math.max(1, Math.round(n)));
}

/** quote must be a literal substring of rawResponse (case-sensitive first, then case-insensitive). */
export function quoteInResponse(quote: string, rawResponse: string): boolean {
  if (!quote?.trim() || !rawResponse) return false;
  const q = quote.trim();
  if (rawResponse.includes(q)) return true;
  return rawResponse.toLowerCase().includes(q.toLowerCase());
}

/**
 * Validate ALL evidence fields for one observation against its transcript.
 * Returns false → observation rejected (degraded path).
 */
export function validateObservationEvidence(
  obs: RefereeObservation,
  rawResponse: string,
): boolean {
  if (!rawResponse?.trim()) return false;

  for (const eq of obs.evidenceQuotes || []) {
    if (!quoteInResponse(eq.quote, rawResponse)) return false;
  }

  if (obs.stMentioned) {
    const hasMentionQuote = obs.evidenceQuotes.some(
      eq => (eq.field === 'stMentioned' || eq.field === 'stMentionForm') && quoteInResponse(eq.quote, rawResponse),
    );
    if (!hasMentionQuote) return false;
  }

  for (const c of obs.dominantCompetitors || []) {
    if (!quoteInResponse(c, rawResponse)) return false;
  }

  if (obs.anchorStatus && obs.anchorStatus !== 'unverified') {
    const hasAnchorQuote = obs.evidenceQuotes.some(eq => eq.field === 'anchor');
    if (!hasAnchorQuote) return false;
  }

  return true;
}

export interface AggregateProbeScoreInput {
  attempts: ModelProbeAttempt[];
  observations: RefereeObservation[];
  runsPerModel: number;
  protocolVersion?: ScoredProbeSnapshot['protocolVersion'];
}

export function aggregateProbeScore(input: AggregateProbeScoreInput): ScoredProbeSnapshot {
  const {
    attempts,
    observations: rawObservations,
    runsPerModel,
    protocolVersion = CURRENT_PROBE_PROTOCOL,
  } = input;

  const attemptById = new Map(attempts.map(a => [a.id, a]));
  const validObs: RefereeObservation[] = [];

  for (const obs of rawObservations) {
    const att = attemptById.get(obs.attemptId);
    if (!att || att.error || !att.rawResponse?.trim()) continue;
    if (!validateObservationEvidence(obs, att.rawResponse)) {
      console.warn(
        `[probeAggregation] evidence validation failed for attempt ${obs.attemptId} — excluded from aggregation`,
      );
      continue;
    }
    validObs.push(obs);
  }

  const successfulAttempts = attempts.filter(a => !a.error && a.rawResponse?.trim()).length;
  const failedAttempts = attempts.length - successfulAttempts;

  if (validObs.length < 2 || successfulAttempts < 2) {
    return {
      protocolVersion,
      runsPerModel,
      modelsProbed: [...PROBE_MODEL_IDS],
      attempts,
      observations: validObs,
      stMentionCount: 0,
      stMentionRate: 0,
      dominantMentionForm: 'none',
      mentionFormCounts: { none: 0, company: 0, product_line: 0, sub_brand: 0 },
      stBindingStrength: 'none',
      voidSeverity: 0,
      voidSize: 'none',
      dominantCompetitors: [],
      primaryFailure: 'UNKNOWN',
      volatility: 'sparse',
      successfulAttempts,
      failedAttempts,
      refereeModel: GEMINI_MODELS.analysis,
      scoredAt: new Date().toISOString(),
      degraded: true,
      degradedReason: validObs.length < 2
        ? 'insufficient_valid_observations_after_evidence_check'
        : 'insufficient_successful_attempts',
    };
  }

  const stMentionCount = validObs.filter(o => o.stMentioned).length;
  const stMentionRate = stMentionCount / validObs.length;

  const mentionFormCounts: Record<StMentionForm, number> = {
    none: 0, company: 0, product_line: 0, sub_brand: 0,
  };
  for (const o of validObs) {
    const f = o.stMentioned ? o.stMentionForm : 'none';
    mentionFormCounts[f] = (mentionFormCounts[f] || 0) + 1;
  }
  const dominantMentionForm = (Object.entries(mentionFormCounts) as [StMentionForm, number][])
    .filter(([f]) => f !== 'none')
    .sort((a, b) => b[1] - a[1] || MENTION_FORM_RANK[b[0]] - MENTION_FORM_RANK[a[0]])[0]?.[0]
    || 'none';

  let stBindingStrength: StBindingStrength = 'none';
  if (stMentionRate >= 0.5) {
    const strongCount = validObs.filter(o => o.stBindingStrength === 'strong').length;
    stBindingStrength = strongCount >= validObs.length / 2 ? 'strong' : 'weak';
  } else if (stMentionRate > 0) {
    stBindingStrength = 'weak';
  }

  const compCounts = new Map<string, number>();
  for (const o of validObs) {
    for (const c of o.dominantCompetitors) {
      compCounts.set(c, (compCounts.get(c) || 0) + 1);
    }
  }
  const dominantCompetitors = [...compCounts.entries()]
    .filter(([, n]) => n >= 2 || compCounts.size === 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, mentionCount]) => ({ name, mentionCount }));

  const failCounts = new Map<string, number>();
  for (const o of validObs) {
    failCounts.set(o.primaryFailure, (failCounts.get(o.primaryFailure) || 0) + 1);
  }
  const primaryFailure = ([...failCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || 'UNKNOWN') as GeoFailureCategory;

  let base = stMentionRate > 0
    ? (stBindingStrength === 'strong' ? 2 : stBindingStrength === 'weak' ? 5 : 7)
    : 8;
  const topComp = dominantCompetitors[0]?.mentionCount ?? 0;
  if (stMentionRate < 0.25 && topComp >= 3) base += 2;
  else if (stMentionRate < 0.25 && topComp >= 1) base += 1;
  const voidSeverity = clampSeverity(base);
  const voidSize = voidSizeFromSeverity(voidSeverity);

  const anchorStatuses = validObs.map(o => o.anchorStatus).filter(Boolean) as AnchorVerificationStatus[];
  const anchorStatus = anchorStatuses.length
    ? mode(anchorStatuses) as AnchorVerificationStatus
    : undefined;

  const volatility = detectVolatility(validObs, runsPerModel);

  return {
    protocolVersion,
    runsPerModel,
    modelsProbed: [...new Set(attempts.map(a => a.modelId))] as ModelId[],
    attempts,
    observations: validObs,
    stMentionCount,
    stMentionRate,
    dominantMentionForm,
    mentionFormCounts,
    stBindingStrength,
    voidSeverity,
    voidSize,
    dominantCompetitors,
    primaryFailure,
    anchorStatus,
    volatility,
    successfulAttempts,
    failedAttempts,
    refereeModel: GEMINI_MODELS.analysis,
    scoredAt: new Date().toISOString(),
    degraded: false,
  };
}

function mode<T>(arr: T[]): T {
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function detectVolatility(
  obs: RefereeObservation[],
  runsPerModel: number,
): 'stable' | 'mixed' | 'sparse' {
  if (obs.length < 4) return 'sparse';
  const byModel = new Map<string, boolean[]>();
  for (const o of obs) {
    if (!byModel.has(o.modelId)) byModel.set(o.modelId, []);
    byModel.get(o.modelId)!.push(o.stMentioned);
  }
  for (const [, mentions] of byModel) {
    if (mentions.length >= 2 && new Set(mentions).size > 1) return 'mixed';
  }
  if (runsPerModel >= 2 && obs.length < runsPerModel * 2) return 'sparse';
  return 'stable';
}
