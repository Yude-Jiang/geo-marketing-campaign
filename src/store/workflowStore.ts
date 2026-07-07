import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UILang } from '../i18n/translations';
import type { Campaign } from '../types/campaign';
import { enrichIntentDiagnoses } from '../services/intentMetrics';
import {
  DEFAULT_FRAMEWORK_ID,
  DEFAULT_FRAMEWORK_VERSION,
  UNASSIGNED_DIMENSION_ID,
} from '../config/intentFramework';
import {
  MAX_RAW_RESPONSE_CHARS,
  PROBE_PROTOCOL_V1,
  PROBE_PROTOCOL_V2,
} from '../config/probeProtocol';

export type Ecosystem = 'global' | 'cn' | 'jp' | 'kr';

const STORAGE_VERSION = 5;

/** Options for setCampaign. `force` overrides freeze protection on a full replace. */
export interface SetCampaignOptions {
  force?: boolean;
}

/**
 * Freeze write-protection. When the current campaign's intent coordinate system
 * is frozen:
 *  • replacing it with a DIFFERENT campaign (re-run Step 1) is blocked unless
 *    { force: true } (the UI gates this behind an explicit confirm — Q5);
 *  • same-campaign updates keep the frozen intent structure (preprocess +
 *    framework binding) — downstream fields (probes, synthesis, snapshots,
 *    status, report) still flow through.
 *
 * NOTE: this is the "strip + warn" interim compromise (REFACTOR-PLAN-01 §3.3).
 * Disabling edits at the UI layer with hard feedback is deferred to the UI knife.
 */
function applyFreezeGuard(
  current: Campaign | null,
  next: Campaign | null,
  opts?: SetCampaignOptions,
): Campaign | null {
  if (!next || !current) return next;
  if (!current.intentFrame?.frozen) return next;

  // Full replace with a new campaign → protect the frozen one from silent loss.
  if (next.id !== current.id) {
    if (opts?.force) return next;
    console.warn(
      '[freeze] blocked replacing a frozen campaign with a new one — ' +
      'baseline + re-probe history would be lost. Pass { force: true } to override.',
    );
    return current;
  }

  // Same campaign, frozen → restore the protected intent structure.
  if (next.preprocess !== current.preprocess) {
    console.warn('[freeze] stripped a mutation to frozen preprocess (questions / dimensions / anchors are frozen).');
  }
  const frame = current.intentFrame;
  return {
    ...next,
    preprocess: current.preprocess,
    intentFrame: next.intentFrame
      ? {
        ...next.intentFrame,
        frameworkId: frame.frameworkId,
        frameworkVersion: frame.frameworkVersion,
        frozen: true,
        frozenAt: frame.frozenAt,
        activeDimensionIds: frame.activeDimensionIds,
        probeProtocolVersion: frame.probeProtocolVersion,
        probeRunsPerModel: frame.probeRunsPerModel,
      }
      : frame,
  };
}

/**
 * v3 → v4 migration: additive defaults only, never fabricate semantics (Q7).
 * Old questions get the surfaced UNASSIGNED dimension (not faked into a real
 * dimension); old campaigns are treated as UNFROZEN.
 */
function migrateCampaignToV4(campaign: unknown): Campaign | null {
  if (!campaign || typeof campaign !== 'object') return campaign as Campaign | null;
  const c = campaign as Record<string, any>;

  const pre = c.preprocess;
  if (pre && Array.isArray(pre.questions)) {
    pre.questions = pre.questions.map((q: any) => ({
      ...q,
      dimensionId: q.dimensionId || UNASSIGNED_DIMENSION_ID,
      anchor: q.anchor
        || (q.expectedAnchor ? { text: q.expectedAnchor, source: null, claimId: null } : undefined),
    }));
    if (!pre.frameworkId) pre.frameworkId = DEFAULT_FRAMEWORK_ID;
    if (!pre.frameworkVersion) pre.frameworkVersion = DEFAULT_FRAMEWORK_VERSION;
  }

  if (!c.intentFrame) {
    c.intentFrame = {
      frameworkId: DEFAULT_FRAMEWORK_ID,
      frameworkVersion: DEFAULT_FRAMEWORK_VERSION,
      frozen: false,
      activeDimensionIds: [],
      probeProtocolVersion: PROBE_PROTOCOL_V1,
      probeRunsPerModel: 1,
    };
  }
  return c as Campaign;
}

/** v4 → v5: probe protocol defaults; never fabricate scored data. */
function migrateCampaignToV5(campaign: unknown): Campaign | null {
  const c = migrateCampaignToV4(campaign);
  if (!c?.intentFrame) return c;
  if (!c.intentFrame.probeProtocolVersion) {
    const hasV2 = c.probes?.some(p => p.scored?.protocolVersion === PROBE_PROTOCOL_V2);
    c.intentFrame.probeProtocolVersion = hasV2 ? PROBE_PROTOCOL_V2 : PROBE_PROTOCOL_V1;
  }
  if (!c.intentFrame.probeRunsPerModel) {
    c.intentFrame.probeRunsPerModel = c.probes?.[0]?.scored?.runsPerModel ?? 1;
  }
  return c;
}

function clampStep(step: unknown): 1 | 2 {
  return step === 2 ? 2 : 1;
}

function safeProbes(campaign: Campaign): Campaign['probes'] {
  return Array.isArray(campaign.probes) ? campaign.probes : [];
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.playName === 'string' && typeof obj.description === 'string') {
      return `${obj.playName}: ${obj.description}`;
    }
    if (typeof obj.description === 'string') return obj.description;
    if (typeof obj.summary === 'string') return obj.summary;
    if (typeof obj.text === 'string') return obj.text;
  }
  return JSON.stringify(value);
}

function normalizeCampaign(campaign: Campaign | null): Campaign | null {
  if (!campaign) return null;
  const normalizedSynthesis = campaign.synthesis
    ? {
      ...campaign.synthesis,
      executiveSummary: toText(campaign.synthesis.executiveSummary),
      innovationPlays: (campaign.synthesis.innovationPlays || []).map(item => toText(item)).filter(Boolean),
    }
    : undefined;
  if (!campaign.synthesis?.intentDiagnoses?.length || !campaign.preprocess) {
    return { ...campaign, probes: safeProbes(campaign), synthesis: normalizedSynthesis };
  }
  const baseline = safeProbes(campaign).filter(p => p.phase === 'baseline');
  const needsMetrics = campaign.synthesis.intentDiagnoses.some(
    d => !d.metrics || typeof d.metrics.avgVoidSeverity !== 'number',
  );
  if (!needsMetrics) {
    return { ...campaign, probes: safeProbes(campaign), synthesis: normalizedSynthesis };
  }
  return {
    ...campaign,
    probes: safeProbes(campaign),
    synthesis: {
      ...normalizedSynthesis!,
      intentDiagnoses: enrichIntentDiagnoses(
        campaign.preprocess,
        baseline,
        campaign.synthesis.intentDiagnoses,
      ),
    },
  };
}

function serializeCampaign(campaign: Campaign | null): Campaign | null {
  if (!campaign) return null;
  const normalized = normalizeCampaign(campaign);
  if (!normalized) return null;
  return {
    ...normalized,
    probes: safeProbes(normalized).map(p => ({
      ...p,
      gemini: p.gemini
        ? {
          ...p.gemini,
          simulatedAnswer: (p.gemini.simulatedAnswer || '').slice(0, 2000),
        }
        : undefined,
      scored: p.scored
        ? {
          ...p.scored,
          attempts: p.scored.attempts.map(a => ({
            ...a,
            rawResponse: (a.rawResponse || '').slice(0, MAX_RAW_RESPONSE_CHARS),
          })),
        }
        : undefined,
    })),
  };
}

export interface WorkflowState {
  targetEcosystem: Ecosystem;
  setTargetEcosystem: (ecosystem: Ecosystem) => void;

  uiLang: UILang;
  setUiLang: (lang: UILang) => void;

  currentStep: 1 | 2;
  setStep: (step: 1 | 2) => void;

  customRegion: string;
  setCustomRegion: (region: string) => void;

  campaign: Campaign | null;
  setCampaign: (campaign: Campaign | null, opts?: SetCampaignOptions) => void;
  updateCampaign: (patch: Partial<Campaign>) => void;
  /** Freeze the intent coordinate system (governance state bit). One-way this knife. */
  freezeIntentFrame: () => void;

  discoveryConfirmed: boolean;
  setDiscoveryConfirmed: (confirmed: boolean) => void;

  selectedPlaybookIds: string[];
  setSelectedPlaybookIds: (ids: string[]) => void;
  togglePlaybookId: (id: string) => void;

  chatHistory: { role: 'user' | 'assistant'; content: string }[];
  addChatMessage: (msg: { role: 'user' | 'assistant'; content: string }) => void;
  clearChatHistory: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set) => ({
      targetEcosystem: 'global',
      setTargetEcosystem: (ecosystem) => set({ targetEcosystem: ecosystem }),

      uiLang: 'en' as UILang,
      setUiLang: (lang) => set({ uiLang: lang }),

      currentStep: 1,
      setStep: (step) => set({ currentStep: clampStep(step) }),

      customRegion: '',
      setCustomRegion: (region) => set({ customRegion: region }),

      campaign: null,
      setCampaign: (campaign, opts) => set((state) => ({
        campaign: normalizeCampaign(applyFreezeGuard(state.campaign, campaign, opts)),
      })),
      updateCampaign: (patch) => set((state) => ({
        campaign: state.campaign
          ? normalizeCampaign(applyFreezeGuard(
            state.campaign,
            { ...state.campaign, ...patch, updatedAt: new Date().toISOString() },
          ))
          : null,
      })),
      freezeIntentFrame: () => set((state) => {
        const cur = state.campaign?.intentFrame;
        if (!state.campaign || !cur || cur.frozen) return {};
        return {
          campaign: {
            ...state.campaign,
            intentFrame: { ...cur, frozen: true, frozenAt: new Date().toISOString() },
          },
        };
      }),

      discoveryConfirmed: false,
      setDiscoveryConfirmed: (confirmed) => set({ discoveryConfirmed: confirmed }),

      selectedPlaybookIds: [],
      setSelectedPlaybookIds: (ids) => set({ selectedPlaybookIds: ids }),
      togglePlaybookId: (id) => set((state) => {
        const has = state.selectedPlaybookIds.includes(id);
        return {
          selectedPlaybookIds: has
            ? state.selectedPlaybookIds.filter(x => x !== id)
            : [...state.selectedPlaybookIds, id],
        };
      }),

      chatHistory: [],
      addChatMessage: (msg) => set((state) => ({ chatHistory: [...state.chatHistory, msg] })),
      clearChatHistory: () => set({ chatHistory: [] }),
    }),
    {
      name: 'geo-campaign-storage',
      version: STORAGE_VERSION,
      migrate: (persisted: unknown, version) => {
        const p = (persisted || {}) as Record<string, unknown>;
        if (version < STORAGE_VERSION) {
          let migrated = p.campaign ? migrateCampaignToV4(p.campaign) : null;
          if (version < 5 && migrated) {
            migrated = migrateCampaignToV5(migrated);
          }
          return {
            ...p,
            currentStep: clampStep(p.currentStep),
            campaign: migrated ? normalizeCampaign(migrated) : null,
          };
        }
        return p;
      },
      partialize: (state) => ({
        targetEcosystem: state.targetEcosystem,
        uiLang: state.uiLang,
        currentStep: clampStep(state.currentStep),
        customRegion: state.customRegion,
        discoveryConfirmed: state.discoveryConfirmed,
        selectedPlaybookIds: state.selectedPlaybookIds,
        chatHistory: state.chatHistory.slice(-20),
        campaign: serializeCampaign(state.campaign),
      }),
      onRehydrateStorage: () => (state, err) => {
        if (err) {
          console.warn('Failed to restore saved workflow state', err);
          return;
        }
        if (!state) return;
        state.currentStep = clampStep(state.currentStep);
        if (state.campaign) {
          state.campaign = normalizeCampaign(state.campaign);
        }
      },
    }
  )
);
