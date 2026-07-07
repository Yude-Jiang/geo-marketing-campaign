/**
 * Gemini referee — reads real model transcripts, extracts structured observations.
 * Gemini is the referee, NOT the athlete.
 */

import { Type } from '@google/genai';
import { GEMINI_MODELS } from '../config/models';
import { formatAliasTableForReferee } from '../config/probeProtocol';
import type { SemanticAnchor } from '../types/campaign';
import type { ModelProbeAttempt, RefereeObservation } from '../types/probe';
import { getGenAI, withRetry } from './geminiService';

const refereeSchema = {
  type: Type.OBJECT,
  properties: {
    observations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          attemptId: { type: Type.STRING },
          modelId: { type: Type.STRING },
          runIndex: { type: Type.NUMBER },
          stMentioned: { type: Type.BOOLEAN },
          stMentionForm: { type: Type.STRING },
          stBindingStrength: { type: Type.STRING },
          dominantCompetitors: { type: Type.ARRAY, items: { type: Type.STRING } },
          primaryFailure: { type: Type.STRING },
          anchorStatus: { type: Type.STRING },
          evidenceQuotes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                field: { type: Type.STRING },
                quote: { type: Type.STRING },
              },
              required: ['field', 'quote'],
            },
          },
        },
        required: [
          'attemptId', 'modelId', 'runIndex', 'stMentioned', 'stMentionForm',
          'stBindingStrength', 'dominantCompetitors', 'primaryFailure', 'evidenceQuotes',
        ],
      },
    },
  },
  required: ['observations'],
};

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1)) as T;
    }
    throw new SyntaxError('No parseable JSON in referee output');
  }
}

const VALID_FORMS = new Set(['none', 'company', 'product_line', 'sub_brand']);
const VALID_BINDINGS = new Set(['none', 'weak', 'strong']);
const VALID_FAILURES = new Set([
  'CORPUS_ABSENCE', 'ATTRIBUTE_MISMATCH', 'BURIED_ANSWER', 'COMPETITOR_DOMINANCE',
  'SEMANTIC_IRRELEVANCE', 'OUTDATED_CONTENT', 'TRUST_CREDIBILITY', 'STRUCTURAL_WEAKNESS', 'UNKNOWN',
]);

function normalizeObservation(raw: RefereeObservation): RefereeObservation {
  return {
    ...raw,
    stMentionForm: VALID_FORMS.has(raw.stMentionForm) ? raw.stMentionForm : 'none',
    stBindingStrength: VALID_BINDINGS.has(raw.stBindingStrength)
      ? raw.stBindingStrength : 'none',
    primaryFailure: VALID_FAILURES.has(raw.primaryFailure)
      ? raw.primaryFailure : 'UNKNOWN',
    dominantCompetitors: Array.isArray(raw.dominantCompetitors) ? raw.dominantCompetitors : [],
    evidenceQuotes: Array.isArray(raw.evidenceQuotes) ? raw.evidenceQuotes : [],
    stMentioned: !!raw.stMentioned,
  };
}

export async function refereeExtractObservations(
  questionText: string,
  attempts: ModelProbeAttempt[],
  anchor?: SemanticAnchor,
): Promise<RefereeObservation[]> {
  const successful = attempts.filter(a => !a.error && a.rawResponse?.trim());
  if (!successful.length) return [];

  const transcriptBlock = successful.map(a =>
    `--- attemptId: ${a.id} | model: ${a.modelId} | run: ${a.runIndex} ---\n${a.rawResponse}`,
  ).join('\n\n');

  const anchorBlock = anchor?.text
    ? `ANCHOR (post-hoc check only — was this cited in the response?):\n${anchor.text}`
    : 'ANCHOR: none';

  const prompt = `You are a REFEREE reading real AI model transcripts. You are NOT simulating answers.

QUESTION (what was asked — do not add context):
${questionText}

${anchorBlock}

ST BRAND ALIAS TABLE (for classifying mention form — only if text literally matches):
${formatAliasTableForReferee()}

MENTION FORM rules:
- none: ST not mentioned
- company: only corporate name (ST / STMicroelectronics / 意法半导体)
- product_line: product family (STM32, STM8, etc.) without specific part number
- sub_brand: specific part/series (STM32H7, STM32C0, etc.)
Mention form can be higher specificity than a bare mention — "提及≠正确定位".

TRANSCRIPTS:
${transcriptBlock}

For EACH transcript, output one observation object:
- stMentioned / stMentionForm / stBindingStrength / dominantCompetitors / primaryFailure / anchorStatus
- evidenceQuotes: REQUIRED for every non-trivial field — each quote MUST be an EXACT substring copied from that transcript
- dominantCompetitors: ONLY names that literally appear in that transcript
- Do NOT invent competitors or ST mentions not in the text

Return JSON only.`;

  const result = await withRetry(() =>
    getGenAI().models.generateContent({
      model: GEMINI_MODELS.analysis,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: refereeSchema as any,
      },
    }),
  );

  let parsed: { observations: RefereeObservation[] };
  try {
    parsed = parseJson(result.text || '{}');
  } catch (firstErr) {
    console.warn('[referee] parse failed, attempting repair', firstErr);
    const repair = await getGenAI().models.generateContent({
      model: GEMINI_MODELS.analysis,
      contents: [{ role: 'user', parts: [{ text:
        `Fix to valid JSON only:\n\n${(result.text || '').slice(0, 12000)}` }] }],
      config: { responseMimeType: 'application/json', responseSchema: refereeSchema as any },
    });
    parsed = parseJson(repair.text || '{}');
  }

  const attemptIds = new Set(successful.map(a => a.id));
  return (parsed.observations || [])
    .filter(o => attemptIds.has(o.attemptId))
    .map(normalizeObservation);
}
