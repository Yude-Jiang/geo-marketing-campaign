import React, { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { runCampaignPipeline } from '../services/campaignPipeline';
import type { CampaignPipelineProgress } from '../types/campaign';
import type { TranslationKeys } from '../i18n/translations';
import PipelineStageIndicator from './PipelineStageIndicator';
import { Loader2, Search, ChevronRight, AlertCircle, Target, Layers } from 'lucide-react';

const toDisplayText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.description === 'string') return obj.description;
    if (typeof obj.summary === 'string') return obj.summary;
    if (typeof obj.text === 'string') return obj.text;
    return JSON.stringify(value);
  }
  return '';
};

const DiscoverySkeleton: React.FC = () => (
  <div className="space-y-4 animate-fade-in">
    <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100 space-y-4">
      <div className="skeleton-block h-4 w-32" />
      <div className="skeleton-block h-16 w-full" />
    </div>
    <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100 space-y-3">
      <div className="skeleton-block h-4 w-40" />
      <div className="flex flex-wrap gap-2">
        <div className="skeleton-block h-8 w-28 rounded-full" />
        <div className="skeleton-block h-8 w-36 rounded-full" />
        <div className="skeleton-block h-8 w-24 rounded-full" />
      </div>
    </div>
    <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
      <div className="skeleton-block h-10 w-full rounded-none" />
      <div className="p-4 space-y-3">
        <div className="skeleton-block h-10 w-full" />
        <div className="skeleton-block h-10 w-full" />
        <div className="skeleton-block h-10 w-full" />
      </div>
    </div>
  </div>
);

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
  const durationOptions = uiLang === 'zh'
    ? [
      { value: '30d', label: '30 天' },
      { value: '90d', label: '90 天' },
      { value: 'quarter', label: '季度（3个月）' },
      { value: '180d', label: '半年（180 天）' },
      { value: '365d', label: '一年（365 天）' },
    ]
    : uiLang === 'jp'
      ? [
        { value: '30d', label: '30日' },
        { value: '90d', label: '90日' },
        { value: 'quarter', label: '四半期（3か月）' },
        { value: '180d', label: '半年（180日）' },
        { value: '365d', label: '1年（365日）' },
      ]
      : [
        { value: '30d', label: '30 days' },
        { value: '90d', label: '90 days' },
        { value: 'quarter', label: 'Quarter (3 months)' },
        { value: '180d', label: 'Half year (180 days)' },
        { value: '365d', label: '1 year (365 days)' },
      ];

  const [topic, setTopic] = useState(campaign?.topic || '');
  const [questions, setQuestions] = useState(
    campaign?.input.seedQuestions?.join('\n') || ''
  );
  const [urls, setUrls] = useState(campaign?.input.sourceUrls?.join('\n') || '');
  const [duration, setDuration] = useState<'30d' | '90d' | 'quarter' | '180d' | '365d'>(
    (campaign?.duration as '30d' | '90d' | 'quarter' | '180d' | '365d') || '90d'
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
  const showSkeleton = loading && !campaign?.synthesis;

  return (
    <div className="space-y-6 animate-fade-in pb-24 max-w-5xl mx-auto">
      <div className="bg-white rounded-2xl p-8 shadow-xl border border-slate-100">
        <h2 className="text-2xl u-page-title text-[#03234b] flex items-center gap-3">
          <Target className="w-6 h-6 text-[#3cb4e6]" /> {c.discoveryTitle}
        </h2>
        <p className="text-[#5f6f85] text-[13px] mt-2 leading-relaxed">{c.discoverySubtitle}</p>

        <div className="mt-8 space-y-5">
          <div>
            <label className="u-eyebrow">{c.topicLabel}</label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder={c.topicPlaceholder}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#03234b] focus:border-[#3cb4e6] outline-none"
            />
          </div>

          <div>
            <label className="u-eyebrow">{c.questionsLabel}</label>
            <textarea
              value={questions}
              onChange={e => setQuestions(e.target.value)}
              placeholder={c.questionsPlaceholder}
              rows={6}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-[13px] text-[#03234b] focus:border-[#3cb4e6] outline-none resize-y leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="u-eyebrow">{c.urlsLabel}</label>
              <textarea
                value={urls}
                onChange={e => setUrls(e.target.value)}
                placeholder={c.urlsPlaceholder}
                rows={3}
                className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-[13px] focus:border-[#3cb4e6] outline-none leading-relaxed"
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className="u-eyebrow">{c.regionLabel}</label>
                <input
                  value={regionInput}
                  onChange={e => setRegionInput(e.target.value)}
                  placeholder={c.regionPlaceholder}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#3cb4e6] outline-none"
                />
              </div>
              <div>
                <label className="u-eyebrow">{c.durationLabel}</label>
                <select
                  value={duration}
                  onChange={e => setDuration(e.target.value as typeof duration)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#03234b] outline-none"
                >
                  {durationOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-[13px] text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
            </div>
          )}

          {loading && (
            <PipelineStageIndicator progress={progress} labels={c.pipelineStages} />
          )}

          <button
            onClick={handleRun}
            disabled={loading || !topic.trim()}
            className="btn-primary w-full py-4 text-sm"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            {loading ? c.runningBtn : c.runBtn}
          </button>
        </div>
      </div>

      {showSkeleton && <DiscoverySkeleton />}

      {campaign?.synthesis && !showSkeleton && (
        <>
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
            <h3 className="text-sm font-bold text-[#03234b] mb-3">{c.execSummary}</h3>
            <p className="text-[13px] text-[#5f6f85] leading-relaxed">{toDisplayText(campaign.synthesis.executiveSummary)}</p>
          </div>

          {groups.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
              <h3 className="text-sm font-bold text-[#03234b] mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#ffd200]" /> {c.intentGroupsTitle}
              </h3>
              <div className="flex flex-wrap gap-2">
                {groups.map(g => (
                  <span key={g.id} className="px-3 py-1.5 bg-[#3cb4e6]/10 text-[#03234b] text-[13px] font-bold rounded-full border border-[#3cb4e6]/20">
                    {g.label} ({g.questionIds.length})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
            <div className="bg-[#03234b] px-6 py-3">
              <h3 className="text-white text-[13px] font-bold">{c.baselineTitle}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-bold text-slate-500">
                    <th className="p-3">{c.tableQuestion}</th>
                    <th className="p-3" title={c.tableTooltipTier}>{c.tableTier}</th>
                    <th className="p-3" title={c.tableTooltipSt}>{c.tableSt}</th>
                    <th className="p-3" title={c.tableTooltipVoid}>{c.tableVoid}</th>
                    <th className="p-3">{c.tableCompetitors}</th>
                  </tr>
                </thead>
                <tbody>
                  {probes.map(p => {
                    const tier = campaign.preprocess?.questions.find(q => q.id === p.questionId)?.tier;
                    return (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="p-3 font-medium text-[#03234b] max-w-xs leading-relaxed">{p.questionText}</td>
                        <td className="p-3 text-[#5f6f85]">{tier}</td>
                        <td className="p-3">{p.gemini.stBindingStrength}</td>
                        <td className="p-3">{p.gemini.voidSize} ({p.gemini.voidSeverity})</td>
                        <td className="p-3 text-[#5f6f85]">{p.gemini.dominantCompetitors.slice(0, 3).join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pr-20 sm:pr-0">
            <button
              onClick={handleConfirm}
              className="btn-accent px-12 py-4 rounded-2xl shadow-xl text-sm"
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
