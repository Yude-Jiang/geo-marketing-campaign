import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UILang } from '../i18n/translations';
import type { Campaign } from '../types/campaign';
import { enrichIntentDiagnoses } from '../services/intentMetrics';

export type Ecosystem = 'global' | 'cn' | 'jp' | 'kr';

const STORAGE_VERSION = 2;

function clampStep(step: unknown): 1 | 2 {
  return step === 2 ? 2 : 1;
}

function safeProbes(campaign: Campaign): Campaign['probes'] {
  return Array.isArray(campaign.probes) ? campaign.probes : [];
}

function normalizeCampaign(campaign: Campaign | null): Campaign | null {
  if (!campaign) return null;
  if (!campaign.synthesis?.intentDiagnoses?.length || !campaign.preprocess) {
    return { ...campaign, probes: safeProbes(campaign) };
  }
  const baseline = safeProbes(campaign).filter(p => p.phase === 'baseline');
  const needsMetrics = campaign.synthesis.intentDiagnoses.some(
    d => !d.metrics || typeof d.metrics.avgVoidSeverity !== 'number',
  );
  if (!needsMetrics) {
    return { ...campaign, probes: safeProbes(campaign) };
  }
  return {
    ...campaign,
    probes: safeProbes(campaign),
    synthesis: {
      ...campaign.synthesis,
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
      gemini: {
        ...p.gemini,
        simulatedAnswer: (p.gemini?.simulatedAnswer || '').slice(0, 2000),
      },
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
  setCampaign: (campaign: Campaign | null) => void;
  updateCampaign: (patch: Partial<Campaign>) => void;

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
      setCampaign: (campaign) => set({ campaign: normalizeCampaign(campaign) }),
      updateCampaign: (patch) => set((state) => ({
        campaign: state.campaign
          ? normalizeCampaign({ ...state.campaign, ...patch, updatedAt: new Date().toISOString() })
          : null,
      })),

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
          return {
            ...p,
            currentStep: clampStep(p.currentStep),
            campaign: p.campaign ? normalizeCampaign(p.campaign as Campaign) : null,
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
