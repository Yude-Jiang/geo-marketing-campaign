import React, { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { runCampaignPipeline } from '../services/campaignPipeline';
import type { CampaignPipelineProgress } from '../types/campaign';
import type { TranslationKeys } from '../i18n/translations';
import { Loader2, Search, ChevronRight, AlertCircle, Target, Layers } from 'lucide-react';

const STAGE_LABELS: Record<string, string> = {
  preprocess: 'Classifying questions…',
  probe_questions: 'Running cognitive probes…',
  multi_model_verify: 'CN model verification…',
  synthesize_campaign: 'Synthesizing campaign plan…',
  done: 'Complete',
};

const StepCampaignDiscovery: React.FC<{ t: TranslationKeys }> = ({ t }) => {
  const uiLang = useWorkflowStore(s => s.uiLang);
  const ecosystem = useWorkflowStore(s => s.targetEcosystem);
  const region = useWorkflowStore(s => s.customRegion);
  const campaign = useWorkflowStore(s => s.campaign);
  const setCampaign = useWorkflowStore(s => s.setCampaign);
  const setDiscoveryConfirmed = useWorkflowStore(s => s.setDiscoveryConfirmed);
  const setSelectedPlaybookIds = useWorkflowStore(s => s.setSelectedPlaybookIds);
  const setStep = useWorkflowStore(s => s.setStep);
  const setCustomRegion = useWorkflowStore(s => s.setCustomRegion);

  const c = t.campaign;

  const [topic, setTopic] = useState(campaign?.topic || '');
  const [questions, setQuestions] = useState(
    campaign?.input.seedQuestions?.join('\n') || ''
  );
  const [urls, setUrls] = useState(campaign?.input.sourceUrls?.join('\n') || '');
  const [duration, setDuration] = useState<'30d' | '90d' | 'quarter'>(
    (campaign?.duration as '30d' | '90d' | 'quarter') || '90d'
  );
  const [regionInput, setRegionInput] = useState(region);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<CampaignPipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setProgress(null);
    setCustomRegion(regionInput);

    try {
      const result = await runCampaignPipeline({
        input: {
          topic: topic.trim(),
          seedQuestions: questions.split('\n').map(q => q.trim()).filter(Boolean),
          sourceUrls: urls.split('\n').map(u => u.trim()).filter(Boolean),
          duration,
        },
        ecosystem,
        region: regionInput,
        uiLang,
        onProgress: setProgress,
      });
      setCampaign(result);
      const p0 = result.synthesis?.playbooks
        .filter(pb => pb.effortTier !== 'L')
        .map(pb => pb.id) || [];
      setSelectedPlaybookIds(p0.length ? p0 : result.synthesis?.playbooks.map(pb => pb.id) || []);
    } catch (err: any) {
      setError(err?.message || c.errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!campaign?.synthesis) return;
    setDiscoveryConfirmed(true);
    setStep(2);
  };

  const probes = campaign?.probes.filter(p => p.phase === 'baseline') || [];
  const groups = campaign?.preprocess?.intentGroups || [];

  return (
    <div className="space-y-6 animate-fade-in pb-24 max-w-5xl mx-auto">
      <div className="bg-white rounded-2xl p-8 shadow-xl border border-slate-100">
        <h2 className="text-2xl font-black text-[#03234b] uppercase tracking-tight flex items-center gap-3">
          <Target className="w-6 h-6 text-[#3cb4e6]" /> {c.discoveryTitle}
        </h2>
        <p className="text-slate-500 text-sm mt-2">{c.discoverySubtitle}</p>

        <div className="mt-8 space-y-5">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-[#8191a5]">{c.topicLabel}</label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder={c.topicPlaceholder}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#03234b] focus:border-[#3cb4e6] outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-[#8191a5]">{c.questionsLabel}</label>
            <textarea
              value={questions}
              onChange={e => setQuestions(e.target.value)}
              placeholder={c.questionsPlaceholder}
              rows={6}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono text-[#03234b] focus:border-[#3cb4e6] outline-none resize-y"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-[#8191a5]">{c.urlsLabel}</label>
              <textarea
                value={urls}
                onChange={e => setUrls(e.target.value)}
                placeholder={c.urlsPlaceholder}
                rows={3}
                className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-xs focus:border-[#3cb4e6] outline-none"
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-[#8191a5]">{c.regionLabel}</label>
                <input
                  value={regionInput}
                  onChange={e => setRegionInput(e.target.value)}
                  placeholder={c.regionPlaceholder}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#3cb4e6] outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-[#8191a5]">{c.durationLabel}</label>
                <select
                  value={duration}
                  onChange={e => setDuration(e.target.value as typeof duration)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#03234b] outline-none"
                >
                  <option value="30d">30 days</option>
                  <option value="90d">90 days</option>
                  <option value="quarter">Quarter</option>
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-3 text-[#3cb4e6] text-sm font-bold">
              <Loader2 className="w-5 h-5 animate-spin" />
              {progress?.detail || STAGE_LABELS[progress?.stage || 'preprocess']}
              {progress?.totalQuestions ? ` (${progress.completedQuestions ?? 0}/${progress.totalQuestions})` : ''}
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={loading || !topic.trim()}
            className="w-full bg-[#03234b] text-white font-black uppercase tracking-widest py-4 rounded-xl hover:bg-[#0a3d7a] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            {loading ? c.runningBtn : c.runBtn}
          </button>
        </div>
      </div>

      {campaign?.synthesis && (
        <>
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
            <h3 className="text-sm font-black uppercase tracking-widest text-[#03234b] mb-3">{c.execSummary}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{campaign.synthesis.executiveSummary}</p>
          </div>

          {groups.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#03234b] mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#ffd200]" /> {c.intentGroupsTitle}
              </h3>
              <div className="flex flex-wrap gap-2">
                {groups.map(g => (
                  <span key={g.id} className="px-3 py-1.5 bg-[#3cb4e6]/10 text-[#03234b] text-xs font-bold rounded-full border border-[#3cb4e6]/20">
                    {g.label} ({g.questionIds.length})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
            <div className="bg-[#03234b] px-6 py-3">
              <h3 className="text-white text-xs font-black uppercase tracking-widest">{c.baselineTitle}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left text-[10px] font-black uppercase text-slate-500">
                    <th className="p-3">Question</th>
                    <th className="p-3">Tier</th>
                    <th className="p-3">ST</th>
                    <th className="p-3">Void</th>
                    <th className="p-3">Competitors</th>
                  </tr>
                </thead>
                <tbody>
                  {probes.map(p => {
                    const tier = campaign.preprocess?.questions.find(q => q.id === p.questionId)?.tier;
                    return (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="p-3 font-medium text-[#03234b] max-w-xs">{p.questionText}</td>
                        <td className="p-3 text-slate-500">{tier}</td>
                        <td className="p-3">{p.gemini.stBindingStrength}</td>
                        <td className="p-3">{p.gemini.voidSize} ({p.gemini.voidSeverity})</td>
                        <td className="p-3 text-slate-500">{p.gemini.dominantCompetitors.slice(0, 3).join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
            <button
              onClick={handleConfirm}
              className="bg-[#ffd200] text-[#03234b] font-black uppercase px-12 py-4 rounded-2xl shadow-xl flex items-center gap-2 hover:bg-[#ffe24d]"
            >
              {c.confirmBtn} <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default StepCampaignDiscovery;
