// ─── Post-process: plain HTML → infographic components ───────────────────────
export function postProcessHtml(html: string): string {
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
