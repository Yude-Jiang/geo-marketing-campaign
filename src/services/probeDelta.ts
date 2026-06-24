/**
 * Deterministic GEO probe delta calculations (Track A only).
 */

import type {
  CampaignProgressSnapshot,
  IntentGroupDelta,
  ProbeDelta,
  ProbePhase,
  QuestionProbe,
  SeedQuestionPreprocessResult,
} from '../types/campaign';

export function computeProbeDelta(from: QuestionProbe, to: QuestionProbe): ProbeDelta {
  const g0 = from.gemini;
  const g1 = to.gemini;
  return {
    questionId: from.questionId,
    questionText: from.questionText,
    fromProbeId: from.id,
    toProbeId: to.id,
    stBindingDelta: `${g0.stBindingStrength} → ${g1.stBindingStrength}`,
    voidSizeDelta: `${g0.voidSize} → ${g1.voidSize}`,
    voidSeverityDelta: g1.voidSeverity - g0.voidSeverity,
    anchorStatusDelta: g0.anchorStatus && g1.anchorStatus
      ? `${g0.anchorStatus} → ${g1.anchorStatus}` : undefined,
    failureCategoryChanged: g0.primaryFailure !== g1.primaryFailure,
    competitorsDelta: `${g0.dominantCompetitors.slice(0, 3).join(', ')} → ${g1.dominantCompetitors.slice(0, 3).join(', ')}`,
    multiModelConsensusDelta:
      from.multiModel && to.multiModel
        ? `${from.multiModel.consensusLevel} → ${to.multiModel.consensusLevel}`
        : undefined,
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
    const base = baselineProbes.filter(p => qIds.has(p.questionId));
    const curr = currentProbes.filter(p => qIds.has(p.questionId));
    const stRate0 = base.length ? base.filter(p => p.gemini.stMentioned).length / base.length : 0;
    const stRate1 = curr.length ? curr.filter(p => p.gemini.stMentioned).length / curr.length : 0;
    const avg0 = base.length ? base.reduce((s, p) => s + p.gemini.voidSeverity, 0) / base.length : 0;
    const avg1 = curr.length ? curr.reduce((s, p) => s + p.gemini.voidSeverity, 0) / curr.length : 0;
    const improved = questionDeltas.filter(
      d => qIds.has(d.questionId) && d.voidSeverityDelta < 0
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

  const questionDeltas: ProbeDelta[] = [];
  for (const curr of currentProbes) {
    const base = baselineByQ.get(curr.questionId);
    if (base) questionDeltas.push(computeProbeDelta(base, curr));
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
    intentGroupDeltas: computeIntentGroupDeltas(preprocess, baseline, currentProbes, questionDeltas),
    narrative,
  };
}
