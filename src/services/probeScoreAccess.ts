/**
 * Unified read path for probe scores — v2 `scored` rail or legacy v1 `gemini`.
 */

import type {
  AnchorVerificationStatus,
  GeoFailureCategory,
} from '../types';
import type {
  QuestionProbe,
  StBindingStrength,
  VoidSize,
} from '../types/campaign';
import type { ProbeProtocolVersion, StMentionForm } from '../types/probe';
import { PROBE_PROTOCOL_V1 } from '../config/probeProtocol';

export interface ProbeScoreView {
  stMentioned: boolean;
  stMentionRate: number;
  stMentionForm: StMentionForm;
  stBindingStrength: StBindingStrength;
  voidSize: VoidSize;
  voidSeverity: number;
  dominantCompetitors: string[];
  primaryFailure: GeoFailureCategory;
  anchorStatus?: AnchorVerificationStatus;
  protocolVersion: ProbeProtocolVersion;
  runsPerModel?: number;
  successfulAttempts?: number;
  totalAttempts?: number;
  volatility?: 'stable' | 'mixed' | 'sparse';
  isLegacy: boolean;
  degraded: boolean;
  scoreable: boolean;
}

/** Returns null when probe has no scoreable data at all. */
export function getProbeScoreView(probe: QuestionProbe): ProbeScoreView | null {
  if (probe.scored) {
    const s = probe.scored;
    if (s.degraded) {
      return {
        stMentioned: false,
        stMentionRate: 0,
        stMentionForm: 'none',
        stBindingStrength: 'none',
        voidSize: 'none',
        voidSeverity: 0,
        dominantCompetitors: [],
        primaryFailure: 'UNKNOWN',
        protocolVersion: s.protocolVersion,
        runsPerModel: s.runsPerModel,
        successfulAttempts: s.successfulAttempts,
        totalAttempts: s.successfulAttempts + s.failedAttempts,
        isLegacy: false,
        degraded: true,
        scoreable: false,
      };
    }
    return {
      stMentioned: s.stMentionCount > 0,
      stMentionRate: s.stMentionRate,
      stMentionForm: s.dominantMentionForm,
      stBindingStrength: s.stBindingStrength,
      voidSize: s.voidSize,
      voidSeverity: s.voidSeverity,
      dominantCompetitors: s.dominantCompetitors.map(c => c.name),
      primaryFailure: s.primaryFailure,
      anchorStatus: s.anchorStatus,
      protocolVersion: s.protocolVersion,
      runsPerModel: s.runsPerModel,
      successfulAttempts: s.successfulAttempts,
      totalAttempts: s.successfulAttempts + s.failedAttempts,
      volatility: s.volatility,
      isLegacy: false,
      degraded: false,
      scoreable: true,
    };
  }

  if (probe.gemini) {
    const g = probe.gemini;
    return {
      stMentioned: g.stMentioned,
      stMentionRate: g.stMentioned ? 1 : 0,
      stMentionForm: g.stMentioned ? 'company' : 'none',
      stBindingStrength: g.stBindingStrength,
      voidSize: g.voidSize,
      voidSeverity: g.voidSeverity,
      dominantCompetitors: g.dominantCompetitors || [],
      primaryFailure: g.primaryFailure,
      anchorStatus: g.anchorStatus,
      protocolVersion: PROBE_PROTOCOL_V1,
      isLegacy: true,
      degraded: false,
      scoreable: true,
    };
  }

  if (probe.probeSkipReason) return null;
  return null;
}

export function isProbeScoreable(probe: QuestionProbe): boolean {
  const v = getProbeScoreView(probe);
  return !!v?.scoreable;
}
