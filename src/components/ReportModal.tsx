import React from 'react';
import { X, Download, Loader2, FileText, Code2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranslationKeys } from '../i18n/translations';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  isGenerating: boolean;
  t: TranslationKeys;
}


// ─── Post-process: plain HTML → infographic components ───────────────────────
function postProcessHtml(html: string): string {
  // 1. Section headers: <div class="sec-label">N. Title</div> → numbered badge header
  html = html.replace(
    /<div class="sec-label">(\d+)\.\s*(.+?)<\/div>/g,
    (_, n, title) =>
      `<div class="sec-header"><div class="sec-num">${n}</div><div class="sec-header-text">${title}</div></div>`
  );

  // 2. Threat cards: <li> containing [高威胁]/[中威胁]/[低威胁] or [High]/[Mid]/[Low]
  html = html.replace(
    /<li>([\s\S]*?(?:高威胁|中威胁|低威胁|High Threat|Mid Threat|Low Threat|高风险|中风险|低风险)[\s\S]*?)<\/li>/g,
    (_, body) => {
      const levelMap: Record<string, string> = {
        '高威胁': 'threat-high', '高风险': 'threat-high', 'High Threat': 'threat-high',
        '中威胁': 'threat-mid', '中风险': 'threat-mid', 'Mid Threat': 'threat-mid',
        '低威胁': 'threat-low', '低风险': 'threat-low', 'Low Threat': 'threat-low',
      };
      const labelMap: Record<string, string> = {
        'threat-high': '高威胁', 'threat-mid': '中威胁', 'threat-low': '低威胁',
      };
      const cls = Object.entries(levelMap).find(([k]) => body.includes(k))?.[1] || 'threat-mid';
      const label = labelMap[cls];
      return `<div class="threat-card"><span class="threat-badge ${cls}">${label}</span><div class="threat-body">${body}</div></div>`;
    }
  );

  // 3. Action step lists: <ol> items after a "下一步" / "Next" section become action cards
  html = html.replace(
    /(<div class="sec-header">[^<]*(?:下一步|Next|建议行动|Recommended)[^<]*<\/div>)([\s\S]*?)(?=<div class="sec-header"|<footer|$)/g,
    (_match: string, header: string, body: string) => {
      const actionBody = body.replace(
        /<li>([\s\S]*?)<\/li>/g,
        (_: string, item: string, offset: number, arr: string) => {
          const n = (arr.slice(0, offset).match(/<li>/g) || []).length + 1;
          return `<div class="action-card"><div class="action-n">${n}</div><div class="action-body">${item}</div></div>`;
        }
      );
      const wrappedActions = actionBody.replace(
        /(<div class="action-card">[\s\S]*<\/div>)/,
        '<div class="action-list">$1</div>'
      );
      return header + wrappedActions;
    }
  );

  // 4. Extract bold numbers/stats into stat cards row at top of each section
  // Find patterns like <strong>数字 + 单位</strong> in the exec summary section
  const statPattern = /<strong>(\d[\d,.]*\s*(?:%|倍|x|USD|美元|\$|个|篇|条))<\/strong>/g;
  const execSummaryMatch = html.match(/(<div class="sec-header">[^<]*(?:摘要|Summary|Overview)[^<]*<\/div>)([\s\S]*?)(?=<div class="sec-header">)/);
  if (execSummaryMatch) {
    const sectionBody = execSummaryMatch[2];
    const stats: string[] = [];
    let m;
    while ((m = statPattern.exec(sectionBody)) !== null) {
      stats.push(m[1]);
    }
    if (stats.length >= 2) {
      const statCards = stats.slice(0, 4).map(s => {
        const parts = s.match(/^([\d,.]+)\s*(.*)$/);
        const num = parts ? parts[1] : s;
        const unit = parts ? parts[2] : '';
        return `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-label">${unit}</div></div>`;
      }).join('');
      html = html.replace(execSummaryMatch[0],
        execSummaryMatch[1] + `<div class="stat-row">${statCards}</div>` + execSummaryMatch[2]
      );
    }
  }

  // 5. GEO Signal comparison table: add class and inject bar cells for numeric columns
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, (match, inner) => {
    if (inner.includes('GEO') || inner.includes('信号') || inner.includes('Signal') ||
        inner.includes('CoreMark') || inner.includes('Before') || inner.includes('优化前')) {
      // Add progress bars to td cells that are pure numbers or percentages
      const withBars = inner.replace(
        /<td>(\d[\d,.]*\s*%?)<\/td>/g,
        (_: string, val: string) => {
          const num = parseFloat(val.replace(/[,%]/g, ''));
          const pct = Math.min(100, num > 100 ? num / 10 : num);
          return `<td class="bar-cell"><div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:4px">${val}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div></td>`;
        }
      );
      return `<table class="geo-signal">${withBars}</table>`;
    }
    return match;
  });

  return html;
}

// ─── Markdown → standalone HTML (User Guide CSS) ─────────────────────────────
// Converts the MD report into a self-contained HTML using the same CSS
// as GEO_Hub_User_Guide, so it looks like an official ST document.
function markdownToStyledHtml(md: string, title: string): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inlineFormat = (text: string): string =>
    text
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>');

  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false, codeLang = '', codeBuf: string[] = [];
  let inTable = false, tableHasHead = false;
  let inBlockquote = false;
  let inUl = false, inOl = false;

  const flushCode = () => {
    out.push(
      `<pre><code class="dm-mono"${codeLang ? ` data-lang="${codeLang}"` : ''}>${escapeHtml(codeBuf.join('\n'))}</code></pre>`
    );
    codeBuf = []; codeLang = ''; inCode = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (/^```/.test(raw)) {
      if (!inCode) { codeLang = raw.slice(3).trim(); inCode = true; }
      else flushCode();
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw.trim())) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (inTable) { out.push('</tbody></table>'); inTable = false; tableHasHead = false; }
      if (inBlockquote) { out.push('</div>'); inBlockquote = false; }
      out.push('<hr>'); continue;
    }

    // Table
    if (/^\|/.test(raw)) {
      const cells = raw.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (inOl) { out.push('</ol>'); inOl = false; }
        out.push('<table><thead>'); inTable = true; tableHasHead = false;
      }
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        out.push('</thead><tbody>'); tableHasHead = true; continue;
      }
      const tag = !tableHasHead ? 'th' : 'td';
      out.push(`<tr>${cells.map(c => `<${tag}>${inlineFormat(escapeHtml(c))}</${tag}>`).join('')}</tr>`);
      continue;
    }
    if (inTable) { out.push('</tbody></table>'); inTable = false; tableHasHead = false; }

    // Blockquote → styled as .tip box
    if (/^> /.test(raw)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inBlockquote) { out.push('<div class="tip"><span class="tip-icon">💡</span><p>'); inBlockquote = true; }
      else out.push(' ');
      out.push(inlineFormat(escapeHtml(raw.slice(2))));
      const next = lines[i + 1] || '';
      if (!/^> /.test(next)) { out.push('</p></div>'); inBlockquote = false; }
      continue;
    }

    // Headings
    const hm = raw.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      const lv = hm[1].length;
      const id = hm[2].toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-');
      const txt = inlineFormat(escapeHtml(hm[2]));
      if (lv === 1) {
        out.push(`<h2 class="sec-title" id="${id}">${txt}</h2>`);
      } else if (lv === 2) {
        out.push(`<div class="sec-label">${txt}</div>`);
      } else if (lv === 3) {
        out.push(`<h3 id="${id}" style="font-size:15px;font-weight:700;color:var(--navy);margin:1.4em 0 .5em;letter-spacing:-.01em">${txt}</h3>`);
      } else {
        out.push(`<h${lv} id="${id}" style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:1em 0 .4em">${txt}</h${lv}>`);
      }
      continue;
    }

    // Unordered list
    if (/^[-*+] /.test(raw.trim())) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul class="report-ul">'); inUl = true; }
      out.push(`<li>${inlineFormat(escapeHtml(raw.replace(/^\s*[-*+] /, '')))}</li>`);
      if (!/^[-*+] /.test((lines[i + 1] || '').trim())) { out.push('</ul>'); inUl = false; }
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(raw.trim())) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="report-ol">'); inOl = true; }
      out.push(`<li>${inlineFormat(escapeHtml(raw.replace(/^\s*\d+\. /, '')))}</li>`);
      if (!/^\d+\. /.test((lines[i + 1] || '').trim())) { out.push('</ol>'); inOl = false; }
      continue;
    }

    if (raw.trim() === '') { out.push(''); continue; }

    out.push(`<p>${inlineFormat(escapeHtml(raw))}</p>`);
  }

  if (inCode) flushCode();
  if (inTable) out.push('</tbody></table>');
  if (inBlockquote) out.push('</p></div>');
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  const date = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* ── Base: GEO Hub User Guide CSS (verbatim) ── */
:root {
  --navy:   #03234b;
  --navy2:  #0a3d7a;
  --blue:   #3cb4e6;
  --blue2:  #1a8ec5;
  --yellow: #ffd200;
  --slate:  #8191a5;
  --bg:     #f4f6f9;
  --white:  #ffffff;
  --border: #dde3ed;
  --text:   #1a2b42;
  --muted:  #5a6a7e;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}

/* ── HEADER ── */
.site-header{
  position:sticky;top:0;z-index:100;
  background:var(--navy);
  border-bottom:3px solid var(--yellow);
  box-shadow:0 2px 16px rgba(3,35,75,.35);
}
.header-inner{
  max-width:1080px;margin:0 auto;
  padding:0 24px;height:56px;
  display:flex;align-items:center;justify-content:space-between;gap:16px;
}
.header-logo{display:flex;align-items:center;gap:12px;text-decoration:none}
.st-badge{
  background:var(--yellow);color:var(--navy);
  font-weight:800;font-size:13px;letter-spacing:-.01em;
  padding:4px 9px;border-radius:4px;line-height:1;
}
.header-logo-text h1{font-size:14px;font-weight:700;color:#fff;letter-spacing:.01em;line-height:1.2}
.header-logo-text p{font-size:10px;color:var(--slate);letter-spacing:.12em;text-transform:uppercase}
.header-right{display:flex;align-items:center;gap:16px}
.nav-links{display:flex;gap:20px}
.nav-links a{font-size:12px;color:rgba(255,255,255,.6);text-decoration:none;font-weight:500;letter-spacing:.03em;transition:color .2s}
.nav-links a:hover{color:#fff}
.lang-toggle{
  display:flex;background:rgba(255,255,255,.1);border-radius:6px;padding:2px;gap:2px;
}
.lang-btn{
  padding:4px 12px;border:none;background:transparent;
  font-size:11px;font-weight:700;color:rgba(255,255,255,.5);
  cursor:pointer;border-radius:4px;transition:all .2s;font-family:inherit;letter-spacing:.05em;
}
.lang-btn.active{background:#fff;color:var(--navy)}

/* ── HERO ── */
.hero{
  background:var(--navy);
  position:relative;overflow:hidden;
  padding:36px 24px 32px;
}
.hero::before{
  content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(-55deg,transparent 0,transparent 32px,rgba(60,180,230,.04) 32px,rgba(60,180,230,.04) 33px);
  pointer-events:none;
}
.hero::after{
  content:'';position:absolute;
  right:-60px;top:-60px;
  width:400px;height:400px;
  background:radial-gradient(circle,rgba(255,210,0,.06) 0%,transparent 70%);
  pointer-events:none;
}
.hero-inner{
  max-width:1080px;margin:0 auto;position:relative;z-index:1;
  display:grid;grid-template-columns:1fr auto;gap:32px;align-items:center;
}
.hero-left{}
.hero-right{
  display:flex;flex-direction:column;gap:8px;min-width:220px;
}
.hero-eyebrow{
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(255,210,0,.12);border:1px solid rgba(255,210,0,.25);
  color:var(--yellow);font-size:10px;font-weight:700;
  letter-spacing:.15em;text-transform:uppercase;
  padding:4px 12px;border-radius:99px;margin-bottom:10px;
}
.hero h2{
  font-size:clamp(22px,3vw,34px);font-weight:700;
  color:#fff;line-height:1.2;letter-spacing:-.02em;
  margin-bottom:10px;
}
.hero h2 span{color:var(--yellow)}
.hero-lead{
  font-size:13px;color:rgba(255,255,255,.6);
  line-height:1.65;margin-bottom:0;
}
.hero-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.chip{
  font-size:11px;font-weight:600;
  padding:4px 12px;border-radius:99px;
  border:1px solid rgba(60,180,230,.3);
  color:var(--blue);background:rgba(60,180,230,.08);
  letter-spacing:.03em;
}
.hero-step-list{
  display:flex;flex-direction:column;gap:0;
}
.hero-step{
  display:flex;align-items:center;gap:10px;
  padding:10px 14px;border-radius:10px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
  margin-bottom:6px;
}
.hero-step:last-child{margin-bottom:0}
.hero-step-n{
  width:22px;height:22px;border-radius:50%;
  background:var(--yellow);color:var(--navy);
  font-size:11px;font-weight:800;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.hero-step-text{font-size:12px;font-weight:600;color:rgba(255,255,255,.85)}
.hero-step-sub{font-size:11px;color:var(--slate);margin-top:1px}

/* ── LAYOUT ── */
.page{max-width:1080px;margin:0 auto;padding:0 24px}

/* ── SECTION TITLE ── */
.sec-label{
  font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;
  color:var(--blue);margin-bottom:4px;display:flex;align-items:center;gap:8px;
}
.sec-label::before{content:'';width:16px;height:2px;background:var(--blue);border-radius:1px}
.sec-title{font-size:clamp(17px,2.5vw,22px);font-weight:700;letter-spacing:-.02em;color:var(--navy);margin-bottom:6px}
.sec-lead{font-size:13px;color:var(--muted);line-height:1.6;max-width:800px}

/* ── WHY CARD ── */
section{padding:36px 0 0}
.why-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.why-card{
  background:var(--white);border:1px solid var(--border);
  border-radius:12px;padding:18px;
  box-shadow:0 2px 8px rgba(3,35,75,.04);
}
.why-card.old .why-icon{background:rgba(148,163,184,.12);color:#64748b}
.why-card.new .why-icon{background:rgba(255,210,0,.12);color:var(--navy)}
.why-icon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;margin-bottom:10px}
.why-card h4{font-size:13px;font-weight:700;margin-bottom:6px;color:var(--navy)}
.why-card p{font-size:12px;color:var(--muted);line-height:1.55}
.why-card ul{list-style:none;display:flex;flex-direction:column;gap:4px;margin-top:8px}
.why-card ul li{font-size:12px;color:var(--muted);display:flex;gap:8px;line-height:1.4}
.why-card ul li::before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor;margin-top:6px;flex-shrink:0}
.why-card.old ul li::before{color:#94a3b8}
.why-card.new ul li::before{color:var(--blue)}

/* ── FLOW ── */
.flow{display:flex;align-items:flex-start;gap:0;margin-top:16px;position:relative}
.flow::before{
  content:'';position:absolute;
  top:22px;left:calc(10% + 22px);right:calc(10% + 22px);
  height:2px;background:linear-gradient(90deg,var(--blue),var(--yellow));
  z-index:0;
}
.flow-step{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;z-index:1;padding:0 8px}
.flow-circle{
  width:44px;height:44px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:18px;margin-bottom:10px;
  border:3px solid var(--white);
  box-shadow:0 0 0 3px;
}
.flow-step:nth-child(1) .flow-circle{background:var(--navy);color:#fff;box-shadow:0 0 0 3px var(--blue)}
.flow-step:nth-child(2) .flow-circle{background:var(--navy);color:#fff;box-shadow:0 0 0 3px var(--blue)}
.flow-step:nth-child(3) .flow-circle{background:var(--yellow);color:var(--navy);box-shadow:0 0 0 3px var(--yellow)}
.flow-num{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--slate);margin-bottom:3px}
.flow-title{font-size:14px;font-weight:700;color:var(--navy);margin-bottom:4px}
.flow-sub{font-size:11px;color:var(--muted);line-height:1.45}

/* ── STEP DETAIL ── */
.step-section{
  background:var(--white);border:1px solid var(--border);
  border-radius:14px;padding:24px;margin-top:14px;
  box-shadow:0 2px 12px rgba(3,35,75,.05);
  position:relative;overflow:hidden;
}
.step-section::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:4px;
  border-radius:4px 0 0 4px;
}
.step-section.s1::before{background:var(--blue)}
.step-section.s2::before{background:var(--yellow)}
.step-section.s3::before{background:linear-gradient(to bottom,var(--blue),var(--yellow))}
.step-head{display:flex;align-items:flex-start;gap:14px;margin-bottom:16px}
.step-badge{
  width:38px;height:38px;border-radius:10px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:17px;
}
.s1 .step-badge{background:rgba(60,180,230,.12)}
.s2 .step-badge{background:rgba(255,210,0,.15)}
.s3 .step-badge{background:rgba(3,35,75,.07)}
.step-head-text h3{font-size:16px;font-weight:700;letter-spacing:-.01em;color:var(--navy);margin-bottom:4px}
.step-head-text p{font-size:12px;color:var(--muted);line-height:1.55}

/* screenshot */
.ss-wrap{
  background:#0d1929;border-radius:10px;overflow:hidden;
  margin:14px 0;border:1px solid rgba(255,255,255,.08);
  box-shadow:0 4px 20px rgba(3,35,75,.15);
}
.ss-bar{
  background:#1a2b3d;padding:8px 14px;
  display:flex;align-items:center;gap:8px;
}
.ss-dot{width:9px;height:9px;border-radius:50%}
.ss-dot.r{background:#f87171}.ss-dot.y{background:var(--yellow)}.ss-dot.g{background:#4ade80}
.ss-url{margin-left:8px;background:#0d1929;border-radius:4px;padding:2px 12px;font-size:10px;font-family:'DM Mono',monospace;color:rgba(255,255,255,.4)}
.ss-wrap img{width:100%;display:block}

/* callouts */
.callouts{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}
.callout{
  background:var(--bg);border:1px solid var(--border);
  border-radius:8px;padding:10px 12px;
  display:flex;gap:10px;align-items:flex-start;
}
.callout-num{
  width:20px;height:20px;border-radius:50%;flex-shrink:0;
  background:var(--navy);color:#fff;font-size:10px;font-weight:700;
  display:flex;align-items:center;justify-content:center;margin-top:1px;
}
.callout h5{font-size:12px;font-weight:700;color:var(--navy);margin-bottom:2px}
.callout p{font-size:11px;color:var(--muted);line-height:1.45}

/* tactics */
.tactics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.tactic{
  border-radius:10px;padding:14px;
  border:1px solid var(--border);background:var(--bg);
}
.tactic-icon{font-size:18px;margin-bottom:8px}
.tactic h5{font-size:12px;font-weight:700;color:var(--navy);margin-bottom:4px}
.tactic p{font-size:11px;color:var(--muted);line-height:1.5}
.tactic-tag{
  display:inline-block;margin-top:8px;
  font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  padding:2px 8px;border-radius:99px;
}
.tactic:nth-child(1) .tactic-tag{background:rgba(60,180,230,.1);color:var(--blue2)}
.tactic:nth-child(2) .tactic-tag{background:rgba(255,210,0,.15);color:#996600}
.tactic:nth-child(3) .tactic-tag{background:rgba(224,63,63,.08);color:#b03030}

/* methods */
.methods{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}
.method{
  display:flex;align-items:center;gap:10px;
  background:var(--bg);border:1px solid var(--border);
  border-radius:8px;padding:9px 12px;
}
.method-lift{
  background:rgba(13,159,110,.1);color:#0d9f6e;
  font-size:10px;font-weight:700;padding:2px 7px;
  border-radius:99px;white-space:nowrap;flex-shrink:0;
}
.method p{font-size:12px;color:var(--navy);font-weight:500}

/* standalone */
.standalone-modes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.smode{
  background:var(--bg);border:1px solid var(--border);
  border-radius:10px;padding:14px 12px;text-align:center;
}
.smode-icon{font-size:22px;margin-bottom:6px}
.smode h5{font-size:12px;font-weight:700;color:var(--navy);margin-bottom:4px}
.smode p{font-size:11px;color:var(--muted);line-height:1.45}

/* ecosystem */
.eco-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
.eco{
  background:var(--white);border:1px solid var(--border);
  border-radius:10px;padding:14px 12px;text-align:center;
  box-shadow:0 2px 8px rgba(3,35,75,.04);
}
.eco-flag{font-size:22px;margin-bottom:6px}
.eco h5{font-size:13px;font-weight:700;color:var(--navy);margin-bottom:4px}
.eco p{font-size:11px;color:var(--muted);line-height:1.4}
.eco-badge{
  display:inline-block;margin-top:6px;
  font-size:10px;font-weight:700;letter-spacing:.06em;
  padding:2px 8px;border-radius:99px;
  background:rgba(60,180,230,.1);color:var(--blue2);
}
.eco.cn .eco-badge{background:rgba(255,210,0,.15);color:#996600}

/* FAQ */
.faq{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.faq-item{
  background:var(--white);border:1px solid var(--border);
  border-radius:10px;overflow:hidden;
}
.faq-q{
  width:100%;text-align:left;background:none;border:none;
  padding:12px 16px;cursor:pointer;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  font-family:inherit;font-size:13px;font-weight:600;color:var(--navy);
}
.faq-q:hover{background:#f8fafc}
.faq-chevron{color:var(--slate);font-size:16px;transition:transform .25s;flex-shrink:0}
.faq-a{
  display:none;padding:0 16px 14px;
  font-size:12px;color:var(--muted);line-height:1.65;
}
.faq-item.open .faq-a{display:block}
.faq-item.open .faq-chevron{transform:rotate(180deg)}

/* TIP BOX */
.tip{
  background:rgba(255,210,0,.08);border:1px solid rgba(255,210,0,.3);
  border-radius:10px;padding:12px 16px;
  display:flex;gap:10px;align-items:flex-start;margin-top:12px;
}
.tip-icon{font-size:15px;flex-shrink:0;margin-top:2px}
.tip p{font-size:12px;color:#5a4a00;line-height:1.55}
.tip strong{color:var(--navy)}

/* TABLE */
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
th{background:var(--navy);color:#fff;font-weight:600;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.03em}
td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top;line-height:1.45}
tr:last-child td{border-bottom:none}
tr:hover td{background:#f8fafc}
td code{font-family:'DM Mono',monospace;font-size:11px;background:#f1f5f9;padding:1px 6px;border-radius:4px;color:var(--navy)}

/* FOOTER */
footer{
  margin-top:48px;background:var(--navy);
  border-top:3px solid var(--yellow);
  padding:24px;
}
.footer-inner{
  max-width:1080px;margin:0 auto;
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;
}
.footer-left p{font-size:12px;color:var(--slate);line-height:1.7}
.footer-left a{color:var(--blue);text-decoration:none}
.footer-stack{display:flex;flex-wrap:wrap;gap:6px}
.tech-pill{
  font-size:10px;font-weight:600;letter-spacing:.04em;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.5);padding:3px 10px;border-radius:99px;
}

/* UTILS */
.mt-24{margin-top:14px}
.mt-16{margin-top:10px}
.pb-80{padding-bottom:48px}

[data-lang]{transition:opacity .2s}

@media(max-width:720px){
  .why-grid,.tactics,.eco-grid,.standalone-modes,.methods{grid-template-columns:1fr 1fr}
  .flow{flex-direction:column;align-items:stretch}
  .flow::before{display:none}
  .flow-step{flex-direction:row;text-align:left;padding:12px 0}
  .flow-circle{margin-bottom:0;margin-right:16px;flex-shrink:0}
  .nav-links{display:none}
}
@media(max-width:480px){
  .why-grid,.tactics,.eco-grid,.standalone-modes,.methods{grid-template-columns:1fr}
}

/* ── Report-specific overrides ── */
body { background: var(--bg); }

.report-wrap {
  max-width: 860px;
  margin: 0 auto;
  padding: 0 24px 80px;
}

/* code block override for report */
pre {
  background: #0d1929;
  border-radius: 10px;
  padding: 18px 22px;
  overflow-x: auto;
  margin: 1em 0;
  border-left: 4px solid var(--yellow);
}
pre code.dm-mono {
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  line-height: 1.65;
  color: #e2e8f0;
  background: none;
  padding: 0;
}

/* paragraph spacing inside report */
.report-body p { margin-bottom: .9em; line-height: 1.75; font-size: 14px; }
.report-body hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
.report-body strong { color: var(--navy); }
.report-body a { color: var(--blue); }

/* list styles */
.report-ul, .report-ol { margin: .5em 0 1em 1.4em; }
.report-ul li, .report-ol li { font-size: 13px; color: var(--text); margin-bottom: .35em; line-height: 1.6; }

/* sec-label spacing in report */
.report-body .sec-label { margin-top: 2em; margin-bottom: .4em; }
.report-body .sec-title { margin-top: .3em; margin-bottom: .8em; }


/* ── INFOGRAPHIC COMPONENTS ── */

/* Stat cards row */
.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}
.stat-card{
  background:var(--white);border:1px solid var(--border);border-radius:12px;
  padding:18px 16px;text-align:center;
  box-shadow:0 2px 8px rgba(3,35,75,.06);
  position:relative;overflow:hidden;
}
.stat-card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:3px;
  background:linear-gradient(90deg,var(--blue),var(--yellow));
}
.stat-card .stat-num{
  font-size:2em;font-weight:800;color:var(--navy);
  letter-spacing:-.03em;line-height:1;margin-bottom:6px;
}
.stat-card .stat-label{font-size:11px;color:var(--muted);font-weight:600;line-height:1.4}

/* Section header with numbered badge */
.sec-header{
  display:flex;align-items:center;gap:14px;
  margin:32px 0 16px;padding-bottom:12px;
  border-bottom:2px solid var(--border);
}
.sec-num{
  width:32px;height:32px;border-radius:50%;flex-shrink:0;
  background:var(--navy);color:#fff;
  font-size:13px;font-weight:800;
  display:flex;align-items:center;justify-content:center;
}
.sec-header-text{font-size:17px;font-weight:700;color:var(--navy);letter-spacing:-.01em}

/* Threat badge cards */
.threat-card{
  display:flex;align-items:flex-start;gap:12px;
  background:var(--bg);border:1px solid var(--border);
  border-radius:10px;padding:14px 16px;margin:8px 0;
}
.threat-badge{
  flex-shrink:0;font-size:10px;font-weight:800;
  letter-spacing:.06em;text-transform:uppercase;
  padding:3px 10px;border-radius:99px;white-space:nowrap;margin-top:2px;
}
.threat-high{background:rgba(239,68,68,.12);color:#dc2626}
.threat-mid{background:rgba(245,158,11,.12);color:#d97706}
.threat-low{background:rgba(16,185,129,.12);color:#059669}
.threat-body{font-size:13px;color:var(--text);line-height:1.6}
.threat-body strong{color:var(--navy)}

/* Action step cards */
.action-list{display:flex;flex-direction:column;gap:10px;margin:16px 0}
.action-card{
  display:flex;align-items:flex-start;gap:14px;
  background:var(--white);border:1px solid var(--border);
  border-radius:10px;padding:14px 16px;
  box-shadow:0 1px 4px rgba(3,35,75,.04);
}
.action-n{
  width:26px;height:26px;border-radius:50%;flex-shrink:0;
  background:linear-gradient(135deg,var(--blue),var(--navy));
  color:#fff;font-size:12px;font-weight:800;
  display:flex;align-items:center;justify-content:center;
}
.action-body{font-size:13px;color:var(--text);line-height:1.6;flex:1}
.action-body strong{color:var(--navy)}

/* GEO signal table with progress bars */
table.geo-signal th{background:var(--navy)}
table.geo-signal td.bar-cell{padding:8px 16px;min-width:120px}
.bar-wrap{background:#e8edf3;border-radius:99px;height:8px;overflow:hidden}
.bar-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue),var(--yellow))}

/* Insight highlight box */
.insight-box{
  background:linear-gradient(135deg,rgba(60,180,230,.08),rgba(3,35,75,.04));
  border:1px solid rgba(60,180,230,.25);border-left:4px solid var(--blue);
  border-radius:0 10px 10px 0;
  padding:16px 20px;margin:16px 0;
}
.insight-box p{font-size:13px;color:var(--navy);line-height:1.7;margin:0}

@media print {
  .site-header { position: static; }
  .hero { padding: 24px; }
  pre, table { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
}
</style>
</head>
<body>

<!-- Header (matches User Guide) -->
<header class="site-header">
  <div class="header-inner">
    <a class="header-logo" href="#">
      <span class="st-badge">ST</span>
      <div class="header-logo-text">
        <h1>GEO Strategic Hub</h1>
        <p>Brand Visibility Intelligence</p>
      </div>
    </a>
    <div class="header-right">
      <span style="font-size:11px;color:rgba(255,255,255,.4);letter-spacing:.08em;text-transform:uppercase">Strategic Report</span>
    </div>
  </div>
</header>

<!-- Hero banner -->
<div class="hero">
  <div class="hero-inner">
    <div class="hero-left">
      <div class="hero-eyebrow">📊 GEO Analysis Output</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="hero-lead">AI-powered brand visibility analysis · Generated ${date}</p>
      <div class="hero-chips">
        <span class="chip">Brand Monitoring</span>
        <span class="chip">GEO Strategy</span>
        <span class="chip">Content Playbook</span>
      </div>
    </div>
  </div>
</div>

<!-- Report body -->
<div class="report-wrap">
  <div class="report-body">
${postProcessHtml(out.join('\n'))}
  </div>
</div>

<!-- Footer (matches User Guide) -->
<footer>
  <div class="footer-inner">
    <div class="footer-left">
      <p>© 2026 GEO Strategic Hub · <a href="mailto:yude.jiang@st.com">yude.jiang@st.com</a><br>
      Generated ${date} · For internal use only</p>
    </div>
    <div class="footer-stack">
      <span class="tech-pill">Gemini 2.5 Pro</span>
      <span class="tech-pill">DeepSeek</span>
      <span class="tech-pill">GEO Analysis</span>
      <span class="tech-pill">STMicroelectronics</span>
    </div>
  </div>
</footer>

</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────────────────────
// ─── Parse dual-output: split MD and HTML blocks ─────────────────────────────
function parseReportContent(raw: string): { md: string; htmlBody: string } {
  const mdMatch = raw.match(/%%MD_START%%([\s\S]*?)%%MD_END%%/);
  const htmlMatch = raw.match(/%%HTML_BODY_START%%([\s\S]*?)%%HTML_BODY_END%%/);
  return {
    md: mdMatch ? mdMatch[1].trim() : raw,
    htmlBody: htmlMatch ? htmlMatch[1].trim() : '',
  };
}

// ─── Build full HTML file from Gemini's body content ─────────────────────────
function buildHtmlShell(bodyContent: string, title: string, date: string): string {
  const css = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#03234b;--navy2:#0a3d7a;--blue:#3cb4e6;--yellow:#ffd200;
  --bg:#f0f4f8;--white:#fff;--border:#dde3ed;--text:#1a2b42;--muted:#5a6a7e;
  --red:#ef4444;--amber:#f59e0b;--green:#10b981;--violet:#7c3aed;
  --radius:14px;
}
html{scroll-behavior:smooth}
body{
  font-family:Arial,Helvetica,sans-serif;
  background:var(--bg);color:var(--text);
  line-height:1.65;-webkit-font-smoothing:antialiased;
}

/* ── TOP HEADER ── */
.top-header{
  background:var(--navy);
  border-bottom:3px solid var(--yellow);
  padding:0 32px;height:56px;
  display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:100;
  box-shadow:0 2px 20px rgba(3,35,75,.4);
}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none}
.st-badge{background:var(--yellow);color:var(--navy);font-weight:800;font-size:13px;padding:4px 9px;border-radius:4px}
.logo-text{font-size:13px;font-weight:700;color:#fff;letter-spacing:.01em}
.header-meta{font-size:11px;color:rgba(255,255,255,.4);letter-spacing:.1em;text-transform:uppercase}

/* ── HERO ── */
.hero{
  background:var(--navy);
  padding:52px 32px 48px;
  position:relative;overflow:hidden;
}
.hero::before{
  content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(-55deg,transparent,transparent 40px,rgba(60,180,230,.03) 40px,rgba(60,180,230,.03) 41px);
}
.hero::after{
  content:'';position:absolute;right:-100px;top:-100px;
  width:500px;height:500px;
  background:radial-gradient(circle,rgba(255,210,0,.07),transparent 65%);
  pointer-events:none;
}
.hero-inner{max-width:1100px;margin:0 auto;position:relative;z-index:1}
.hero-eyebrow{
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(255,210,0,.1);border:1px solid rgba(255,210,0,.2);
  color:var(--yellow);font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;
  padding:5px 14px;border-radius:99px;margin-bottom:16px;
}
.hero h1{
  font-family:Arial,Helvetica,sans-serif;
  font-size:clamp(22px,3.5vw,38px);font-weight:800;
  color:#fff;line-height:1.15;letter-spacing:-.02em;
  max-width:820px;margin-bottom:16px;
}
.hero h1 em{color:var(--yellow);font-style:normal}
.hero-sub{font-size:14px;color:rgba(255,255,255,.55);margin-bottom:28px;max-width:600px}
.hero-chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{
  font-size:11px;font-weight:600;
  padding:5px 14px;border-radius:99px;
  border:1px solid rgba(60,180,230,.3);
  color:var(--blue);background:rgba(60,180,230,.08);
}

/* ── STAT BANNER ── */
.stat-banner{
  background:var(--white);
  border-bottom:1px solid var(--border);
  padding:0 32px;
}
.stat-banner-inner{
  max-width:1100px;margin:0 auto;
  display:grid;grid-template-columns:repeat(4,1fr);
  divide-x:1px solid var(--border);
}
.stat-item{
  padding:24px 20px;
  border-right:1px solid var(--border);
  position:relative;
}
.stat-item:last-child{border-right:none}
.stat-item::before{
  content:'';position:absolute;top:0;left:0;right:0;height:3px;
}
.stat-item:nth-child(1)::before{background:var(--blue)}
.stat-item:nth-child(2)::before{background:var(--yellow)}
.stat-item:nth-child(3)::before{background:var(--red)}
.stat-item:nth-child(4)::before{background:var(--green)}
.stat-num{
  font-family:Arial,Helvetica,sans-serif;
  font-size:2.4em;font-weight:800;color:var(--navy);
  letter-spacing:-.03em;line-height:1;
}
.stat-unit{font-size:.5em;font-weight:600;color:var(--muted);vertical-align:super}
.stat-label{font-size:11px;font-weight:600;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.06em}

/* ── PAGE WRAP ── */
.page{max-width:1100px;margin:0 auto;padding:40px 32px 80px}

/* ── SECTION HEADER ── */
.sec{margin-bottom:40px}
.sec-head{
  display:flex;align-items:center;gap:14px;
  margin-bottom:20px;padding-bottom:14px;
  border-bottom:2px solid var(--border);
}
.sec-num{
  width:34px;height:34px;border-radius:50%;flex-shrink:0;
  background:var(--navy);color:#fff;
  font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;
  display:flex;align-items:center;justify-content:center;
}
.sec-title-text{
  font-family:Arial,Helvetica,sans-serif;
  font-size:18px;font-weight:800;color:var(--navy);letter-spacing:-.02em;
}

/* ── CARD GRID ── */
.card-grid{display:grid;gap:16px}
.card-grid.cols-2{grid-template-columns:1fr 1fr}
.card-grid.cols-3{grid-template-columns:repeat(3,1fr)}

.card{
  background:var(--white);border:1px solid var(--border);
  border-radius:var(--radius);padding:20px;
  box-shadow:0 2px 8px rgba(3,35,75,.05);
  position:relative;overflow:hidden;
}
.card-label{
  font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;
  color:var(--blue);margin-bottom:8px;
  display:flex;align-items:center;gap:6px;
}
.card-label::before{content:'';width:14px;height:2px;background:currentColor;border-radius:1px}
.card p{font-size:13px;color:var(--text);line-height:1.7}
.card strong{color:var(--navy)}

/* Insight card (accent left border) */
.card.insight{border-left:4px solid var(--blue);background:linear-gradient(135deg,rgba(60,180,230,.04),rgba(3,35,75,.02))}
.card.warn{border-left:4px solid var(--amber)}
.card.danger{border-left:4px solid var(--red)}
.card.success{border-left:4px solid var(--green)}

/* ── THREAT CARDS ── */
.threat-list{display:flex;flex-direction:column;gap:10px}
.threat-card{
  background:var(--white);border:1px solid var(--border);
  border-radius:10px;padding:14px 16px;
  display:flex;align-items:flex-start;gap:12px;
}
.tbadge{
  flex-shrink:0;font-size:10px;font-weight:800;letter-spacing:.06em;
  text-transform:uppercase;padding:3px 10px;border-radius:99px;white-space:nowrap;margin-top:2px;
}
.tbadge.high{background:rgba(239,68,68,.1);color:#dc2626}
.tbadge.mid{background:rgba(245,158,11,.1);color:#d97706}
.tbadge.low{background:rgba(16,185,129,.1);color:#059669}
.threat-body{font-size:13px;color:var(--text);line-height:1.65;flex:1}
.threat-body strong{color:var(--navy)}

/* ── GEO SIGNAL TABLE ── */
.signal-table{width:100%;border-collapse:collapse;font-size:13px;border-radius:var(--radius);overflow:hidden;box-shadow:0 0 0 1px var(--border)}
.signal-table th{background:var(--navy);color:#fff;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:11px 16px;text-align:left}
.signal-table td{padding:12px 16px;border-bottom:1px solid var(--border);vertical-align:middle}
.signal-table tr:last-child td{border-bottom:none}
.signal-table tr:nth-child(even) td{background:#f8fafc}
.delta-pos{color:#059669;font-weight:700}
.delta-neg{color:#dc2626;font-weight:700}
.bar-wrap{background:#e8edf3;border-radius:99px;height:7px;overflow:hidden;margin-top:5px;width:100px}
.bar-before{height:100%;background:#94a3b8;border-radius:99px}
.bar-after{height:100%;background:linear-gradient(90deg,var(--blue),var(--yellow));border-radius:99px}

/* ── ACTION STEPS ── */
.action-list{display:flex;flex-direction:column;gap:10px}
.action-card{
  background:var(--white);border:1px solid var(--border);
  border-radius:10px;padding:16px;
  display:flex;align-items:flex-start;gap:14px;
  box-shadow:0 1px 4px rgba(3,35,75,.04);
  transition:box-shadow .2s,transform .2s;
}
.action-card:hover{box-shadow:0 4px 16px rgba(3,35,75,.1);transform:translateY(-1px)}
.action-n{
  width:28px;height:28px;border-radius:50%;flex-shrink:0;
  background:linear-gradient(135deg,var(--blue),var(--navy));
  color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;
  display:flex;align-items:center;justify-content:center;
}
.action-body{font-size:13px;color:var(--text);line-height:1.65;flex:1}
.action-body strong{color:var(--navy);display:block;margin-bottom:4px}
.priority-badge{
  flex-shrink:0;margin-top:2px;
  font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  padding:2px 8px;border-radius:99px;
}
.pri-high{background:rgba(239,68,68,.1);color:#dc2626}
.pri-mid{background:rgba(245,158,11,.1);color:#d97706}

/* ── INTENT CLUSTER CHIPS ── */
.cluster-grid{display:flex;flex-wrap:wrap;gap:8px}
.cluster-chip{
  background:rgba(60,180,230,.08);border:1px solid rgba(60,180,230,.25);
  color:var(--navy2);font-size:12px;font-weight:600;
  padding:6px 14px;border-radius:99px;
  display:flex;align-items:center;gap:6px;
}
.cluster-chip .dot{width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0}

/* ── PLAYBOOK CARD ── */
.playbook-card{
  background:var(--navy);color:#fff;
  border-radius:var(--radius);padding:22px;
  position:relative;overflow:hidden;
}
.playbook-card::before{
  content:'';position:absolute;right:-40px;top:-40px;
  width:200px;height:200px;
  background:radial-gradient(circle,rgba(255,210,0,.08),transparent 70%);
}
.playbook-type{
  font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;
  color:var(--yellow);margin-bottom:10px;
}
.playbook-title{font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;color:#fff;margin-bottom:10px;line-height:1.3}
.playbook-body{font-size:12px;color:rgba(255,255,255,.65);line-height:1.65}
.playbook-snippet{
  margin-top:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  border-radius:8px;padding:12px;
  font-family:'Courier New',Courier,monospace;font-size:11px;color:rgba(255,255,255,.8);line-height:1.6;
}

/* ── CORPUS DEFICIT VISUAL ── */
.deficit-bar-wrap{margin:16px 0}
.deficit-row{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.deficit-label{font-size:12px;font-weight:600;color:var(--navy);min-width:140px}
.deficit-bar-outer{flex:1;background:#e8edf3;border-radius:99px;height:10px;overflow:hidden}
.deficit-bar-fill{height:100%;border-radius:99px}
.deficit-val{font-size:12px;font-weight:700;color:var(--navy);min-width:40px;text-align:right}

/* ── FOOTER ── */
footer{
  background:var(--navy);border-top:3px solid var(--yellow);
  padding:24px 32px;
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;
}
.footer-text{font-size:12px;color:rgba(255,255,255,.4)}
.footer-stack{display:flex;gap:6px;flex-wrap:wrap}
.tech-pill{
  font-size:10px;font-weight:600;letter-spacing:.04em;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.5);padding:3px 10px;border-radius:99px;
}

/* ── ANIMATIONS ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.sec{animation:fadeUp .5s ease both}
.sec:nth-child(2){animation-delay:.1s}
.sec:nth-child(3){animation-delay:.15s}
.sec:nth-child(4){animation-delay:.2s}
.sec:nth-child(5){animation-delay:.25s}

@media(max-width:720px){
  .stat-banner-inner{grid-template-columns:1fr 1fr}
  .card-grid.cols-2,.card-grid.cols-3{grid-template-columns:1fr}
  .hero h1{font-size:22px}
  .page{padding:24px 16px 60px}
}
@media print{
  .top-header{position:static}
  .action-card:hover{transform:none;box-shadow:none}
  .sec{animation:none}
}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<header class="top-header">
  <a class="logo" href="#"><span class="st-badge">ST</span><span class="logo-text">GEO Strategic Hub</span></a>
  <span class="header-meta">Strategic Report · ${date}</span>
</header>
${bodyContent}
<footer>
  <div class="footer-text">© 2026 GEO Strategic Hub · yude.jiang@st.com · For internal use only</div>
  <div class="footer-stack">
    <span class="tech-pill">Gemini 2.5 Pro</span>
    <span class="tech-pill">GEO Analysis</span>
    <span class="tech-pill">STMicroelectronics</span>
    <span class="tech-pill">${date}</span>
  </div>
</footer>
</body></html>`;
}

const ReportModal: React.FC<Props> = ({ isOpen, onClose, content, isGenerating, t }) => {
  if (!isOpen) return null;

  const p = t.production;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportTitle = p.reportTitle ?? 'GEO Strategic Report';

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
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${title}-GEO战略报告-${date}.md`);
  };

  const handleDownloadHtml = () => {
    const title = toFilename(extractTitle(md));
    const htmlOut = hasHtml
      ? buildHtmlShell(htmlBody, reportTitle, date)
      : markdownToStyledHtml(md, reportTitle);
    downloadBlob(
      new Blob([htmlOut], { type: 'text/html;charset=utf-8' }),
      `${title}-GEO战略报告-${date}.html`
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
