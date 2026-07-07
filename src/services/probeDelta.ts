/**
 * Deterministic GEO probe delta calculations (M1: scored rail + protocol guard).
 */

import type {
  Campaign,
  CampaignProgressSnapshot,
  IntentGroupDelta,
  ProbeDelta,
  ProbePhase,
  QuestionProbe,
  SeedQuestionPreprocessResult,
} from '../types/campaign';
import { PROBE_PROTOCOL_V1 } from '../config/probeProtocol';
import { getProbeScoreView, isProbeScoreable } from './probeScoreAccess';

function getProtocolVersion(probe: QuestionProbe, campaign?: Campaign): string {
  if (probe.scored?.protocolVersion) return probe.scored.protocolVersion;
  if (probe.gemini) return campaign?.intentFrame?.probeProtocolVersion || PROBE_PROTOCOL_V1;
  return PROBE_PROTOCOL_V1;
}

export function protocolsComparable(
  from: QuestionProbe,
  to: QuestionProbe,
  campaign?: Campaign,
): boolean {
  return getProtocolVersion(from, campaign) === getProtocolVersion(to, campaign);
}

export function computeProbeDelta(
  from: QuestionProbe,
  to: QuestionProbe,
  campaign?: Campaign,
): ProbeDelta | null {
  if (!protocolsComparable(from, to, campaign)) return null;

  const v0 = getProbeScoreView(from);
  const v1 = getProbeScoreView(to);
  if (!v0?.scoreable || !v1?.scoreable) return null;

  return {
    questionId: from.questionId,
    questionText: from.questionText,
    fromProbeId: from.id,
    toProbeId: to.id,
    stBindingDelta: `${v0.stBindingStrength} → ${v1.stBindingStrength}`,
    voidSizeDelta: `${v0.voidSize} → ${v1.voidSize}`,
    voidSeverityDelta: v1.voidSeverity - v0.voidSeverity,
    anchorStatusDelta: v0.anchorStatus && v1.anchorStatus
      ? `${v0.anchorStatus} → ${v1.anchorStatus}` : undefined,
    failureCategoryChanged: v0.primaryFailure !== v1.primaryFailure,
    competitorsDelta: `${v0.dominantCompetitors.slice(0, 3).join(', ')} → ${v1.dominantCompetitors.slice(0, 3).join(', ')}`,
    multiModelConsensusDelta: v0.volatility && v1.volatility
      ? `${v0.volatility} → ${v1.volatility}` : undefined,
  };
}

export function computeIntentGroupDeltas(
  preprocess: SeedQuestionPreprocessResult,
  baselineProbes: QuestionProbe[],
  currentProbes: QuestionProbe[],
  questionDeltas: ProbeDelta[],
): IntentGroupDelta[] {
  return preprocess.intentGroups.map(ig => {
    const qIds = new Set(ig.questionIds);
    const base = baselineProbes.filter(p => qIds.has(p.questionId) && isProbeScoreable(p));
    const curr = currentProbes.filter(p => qIds.has(p.questionId) && isProbeScoreable(p));

    const rate = (probes: QuestionProbe[]) => {
      const vs = probes.map(p => getProbeScoreView(p)).filter(Boolean);
      if (!vs.length) return 0;
      return vs.reduce((s, v) => s + (v!.stMentionRate), 0) / vs.length;
    };
    const avgSev = (probes: QuestionProbe[]) => {
      const vs = probes.map(p => getProbeScoreView(p)).filter(v => v?.scoreable);
      if (!vs.length) return 0;
      return vs.reduce((s, v) => s + v!.voidSeverity, 0) / vs.length;
    };

    const stRate0 = rate(base);
    const stRate1 = rate(curr);
    const avg0 = avgSev(base);
    const avg1 = avgSev(curr);
    const improved = questionDeltas.filter(
      d => qIds.has(d.questionId) && d.voidSeverityDelta < 0,
    ).length;

    return {
      intentGroupId: ig.id,
      label: ig.label,
      stMentionRateDelta: stRate1 - stRate0,
      avgVoidSeverityDelta: avg1 - avg0,
      improvedQuestionCount: improved,
      totalQuestions: ig.questionIds.length,
    };
  });
}

export function buildProgressSnapshot(
  campaignId: string,
  phase: ProbePhase,
  preprocess: SeedQuestionPreprocessResult,
  allProbes: QuestionProbe[],
  narrative: string,
  campaign?: Campaign,
): CampaignProgressSnapshot {
  const baseline = allProbes.filter(p => p.phase === 'baseline');
  const baselineByQ = new Map(baseline.map(p => [p.questionId, p]));

  const latestNonBaseline = new Map<string, QuestionProbe>();
  for (const p of allProbes) {
    if (p.phase === 'baseline') continue;
    const prev = latestNonBaseline.get(p.questionId);
    if (!prev || p.probedAt > prev.probedAt) latestNonBaseline.set(p.questionId, p);
  }
  const currentProbes = [...latestNonBaseline.values()];

  let protocolMismatch = false;
  const questionDeltas: ProbeDelta[] = [];

  for (const curr of currentProbes) {
    const base = baselineByQ.get(curr.questionId);
    if (!base) {
      console.warn(`[probeDelta] no baseline for ${curr.questionId}`);
      continue;
    }
    if (!protocolsComparable(base, curr, campaign)) {
      protocolMismatch = true;
      console.warn(
        `[probeDelta] protocol mismatch for ${curr.questionId}: ` +
        `${getProtocolVersion(base, campaign)} vs ${getProtocolVersion(curr, campaign)} — delta skipped`,
      );
      continue;
    }
    const delta = computeProbeDelta(base, curr, campaign);
    if (delta) questionDeltas.push(delta);
  }

  const t0 = baseline[0]?.probedAt ? new Date(baseline[0].probedAt).getTime() : Date.now();
  const daysSinceBaseline = Math.round((Date.now() - t0) / (1000 * 60 * 60 * 24));

  return {
    id: `progress-${Date.now()}`,
    campaignId,
    phase,
    probedAt: new Date().toISOString(),
    daysSinceBaseline,
    questionDeltas,
    intentGroupDeltas: protocolMismatch
      ? []
      : computeIntentGroupDeltas(preprocess, baseline, currentProbes, questionDeltas),
    narrative,
    protocolMismatch,
  };
}
