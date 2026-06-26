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
  const [showCompetitors, setShowCompetitors] = useState(true);
  const [showStDetail, setShowStDetail] = useState(false);

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
  // Per-question ST visibility. The headline 28.6% is GEMINI-ONLY
  // (stMentions/probeCount); this surfaces WHICH questions, and where the real
  // China-local probes ran, how many of those 4 models actually named ST.
  const ST_ALIAS = /意法半导体|意法|st\s*microelectronics|\bst[- ]?micro\b|(^|[^a-zA-Z])st([^a-zA-Z]|$)/i;
  const cnMentionsST = (s: { rawResponse?: string; keyEntities?: string[]; error?: string }) =>
    !s.error && ST_ALIAS.test(`${s.rawResponse || ''} ${(s.keyEntities || []).join(' ')}`);
  const stBreakdown = baseline.map(p => {
    const snaps = (p.multiModel?.snapshots || []).filter(s => !s.error);
    return {
      id: p.id,
      question: p.questionText,
      gemini: !!p.gemini?.stMentioned,
      cnTotal: snaps.length,
      cnHit: snaps.filter(cnMentionsST).length,
    };
  });
  const cnAnyProbed = stBreakdown.some(b => b.cnTotal > 0);
  const cnStTotal = stBreakdown.reduce((s, b) => s + b.cnTotal, 0);
  const cnStHit = stBreakdown.reduce((s, b) => s + b.cnHit, 0);
  const cnStRatePct = cnStTotal ? Math.round((cnStHit / cnStTotal) * 100) : 0;
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
  const strategicReport = syn.strategicReport;
  const competitorDiagnoses = syn.competitorDiagnoses || [];
  const langMismatch = campaign.uiLang !== uiLang;
  const severityColor = (sev: number) =>
    sev >= 7 ? '#ef4444' : sev >= 5 ? '#f59e0b' : sev >= 3 ? '#3cb4e6' : '#10b981';
  const threatTierColor = (tier: string) =>
    tier === 'dominant' ? '#ef4444' : tier === 'strong' ? '#f59e0b'
    : tier === 'emerging' ? '#3cb4e6' : '#64748b';

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

        {probeCount > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
            <button
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50"
              onClick={() => setShowStDetail(s => !s)}
            >
              <div>
                <h3 className="text-sm font-bold text-[#03234b] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#3cb4e6]" /> {c.stVisibilityTitle}
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  {c.stVisibilityGemini}: {stMentions}/{probeCount}
                  {cnAnyProbed && <> · {c.stVisibilityCn}: {cnStHit}/{cnStTotal} ({cnStRatePct}%)</>}
                  {!cnAnyProbed && <> · {c.stVisibilityCnPending}</>}
                </p>
              </div>
              {showStDetail ? <ChevronUp className="w-5 h-5 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 flex-shrink-0" />}
            </button>
            {showStDetail && (
              <div className="border-t border-slate-100 overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-2.5">{c.stVisibilityQuestion}</th>
                      <th className="px-3 py-2.5 text-center">Gemini</th>
                      <th className="px-3 py-2.5 text-center">{c.stVisibilityCn}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stBreakdown.map(b => (
                      <tr key={b.id} className="border-t border-slate-50">
                        <td className="px-6 py-2.5 text-[#03234b] max-w-md">{b.question}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${b.gemini ? 'bg-emerald-500' : 'bg-rose-400'}`}>
                            {b.gemini ? c.stVisibilityYes : c.stVisibilityNo}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {b.cnTotal > 0 ? (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${b.cnHit > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                              {b.cnHit}/{b.cnTotal}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-400 px-6 py-3 bg-slate-50/60">{c.stVisibilityNote}</p>
              </div>
            )}
          </div>
        )}

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

        <div className="space-y-3">
          <h3 className="text-sm font-bold text-[#03234b] flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#3cb4e6]" /> {c.intentDiagnosisTitle}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {syn.intentDiagnoses.map(ig => {
              const stRate = ((ig.metrics?.stMentionRate ?? 0) * 100).toFixed(0);
              const avgVoid = (ig.metrics?.avgVoidSeverity ?? 0).toFixed(1);
              const critical = ig.metrics?.criticalVoidCount ?? 0;
              return (
              <div key={ig.intentGroupId} className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
                <button
                  className="w-full px-5 py-4 text-left hover:bg-slate-50"
                  onClick={() => setExpandedIg(expandedIg === ig.intentGroupId ? null : ig.intentGroupId)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-[#03234b] text-[14px] leading-snug">{ig.label}</h3>
                    {expandedIg === ig.intentGroupId ? <ChevronUp className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  </div>
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
                </button>
                {expandedIg === ig.intentGroupId && (
                  <div className="px-5 pb-4 text-[13px] text-slate-600 border-t border-slate-100 pt-3 leading-relaxed">{toDisplayText(ig.narrative)}</div>
                )}
              </div>
            );})}
          </div>
        </div>


        {competitorDiagnoses.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
            <button
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50"
              onClick={() => setShowCompetitors(s => !s)}
            >
              <div>
                <h3 className="text-sm font-bold text-[#03234b] flex items-center gap-2">
                  <Swords className="w-4 h-4 text-rose-500" /> {c.competitorTitle}
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">{c.competitorDesc}</p>
              </div>
              {showCompetitors ? <ChevronUp className="w-5 h-5 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 flex-shrink-0" />}
            </button>
            {showCompetitors && (
              <div className="px-6 pb-6 pt-2 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {competitorDiagnoses.map((comp, idx) => {
                  const share = Math.round((comp.mentionShare ?? 0) * 100);
                  const color = threatTierColor(comp.threatTier);
                  return (
                    <div key={idx} className="rounded-xl border border-slate-100 p-5 bg-slate-50/40">
                      <div className="flex justify-between items-start mb-3">
                        <h4 className="text-base font-black text-[#03234b]">{comp.name}</h4>
                        <span
                          className="flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-1 rounded-full text-white"
                          style={{ backgroundColor: color }}
                        >
                          <AlertTriangle className="w-3 h-3" /> {comp.threatTier}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-4">
                        <span className="u-eyebrow text-slate-400 flex-shrink-0">SOV</span>
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(3, share)}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-[11px] font-bold text-[#03234b] flex-shrink-0">{share}%</span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <h5 className="u-eyebrow text-amber-500 flex items-center gap-1 mb-1"><ShieldAlert className="w-3 h-3" /> {c.competitorCorpus}</h5>
                          <p className="text-[12px] text-amber-900 font-medium bg-amber-50 p-2 rounded-lg border border-amber-100">{toDisplayText(comp.corpusAdvantage)}</p>
                        </div>
                        <div>
                          <h5 className="u-eyebrow text-slate-400 flex items-center gap-1 mb-1"><Info className="w-3 h-3" /> {c.competitorWeakSpot}</h5>
                          <p className="text-[12px] text-slate-700 leading-relaxed">{toDisplayText(comp.weakSpot)}</p>
                        </div>
                        <div>
                          <h5 className="u-eyebrow text-emerald-500 flex items-center gap-1 mb-1"><Activity className="w-3 h-3" /> {c.competitorInterception}</h5>
                          <p className="text-[12px] text-[#03234b] font-medium leading-relaxed">{toDisplayText(comp.interceptionPlay)}</p>
                        </div>
                        {comp.crossModelValidation && (
                          <div>
                            <h5 className="u-eyebrow text-[#3cb4e6] flex items-center gap-1 mb-1"><Users className="w-3 h-3" /> {c.competitorCrossModel}</h5>
                            <p className="text-[12px] text-slate-600 leading-relaxed bg-[#3cb4e6]/5 p-2 rounded-lg border border-[#3cb4e6]/15">{toDisplayText(comp.crossModelValidation)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
