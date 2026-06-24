import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { CampaignPipelineProgress, CampaignPipelineStage } from '../types/campaign';

const STAGE_ORDER: CampaignPipelineStage[] = [
  'preprocess',
  'probe_questions',
  'multi_model_verify',
  'synthesize_campaign',
];

function stageIndex(stage: CampaignPipelineStage | undefined): number {
  if (!stage || stage === 'done') return stage === 'done' ? STAGE_ORDER.length : 0;
  const idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

interface Props {
  progress: CampaignPipelineProgress | null;
  labels: Record<CampaignPipelineStage, string>;
}

const PipelineStageIndicator: React.FC<Props> = ({ progress, labels }) => {
  const current = stageIndex(progress?.stage);
  const isDone = progress?.stage === 'done';

  return (
    <div className="rounded-xl border border-[#3cb4e6]/20 bg-[#3cb4e6]/5 p-4">
      <div className="flex items-center justify-between gap-2">
        {STAGE_ORDER.map((stage, idx) => {
          const done = isDone || idx < current;
          const active = !isDone && idx === current;
          const pending = !done && !active;
          return (
            <React.Fragment key={stage}>
              <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                    done ? 'bg-[#3cb4e6] text-white'
                    : active ? 'bg-[#03234b] text-white ring-2 ring-[#3cb4e6]/40'
                    : 'bg-slate-200 text-slate-400'
                  }`}
                >
                  {done ? <Check className="w-4 h-4" />
                    : active ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <span className="text-[11px] font-bold">{idx + 1}</span>}
                </div>
                <span
                  className={`text-[11px] font-bold text-center leading-tight line-clamp-2 ${
                    pending ? 'text-slate-400' : active ? 'text-[#03234b]' : 'text-[#3cb4e6]'
                  }`}
                >
                  {labels[stage]}
                </span>
              </div>
              {idx < STAGE_ORDER.length - 1 && (
                <div
                  className={`h-0.5 flex-1 min-w-[12px] mb-5 transition-colors ${
                    idx < current || isDone ? 'bg-[#3cb4e6]' : 'bg-slate-200'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {(progress?.detail || progress?.totalQuestions) && (
        <p className="mt-3 text-[13px] text-[#03234b]/80 text-center">
          {progress?.detail}
          {progress?.totalQuestions
            ? ` (${progress.completedQuestions ?? 0}/${progress.totalQuestions})`
            : ''}
        </p>
      )}
    </div>
  );
};

export default PipelineStageIndicator;
