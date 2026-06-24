import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UILang } from '../i18n/translations';
import type { Campaign } from '../types/campaign';

export type Ecosystem = 'global' | 'cn' | 'jp' | 'kr';

export interface WorkflowState {
  targetEcosystem: Ecosystem;
  setTargetEcosystem: (ecosystem: Ecosystem) => void;

  uiLang: UILang;
  setUiLang: (lang: UILang) => void;

  currentStep: 1 | 2;
  setStep: (step: 1 | 2) => void;

  customRegion: string;
  setCustomRegion: (region: string) => void;

  /** Active campaign (discovery → blueprint → report) */
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
      setStep: (step) => set({ currentStep: step }),

      customRegion: '',
      setCustomRegion: (region) => set({ customRegion: region }),

      campaign: null,
      setCampaign: (campaign) => set({ campaign }),
      updateCampaign: (patch) => set((state) => ({
        campaign: state.campaign ? { ...state.campaign, ...patch, updatedAt: new Date().toISOString() } : null,
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
      partialize: (state) => ({
        ...state,
        chatHistory: state.chatHistory.slice(-20),
        // Cap probe simulated answers in localStorage
        campaign: state.campaign ? {
          ...state.campaign,
          probes: state.campaign.probes.map(p => ({
            ...p,
            gemini: {
              ...p.gemini,
              simulatedAnswer: p.gemini.simulatedAnswer.slice(0, 2000),
            },
          })),
        } : null,
      }),
    }
  )
);
