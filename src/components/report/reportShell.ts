// Wraps the model's slide HTML (%%HTML_BODY%%) into a standalone, ST
// brand-compliant slide deck (16:9), per the st-ppt-brand skill: ST palette,
// Arial, key message bar, Title Only layout, content/promotion timeline lanes,
// closing trademark slide. Used for both the in-modal preview and the .html
// download.
export function buildHtmlShell(bodyContent: string, title: string, date: string): string {
  const css = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#03234B;      /* ST Dark Blue (Green Vogue) */
  --slate:#425978;     /* dark-blue ramp step 2 */
  --yellow:#FFD200;    /* ST Yellow (Gold) */
  --blue:#3CB4E6;      /* ST Light Blue (Picton Blue) */
  --g1:#EEEFF1; --g2:#DBDEE1; --g3:#C0C8D2;
}
html,body{background:#525659;font-family:Arial,"Helvetica Neue",Helvetica,sans-serif;color:var(--navy);-webkit-font-smoothing:antialiased}
.deck{padding:28px 16px 48px;counter-reset:slide}

/* ── 16:9 slide frame ───────────────────────────────────────────────── */
.slide{
  position:relative;width:100%;max-width:1120px;aspect-ratio:16/9;margin:0 auto 26px;
  background:#fff;box-shadow:0 6px 28px rgba(0,0,0,.32);border-radius:2px;
  padding:5.2% 5.6%;overflow:hidden;display:flex;flex-direction:column;
}
/* corner accent (top-right) */
.slide::after{content:'';position:absolute;top:0;right:0;width:74px;height:13px;background:var(--navy)}
/* ST mark + slide number (bottom-left), Title Only footer */
.slide{counter-increment:slide}
.slide::before{content:'ST · ' counter(slide);position:absolute;left:5.6%;bottom:3%;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--g3)}
.slide--title::before,.slide--closing::before,.slide--title::after,.slide--closing::after{display:none}

.slide-title{font-size:1.9rem;font-weight:800;color:var(--navy);text-align:right;line-height:1.15;margin-bottom:.5rem}

/* ── Key message bar (signature element) — single colour, contrast-matched ── */
.msg-bar{font-size:1.05rem;font-weight:700;line-height:1.35;padding:.7rem 1.1rem;margin:.2rem 0 1.1rem;border-radius:2px}
.msg-bar--yellow{background:var(--yellow);color:var(--navy)}   /* never white on yellow */
.msg-bar--navy{background:var(--navy);color:#fff}
.msg-bar--blue{background:var(--blue);color:#fff}

.slide-body{flex:1;min-height:0}

/* ── Title slide ───────────────────────────────────────────────────────── */
.slide--title{background:var(--navy);color:#fff;justify-content:center;padding:7%}
.slide--title .kicker{display:inline-block;background:var(--yellow);color:var(--navy);font-weight:800;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;padding:.35rem .8rem;border-radius:2px;margin-bottom:1.2rem}
.slide--title h1{font-size:2.9rem;font-weight:800;line-height:1.1;color:#fff;max-width:80%}
.slide--title .subtitle{margin-top:1.2rem;color:var(--g3);font-size:1.05rem;font-weight:600}
.slide--title .st-mark{position:absolute;left:7%;bottom:7%;font-weight:800;letter-spacing:.1em;color:var(--yellow)}

/* ── Cards (cards-Nup) ─────────────────────────────────────────────────── */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:14px;height:100%}
.card{display:flex;flex-direction:column;border:1px solid var(--g2);border-radius:4px;overflow:hidden;background:#fff}
.card-head{background:var(--yellow);color:var(--navy);font-weight:800;font-size:.92rem;padding:.6rem .8rem}
.card.navy .card-head{background:var(--navy);color:#fff}
.card.blue .card-head{background:var(--blue);color:#fff}
.card-body{background:var(--g1);padding:.7rem .85rem;flex:1;font-size:.86rem;line-height:1.5;color:var(--navy)}
.card-body ul{list-style:none;margin:0;padding:0}
.card-body li{position:relative;padding-left:1rem;margin:.3rem 0}
.card-body li::before{content:'▪';position:absolute;left:0;color:var(--blue)}
.card-sub{font-size:.7rem;font-weight:800;color:var(--slate);text-transform:uppercase;letter-spacing:.04em;margin:.1rem 0 .15rem}

/* ── Executive summary (GIFBP) ─────────────────────────────────────────── */
.gifbp{display:grid;grid-template-columns:140px 1fr;border:1px solid var(--g2);border-radius:3px;overflow:hidden}
.gifbp-k{background:var(--navy);color:#fff;font-weight:800;font-size:.78rem;padding:.6rem .75rem;display:flex;flex-direction:column;justify-content:center;line-height:1.2;border-top:1px solid rgba(255,255,255,.12)}
.gifbp-k small{font-weight:600;font-size:.62rem;color:var(--g3);text-transform:uppercase;letter-spacing:.05em}
.gifbp-v{background:#fff;color:var(--navy);font-size:.82rem;line-height:1.45;padding:.6rem .85rem;border-top:1px solid var(--g1);display:flex;align-items:center}
.gifbp-k:first-child,.gifbp-v:nth-child(2){border-top:none}

/* ── Message hierarchy (top message / value props / proof / use cases) ──── */
.mh{display:flex;flex-direction:column;gap:9px;height:100%}
.mh-cap{font-size:.62rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);margin-bottom:-3px}
.mh-top{background:var(--blue);color:#fff;font-weight:800;font-size:.98rem;line-height:1.35;text-align:center;padding:.75rem 1rem;border-radius:2px}
.mh-cols{display:grid;grid-template-columns:repeat(var(--n,3),1fr);gap:9px;flex:1;min-height:0}
.mh-col{display:flex;flex-direction:column;border:1px solid var(--g2);border-radius:3px;overflow:hidden}
.mh-vp{background:var(--yellow);color:var(--navy);font-weight:800;font-size:.8rem;line-height:1.25;text-align:center;padding:.55rem .65rem}
.mh-proof{background:var(--g1);color:var(--navy);padding:.55rem .7rem;flex:1;font-size:.72rem;line-height:1.45}
.mh-proof ul{list-style:none;margin:0;padding:0}
.mh-proof li{position:relative;padding-left:.85rem;margin:.28rem 0}
.mh-proof li::before{content:'•';position:absolute;left:0;color:var(--blue);font-weight:800}
.mh-foot{background:var(--g1);border-left:4px solid var(--yellow);border-radius:2px;padding:.5rem .8rem;font-size:.74rem;color:var(--navy)}
.mh-foot b{color:var(--slate)}

/* ── Checklist ─────────────────────────────────────────────────────────── */
.checklist{columns:2;column-gap:2.2rem;font-size:.92rem}
.phase-h{font-weight:800;color:var(--navy);margin:.2rem 0 .5rem;break-after:avoid}
.checklist .item{display:flex;gap:.55rem;align-items:flex-start;margin:.32rem 0;break-inside:avoid;color:var(--slate)}
.checklist .box{flex:0 0 14px;width:14px;height:14px;border:2px solid var(--blue);border-radius:3px;margin-top:2px}

/* ── Timeline (content assets ABOVE a central axis, promotion BELOW) ────── */
.tl-legend{display:flex;gap:.9rem;flex-wrap:wrap;font-size:.66rem;color:var(--slate);margin-bottom:.5rem}
.tl-legend span{display:inline-flex;align-items:center;gap:.3rem}
.tl-legend i{width:11px;height:11px;border-radius:2px;display:inline-block}
.tl{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:stretch}
.tl-side{display:grid;grid-template-rows:1fr 34px 1fr}
.tl-side-label{writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;font-weight:800;font-size:.6rem;letter-spacing:.07em;color:#fff;display:flex;align-items:center;justify-content:center;border-radius:2px}
.tl-side-label.assets{background:var(--navy)}
.tl-side-label.promo{background:var(--slate);grid-row:3}
.tl-main{display:flex;flex-direction:column;min-width:0}
.tl-assets,.tl-promo,.tl-spans{display:grid;grid-template-columns:repeat(var(--n,6),1fr)}
.tl-assets{align-items:end;min-height:120px}
.tl-promo{align-items:start;min-height:120px}
.tl-axis{display:grid;grid-template-columns:repeat(var(--n,6),1fr);position:relative;height:34px;align-items:center}
.tl-axis::before{content:'';position:absolute;left:0;right:6px;top:50%;height:3px;background:var(--navy);transform:translateY(-50%)}
.tl-axis::after{content:'';position:absolute;right:-2px;top:50%;transform:translateY(-50%);border-left:10px solid var(--navy);border-top:7px solid transparent;border-bottom:7px solid transparent}
.tl-date{position:relative;display:flex;align-items:center;justify-content:center}
.tl-date i{width:12px;height:12px;border-radius:50%;background:var(--yellow);box-shadow:0 0 0 2px var(--navy);z-index:1}
.tl-date em{position:absolute;top:calc(50% + 12px);font-style:normal;font-size:.6rem;font-weight:700;color:var(--navy);white-space:nowrap;text-align:center}
.tl-col{display:flex;flex-direction:column;gap:4px;padding:0 4px;position:relative}
.tl-assets .tl-col{justify-content:flex-end}
.tl-promo .tl-col{justify-content:flex-start}
.tl-col.on::before{content:'';position:absolute;left:50%;width:1px;background:var(--g3)}
.tl-assets .tl-col.on::before{bottom:-2px;height:8px}
.tl-promo .tl-col.on::before{top:-2px;height:8px}
.tl-item{font-size:.64rem;line-height:1.25;font-weight:600;padding:.26rem .4rem;border-radius:3px;background:var(--g1);color:var(--navy);border:1px solid var(--g2)}
.tl-item.hl{background:var(--yellow);border-color:#e6bd00;color:var(--navy)}
.tl-item.tbc{background:var(--g2);color:var(--slate)}
.tl-spans{margin-top:6px;row-gap:4px}
.tl-span{grid-row:1;height:16px;border-radius:9px;background:var(--blue);color:#fff;font-size:.58rem;font-weight:700;display:flex;align-items:center;padding:0 .55rem;white-space:nowrap;overflow:hidden}

/* generic helpers a slide body may use */
.slide-body p{font-size:.95rem;line-height:1.6;margin:.4rem 0}
.slide-body ul{margin:.4rem 0 .4rem 1.1rem}
.slide-body li{margin:.3rem 0;font-size:.95rem;line-height:1.5}
.lead{font-size:1.15rem;font-weight:700;color:var(--navy)}

/* ── Closing slide (trademark) ─────────────────────────────────────────── */
.slide--closing{background:var(--navy);color:#fff;justify-content:center;padding:7%}
.slide--closing h2{font-size:2.4rem;font-weight:800;color:#fff;max-width:80%}
.slide--closing .tm-band{margin-top:1.4rem;border-top:4px solid var(--yellow);padding-top:1rem;font-size:.72rem;color:var(--g3);line-height:1.5;max-width:90%}

/* ── Screen viewing header ─────────────────────────────────────────────── */
.deck-bar{max-width:1120px;margin:0 auto 14px;display:flex;align-items:center;justify-content:space-between;color:#cfd4da;font-size:12px}
.deck-bar .st-badge{background:var(--yellow);color:var(--navy);font-weight:800;padding:2px 7px;border-radius:2px;margin-right:8px}

@media(max-width:680px){.slide{padding:6% 6%}.checklist{columns:1}}
@media print{
  @page{size:1280px 720px;margin:0}
  html,body{background:#fff}
  .deck{padding:0}
  .deck-bar{display:none}
  .slide{max-width:none;width:1280px;height:720px;aspect-ratio:auto;margin:0;border-radius:0;box-shadow:none;break-after:page;page-break-after:always}
}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · ${date}</title>
<style>${css}</style>
</head>
<body>
<div class="deck-bar"><span><span class="st-badge">ST</span>Campaign Hub · ${title}</span><span>${date}</span></div>
<div class="deck">
${bodyContent}
</div>
</body>
</html>`;
}
