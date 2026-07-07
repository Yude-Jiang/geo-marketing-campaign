/**
 * Probe protocol registry — version constants, ST alias table, defaults.
 */

import type { ModelId } from '../services/multiModelService';
import type { ProbeProtocolVersion, StMentionForm } from '../types/probe';

export const PROBE_PROTOCOL_V1: ProbeProtocolVersion = 'v1-simulated-guided';
export const PROBE_PROTOCOL_V2: ProbeProtocolVersion = 'v2-real-probe';
export const CURRENT_PROBE_PROTOCOL = PROBE_PROTOCOL_V2;
export const DEFAULT_RUNS_PER_MODEL = 2;

export const PROBE_MODEL_IDS: ModelId[] = ['deepseek', 'qwen', 'doubao', 'kimi'];

export const MAX_RAW_RESPONSE_CHARS = 8000;
export const PROMPT_AUDIT_MAX_CHARS = 500;

export interface StAliasEntry {
  form: Exclude<StMentionForm, 'none'>;
  patterns: string[];
}

/** Referee dictionary — NOT injected into probe prompts. */
export const ST_ALIAS_TABLE: StAliasEntry[] = [
  {
    form: 'company',
    patterns: ['STMicroelectronics', 'STMicro', 'ST', '意法半导体', '意法'],
  },
  {
    form: 'product_line',
    patterns: ['STM32', 'STM8', 'Stellar', 'STPOWER', 'SPC5', 'BlueNRG', 'STM32MP'],
  },
  {
    form: 'sub_brand',
    patterns: ['STM32H7', 'STM32C0', 'STM32U5', 'STM32F4', 'STM32G0', 'STM32WL'],
  },
];

/** Specificity order for dominant form aggregation. */
export const MENTION_FORM_RANK: Record<StMentionForm, number> = {
  none: 0,
  company: 1,
  product_line: 2,
  sub_brand: 3,
};

export function formatAliasTableForReferee(): string {
  return ST_ALIAS_TABLE.map(
    e => `- ${e.form}: ${e.patterns.join(', ')}`,
  ).join('\n');
}
