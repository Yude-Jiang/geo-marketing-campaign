/**
 * Deterministic intent-group metrics from baseline probes.
 * LLM synthesis may omit metrics — always compute from probe data.
 */

import type { GeoFailureCategory } from '../types';
import type {
  IntentGroupDiagnosis,
  IntentGroupMetrics,
  QuestionProbe,
  SeedQuestionPreprocessResult,
} from '../types/campaign';

export function computeIntentGroupMetrics(
  groupQuestionIds: string[],
  baselineProbes: QuestionProbe[],
): IntentGroupMetrics {
  const qSet = new Set(groupQuestionIds);
  const groupProbes = baselineProbes.filter(p => qSet.has(p.questionId));

  if (!groupProbes.length) {
    return {
      questionCount: groupQuestionIds.length,
      stMentionRate: 0,
      avgVoidSeverity: 0,
      criticalVoidCount: 0,
      dominantCompetitors: [],
      primaryFailure: 'UNKNOWN',
    };
  }

  const stMentionRate =
    groupProbes.filter(p => p.gemini.stMentioned).length / groupProbes.length;
  const avgVoidSeverity =
    groupProbes.reduce((s, p) => s + (p.gemini.voidSeverity ?? 0), 0) / groupProbes.length;
  const criticalVoidCount = groupProbes.filter(
    p => p.gemini.voidSize === 'critical' || (p.gemini.voidSeverity ?? 0) >= 8,
  ).length;

  const compCounts = new Map<string, number>();
  for (const p of groupProbes) {
    for (const c of p.gemini.dominantCompetitors || []) {
      compCounts.set(c, (compCounts.get(c) || 0) + 1);
    }
  }
  const dominantCompetitors = [...compCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  const failCounts = new Map<string, number>();
  for (const p of groupProbes) {
    const f = p.gemini.primaryFailure || 'UNKNOWN';
    failCounts.set(f, (failCounts.get(f) || 0) + 1);
  }
  const primaryFailure = ([...failCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || 'UNKNOWN') as GeoFailureCategory;

  return {
    questionCount: groupQuestionIds.length,
    stMentionRate,
    avgVoidSeverity,
    criticalVoidCount,
    dominantCompetitors,
    primaryFailure,
  };
}

export function enrichIntentDiagnoses(
  preprocess: SeedQuestionPreprocessResult,
  baselineProbes: QuestionProbe[],
  intentDiagnoses: IntentGroupDiagnosis[],
): IntentGroupDiagnosis[] {
  return preprocess.intentGroups.map(ig => {
    const aiDiag = intentDiagnoses.find(
      d => d.intentGroupId === ig.id || d.label === ig.label,
    );
    const probeIds = baselineProbes
      .filter(p => ig.questionIds.includes(p.questionId))
      .map(p => p.id);
    const metrics = computeIntentGroupMetrics(ig.questionIds, baselineProbes);

    return {
      intentGroupId: ig.id,
      label: ig.label,
      questionIds: ig.questionIds,
      probeIds,
      metrics,
      narrative: aiDiag?.narrative || '',
      failureDiagnosis: aiDiag?.failureDiagnosis,
      recommendedPlaybookIds: aiDiag?.recommendedPlaybookIds,
    };
  });
}
