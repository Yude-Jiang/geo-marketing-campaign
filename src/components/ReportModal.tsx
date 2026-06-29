import React from 'react';
import { X, Download, Loader2, FileText, Code2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranslationKeys } from '../i18n/translations';
import { parseReportContent } from './report/parseReportContent';
import { markdownToStyledHtml } from './report/mdToHtml';
import { buildHtmlShell } from './report/reportShell';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  isGenerating: boolean;
  t: TranslationKeys;
}

const ReportModal: React.FC<Props> = ({ isOpen, onClose, content, isGenerating, t }) => {
  if (!isOpen) return null;

  const p = t.production;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportTitle = p.reportTitle ?? 'Campaign Proposal';

  const { md, htmlBody } = parseReportContent(content);
  const hasHtml = htmlBody.length > 100;

  const extractTitle = (mdText: string): string => {
    const match = mdText.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : reportTitle;
  };
  const toFilename = (s: string): string =>
    s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 60);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  const handleDownloadMd = () => {
    const title = toFilename(extractTitle(md));
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${title}-Campaign-Proposal-${date}.md`);
  };

  const handleDownloadHtml = () => {
    const title = toFilename(extractTitle(md));
    const htmlOut = hasHtml
      ? buildHtmlShell(htmlBody, reportTitle, date)
      : markdownToStyledHtml(md, reportTitle);
    downloadBlob(
      new Blob([htmlOut], { type: 'text/html;charset=utf-8' }),
      `${title}-Campaign-Proposal-${date}.html`
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white w-full max-w-4xl mx-4 rounded-3xl shadow-2xl border border-slate-100 flex flex-col animate-fade-in"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-[#ffd200] p-2 rounded-xl">
              <FileText className="w-4 h-4 text-[#03234b]" />
            </div>
            <h3 className="text-sm font-bold text-[#03234b]">
              {p.reportTitle}
            </h3>
            {isGenerating && (
              <span className="flex items-center gap-1.5 u-eyebrow text-[#3cb4e6] ml-2">
                <Loader2 className="w-3 h-3 animate-spin" /> {p.reportGenerating}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-[#03234b] hover:bg-slate-100 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content preview:
            - While streaming: show MD (ReactMarkdown) — HTML block not yet complete
            - After generation: if HTML block available, render it in iframe; else fall back to MD */}
        <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: hasHtml ? 0 : '2rem 2.5rem' }}>
          {!content && isGenerating && (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="u-eyebrow">{p.reportGenerating}</p>
            </div>
          )}
          {content && !hasHtml && (
            <article className="prose prose-slate max-w-none prose-lg prose-p:mb-6 prose-p:leading-[1.8] prose-headings:font-black prose-headings:text-[#03234b] prose-headings:tracking-tight prose-h1:text-2xl prose-h1:mb-2 prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-base prose-a:text-[#3cb4e6] prose-table:text-sm prose-th:bg-slate-50 prose-th:font-black prose-strong:text-[#03234b] prose-blockquote:border-[#3cb4e6] prose-blockquote:bg-blue-50 prose-blockquote:rounded-xl prose-hr:my-10 prose-li:mb-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
            </article>
          )}
          {content && hasHtml && (
            <iframe
              srcDoc={buildHtmlShell(htmlBody, reportTitle, date)}
              style={{ width: '100%', height: '100%', minHeight: '600px', border: 'none', borderRadius: '0 0 1.5rem 1.5rem' }}
              title="GEO Report Preview"
              sandbox="allow-same-origin"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="u-caption text-slate-400">
              {t.footer}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="btn-ghost px-4 py-2 text-[11px]"
            >
              {p.reportCloseBtn}
            </button>

            {/* .md — secondary */}
            <button
              onClick={handleDownloadMd}
              disabled={!content || isGenerating}
              title="Markdown — 适合 Notion / Obsidian 二次编辑"
              className="btn-ghost px-4 py-2 text-[11px] bg-slate-100 hover:bg-slate-200"
            >
              <Download className="w-3.5 h-3.5" /> .md
            </button>

            {/* .html — primary */}
            <button
              onClick={handleDownloadHtml}
              disabled={!content || isGenerating}
              title="HTML — 浏览器直接打开，样式与 User Guide 一致"
              className="btn-primary px-5 py-2 text-[11px] disabled:opacity-30"
            >
              <Code2 className="w-3.5 h-3.5" /> {p.reportDownloadHtmlBtn ?? 'Download .html'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportModal;
