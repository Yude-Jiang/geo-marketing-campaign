/**
 * Gemini client utilities for the Campaign pipeline.
 * CN model probes: multiModelService + /api/multi-model-probe
 */

import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODELS } from '../config/models';

export const getGenAI = () => {
  const apiKey = (window as any).env?.VITE_GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'API key is missing. Set VITE_GEMINI_API_KEY in .env.local (dev) or as an environment variable on the server (production).',
    );
  }
  return new GoogleGenAI({ apiKey });
};

export const parseRetrySeconds = (err: any): number | null => {
  try {
    const raw = typeof err?.message === 'string' ? JSON.parse(err.message) : err;
    const details = raw?.error?.details || [];
    for (const d of details) {
      if (d?.retryDelay) {
        const match = String(d.retryDelay).match(/([\d.]+)/);
        if (match) return Math.ceil(parseFloat(match[1]));
      }
    }
    const inner = raw?.error?.message || raw?.message || '';
    const match = inner.match(/retry in ([\d.]+)s/i);
    if (match) return Math.ceil(parseFloat(match[1]));
  } catch { /* non-fatal */ }
  return null;
};

const is429 = (err: any): boolean => {
  try {
    const raw = typeof err?.message === 'string' ? JSON.parse(err.message) : err;
    return raw?.error?.code === 429 || raw?.error?.status === 'RESOURCE_EXHAUSTED';
  } catch { return false; }
};

export const withTimeout = <T>(
  fn: () => Promise<T>,
  ms = 90_000,
  label = 'request',
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s: ${label}`)),
      ms,
    );
    fn().then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
};

export const withRetry = async <T>(
  fn: () => Promise<T>,
  onCountdown?: (secondsLeft: number) => void,
  maxRetries = 3,
): Promise<T> => {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (is429(err) && attempt < maxRetries) {
        const seconds = parseRetrySeconds(err) || 60;
        for (let s = seconds; s > 0; s--) {
          onCountdown?.(s);
          await new Promise(r => setTimeout(r, 1000));
        }
        onCountdown?.(0);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
};

export const fetchUrlContent = async (url: string) => {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = '';
    try { detail = JSON.parse(body).error; } catch { detail = body; }
    throw new Error(detail || `Fetch failed (${res.status})`);
  }
  const text = await res.text();
  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const bodyStart = text.indexOf('\n\n');
  const body = bodyStart !== -1 ? text.slice(bodyStart).trim() : text;
  return { title, content: text, body, wordCount: body.split(/\s+/).filter(Boolean).length };
};

export const chatWithAssistant = async (
  message: string,
  history: { role: string; content: string }[],
  contextData: unknown,
  uiLang: string,
) => {
  const response = await getGenAI().models.generateContent({
    model: GEMINI_MODELS.chat,
    contents: [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ],
    config: {
      systemInstruction: `Expert GEO Campaign Assistant. UI Lang: ${uiLang}. Context: ${JSON.stringify(contextData)}`,
    },
  });
  return response.text;
};

// ─── Campaign Report ─────────────────────────────────────────────────────────

export interface CampaignReportParams {
  campaign: import('../types/campaign').Campaign;
  selectedPlaybookIds?: string[];
  progressSnapshot?: import('../types/campaign').CampaignProgressSnapshot;
}

function buildCampaignReportPrompt(p: CampaignReportParams): string {
  const c = p.campaign;
  const syn = c.synthesis;
  const probes = c.probes.filter(pr => pr.phase === 'baseline');
  const playbooks = syn?.playbooks.filter(pb =>
    !p.selectedPlaybookIds?.length || p.selectedPlaybookIds.includes(pb.id),
  ) ?? [];

  let data = `
CAMPAIGN TOPIC: ${c.topic}
DURATION: ${c.duration}
ECOSYSTEM: ${c.ecosystem} | REGION: ${c.region || 'Global'}
UI LANGUAGE: ${c.uiLang}

EXECUTIVE SUMMARY:
${syn?.executiveSummary || 'N/A'}

BRIEF DRAFT:
${JSON.stringify(syn?.brief, null, 2).slice(0, 8000)}

INTENT GROUP DIAGNOSES:
${JSON.stringify(syn?.intentDiagnoses, null, 2).slice(0, 6000)}

SELECTED PLAYBOOKS (${playbooks.length}):
${playbooks.map((pb, i) => `${i + 1}. [${pb.tacticsType}] ${pb.geoAction}\n   Snippet: ${pb.targetSnippet}`).join('\n')}

INNOVATION PLAYS:
${(syn?.innovationPlays || []).join('\n')}

T0 PROBE BASELINE:
${probes.map(pr => `- Q: ${pr.questionText}
  ST: ${pr.gemini.stBindingStrength} | void: ${pr.gemini.voidSize} (${pr.gemini.voidSeverity}/10)
  Competitors: ${pr.gemini.dominantCompetitors.join(', ')}
  Failure: ${pr.gemini.primaryFailure}`).join('\n')}
`;

  if (p.progressSnapshot) {
    data += `
PROGRESS (day ${p.progressSnapshot.daysSinceBaseline}):
${JSON.stringify(p.progressSnapshot.questionDeltas, null, 2)}
${JSON.stringify(p.progressSnapshot.intentGroupDeltas, null, 2)}
`;
  }

  return `ROLE: Senior GEO Campaign Strategist at STMicroelectronics.
TASK: Generate a GEO Marketing Campaign Report in TWO formats (%%MD_START%%...%%MD_END%% and %%HTML_BODY_START%%...%%HTML_BODY_END%%).
OUTPUT LANGUAGE: [${c.uiLang}] only. Campaign plan only — no full blog articles.

SECTIONS: Executive Overview, Brief Summary, GEO Cognitive Baseline table, Intent Analysis, Channel & Timeline, Phase KPIs (GEO only), Playbook Cards, Innovation Lab${p.progressSnapshot ? ', Progress Evidence' : ''}.

DATA:
${data}`;
}

export const generateCampaignReportStream = async (params: CampaignReportParams) => {
  const prompt = buildCampaignReportPrompt(params);
  const response = await getGenAI().models.generateContentStream({
    model: GEMINI_MODELS.contentGen,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  async function* stream() {
    for await (const chunk of response) {
      if (chunk.text) yield chunk.text;
    }
  }
  return stream();
};

export const generateProgressNarrative = async (
  campaign: import('../types/campaign').Campaign,
  snapshot: import('../types/campaign').CampaignProgressSnapshot,
): Promise<string> => {
  const res = await getGenAI().models.generateContent({
    model: GEMINI_MODELS.contentGen,
    contents: [{
      role: 'user',
      parts: [{ text: `Write 2-3 paragraphs interpreting campaign GEO probe progress for executives.
Language: ${campaign.uiLang}
Topic: ${campaign.topic}
Days since baseline: ${snapshot.daysSinceBaseline}
Question deltas: ${JSON.stringify(snapshot.questionDeltas)}
Intent group deltas: ${JSON.stringify(snapshot.intentGroupDeltas)}
Focus on ST binding improvements and void reduction as campaign effect evidence.` }],
    }],
  });
  return res.text || '';
};
