// ─── Build full HTML file from Gemini's body content ─────────────────────────
export function buildHtmlShell(bodyContent: string, title: string, date: string): string {
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
  .etl-cells{grid-template-columns:1fr}
  .etl-axis{display:none}
}
/* ── EXECUTION TIMELINE (2 tracks: Content Assets / Promotion) ── */
.exec-timeline{margin:14px 0 8px;border:1px solid #e8edf3;border-radius:14px;overflow:hidden}
.etl-axis{display:grid;grid-template-columns:repeat(3,1fr);margin-left:96px;background:var(--navy)}
.etl-phase{padding:9px 12px;color:#fff;font-size:11px;font-weight:800;letter-spacing:.02em;border-left:1px solid rgba(255,255,255,.14)}
.etl-phase:first-child{border-left:none}
.etl-track{display:grid;grid-template-columns:96px 1fr;border-top:1px solid #e8edf3}
.etl-track-label{display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:800;color:#fff;padding:10px 6px;line-height:1.3}
.etl-track.assets .etl-track-label{background:#1f4e79}
.etl-track.promo .etl-track-label{background:#5b6b80}
.etl-cells{display:grid;grid-template-columns:repeat(3,1fr)}
.etl-cell{padding:10px;border-left:1px solid #eef2f7;display:flex;flex-direction:column;gap:6px;align-content:flex-start}
.etl-cell:first-child{border-left:none}
.etl-item{display:block;font-size:11px;font-weight:600;line-height:1.35;padding:5px 9px;border-radius:8px;background:#eef6fb;color:var(--navy);border:1px solid #d6e9f5}
.etl-track.promo .etl-item{background:#fff7da;border-color:#ffe699;color:#7a5b00}
/* ── APPENDIX (collapsed details) ── */
details{margin:10px 0;border:1px solid #e8edf3;border-radius:12px;background:#fff;overflow:hidden}
details>summary{cursor:pointer;list-style:none;padding:12px 16px;font-weight:700;font-size:13px;color:var(--navy);background:#f8fafc}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:'▸';margin-right:8px;color:var(--blue);font-size:11px}
details[open]>summary::before{content:'▾'}
details>summary:hover{background:#f1f5f9}
details>*:not(summary){padding:0 16px}
details>*:not(summary):last-child{padding-bottom:14px}
@media print{
  details{break-inside:avoid}
  details:not([open]){display:block}
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
  <a class="logo" href="#"><span class="st-badge">ST</span><span class="logo-text">Campaign Hub</span></a>
  <span class="header-meta">${title} · ${date}</span>
</header>
${bodyContent}
<footer>
  <div class="footer-text">© 2026 Campaign Hub · yude.jiang@st.com · For internal use only</div>
  <div class="footer-stack">
    <span class="tech-pill">Gemini 2.5 Pro</span>
    <span class="tech-pill">GEO Analysis</span>
    <span class="tech-pill">STMicroelectronics</span>
    <span class="tech-pill">${date}</span>
  </div>
</footer>
</body></html>`;
}
