import React, { useState, lazy, Suspense } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { rerunCampaignProbes } from '../services/campaignPipeline';
import { buildProgressSnapshot } from '../services/probeDelta';
import {
  generateCampaignReportStream,
  generateProgressNarrative,
} from '../services/geminiService';
import type { TranslationKeys } from '../i18n/translations';
// Lazy-loaded: pulls in react-markdown + remark-gfm, only needed when the
// report modal is actually opened. Keeps them out of the initial bundle.
const ReportModal = lazy(() => import('./ReportModal'));
import {
  ArrowLeft, Loader2, FileText, RefreshCw, CheckCircle2, Zap, ChevronDown, ChevronUp,
  ShieldCheck, AlertTriangle, Gauge, Users, Languages,
  Target, Swords, ShieldAlert, Activity, Info, Lightbulb,
} from 'lucide-react';

const DASH_LABELS = {
  zh: { st: 'ST 绑定率', void: '平均空洞严重度', critical: '高危空洞', competitors: '主导竞品', of: '共', questions: '题', mismatch: '内容生成语言为', mismatchTail: '，与当前界面语言不一致。请用当前语言重新生成以保持一致。' },
  en: { st: 'ST binding rate', void: 'Avg void severity', critical: 'Critical voids', competitors: 'Dominant rivals', of: 'of', questions: 'probes', mismatch: 'Content was generated in', mismatchTail: ', which differs from the current UI language. Re-run in the current language to keep them consistent.' },
  jp: { st: 'ST 露出率', void: '平均空白深刻度', critical: '重大空白', competitors: '主要競合', of: '全', questions: '問', mismatch: 'コンテンツの生成言語は', mismatchTail: 'で、現在のUI言語と異なります。一致させるには現在の言語で再生成してください。' },
} as const;

const toDisplayText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.playName === 'string' && typeof obj.description === 'string') {
      return `${obj.playName}: ${obj.description}`;
    }
    if (typeof obj.description === 'string') return obj.description;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.summary === 'string') return obj.summary;
    return JSON.stringify(value);
  }
  return '';
};

const StepCampaignBlueprint: React.FC<{ t: TranslationKeys }> = ({ t }) => {
  const campaign = useWorkflowStore(s => s.campaign);
  const setCampaign = useWorkflowStore(s => s.setCampaign);
  const setStep = useWorkflowStore(s => s.setStep);
  const selectedPlaybookIds = useWorkflowStore(s => s.selectedPlaybookIds);
  const togglePlaybookId = useWorkflowStore(s => s.togglePlaybookId);
  const uiLang = useWorkflowStore(s => s.uiLang);

  const c = t.campaign;
  const syn = campaign?.synthesis;
  const playbooks = syn?.playbooks || [];
  const innovationPlays = (syn?.innovationPlays || [])
    .map(play => toDisplayText(play))
    .filter(Boolean);

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

  // ── Visual KPI dashboard: aggregate the T0 baseline probes into headline
  // numbers (mirrors the report's metrics so the Blueprint isn't just text). ──
  const baseline = campaign.probes.filter(p => p.phase === 'baseline');
  const probeCount = baseline.length;
  const stMentions = baseline.filter(p => p.gemini?.stMentioned).length;
  const stRatePct = probeCount ? Math.round((stMentions / probeCount) * 100) : 0;
  const avgVoidSeverity = probeCount
    ? baseline.reduce((sum, p) => sum + (p.gemini?.voidSeverity || 0), 0) / probeCount
    : 0;
  const criticalVoids = baseline.filter(
    p => p.gemini?.voidSize === 'critical' || p.gemini?.voidSize === 'large',
  ).length;
  const competitorFreq = (() => {
    const m = new Map<string, number>();
    for (const p of baseline) {
      for (const cmp of p.gemini?.dominantCompetitors || []) {
        m.set(cmp, (m.get(cmp) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const competitorSet = new Set(competitorFreq.map(([name]) => name));
  const maxCompFreq = competitorFreq[0]?.[1] || 1;
  const strategicReport = syn.strategicReport;
  const competitorCards = syn.competitorAnalysis || [];
  const langMismatch = campaign.uiLang !== uiLang;
  const severityColor = (sev: number) =>
    sev >= 7 ? '#ef4444' : sev >= 5 ? '#f59e0b' : sev >= 3 ? '#3cb4e6' : '#10b981';
  const threatColor = (lvl: string) =>
    lvl === 'Critical' ? '#ef4444' : lvl === 'High' ? '#f97316'
    : lvl === 'Medium' ? '#f59e0b' : lvl === 'Low' ? '#10b981' : '#64748b';

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
              <h2 className="text-xl u-page-title text-[#03234b]">{c.blueprintTitle}</h2>
              <p className="u-eyebrow mt-0.5">{campaign.topic}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReprobe}
              disabled={isReprobing}
              className="btn-ghost px-4 py-2.5 text-[11px] disabled:opacity-50"
            >
              {isReprobing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {c.reprobeBtn}
            </button>
            <button
              onClick={handleGenerateReport}
              disabled={isGeneratingReport}
              className="btn-accent px-6 py-2.5 text-[11px] disabled:opacity-50"
            >
              {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {c.reportBtn}
            </button>
          </div>
        </div>

        {langMismatch && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <Languages className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-amber-900 leading-relaxed">
              {(DASH_LABELS[uiLang] ?? DASH_LABELS.en).mismatch}{' '}
              <strong>{campaign.uiLang.toUpperCase()}</strong>
              {(DASH_LABELS[uiLang] ?? DASH_LABELS.en).mismatchTail}
            </p>
          </div>
        )}

        {(() => {
          const d = DASH_LABELS[uiLang] ?? DASH_LABELS.en;
          const cards = [
            { icon: ShieldCheck, label: d.st, value: `${stRatePct}%`, sub: `${stMentions} ${d.of} ${probeCount} ${d.questions}`, color: stRatePct >= 50 ? '#10b981' : stRatePct >= 25 ? '#f59e0b' : '#ef4444' },
            { icon: Gauge, label: d.void, value: avgVoidSeverity.toFixed(1), sub: '/ 10', color: severityColor(avgVoidSeverity) },
            { icon: AlertTriangle, label: d.critical, value: String(criticalVoids), sub: `${d.of} ${probeCount}`, color: criticalVoids > 0 ? '#ef4444' : '#10b981' },
            { icon: Users, label: d.competitors, value: String(competitorSet.size), sub: [...competitorSet].slice(0, 2).join(', '), color: '#03234b' },
          ];
          return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {cards.map((card, i) => (
                <div key={i} className="bg-white rounded-2xl p-5 shadow-lg border border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <card.icon className="w-4 h-4" style={{ color: card.color }} />
                    <span className="u-eyebrow text-[#5f6f85]">{card.label}</span>
                  </div>
                  <div className="text-3xl font-black leading-none" style={{ color: card.color }}>{card.value}</div>
                  <div className="text-[11px] text-slate-400 mt-1.5 truncate">{card.sub || '—'}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {strategicReport?.executiveSummary && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
            <div className="bg-[#03234b] px-6 py-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#ffd200]" />
              <h3 className="text-white text-[13px] font-bold">{c.strategyReportTitle}</h3>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                { icon: Activity, label: c.strategyMarketPulse, val: strategicReport.executiveSummary.marketPulse, color: '#3cb4e6' },
                { icon: AlertTriangle, label: c.strategyRoadblocks, val: strategicReport.executiveSummary.coreRoadblocks, color: '#ef4444' },
                { icon: Target, label: c.strategyPivot, val: strategicReport.executiveSummary.strategicPivot, color: '#f59e0b' },
                { icon: Lightbulb, label: c.strategyKeyInsight, val: strategicReport.executiveSummary.keyInsight, color: '#10b981' },
              ]).filter(d => d.val).map((d, i) => (
                <div key={i} className="rounded-xl border border-slate-100 p-4 bg-slate-50/50">
                  <h4 className="u-eyebrow flex items-center gap-1.5 mb-1.5" style={{ color: d.color }}>
                    <d.icon className="w-3.5 h-3.5" /> {d.label}
                  </h4>
                  <p className="text-[13px] text-[#03234b] leading-relaxed">{toDisplayText(d.val)}</p>
                </div>
              ))}
            </div>
            {strategicReport.actionPlan?.length > 0 && (
              <div className="px-6 pb-6">
                <h4 className="u-eyebrow text-[#5f6f85] mb-2">{c.strategyActionPlan}</h4>
                <ol className="space-y-1.5">
                  {strategicReport.actionPlan.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px] text-slate-600">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#3cb4e6]/10 text-[#3cb4e6] text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                      {toDisplayText(step)}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {latestProgress && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <h3 className="text-[13px] font-bold text-emerald-800 mb-2">{c.progressTitle} (Day {latestProgress.daysSinceBaseline})</h3>
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
              <div className="flex-1 min-w-0 mr-4">
                <h3 className="font-bold text-[#03234b]">{ig.label}</h3>
                <p className="text-[11px] text-[#5f6f85] mt-1">
                  ST rate {stRate}% · avg void {avgVoid} · {critical} critical
                </p>
                <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (Number(avgVoid) / 10) * 100)}%`,
                      backgroundColor: severityColor(Number(avgVoid)),
                    }}
                  />
                </div>
              </div>
              {expandedIg === ig.intentGroupId ? <ChevronUp className="w-5 h-5 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 flex-shrink-0" />}
            </button>
            {expandedIg === ig.intentGroupId && (
              <div className="px-6 pb-4 text-sm text-slate-600 border-t border-slate-100 pt-4">{toDisplayText(ig.narrative)}</div>
            )}
          </div>
        );})}

        {(competitorFreq.length > 0 || competitorCards.length > 0) && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-bold text-[#03234b] flex items-center gap-2">
                <Swords className="w-4 h-4 text-rose-500" /> {c.competitorTitle}
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">{c.competitorDesc}</p>
            </div>

            {competitorFreq.length > 0 && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
                <h4 className="u-eyebrow text-[#5f6f85] mb-4">{c.competitorFreqTitle}</h4>
                <div className="space-y-2.5">
                  {competitorFreq.slice(0, 8).map(([name, count]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-28 sm:w-40 text-[12px] font-bold text-[#03234b] truncate flex-shrink-0">{name}</span>
                      <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-rose-400 flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(8, (count / maxCompFreq) * 100)}%` }}
                        >
                          <span className="text-[10px] font-bold text-white">{count}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {competitorCards.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {competitorCards.map((comp, idx) => (
                  <div key={idx} className="bg-white rounded-2xl p-5 shadow-lg border border-rose-100 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-rose-50 rounded-bl-full -z-0" />
                    <div className="relative flex justify-between items-start mb-4">
                      <h4 className="text-lg font-black text-[#03234b]">{comp.competitorName}</h4>
                      <span
                        className="flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-1 rounded-full text-white"
                        style={{ backgroundColor: threatColor(comp.threatLevel) }}
                      >
                        <AlertTriangle className="w-3 h-3" /> {comp.threatLevel}
                      </span>
                    </div>
                    <div className="relative space-y-3">
                      <div>
                        <h5 className="u-eyebrow text-slate-400 flex items-center gap-1 mb-1"><Info className="w-3 h-3" /> {c.competitorPerception}</h5>
                        <p className="text-[12px] text-slate-700 italic leading-relaxed bg-slate-50 p-2 rounded-lg border-l-2 border-[#3cb4e6]">“{toDisplayText(comp.aiPerception)}”</p>
                      </div>
                      <div>
                        <h5 className="u-eyebrow text-amber-500 flex items-center gap-1 mb-1"><ShieldAlert className="w-3 h-3" /> {c.competitorCorpus}</h5>
                        <p className="text-[12px] text-amber-900 font-medium bg-amber-50 p-2 rounded-lg border border-amber-100">{toDisplayText(comp.corpusAdvantage)}</p>
                      </div>
                      <div>
                        <h5 className="u-eyebrow text-emerald-500 flex items-center gap-1 mb-1"><Activity className="w-3 h-3" /> {c.competitorOpening}</h5>
                        <p className="text-[12px] text-[#03234b] font-medium leading-relaxed">{toDisplayText(comp.strategicOpening)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-bold text-[#03234b] flex items-center gap-2">
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
                    <span className="u-eyebrow text-[#3cb4e6]">{toDisplayText(pb.tacticsType)}</span>
                    <p className="font-bold text-[#03234b] mt-1">{toDisplayText(pb.sourceLogic)}</p>
                    <p className="text-xs text-slate-500 mt-2">{toDisplayText(pb.geoAction)}</p>
                    <p className="text-[11px] font-mono bg-slate-50 p-3 rounded-lg mt-3 text-slate-600">{toDisplayText(pb.targetSnippet)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {innovationPlays.length > 0 && (
          <div className="bg-[#03234b] rounded-2xl p-6 text-white">
            <h3 className="text-[13px] font-bold text-[#ffd200] mb-4">{c.innovationTitle}</h3>
            <ul className="space-y-2 text-sm text-white/80">
              {innovationPlays.map((play, i) => (
                <li key={i} className="flex gap-2"><span className="text-[#3cb4e6]">→</span>{play}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showReport && (
        <Suspense fallback={null}>
          <ReportModal
            isOpen={showReport}
            onClose={() => setShowReport(false)}
            content={reportContent}
            isGenerating={isGeneratingReport}
            t={t}
          />
        </Suspense>
      )}
    </>
  );
};

export default StepCampaignBlueprint;
