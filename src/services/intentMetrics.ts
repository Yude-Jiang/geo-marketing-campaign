/**
 * Deterministic intent-group metrics from baseline probes (M1: reads scored rail).
 */

import type { GeoFailureCategory } from '../types';
import type {
  IntentGroupDiagnosis,
  IntentGroupMetrics,
  QuestionProbe,
  SeedQuestionPreprocessResult,
} from '../types/campaign';
import { getProbeScoreView, isProbeScoreable } from './probeScoreAccess';

export function computeIntentGroupMetrics(
  groupQuestionIds: string[],
  baselineProbes: QuestionProbe[],
): IntentGroupMetrics {
  const qSet = new Set(groupQuestionIds);
  const groupProbes = baselineProbes.filter(p => qSet.has(p.questionId) && isProbeScoreable(p));

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

  const views = groupProbes.map(p => getProbeScoreView(p)!);

  const stMentionRate =
    views.reduce((s, v) => s + v.stMentionRate, 0) / views.length;
  const avgVoidSeverity =
    views.reduce((s, v) => s + v.voidSeverity, 0) / views.length;
  const criticalVoidCount = views.filter(
    v => v.voidSize === 'critical' || v.voidSeverity >= 8,
  ).length;

  const compCounts = new Map<string, number>();
  for (const v of views) {
    for (const c of v.dominantCompetitors || []) {
      compCounts.set(c, (compCounts.get(c) || 0) + 1);
    }
  }
  const dominantCompetitors = [...compCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  const failCounts = new Map<string, number>();
  for (const v of views) {
    const f = v.primaryFailure || 'UNKNOWN';
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
