import React, { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { rerunCampaignProbes } from '../services/campaignPipeline';
import { buildProgressSnapshot } from '../services/probeDelta';
import {
  generateCampaignReportStream,
  generateProgressNarrative,
} from '../services/geminiService';
import type { TranslationKeys } from '../i18n/translations';
import ReportModal from './ReportModal';
import {
  ArrowLeft, Loader2, FileText, RefreshCw, CheckCircle2, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';

const StepCampaignBlueprint: React.FC<{ t: TranslationKeys }> = ({ t }) => {
  const campaign = useWorkflowStore(s => s.campaign);
  const setCampaign = useWorkflowStore(s => s.setCampaign);
  const setStep = useWorkflowStore(s => s.setStep);
  const selectedPlaybookIds = useWorkflowStore(s => s.selectedPlaybookIds);
  const togglePlaybookId = useWorkflowStore(s => s.togglePlaybookId);

  const c = t.campaign;
  const syn = campaign?.synthesis;
  const playbooks = syn?.playbooks || [];

  const [showReport, setShowReport] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isReprobing, setIsReprobing] = useState(false);
  const [expandedIg, setExpandedIg] = useState<string | null>(null);

  if (!campaign || !syn) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p>{c.noCampaign}</p>
        <button onClick={() => setStep(1)} className="mt-4 text-[#3cb4e6] font-bold text-sm">{c.backDiscovery}</button>
      </div>
    );
  }

  const latestProgress = campaign.progressSnapshots?.[campaign.progressSnapshots.length - 1];

  const handleGenerateReport = async () => {
    setReportContent('');
    setIsGeneratingReport(true);
    setShowReport(true);
    try {
      const stream = await generateCampaignReportStream({
        campaign,
        selectedPlaybookIds,
        progressSnapshot: latestProgress,
      });
      for await (const chunk of stream) {
        setReportContent(prev => prev + chunk);
      }
      setCampaign({
        ...campaign,
        reportGeneratedAt: new Date().toISOString(),
        status: 'active',
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleReprobe = async () => {
    setIsReprobing(true);
    try {
      const phase = campaign.progressSnapshots?.length ? 'mid' : 'mid';
      const newProbes = await rerunCampaignProbes(campaign, phase);
      const updatedProbes = [...campaign.probes, ...newProbes];
      const narrative = await generateProgressNarrative(
        campaign,
        buildProgressSnapshot(
          campaign.id,
          phase,
          campaign.preprocess!,
          updatedProbes,
          '',
        ),
      );
      const snapshot = buildProgressSnapshot(
        campaign.id,
        phase,
        campaign.preprocess!,
        updatedProbes,
        narrative,
      );
      setCampaign({
        ...campaign,
        probes: updatedProbes,
        progressSnapshots: [...(campaign.progressSnapshots || []), snapshot],
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsReprobing(false);
    }
  };

  return (
    <>
      <div className="space-y-6 animate-fade-in pb-24">
        <div className="bg-white rounded-2xl p-6 shadow-xl border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setStep(1)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:text-[#03234b]">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-xl font-black uppercase text-[#03234b]">{c.blueprintTitle}</h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#8191a5]">{campaign.topic}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReprobe}
              disabled={isReprobing}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-[#3cb4e6] disabled:opacity-50"
            >
              {isReprobing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {c.reprobeBtn}
            </button>
            <button
              onClick={handleGenerateReport}
              disabled={isGeneratingReport}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#ffd200] to-[#f5c400] text-[#03234b] rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {c.reportBtn}
            </button>
          </div>
        </div>

        {latestProgress && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <h3 className="text-xs font-black uppercase text-emerald-800 mb-2">{c.progressTitle} (Day {latestProgress.daysSinceBaseline})</h3>
            <p className="text-sm text-emerald-900 leading-relaxed">{latestProgress.narrative}</p>
          </div>
        )}

        {syn.intentDiagnoses.map(ig => {
          const stRate = ((ig.metrics?.stMentionRate ?? 0) * 100).toFixed(0);
          const avgVoid = (ig.metrics?.avgVoidSeverity ?? 0).toFixed(1);
          const critical = ig.metrics?.criticalVoidCount ?? 0;
          return (
          <div key={ig.intentGroupId} className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
            <button
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50"
              onClick={() => setExpandedIg(expandedIg === ig.intentGroupId ? null : ig.intentGroupId)}
            >
              <div>
                <h3 className="font-black text-[#03234b]">{ig.label}</h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  ST rate {stRate}% · avg void {avgVoid} · {critical} critical
                </p>
              </div>
              {expandedIg === ig.intentGroupId ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
            {expandedIg === ig.intentGroupId && (
              <div className="px-6 pb-4 text-sm text-slate-600 border-t border-slate-100 pt-4">{ig.narrative}</div>
            )}
          </div>
        );})}

        <div className="space-y-3">
          <h3 className="text-sm font-black uppercase tracking-widest text-[#03234b] flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#ffd200]" /> {c.playbooksTitle}
          </h3>
          {playbooks.map(pb => {
            const selected = selectedPlaybookIds.includes(pb.id);
            return (
              <div
                key={pb.id}
                onClick={() => togglePlaybookId(pb.id)}
                className={`bg-white rounded-2xl p-5 border-2 cursor-pointer transition-all ${selected ? 'border-[#3cb4e6] shadow-lg' : 'border-slate-100 opacity-70'}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'bg-[#3cb4e6] border-[#3cb4e6]' : 'border-slate-300'}`}>
                    {selected && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px] font-black uppercase text-[#3cb4e6]">{pb.tacticsType}</span>
                    <p className="font-bold text-[#03234b] mt-1">{pb.sourceLogic}</p>
                    <p className="text-xs text-slate-500 mt-2">{pb.geoAction}</p>
                    <p className="text-[11px] font-mono bg-slate-50 p-3 rounded-lg mt-3 text-slate-600">{pb.targetSnippet}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {syn.innovationPlays.length > 0 && (
          <div className="bg-[#03234b] rounded-2xl p-6 text-white">
            <h3 className="text-xs font-black uppercase tracking-widest text-[#ffd200] mb-4">{c.innovationTitle}</h3>
            <ul className="space-y-2 text-sm text-white/80">
              {syn.innovationPlays.map((play, i) => (
                <li key={i} className="flex gap-2"><span className="text-[#3cb4e6]">→</span>{play}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        content={reportContent}
        isGenerating={isGeneratingReport}
        t={t}
      />
    </>
  );
};

export default StepCampaignBlueprint;
