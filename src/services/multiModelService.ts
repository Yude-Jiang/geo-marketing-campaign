/**
 * Multi-Model Probe Service (M1: zero-hint real probes)
 *
 * Calls DeepSeek, Qwen, Doubao, Kimi via server-side proxy.
 * Probe prompts contain ONLY the question + language hint — no brand/topic/anchor.
 */

import {
  DEFAULT_RUNS_PER_MODEL,
  MAX_RAW_RESPONSE_CHARS,
  PROMPT_AUDIT_MAX_CHARS,
  PROBE_MODEL_IDS,
} from '../config/probeProtocol';
import type { ModelProbeAttempt } from '../types/probe';

export type ModelId = 'deepseek' | 'qwen' | 'doubao' | 'kimi';

const MODEL_NAMES: Record<ModelId, string> = {
  deepseek: 'DeepSeek Chat',
  qwen: '通义千问 Qwen-Plus',
  doubao: '豆包 Doubao',
  kimi: 'Kimi (Moonshot)',
};

/** @deprecated Legacy hub verification — guided prompt, not used in v2 pipeline. */
export interface ModelSnapshot {
  modelId: ModelId;
  modelName: string;
  rawResponse: string;
  keyEntities: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  latencyMs: number;
  error?: string;
}

/** @deprecated Replaced by ScoredProbeSnapshot in v2 pipeline. */
export interface MultiModelVerificationResult {
  snapshots: ModelSnapshot[];
  consensusLevel: 'full' | 'partial' | 'divergent' | 'insufficient';
  consensusSummary: string;
  verifiedAt: string;
}

function newAttemptId(modelId: ModelId, runIndex: number) {
  return `att-${Date.now()}-${modelId}-r${runIndex}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Zero-hint probe prompt — question text + language only. */
export function buildZeroHintProbePrompt(questionText: string, uiLang: string): string {
  const langHint = uiLang === 'zh'
    ? '请用中文回答。'
    : uiLang === 'jp'
      ? '日本語で答えてください。'
      : 'Please answer in English.';
  return `${langHint}\n${questionText.slice(0, 800)}`;
}

async function callViaProxy(
  modelId: ModelId,
  prompt: string,
  timeoutMs = 20000,
): Promise<{ rawResponse: string; latencyMs: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/multi-model-probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, prompt, temperature: 0.3 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { rawResponse: '', latencyMs: 0, error: err.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    const raw = (data.rawResponse || '').slice(0, MAX_RAW_RESPONSE_CHARS);
    return { rawResponse: raw, latencyMs: data.latencyMs || 0, error: data.error };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    return {
      rawResponse: '',
      latencyMs: 0,
      error: isTimeout ? 'Request timeout' : (err?.message || 'Network error'),
    };
  }
}

export async function runSingleModelProbe(
  modelId: ModelId,
  prompt: string,
  runIndex: number,
): Promise<ModelProbeAttempt> {
  const t0 = Date.now();
  const result = await callViaProxy(modelId, prompt);
  return {
    id: newAttemptId(modelId, runIndex),
    modelId,
    runIndex,
    promptText: prompt.slice(0, PROMPT_AUDIT_MAX_CHARS),
    rawResponse: result.rawResponse,
    probedAt: new Date().toISOString(),
    latencyMs: result.latencyMs || (Date.now() - t0),
    error: result.error,
  };
}

export interface RunZeroHintProbesOptions {
  runsPerModel?: number;
  uiLang: string;
  onAttemptComplete?: (completed: number, total: number) => void;
}

/**
 * Run N zero-hint probes per model for one question.
 * Concurrency: all 4 models in parallel per run; runs serial per question.
 */
export async function runZeroHintProbes(
  questionText: string,
  opts: RunZeroHintProbesOptions,
): Promise<ModelProbeAttempt[]> {
  const runsPerModel = opts.runsPerModel ?? DEFAULT_RUNS_PER_MODEL;
  const prompt = buildZeroHintProbePrompt(questionText, opts.uiLang);
  const attempts: ModelProbeAttempt[] = [];
  const total = PROBE_MODEL_IDS.length * runsPerModel;
  let completed = 0;

  for (let runIndex = 0; runIndex < runsPerModel; runIndex++) {
    const batch = await Promise.all(
      PROBE_MODEL_IDS.map(modelId => runSingleModelProbe(modelId, prompt, runIndex)),
    );
    for (const att of batch) {
      attempts.push(att);
      completed++;
      opts.onAttemptComplete?.(completed, total);
    }
  }

  return attempts;
}

/** @deprecated Hub-era guided verification — not used in campaign pipeline. */
export async function runMultiModelVerification(
  seedText: string,
  uiLang: string,
): Promise<MultiModelVerificationResult> {
  const langHint = uiLang === 'zh' ? '请用中文回答。' : 'Please answer in English.';
  const probe = `${langHint}\n"${seedText.slice(0, 300)}"`;
  const snapshots = await Promise.all(
    PROBE_MODEL_IDS.map(id => runSingleModelProbe(id, probe, 0).then(a => ({
      modelId: id,
      modelName: MODEL_NAMES[id],
      rawResponse: a.rawResponse,
      keyEntities: [],
      sentiment: 'neutral' as const,
      latencyMs: a.latencyMs,
      error: a.error,
    }))),
  );
  const ok = snapshots.filter(s => !s.error && s.rawResponse);
  return {
    snapshots,
    consensusLevel: ok.length >= 2 ? 'partial' : 'insufficient',
    consensusSummary: `${ok.length}/${snapshots.length} models responded`,
    verifiedAt: new Date().toISOString(),
  };
}

/** @deprecated Use runZeroHintProbes — guided prompt removed in M1. */
export async function runMultiModelVerificationForQuestion(
  questionText: string,
  _campaignTopic: string,
  uiLang: string,
): Promise<MultiModelVerificationResult> {
  const attempts = await runZeroHintProbes(questionText, { uiLang, runsPerModel: 1 });
  const snapshots: ModelSnapshot[] = attempts.map(a => ({
    modelId: a.modelId,
    modelName: MODEL_NAMES[a.modelId],
    rawResponse: a.rawResponse,
    keyEntities: [],
    sentiment: 'neutral',
    latencyMs: a.latencyMs,
    error: a.error,
  }));
  const ok = snapshots.filter(s => !s.error && s.rawResponse);
  return {
    snapshots,
    consensusLevel: ok.length >= 2 ? 'partial' : 'insufficient',
    consensusSummary: `${ok.length}/${snapshots.length} models responded`,
    verifiedAt: new Date().toISOString(),
  };
}
