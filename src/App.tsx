import React from 'react';
import { useWorkflowStore } from './store/workflowStore';
import type { Ecosystem } from './store/workflowStore';
import type { UILang } from './i18n/translations';
import { translations } from './i18n/translations';
import { Globe, Target, FileBarChart, Cpu, Languages } from 'lucide-react';
import StepCampaignDiscovery from './components/StepCampaignDiscovery';
import StepCampaignBlueprint from './components/StepCampaignBlueprint';
import ChatAssistant from './components/ChatAssistant';

const App: React.FC = () => {
  const {
    currentStep, targetEcosystem, setTargetEcosystem, setStep,
    discoveryConfirmed, uiLang, setUiLang,
  } = useWorkflowStore();
  const t = translations[uiLang] ?? translations.en;
  const activeStep = currentStep === 2 ? 2 : 1;

  const ecosystems: { id: Ecosystem; label: string }[] = [
    { id: 'global', label: t.ecosystems.global },
    { id: 'cn',     label: t.ecosystems.cn },
    { id: 'jp',     label: t.ecosystems.jp },
    { id: 'kr',     label: t.ecosystems.kr },
  ];

  const uiLangs: { id: UILang; label: string }[] = [
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'EN' },
    { id: 'jp', label: '日本語' },
  ];

  const canGoToStep = (step: number) => {
    if (step === 1) return true;
    if (step === 2) return discoveryConfirmed;
    return false;
  };

  const handleStepClick = (step: 1 | 2) => {
    if (canGoToStep(step)) setStep(step);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans" data-lang={uiLang}>
      <header className="bg-[#03234b] text-white shadow-xl z-20 sticky top-0">
        <div className="max-w-[98%] mx-auto px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="bg-[#3cb4e6] p-1.5 rounded-sm shadow-inner">
              <Cpu className="w-5 h-5 text-[#03234b]" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-base font-black tracking-tight leading-tight u-page-title">{t.appTitle}</h1>
              <p className="u-caption">{t.appSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center bg-[#2a4060] rounded p-0.5 border border-[#8191a5]/20">
              <Languages className="w-3.5 h-3.5 text-[#8191a5] mx-1.5" />
              {uiLangs.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setUiLang(l.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                    uiLang === l.id
                      ? 'bg-white text-[#03234b] shadow-sm'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <div className="flex items-center bg-[#425a78] rounded p-0.5 border border-[#8191a5]/30">
              <div className="px-2 u-eyebrow text-[#c0c8d2] flex items-center gap-1 border-r border-[#8191a5]/30 mr-0.5 pr-2">
                <Globe className="w-3 h-3" /> {t.ecosystemLabel}
              </div>
              {ecosystems.map((eco) => (
                <button
                  key={eco.id}
                  onClick={() => setTargetEcosystem(eco.id as Ecosystem)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                    targetEcosystem === eco.id
                      ? 'bg-[#ffd200] text-[#03234b] shadow-md scale-105'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {eco.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-slate-200 py-5 shadow-sm z-10 relative">
        <div className="max-w-xl mx-auto px-4">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-[25%] right-[25%] h-0.5 bg-slate-100 -translate-y-1/2 z-0" />
            <div
              className="absolute top-1/2 left-[25%] h-0.5 bg-[#3cb4e6] -translate-y-1/2 z-0 transition-all duration-700"
              style={{ width: activeStep === 2 ? '50%' : '0%' }}
            />
            {[
              { num: 1 as const, label: t.steps.discovery, icon: Target },
              { num: 2 as const, label: t.steps.blueprint, icon: FileBarChart },
            ].map((stepItem) => {
              const isActive = activeStep === stepItem.num;
              const isPast = activeStep > stepItem.num;
              const canClick = canGoToStep(stepItem.num);
              return (
                <div key={stepItem.num} className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-6">
                  <button
                    onClick={() => handleStepClick(stepItem.num)}
                    disabled={!canClick && !isActive}
                    className={`w-11 h-11 rounded-full flex items-center justify-center font-bold transition-all ${
                      isActive ? 'bg-[#03234b] text-white shadow-lg ring-4 ring-[#3cb4e6]/20'
                      : isPast  ? 'bg-[#3cb4e6] text-white cursor-pointer'
                      : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    }`}
                  >
                    <stepItem.icon className="w-5 h-5" />
                  </button>
                  <span className={`text-[11px] font-bold ${
                    isActive ? 'text-[#03234b]' : isPast ? 'text-[#3cb4e6]' : 'text-slate-300'
                  }`}>
                    {stepItem.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <main className="flex-1 w-full max-w-[95%] mx-auto px-4 py-8">
        {activeStep === 1 && <StepCampaignDiscovery t={t} />}
        {activeStep === 2 && <StepCampaignBlueprint t={t} />}
      </main>

      <footer className="border-t border-slate-200 py-6 text-center bg-white">
        <p className="u-caption text-center">{t.footer}</p>
      </footer>

      <ChatAssistant />
    </div>
  );
};

export default App;
