/**
 * Iristel API Marketplace console, v2: the same console in the Iristel
 * brand of the partner portal (light by default, readable dark mode).
 * Behaviour and API calls are those of /console-app.js; only the look and
 * where the theme comes from differ.
 *
 * Hosts:
 *   - the partner portal's /console page with the new design switched on
 *     (html.ir-portal, from the portal's staging gate):
 *       <div id="mp-console"></div>
 *       <script src="https://api-marketplace-1im9.onrender.com/v2/console-app.js"></script>
 *   - the gateway's own /v2/console page (framed by the portal's /dids page).
 * Anywhere else (a page without html.ir-portal) it hands over to
 * /console-app.js, so a page that loads it without the new design keeps
 * today's look. (marketplace-access.js is loaded first if the page hasn't
 * loaded it.)
 *
 * Theme: always the hosting page's html[data-theme] ("dark", else light),
 * followed live. On the portal, theme-runtime.js sets it; on /v2/console,
 * ?theme= and the framing page's postMessage {type:'ir-theme', theme} do.
 * The device's dark setting is never used. Inside the portal the console's
 * own brand bar and Light/Dark switch are hidden: the portal nav has both.
 *
 * The console renders inside a shadow root on #mp-console, so the host
 * page's CSS can't change it and its own CSS can't leak out. It flows with
 * the page instead of scrolling in its own box: the page scrolls, the
 * product and endpoint rails stay in view (sticky), and the Iris panel
 * (iris-console.js, from the same gateway) is fixed to the window. Every API
 * call goes to the gateway that served this script.
 *
 * Optional: set --mp-top on #mp-console to the height of a fixed header on
 * the host page, so the sticky parts sit below it.
 */
(function () {
  'use strict';
  const SCRIPT = document.currentScript;
  const GATEWAY = SCRIPT && SCRIPT.src ? new URL(SCRIPT.src).origin : location.origin;
  const PAGE = document.documentElement;
  // The gateway's own /v2/console page, or a page in the new portal design.
  const STANDALONE = GATEWAY === location.origin;
  if (!STANDALONE && !PAGE.classList.contains('ir-portal')) {
    // Not the new design (production today): load the current console instead.
    if (!window.__mpConsoleLoaded && !document.querySelector('script[data-mp-v1]')) {
      const v1 = document.createElement('script');
      v1.src = GATEWAY + '/console-app.js';
      v1.setAttribute('data-mp-v1', '');
      document.head.appendChild(v1);
    }
    return;
  }
  if (window.__mpConsoleLoaded) return;
  window.__mpConsoleLoaded = true;
  let FRAMED = true;
  try { FRAMED = window.parent !== window; } catch (_) { /* cross-origin parent: framed */ }
  // Own brand bar and Light/Dark switch only when /v2/console is opened on
  // its own; the portal's nav (around it or in the parent page) has both.
  const OWN_CHROME = STANDALONE && !FRAMED;
  const pageTheme = () => (PAGE.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  const CSS = `
  /* v2: the Iristel brand of the partner portal (design-system/portal.css):
     navy, royal and magenta, Heebo headings, Ubuntu text, light by default.
     Every colour is a custom property on :host, so these two blocks theme
     the whole console and the Iris panel. The theme is the hosting page's
     html[data-theme], copied onto the host element by console-app.js; the
     device's dark setting is never used. The console lives in a shadow
     root, so the host page's CSS can't reach it and the page itself scrolls. */
  :host{all:initial;display:block;background:var(--bg);
    color-scheme:only light;
    --bg:#f5f7fb; --bg2:#f6f9fc; --panel:#ffffff; --panel2:#f4fafe; --rail:#ffffff;
    --heading:#01111e; --ink:#0b1f3a; --text:#3d4b59; --muted:#5b6b7f;
    --line:#e8edf2; --line-strong:#d5dde6; --outline:#b9c7d6;
    --field:#f4f9fe; --field-line:#d5dde6;
    /* royal: links, selection, focus; magenta: the main action on a card */
    --accent:#004a9f; --accent2:#0047cc; --accent-ink:#ffffff; --accent-soft:#004a9f;
    --eyebrow:#0070c0;
    --primary:#d1155a; --primary-hover:#b0104b; --on-primary:#ffffff;
    --sel:#004a9f; --on-sel:#ffffff;
    --hover:rgba(0,74,159,.06); --active:rgba(0,74,159,.10);
    --chip-bg:#eef5fb; --chip-line:#d6e6f3; --chip-ink:#0f3d63;
    --icon-tile:#eef5fd;
    --ok:#1e7e34; --ok-deep:#1e7e34; --warn:#8a5a00; --err:#c62828; --err-deep:#c62828;
    --ok-bg:#e7f6ec; --err-bg:#fdecee; --warn-bg:#fff4dc;
    --grad:linear-gradient(135deg,#004a9f,#01111e);
    --shadow:0 4px 24px rgba(1,17,30,.08);
    --glow:0 12px 24px -12px rgba(1,17,30,.55);
    --focus:#004a9f; --ring:rgba(0,114,206,.22);
    --code-bg:#01111e; --code-ink:#dde9f2; --code-line:#0b1f3a; --code-key:#ff9cc2;
    --header-bg:#ffffff;
    --scroll:rgba(1,17,30,.18); --scroll-hover:rgba(1,17,30,.32);
    /* flow steps, in order: text/border colour and the number's fill */
    --t1:#004a9f; --t1f:#004a9f; --t2:#0070c0; --t2f:#0070c0; --t3:#d1155a; --t3f:#d1155a;
    --t4:#0b1f3a; --t4f:#0b1f3a; --t5:#2a6a9a; --t5f:#2a6a9a; --t6:#8c1c56; --t6f:#8c1c56;
    --r:16px; --r-sm:12px;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:'Ubuntu',Helvetica,Arial,sans-serif;
    --head:'Heebo',Arial,sans-serif;
  }
  :host([data-theme="dark"]){
    color-scheme:dark;
    --bg:#01111e; --bg2:#090e16; --panel:#0a1628; --panel2:#0d1f3c; --rail:#06121f;
    --heading:#ffffff; --ink:#e8f1f8; --text:#c8d8e8; --muted:#9fb3c8;
    --line:rgba(255,255,255,.10); --line-strong:rgba(255,255,255,.18); --outline:rgba(255,255,255,.35);
    --field:#071422; --field-line:rgba(255,255,255,.18);
    --accent:#7cc4ff; --accent2:#a9d8ff; --accent-ink:#01111e; --accent-soft:#7cc4ff;
    --eyebrow:#4db3f5;
    --sel:#7cc4ff; --on-sel:#01111e;
    --hover:rgba(124,196,255,.07); --active:rgba(124,196,255,.13);
    --chip-bg:#0d1f3c; --chip-line:rgba(124,196,255,.25); --chip-ink:#c8e4ff;
    --icon-tile:#12335f;
    --ok:#6fcf97; --ok-deep:#2e7d32; --warn:#f5c86a; --err:#ff8a8a; --err-deep:#c62828;
    --ok-bg:#0b2a1a; --err-bg:#2a0f14; --warn-bg:#2a1f08;
    --grad:linear-gradient(135deg,#004a9f,#0b1f3a);
    --shadow:0 4px 24px rgba(0,0,0,.35);
    --glow:0 12px 24px -12px rgba(0,0,0,.7);
    --focus:#7cc4ff; --ring:rgba(124,196,255,.35);
    --code-bg:#050d16; --code-ink:#dde9f2; --code-line:rgba(255,255,255,.10);
    --header-bg:#0a1628;
    --scroll:rgba(255,255,255,.16); --scroll-hover:rgba(255,255,255,.3);
    --t1:#7cc4ff; --t2:#4db3f5; --t3:#ff7fae; --t4:#c8d8e8; --t4f:#3d5a7a; --t5:#9ccbef; --t6:#f39ac6;
  }
  *{box-sizing:border-box}
  .mp-app{background:var(--bg);color:var(--ink);font:14px/1.55 var(--sans);text-align:left;-webkit-font-smoothing:antialiased}
  /* The host page's styles still reach the host element and anything it
     passes down by inheritance, so every top-level part of the shadow root
     (the console and the Iris panel) resets the inherited text properties
     it doesn't set itself. */
  .mp-app,.irp-launch,.irp-drawer{letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;text-shadow:none;font-style:normal;font-variant:normal;white-space:normal;visibility:visible;direction:ltr;-webkit-text-stroke:0}
  /* Sticky offsets: --mp-top is the host page's own fixed header (set by the
     embed), --mp-bar the console's mode bar (set by console-app.js). */
  .mp-app{--stick:calc(var(--mp-top,0px) + var(--mp-bar,0px))}
  ::selection{background:color-mix(in srgb,var(--accent) 25%,transparent)}
  *::-webkit-scrollbar{width:10px;height:10px}
  *::-webkit-scrollbar-thumb{background:var(--scroll);border-radius:99px}
  *::-webkit-scrollbar-thumb:hover{background:var(--scroll-hover)}
  *::-webkit-scrollbar-track{background:transparent}

  /* ---- header ---- */
  header{position:relative;flex:none;display:flex;align-items:center;gap:16px;padding:12px 24px;background:var(--header-bg);border-bottom:1px solid var(--line);flex-wrap:wrap}
  .brand-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:#fff;font:800 17px/1 var(--head);background:var(--grad);flex:none}
  /* In the portal (and framed by it) the portal's nav already carries the
     brand and the theme switch, so the console keeps only its tool bar.
     !important: the brand link carries an inline display. */
  .mp-app.embedded #brand-link,.mp-app.embedded #theme-toggle{display:none!important}
  .theme-toggle{height:34px;display:inline-flex;align-items:center;gap:6px;padding:0 14px;border:1px solid var(--outline);border-radius:999px;background:none;color:var(--ink);font:500 13px var(--sans);cursor:pointer}
  .theme-toggle:hover{background:var(--hover)}
  .theme-toggle:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .theme-toggle .sun,.theme-toggle .moon{color:var(--accent)}
  .theme-toggle .moon{display:none}
  :host([data-theme="dark"]) .theme-toggle .sun{display:none}
  :host([data-theme="dark"]) .theme-toggle .moon{display:inline}
  header h1{font:700 17px/1 var(--head);margin:0;color:var(--heading);white-space:nowrap}
  header h1 span{color:var(--muted);font-weight:500}
  header .grow{flex:1}
  header label{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
  header select,header input{font:13px var(--mono);padding:6px 9px;border:1px solid var(--field-line);border-radius:8px;background:var(--field);color:var(--ink);max-width:210px}
  header select:focus-visible,header input:focus{outline:2px solid var(--focus);outline-offset:1px}
  .tabs{display:flex;gap:4px;background:var(--chip-bg);border:1px solid var(--chip-line);border-radius:999px;padding:4px}
  .tab{border:0;background:none;font:600 14px/1.2 var(--head);color:var(--chip-ink);padding:8px 18px;border-radius:999px;cursor:pointer;transition:color .15s,background .15s}
  .tab:hover{color:var(--heading);background:var(--hover)}
  .tab[aria-selected="true"]{color:var(--on-sel);background:var(--sel)}
  .tab:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .badge{font:500 12.5px var(--head);padding:4px 12px;border-radius:999px;border:1px solid var(--chip-line);color:var(--chip-ink);background:var(--chip-bg);white-space:nowrap}
  .badge.planned{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:var(--warn-bg)}

  /* ---- layout: product sidebar + content ---- */
  .layout{display:grid;grid-template-columns:240px minmax(0,1fr);align-items:start}
  .content{min-width:0}
  .content>*{min-width:0}
  .products{display:flex;flex-direction:column;gap:6px;align-items:stretch;padding:14px 12px;background:var(--rail);border-right:1px solid var(--line);overflow-y:auto;overflow-x:hidden;position:sticky;top:var(--stick);max-height:calc(100vh - var(--stick));align-self:start}
  .pchip{border:1px solid var(--line);background:var(--panel);color:var(--ink);font:500 13.5px/1.3 var(--head);padding:8px 12px;border-radius:10px;cursor:pointer;transition:all .15s;text-align:left;display:flex;gap:7px;align-items:center;justify-content:space-between}
  .pchip:hover{color:var(--heading);border-color:var(--line-strong);background:var(--hover)}
  .pchip[hidden]{display:none}
  .pchip.active{color:var(--on-sel);background:var(--sel);border-color:transparent}
  .pchip .soon{font:600 10px var(--head);color:var(--chip-ink);background:var(--chip-bg);border:1px solid var(--chip-line);border-radius:999px;padding:0 7px}
  .pchip.active .soon{color:var(--on-sel);background:color-mix(in srgb,var(--on-sel) 16%,transparent);border-color:transparent}
  .pchip:focus-visible{outline:2px solid var(--focus);outline-offset:2px}

  /* ---- sidebar search ---- */
  #product-search{flex:none;width:100%;font:13.5px var(--sans);padding:8px 12px;border:1px solid var(--field-line);border-radius:999px;background:var(--field);color:var(--ink);margin-bottom:4px}
  #product-search:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  #product-search::placeholder{color:var(--muted)}
  #search-results{flex:none;display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:4px;max-height:40vh;overflow-y:auto;box-shadow:var(--shadow)}
  #search-results[hidden]{display:none}
  .sres{border:0;background:none;text-align:left;color:var(--ink);font:13px var(--sans);padding:7px 8px;border-radius:8px;cursor:pointer;display:flex;flex-direction:column;gap:2px}
  .sres:hover,.sres.kbd{background:var(--active)}
  .sres .m{font:700 10px var(--mono);color:var(--accent)}
  .sres small{color:var(--muted)}
  .sres b{color:var(--accent)}
  .snone{color:var(--muted);font-size:12px;padding:8px}

  main{display:grid;grid-template-columns:310px minmax(0,1fr);align-items:start}
  main[hidden]{display:none}
  nav[hidden]{display:none}
  .opgroup{grid-column:1/-1;font:600 11px var(--sans);text-transform:uppercase;letter-spacing:1.5px;color:var(--eyebrow);margin:8px 0 -6px;padding-top:6px;border-top:1px solid var(--line)}
  .opgroup:first-child{margin-top:0;padding-top:0;border-top:0}

  /* ---- docs ---- */
  .docs{padding:32px 28px 72px}
  .docs .wrap{max-width:920px;margin:0 auto;animation:fadein .2s ease}
  .docs h2{font:700 28px/1.2 var(--head);margin:0 0 8px;color:var(--heading)}
  .docs h3{font:700 18px/1.3 var(--head);color:var(--heading);margin:30px 0 10px;padding-top:18px;border-top:1px solid var(--line)}
  .docs h4{font:600 11.5px var(--sans);text-transform:uppercase;letter-spacing:1.5px;color:var(--eyebrow);margin:16px 0 6px}
  .docs p{max-width:74ch;font-size:14px;color:var(--text)}
  .docs .lead{color:var(--muted);font-size:15px;margin-top:0}
  .docs a{color:var(--accent)}
  .docs pre{font:12px/1.65 var(--mono);background:var(--code-bg);color:var(--code-ink);border:1px solid var(--code-line);border-radius:var(--r-sm);padding:14px;overflow-x:auto;white-space:pre}
  .docs code{font-family:var(--mono);font-size:12.5px}
  .docs p code,.docs td code,.docs li code,.docs ol code{background:var(--chip-bg);border:1px solid var(--chip-line);border-radius:6px;padding:1px 6px;color:var(--accent-soft)}
  .docs table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}
  .docs table td,.docs table th{border-top:1px solid var(--line);padding:7px 9px;vertical-align:top;text-align:left}
  .docs table th{font:700 11px var(--head);text-transform:uppercase;letter-spacing:.8px;color:var(--muted);border-top:0}
  .docs .ep{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;margin:14px 0;transition:transform .2s,box-shadow .2s,border-color .2s}
  .docs .ep:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:var(--line-strong)}
  .docs .ep .sig{font:13px var(--mono);display:flex;gap:10px;align-items:baseline;color:var(--heading)}
  .docs .toc{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 4px}
  .docs .toc a{font:12px var(--mono);text-decoration:none;color:var(--accent-soft);border:1px solid var(--chip-line);border-radius:999px;padding:4px 12px;background:var(--chip-bg);transition:all .15s}
  .docs .toc a:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:var(--shadow)}
  .callout{background:var(--warn-bg);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);color:var(--ink);border-radius:var(--r-sm);padding:12px 14px;font-size:13.5px;margin:14px 0}
  .callout code{background:color-mix(in srgb,var(--warn) 10%,transparent);border-color:color-mix(in srgb,var(--warn) 25%,transparent);color:var(--ink)}
  .callout b{color:var(--warn)}

  /* ---- flow diagram ---- */
  .flow{margin:18px 0 6px}
  .flow-head{margin-bottom:14px}
  .flow-head h3{border-top:0;padding-top:0;margin:0 0 4px;font:700 18px var(--head)}
  .flow-head p{margin:0;color:var(--muted);font-size:13.5px}
  .flow-scroll{overflow-x:auto;padding-bottom:8px}
  .flow-grid{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(210px,1fr);gap:0;min-width:min-content}
  .flow-col{display:flex;flex-direction:column;gap:10px;padding-right:34px;position:relative}
  .flow-col:last-child{padding-right:0}
  /* arrow between steps */
  .flow-col:not(:last-child)::after{content:'';position:absolute;top:52px;right:11px;width:12px;height:12px;
    border-top:2px solid var(--line-strong);border-right:2px solid var(--line-strong);transform:rotate(45deg)}
  /* --tone / --tone-fill: one of --t1..--t6 (TONES in the script) */
  .fstep{background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--tone,var(--accent));
    border-radius:var(--r);padding:16px 14px;flex:1;transition:transform .2s,box-shadow .2s}
  .fstep:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
  .fnum{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    font:700 12px var(--head);color:#fff;background:var(--tone-fill,var(--accent));margin-bottom:10px}
  .fstep h4{margin:0 0 6px;font:700 15px var(--head);color:var(--tone,var(--accent));
    text-transform:none;letter-spacing:0}
  .fstep p{margin:0;font-size:13px;color:var(--text);max-width:none;line-height:1.5}
  .fdetail{background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--tone,var(--accent));
    border-radius:var(--r-sm);padding:11px 12px}
  .fdetail .fep{font:600 11.5px var(--mono);color:var(--tone,var(--accent));word-break:break-all;display:block;margin-bottom:6px}
  .fdetail dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 8px}
  .fdetail dt{font:700 10px var(--head);text-transform:uppercase;letter-spacing:.6px;color:var(--muted);white-space:nowrap}
  .fdetail dd{margin:0;font:11px var(--mono);color:var(--ink);word-break:break-word}
  .flow-notes{display:flex;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin-top:16px}
  .flow-notes .ni{color:var(--accent);font-size:16px;line-height:1.2;flex:none}
  .flow-notes ul{margin:0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.65}
  .flow-notes li::marker{color:var(--accent)}
  .flow-img{margin:16px 0}
  .flow-img img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:var(--r);display:block}
  .flow-img figcaption{margin-top:6px;font-size:12px;color:var(--muted)}
  @media (max-width:760px){
    .flow-grid{grid-auto-flow:row;grid-auto-columns:auto}
    .flow-col{padding-right:0;padding-bottom:26px}
    .flow-col:not(:last-child)::after{top:auto;bottom:8px;right:auto;left:50%;transform:rotate(135deg)}
  }

  /* ---- console nav ---- */
  nav{border-right:1px solid var(--line);overflow:auto;background:var(--rail)}
  #nav{position:sticky;top:var(--stick);max-height:calc(100vh - var(--stick));align-self:start}
  nav .group{padding:14px 14px 6px;font:600 10.5px var(--sans);text-transform:uppercase;letter-spacing:1.5px;color:var(--eyebrow)}
  nav button{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;border:0;background:none;padding:8px 14px;font:12.5px var(--mono);cursor:pointer;color:var(--ink);border-left:3px solid transparent;transition:background .12s}
  nav button:hover{background:var(--hover)}
  nav button.active{background:var(--active);border-left-color:var(--accent)}
  nav button:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
  .m{font-size:10.5px;font-weight:700;width:44px;flex:none;font-family:var(--head)}
  .m.GET{color:var(--ok)} .m.POST{color:var(--accent)} .m.PUT{color:var(--warn)} .m.DELETE{color:var(--err)}

  /* ---- console main ---- */
  section{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .card,.docs .ep,.docs h3{scroll-margin-top:calc(var(--stick) + 12px)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;box-shadow:var(--shadow)}
  .card h2{margin:0 0 2px;font:700 17px var(--head);color:var(--heading)}
  .card h2 .mono{font-family:var(--mono);font-size:12.5px;color:var(--muted);font-weight:400;margin-left:8px}
  .soap{color:var(--muted);font-size:12px;margin:0 0 10px}
  .soap code{font-family:var(--mono)}
  .desc{font-size:14px;margin:0 0 10px;max-width:70ch;color:var(--text)}
  /* Mode bar: live (rates, card), sandbox, payment due or staff, with the
     sandbox switch and the sandbox calls left this month. */
  .modebar{position:sticky;top:var(--mp-top,0px);z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:9px 24px;font-size:13.5px;border-bottom:1px solid var(--line)}
  .modebar[hidden]{display:none}
  .modebar b{font:700 11.5px var(--head);letter-spacing:.8px;text-transform:uppercase;padding:3px 10px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
  .modebar.live{background:var(--ok-bg);color:var(--ok)}
  .modebar.sandbox{background:var(--warn-bg);color:var(--warn)}
  .modebar.staff{background:var(--chip-bg);color:var(--chip-ink)}
  .modebar.block{background:var(--err-bg);color:var(--err)}
  .modebar .grow{flex:1}
  .mb-state{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-width:0}
  .mb-proposed{font:500 12px var(--sans);border:1px dashed currentColor;border-radius:999px;padding:1px 10px;white-space:nowrap}
  .mb-card{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;flex-basis:100%}
  .mb-card[hidden]{display:none}
  .modebar button,.modebar a{font:500 13px var(--sans);padding:5px 14px;border-radius:999px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;text-decoration:none}
  .modebar button:hover,.modebar a:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
  .modebar button:focus-visible,.modebar a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .mb-side{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
  .mb-sbx{display:inline-flex;align-items:center;gap:8px;font:600 13.5px var(--head);cursor:pointer;user-select:none;position:relative}
  .mb-sbx[hidden]{display:none}
  .mb-sbx input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
  .mb-sbx .sw{position:relative;width:34px;height:20px;border-radius:999px;border:1.5px solid currentColor;flex:none;transition:background .15s}
  .mb-sbx .sw::after{content:'';position:absolute;top:2.5px;left:2.5px;width:12px;height:12px;border-radius:50%;background:currentColor;transition:transform .15s}
  .mb-sbx input:checked+.sw{background:currentColor}
  .mb-sbx input:checked+.sw::after{transform:translateX(14px);background:var(--panel)}
  .mb-sbx input:focus-visible+.sw{outline:2px solid var(--focus);outline-offset:2px}
  .mb-count{font-size:12.5px;white-space:nowrap}
  /* Per-card cues that follow the mode bar without a re-render: the
     .mp-app carries .sbx (sandbox on) and .nocard (no card on file). */
  .needs-card{display:none;font:600 11px var(--mono);color:var(--err);border:1px solid currentColor;border-radius:999px;padding:2px 8px}
  .mp-app.nocard:not(.sbx) .needs-card{display:inline-block}
  .sbx-ro{display:none;flex-basis:100%;font-size:12.5px;color:var(--warn)}
  .mp-app.sbx .sbx-ro{display:block}
  .btn .sbx-tag{display:none}
  .mp-app.sbx .btn .sbx-tag{display:inline}
  .resp-next{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:0 0 10px;font-size:13px;color:var(--text)}
  .resp-next a{color:var(--accent)}
  /* Rate class of an operation (lib/catalogs/rate-card.json). */
  .rate{flex:none;display:inline-flex;align-items:center;font:600 10.5px/1.6 var(--head);text-transform:uppercase;letter-spacing:.6px;padding:1px 9px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
  .rate.free{color:var(--ok)} .rate.standard{color:var(--accent)} .rate.advanced{color:var(--t3)} .rate.service,.rate.bundle{color:var(--muted)} .rate.service{border-style:dashed}
  .op-title{flex-wrap:wrap}
  .op-title .rate{margin-left:auto}
  .docs .ep .sig .rate{margin-left:auto}
  .price-note{font-size:13px;color:var(--muted);margin:8px 0 0}
  .price-note b{color:var(--heading)}
  .svc-note{font-size:13px;color:var(--muted);margin:0 0 10px}
  /* Service orders: Send asks first, in the card (never a browser dialog). */
  .svc-confirm{margin-top:12px;border:1px solid color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warn-bg);border-radius:var(--r-sm);padding:12px 14px;animation:fadein .18s ease}
  .svc-confirm p{margin:0 0 4px;font-size:13.5px;color:var(--ink);max-width:none}
  .svc-confirm p b{color:var(--warn)}
  .svc-confirm .row{margin-top:10px}
  .btn-line{background:none;border:1px solid var(--outline);color:var(--accent);border-radius:999px;padding:9px 20px;font:500 14px/1.3 var(--sans);cursor:pointer;transition:background .15s,border-color .15s}
  .btn-line:hover{background:var(--hover);border-color:var(--accent)}
  .btn-line:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .resp-next .btn-line{padding:5px 14px;font-size:13px}
  .btn-line[aria-checked="true"]{border-color:var(--warn);color:var(--warn)}
  .docs td.num,.docs th.num{text-align:right;white-space:nowrap}
  .docs tr.total td{font-weight:700;color:var(--heading);border-top:2px solid var(--line-strong)}
  .pre-note{font-size:13px;background:var(--warn-bg);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);color:var(--ink);border-radius:var(--r-sm);padding:9px 12px;margin:0 0 12px}
  .pre-note b{color:var(--warn)}
  .doc h3{font:600 11px var(--sans);text-transform:uppercase;letter-spacing:1.5px;color:var(--eyebrow);margin:16px 0 6px}
  table.doc{border-collapse:collapse;width:100%;font-size:13px}
  table.doc td{border-top:1px solid var(--line);padding:6px 9px;vertical-align:top}
  table.doc td.k{font-family:var(--mono);white-space:nowrap;color:var(--accent-soft)}
  table.doc td.req{color:var(--err);font-size:11px;width:1%;white-space:nowrap}
  .field{display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:center;margin:7px 0}
  .field label{font-size:12px;color:var(--muted);font-family:var(--mono)}
  .field .fd{grid-column:2;font-size:11.5px;color:var(--muted);margin-top:-2px}
  .field input,textarea{font:13px var(--mono);padding:8px 10px;border:1px solid var(--field-line);border-radius:8px;width:100%;background:var(--field);color:var(--ink);transition:border-color .15s,box-shadow .15s}
  .field input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}
  textarea{min-height:170px;resize:vertical}
  .row{display:flex;gap:12px;align-items:center;margin-top:14px;flex-wrap:wrap}
  /* Main action (Send, Show my API key, Save): the brand's magenta pill */
  .btn{background:var(--primary);color:var(--on-primary);border:0;border-radius:999px;padding:10px 22px;font:500 14px/1.3 var(--sans);cursor:pointer;transition:background-color .2s,transform .2s,box-shadow .2s}
  .btn:hover{background:var(--primary-hover);transform:translateY(-1px);box-shadow:var(--glow)}
  .btn:disabled{opacity:.6;cursor:progress;transform:none;box-shadow:none}
  .btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .url{font:12px var(--mono);color:var(--muted);word-break:break-all}
  .status{font:600 12px var(--mono);padding:3px 10px;border-radius:999px;border:1px solid var(--line)}
  .status.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 50%,transparent);background:var(--ok-bg)}
  .status.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-bg)}
  .status.err{color:var(--err);border-color:color-mix(in srgb,var(--err) 50%,transparent);background:var(--err-bg)}

  /* ---- response ---- */
  .resp-banner{display:flex;gap:10px;align-items:center;border-radius:var(--r-sm);padding:10px 14px;margin:10px 0 12px;font:600 14px var(--head);animation:fadein .18s ease}
  .resp-banner .icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none;color:#fff}
  .resp-banner.good{background:var(--ok-bg);border:1px solid color-mix(in srgb,var(--ok) 40%,transparent);color:var(--ok)}
  .resp-banner.good .icon{background:var(--ok-deep)}
  .resp-banner.bad{background:var(--err-bg);border:1px solid color-mix(in srgb,var(--err) 40%,transparent);color:var(--err)}
  .resp-banner.bad .icon{background:var(--err-deep)}
  .listing-table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px;margin:4px 0;animation:fadein .18s ease}
  .listing-table td{border-top:1px solid var(--line);padding:7px 9px;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  .listing-table td:first-child{color:var(--muted);font-family:var(--head);font-weight:600;width:36%;padding-right:22px}
  .listing-table .listing-table td:first-child{width:45%}
  .listing-table tr:first-child td{border-top:0}
  details.raw{margin-top:12px}
  details.raw summary{cursor:pointer;font:600 12.5px var(--head);color:var(--muted);padding:4px 0;list-style:none}
  details.raw summary::before{content:'▸ ';color:var(--accent)}
  details.raw[open] summary::before{content:'▾ '}
  details.raw summary:hover{color:var(--ink)}
  pre.out{margin:8px 0 0;font:12.5px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word;background:var(--code-bg);color:var(--code-ink);border:1px solid var(--code-line);border-radius:var(--r-sm);padding:14px;max-height:50vh;overflow:auto}
  .resp-empty{color:var(--muted);font-size:13.5px;padding:10px 0}

  /* ---- misc ---- */
  .railnote{padding:16px 14px;margin-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.6}
  .railnote code{font-family:var(--mono);font-size:11px;color:var(--accent-soft)}
  .railnote strong{color:var(--heading)}
  .base{display:flex;align-items:center;gap:8px;font:12px var(--mono);color:var(--muted)}
  .base b{font:700 10.5px var(--head);text-transform:uppercase;letter-spacing:.8px}
  .base code{color:var(--accent-soft);background:var(--chip-bg);border:1px solid var(--chip-line);border-radius:999px;padding:4px 11px;user-select:all}
  .snippet{position:relative;margin:0}
  .snippet pre{margin:0;font:12px/1.65 var(--mono);white-space:pre;overflow-x:auto;background:var(--code-bg);color:var(--code-ink);border:1px solid var(--code-line);border-radius:var(--r-sm);padding:14px}
  .snippet .cred{color:var(--code-key)} /* snippet bg is navy in both themes */
  .copy{position:absolute;top:9px;right:9px;background:var(--panel);color:var(--ink);border:1px solid var(--line-strong);border-radius:999px;font:500 11.5px var(--sans);padding:4px 12px;cursor:pointer;transition:all .15s}
  .copy:hover{border-color:var(--accent);transform:translateY(-1px)}
  .copy.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 50%,transparent)}
  .empty{color:var(--muted);font-size:13.5px}
  .hint{font-size:12.5px;color:var(--muted)}
  .errcode{font-family:var(--mono);color:var(--warn);font-weight:600}
  /* ---- guided forms ---- */
  .gfield{margin:12px 0}
  .gfield>label{display:block;font:600 13px var(--head);color:var(--heading);margin-bottom:5px}
  .gfield .req{color:var(--accent)}
  .gfield input,.gfield select{font:14px var(--sans);padding:9px 12px;border:1px solid var(--field-line);border-radius:8px;width:100%;background:var(--field);color:var(--ink);transition:border-color .15s,box-shadow .15s}
  .gfield input:focus,.gfield select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}
  .gfield .ghelp{font-size:12px;color:var(--muted);margin-top:4px}
  .grow2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
  .info-box{background:color-mix(in srgb,var(--accent) 6%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);border-radius:var(--r-sm);padding:12px 14px;margin:14px 0;font-size:13px;color:var(--ink)}
  .info-box b,.info-box strong{color:var(--accent)}
  .btn.danger{background:var(--err-deep)}
  .btn.danger:hover{background:var(--err-deep);filter:brightness(.9)}
  .btn .spin{display:none;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:7px}
  .btn[aria-busy="true"] .spin{display:inline-block}
  @keyframes spin{to{transform:rotate(360deg)}}
  .opgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;align-items:start}
  .opgrid .card{position:relative;overflow:hidden}
  /* Bundles view */
  .bundle-aud{font:600 12px var(--sans);text-transform:uppercase;letter-spacing:1.5px;color:var(--eyebrow);margin:26px 0 10px}
  .bundle-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .bundle-card{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);padding:18px 20px;animation:fadein .18s ease}
  .bundle-card h3{margin:0 0 2px;font:700 16px var(--head);color:var(--heading)}
  .bundle-card .buse{color:var(--accent-soft);font-size:13px;margin:0 0 6px}
  .bundle-card p{font-size:13px;margin:0 0 10px;color:var(--text)}
  .bundle-card ol{margin:0;padding-left:18px;font-size:13px}
  .bundle-card li{margin:5px 0}
  .bundle-card li a{color:inherit;text-decoration:none;display:block;border-radius:6px;padding:2px 4px;margin:-2px -4px}
  .bundle-card li a:hover{background:var(--hover)}
  .bundle-card li code{font:11px var(--mono);color:var(--accent-soft)}
  .bundle-card li small{display:block;color:var(--muted)}
  .pchip.bundles{font-weight:600;border-style:dashed}
  /* APIs group header in the product rail */
  .pgroup-head{border:0;background:none;color:var(--muted);font:600 10.5px var(--sans);text-transform:uppercase;letter-spacing:1.5px;text-align:left;padding:10px 4px 2px;cursor:pointer;display:flex;align-items:center;gap:6px}
  .pgroup-head:hover{color:var(--ink)}
  .pgroup-head:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .pgroup-head .caret{font-size:9px;transition:transform .15s}
  .pgroup-head[aria-expanded="false"] .caret{transform:rotate(-90deg)}
  .pgroup-head .cnt{font-weight:500;color:var(--muted);opacity:.8;text-transform:none;letter-spacing:0}
  #api-group,#bundle-group{display:contents}
  #api-group.collapsed .pchip,#bundle-group.collapsed .pchip,#bundle-group.collapsed .pgroup-sub{display:none}
  .pgroup-sub{font:600 10px var(--head);color:var(--muted);padding:6px 6px 0;text-transform:uppercase;letter-spacing:.6px}
  .pchip.bstep{font-weight:500}
  .step-badge{display:inline-flex;gap:8px;align-items:center;font:600 10.5px var(--sans);text-transform:uppercase;letter-spacing:1.2px;color:var(--eyebrow);margin-bottom:6px}
  .step-badge .num{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--grad);color:#fff;font:700 11px var(--head);letter-spacing:0}
  .step-badge .prod{color:var(--muted);font-weight:500;text-transform:none;letter-spacing:0}
  .step-note{font-size:13px;color:var(--muted);margin:0 0 8px}
  .carried{outline:2px solid var(--ok);outline-offset:1px;transition:outline-color 1.5s}
  .opgrid .card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,var(--accent),transparent);opacity:0;transition:opacity .2s}
  .opgrid .card:hover::before{opacity:1}
  .opgrid .card:hover{border-color:var(--line-strong)}
  .op-title{display:flex;align-items:center;gap:10px;margin:0 0 12px;font:700 17px var(--head);color:var(--heading)}
  .op-title .op-icon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--icon-tile);flex:none}
  .op-resp{margin-top:8px}
  /* Second action (Fill example, Show more): the brand's outline pill */
  .ghost-btn{width:100%;background:none;border:1px solid var(--outline);color:var(--accent);border-radius:999px;padding:9px 16px;font:500 13.5px var(--sans);cursor:pointer;margin:4px 0 10px;transition:background .15s,border-color .15s}
  .ghost-btn:hover{background:var(--hover);border-color:var(--accent)}
  .ghost-btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  details.adv{margin:10px 0}
  details.adv summary{cursor:pointer;font:600 12.5px var(--head);color:var(--muted);list-style:none;padding:4px 0}
  details.adv summary::before{content:'▸ ';color:var(--accent)}
  details.adv[open] summary::before{content:'▾ '}
  /* Code sample language tabs (Developer details on every card). */
  .snip-tabs{display:flex;gap:4px;margin:0 0 6px}
  .snip-tabs button{border:1px solid var(--line-strong);background:none;color:var(--muted);font:600 12px var(--head);padding:4px 12px;border-radius:999px;cursor:pointer}
  .snip-tabs button:hover{color:var(--ink)}
  .snip-tabs button[aria-selected="true"]{color:var(--on-sel);background:var(--sel);border-color:transparent}
  .snip-tabs button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  /* Iris (iris-console.js) fills a card and points at Send; only the user presses it. */
  .iris-filled{outline:2px solid var(--accent);outline-offset:1px;transition:outline-color 1.5s}
  .opgrid .card.iris-pulse{border-color:var(--accent);animation:iris-pulse 1.2s ease-in-out 5}
  .iris-pulse [data-send]{outline:3px solid var(--accent);outline-offset:3px}
  .iris-cue{font:600 12px var(--head);color:var(--accent-soft);background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:999px;padding:4px 11px}
  @keyframes iris-pulse{50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 35%,transparent),var(--shadow)}}
  @keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @media (max-width:900px){
    .layout{grid-template-columns:1fr;grid-template-rows:auto 1fr}
    .products,#nav{position:static}
    .products{flex-direction:row;flex-wrap:wrap;align-items:center;overflow-x:auto;overflow-y:visible;border-right:0;border-bottom:1px solid var(--line);padding:10px 16px;max-height:40vh}
    .pchip{flex:none;white-space:nowrap;border-radius:999px;justify-content:flex-start}
    .pgroup-sub{display:none}
    #product-search{width:100%}
    #search-results{width:100%}
    main{grid-template-columns:1fr;grid-template-rows:auto 1fr}nav{max-height:34vh}.field{grid-template-columns:1fr}.field .fd{grid-column:1}header{gap:10px}
  }
  /* Phone pickers: stand-ins for the product rail and the endpoint rail
     below 760px (see "phone pickers" in the script). Hidden on wider screens. */
  .m-pick{display:none;align-items:center;gap:10px;width:100%}
  .m-pick>span{flex:none;font:600 10.5px var(--sans);text-transform:uppercase;letter-spacing:1.2px;color:var(--eyebrow)}
  .m-pick select{flex:1;min-width:0;font:500 15px var(--head);padding:9px 34px 9px 14px;border:1px solid var(--field-line);border-radius:999px;color:var(--ink);
    background:var(--field) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%233E8CCB' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 14px center;
    -webkit-appearance:none;appearance:none}
  .m-pick select:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  /* Phones: one page that scrolls as a whole. The desktop shell (product
     rail, endpoint rail and content, each scrolling in its own box) leaves
     the content a sliver of the screen, so it is flattened here. */
  @media (max-width:760px){
    header{padding:10px 16px;gap:8px 10px}
    header>a{flex:1;min-width:0;order:0}
    header h1{font-size:15px}
    .theme-toggle{order:1}
    .tabs{order:2;width:100%}
    .tab{flex:1}
    #partner-badge{order:3;max-width:100%;overflow:hidden;text-overflow:ellipsis}
    .base{order:4;width:100%;min-width:0}
    .base code{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px}
    header .grow{display:none}
    .modebar{padding:8px 16px;font-size:13px;position:static}
    /* The state reads as one line of text that wraps, badge included. */
    .mb-state{display:block;line-height:1.75}
    .mb-state>*{margin-right:8px}
    .mb-state>b,.mb-state>.mb-proposed,.mb-state>button{display:inline-block}
    /* Billing tables: no breaks inside a word or a number; scroll if needed. */
    .docs table.bill td{white-space:nowrap;overflow-wrap:normal}
    .docs table.bill.names td:first-child{white-space:normal}
    .docs table.bill td code{white-space:nowrap;overflow-wrap:normal}
    .layout{display:block}
    .products{display:flex;flex-direction:column;gap:8px;max-height:none;overflow:visible;padding:12px 16px}
    #product-bar{display:none!important}
    #product-search{margin:0}
    .m-pick{display:flex}
    .m-pick[hidden]{display:none}
    .content{display:block}
    .docs{height:auto;overflow:visible;padding:20px 16px 96px}
    .docs h2{font-size:24px}
    .docs .ep{padding:14px}
    .docs .ep .sig{flex-wrap:wrap;gap:4px 10px}
    .docs .ep .sig>*,.docs .toc a,.docs table td,.docs table td code{min-width:0;overflow-wrap:anywhere;white-space:normal}
    .docs table{display:block;overflow-x:auto}
    main{display:flex;flex-direction:column;align-items:stretch;height:auto}
    #nav{order:2;max-height:none;overflow:visible;border:0;border-top:1px solid var(--line);background:none}
    #nav .group,#nav>button{display:none}
    #nav .railnote{margin:0;border:0}
    section{overflow:visible;padding:14px 16px 96px;gap:14px}
    .card{padding:16px}
    .opgrid,.bundle-grid{grid-template-columns:1fr;gap:14px}
    .grow2{grid-template-columns:1fr}
    table.doc td.k{white-space:normal;word-break:break-all}
  }
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

  const MARKUP = `
<div class="mp-app">
<header>
  <a href="/" id="brand-link" title="Marketplace guide" style="text-decoration:none;display:flex;align-items:center;gap:10px;color:inherit">
    <span class="brand-mark" aria-hidden="true">I</span>
    <h1>Iristel API <span>Marketplace</span></h1>
  </a>
  <div class="tabs" role="tablist">
    <button class="tab" id="tab-docs" role="tab" aria-selected="true" aria-controls="view-docs">Documentation</button>
    <button class="tab" id="tab-console" role="tab" aria-selected="false" aria-controls="view-console">Console</button>
  </div>
  <div class="base"><b>Base URL</b><code id="baseurl">—</code></div>
  <div class="grow"></div>
  <span class="badge acct" id="partner-badge" hidden></span>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark mode" aria-pressed="false">
    <span class="sun" aria-hidden="true">☀</span>
    <span class="moon" aria-hidden="true">☾</span>
    <span class="theme-label">Light</span>
  </button>
</header>
<div class="modebar" id="modebar" hidden>
  <span class="mb-state" aria-live="polite"></span>
  <span class="grow"></span>
  <span class="mb-side">
    <label class="mb-sbx" hidden><input type="checkbox" role="switch" id="sandbox-toggle"><span class="sw" aria-hidden="true"></span>Sandbox</label>
    <span class="mb-count" aria-live="polite"></span>
  </span>
  <span class="mb-card" aria-live="polite" hidden></span>
</div>
<div class="layout">
<nav class="products" aria-label="Products">
  <label class="m-pick" for="m-product"><span>API</span><select id="m-product"></select></label>
  <input id="product-search" type="search" placeholder="Search APIs… (e.g. port a number)" aria-label="Search APIs" autocomplete="off">
  <div id="search-results" hidden></div>
  <div style="display:contents" id="product-bar" role="tablist" aria-orientation="vertical" aria-label="Product list"></div>
</nav>
<div class="content">
<div class="docs" id="view-docs" role="tabpanel" aria-labelledby="tab-docs">
  <div class="wrap" id="docs-body"><p class="lead">Loading reference…</p></div>
</div>

<main id="view-console" role="tabpanel" aria-labelledby="tab-console" hidden>
  <nav id="nav"><div class="empty" style="padding:14px">Loading endpoints…</div></nav>
  <section id="console-main">
    <div id="op-intro" hidden></div>
    <label class="m-pick" id="m-jump-wrap" for="m-jump" hidden><span>Jump to</span><select id="m-jump"></select></label>
    <div id="opgrid" class="opgrid" hidden></div>
    <div class="card" id="req"><div class="empty">Pick an endpoint on the left to see its docs and try it.</div></div>
    <div class="card" id="resp-card">
      <div class="row" style="margin:0 0 4px">
        <strong style="font:700 14px var(--head)">Response</strong>
        <span id="status" class="status" hidden></span>
        <span id="time" class="hint"></span>
      </div>
      <div id="resp-body"><div class="resp-empty">Send a request to see the result here.</div></div>
    </div>
  </section>
</main>
</div>
</div>

</div>
`;

  // ---- the console --------------------------------------------------------
async function main(ROOT,HOST,GATEWAY){
  const $=s=>ROOT.querySelector(s);
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const nav=$('#nav'), reqEl=$('#req'), respBody=$('#resp-body'), statusEl=$('#status'), timeEl=$('#time');
  // The gateway that served this script (console-app.js); every API call
  // goes there, whichever page hosts the console.
  const ORIGIN=GATEWAY;
  // The marketplace page's request form (access requests).
  const REQUEST_URL='https://iristelpartnerportal.com/api-marketplace#request-form';
  const USER_PH='YOUR_ESPRESSO_USERNAME', PASS_PH='YOUR_ESPRESSO_PASSWORD', KEY_PH='YOUR_MARKETPLACE_KEY';
  // No upstream API keys live in this page. IristelX and 911 calls go through
  // the gateway (/api/ix/<product>), which holds the keys server-side. Every
  // call carries the portal login session; from their own application a
  // partner sends their personal marketplace key instead ("Show my API key").
  const mpSession=()=>(window.MarketplaceAccess&&window.MarketplaceAccess.session())||'';

  // Iris panel handshake (public/v2/iris-console.js). When the console shows no
  // APIs it says so, and answers the panel's 'iris:console-request' the same
  // way; otherwise the bridge is announced at the bottom of this script.
  let irisUnavailableReason=null;
  const irisUnavailableEvt=()=>document.dispatchEvent(new CustomEvent('iris:console-unavailable',{detail:{reason:irisUnavailableReason}}));
  function irisUnavailable(reason){
    if(irisUnavailableReason===null)document.addEventListener('iris:console-request',irisUnavailableEvt);
    irisUnavailableReason=reason;irisUnavailableEvt();
  }

  // "Show my API key": the partner's personal key for their own application,
  // issued by the gateway to a logged-in, approved account.
  ROOT.addEventListener('click',async ev=>{
    const btn=ev.target.closest('[data-getkey]');
    if(!btn)return;
    const out=btn.closest('p').nextElementSibling;
    out.hidden=false;out.textContent='Loading…';
    try{
      const r=await fetch(ORIGIN+'/marketplace/api-key',{method:'POST',headers:{Authorization:'Bearer '+mpSession()}});
      const d=await r.json().catch(()=>({}));
      out.textContent=r.ok?'Authorization: Bearer '+d.key
        :(r.status===401?'Your portal login has expired. Log in again and reopen the console.':(d.message||d.error||'HTTP '+r.status));
    }catch(err){out.textContent='Could not load your key: '+err.message;}
  });

  // ---- theme --------------------------------------------------------------
  // The console takes the hosting page's html[data-theme] and follows it as
  // it changes (the portal's theme switch, or the /dids page's message to
  // /v2/console). The card frame has its own document, so it is told too.
  const themeToggle=$('#theme-toggle');
  function applyTheme(theme){
    HOST.dataset.theme=theme;
    const dark=theme==='dark';
    themeToggle.setAttribute('aria-pressed',String(dark));
    themeToggle.setAttribute('aria-label','Switch to '+(dark?'light':'dark')+' mode');
    themeToggle.querySelector('.theme-label').textContent=dark?'Dark':'Light';
    const frame=ROOT.querySelector('[data-card-frame]');
    if(frame&&frame.contentWindow)frame.contentWindow.postMessage({type:'ir-theme',theme},ORIGIN);
  }
  applyTheme(pageTheme());
  new MutationObserver(()=>{if(pageTheme()!==HOST.dataset.theme)applyTheme(pageTheme());})
    .observe(PAGE,{attributes:true,attributeFilter:['data-theme']});
  // Shown only on /v2/console opened on its own: the choice goes in the URL.
  themeToggle.addEventListener('click',()=>{
    const next=pageTheme()==='dark'?'light':'dark';
    if(window.irTheme&&!STANDALONE){window.irTheme.set(next);return;}
    PAGE.setAttribute('data-theme',next);
    try{const u=new URL(location.href);u.searchParams.set('theme',next);history.replaceState(history.state,'',u);}catch(_){}
  });

  function getCookie(name){
    const m=document.cookie.match(new RegExp('(?:^|; )'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=([^;]*)'));
    return m?decodeURIComponent(m[1]):null;
  }

  // ---- per-product behaviour -------------------------------------------
  // auth: 'edid'  -> Espresso; the gateway signs in, X-EDID-Env applies to staff only
  //       'proxy' -> WLNP on the public IristelX API; gateway injects the upstream key
  //       'ix'    -> IristelX API; gateway injects the upstream key
  // Every product also needs the caller's marketplace session or key.
  const IX=id=>ORIGIN+'/api/ix/'+id;
  // Partners reach Espresso's production system live and its test system in
  // the sandbox (X-Marketplace-Mode); the gateway ignores X-EDID-Env for
  // them. Staff are never billed, so for them the same Sandbox switch picks
  // the Espresso system instead: off = production, on = test (staffEnv()).
  const PRODUCT_CFG={
    'lnp-enterprise': {auth:'edid',  base:ORIGIN, group:p=>p.includes('/pons')||p.includes('/numbers')?'Porting requests (PONs)':'Reference'},
    'lnp-wireless':   {auth:'proxy', base:ORIGIN, group:p=>p.includes('/portin')?'Port In':p.includes('/portout')?'Port Out':p.includes('/cancel-svc')?'Cancel Service':'Grids & health'},
    'did-orders':     {auth:'edid',  base:ORIGIN, group:p=>p.includes('/orders')?'Orders':p.includes('/available')?'Find numbers':'Setup'},
    'lrn':            {auth:'edid',  base:ORIGIN, group:()=>'Lookups'},
    'e911':           {auth:'ix',base:IX('e911'), group:()=>'Listings'},
    'provisioning':{auth:'ix',base:IX('provisioning'), group:p=>/email|welcome/.test(p)?'Welcome letters':'Trunk provisioning'},
    'iristelx-accounts':{auth:'ix',base:IX('iristelx-accounts'), group:p=>/\/plans?(\/|$)/.test(p)?'Plans':/canada-post|address/.test(p)?'Addresses':/siptrunk/.test(p)?'SIP trunks':/service/.test(p)?'Services':'Accounts'},
    'iristelx-sim':{auth:'ix',base:IX('iristelx-sim'), group:p=>/esim/i.test(p)?'eSIM':'SIM cards'},
    'iristelx-commission':{auth:'ix',base:IX('iristelx-commission'), group:()=>'Commissions'},
    'iristelx-mobile':{auth:'ix',base:IX('iristelx-mobile'), group:p=>/service-now/.test(p)?'Support tickets':/esim|qr/.test(p)?'eSIM':/port-in/.test(p)?'Port in':/notification/.test(p)?'Notifications':/payment/.test(p)?'Payment':'Plans & usage'},
    // BroadWorks: scoped to the enterprise linked to the caller's account
    // (403 broadworks_not_linked when there is none); staff name one with ?enterprise=.
    'broadworks':     {auth:'bw',    base:ORIGIN, group:p=>/\/dns(\/|$)/.test(p)?'Numbers':/\/users(\/|$)/.test(p)?'Users':/\/groups(\/|$)/.test(p)?'Groups':'Enterprise'},
  };
  const cfg=()=>PRODUCT_CFG[productId]||{auth:'proxy',base:ORIGIN,group:()=>'Endpoints'};
  // Config of the product an endpoint belongs to (e.pid, set at load). Bundle
  // consoles mix products on one page, so card code must not rely on the
  // global productId.
  const cfgOf=e=>(e&&PRODUCT_CFG[e.pid])||cfg();

  const DEFAULTS={ from:'2026-08-01 00:00:00', to:'2026-08-18 23:59:59',
    npanxx:'250999', pon:'IRIS102002170008', number:'2509991212',
    date:'2026-08-01 00:00:00', status:'Confirmed',
    requestNumber:'', RequestNumber:'', PortType:'', HomeSpid:'', PortedTn:'',
    code:'', };

  // ---- pricing ------------------------------------------------------------
  // Per event (/catalog.json pricing, lib/catalogs/pricing.js). Every
  // endpoint carries its rateClass and priceCents:
  //   free      reads, lists, searches, status: never charged
  //   standard  1¢ per successful event      } need a card on file live
  //   advanced  2.5¢ per successful event    } (402 card_required without one)
  //   service   orders telecom service: no API fee; the service is billed
  //             under Iristel's tariff
  // Only successful (2xx) live calls are billable. The sandbox (header
  // X-Marketplace-Mode: sandbox) gives 1,000 calls a month, never billed.
  // The gateway has the last word; the console only explains.
  const priceText=c=>{c=Number(c||0);return c<100?(Math.round(c*10)/10)+'¢':'$'+(c/100).toFixed(2);};
  const FALLBACK_CLASSES=[
    {id:'free',name:'Free',priceCents:0},{id:'standard',name:'Standard',priceCents:1},
    {id:'advanced',name:'Advanced',priceCents:2.5},{id:'service',name:'Service order',priceCents:0}];
  const rateClasses=()=>(pricing&&Array.isArray(pricing.classes)&&pricing.classes.length?pricing.classes:FALLBACK_CLASSES);
  const classById=id=>rateClasses().find(c=>c.id===id)||null;
  const rateOf=e=>(e&&classById(e.rateClass))||null;
  const priced=e=>{const r=rateOf(e);return !!(r&&r.priceCents);};
  const isService=e=>!!e&&e.rateClass==='service';
  const sandboxLimit=()=>Number((ACCOUNT&&ACCOUNT.sandbox&&ACCOUNT.sandbox.limit)||(ME&&ME.sandbox&&ME.sandbox.limit)||(pricing&&pricing.sandboxCalls)||1000);
  const num=n=>Number(n).toLocaleString('en-CA');
  const proposed=()=>!!pricing&&pricing.status==='proposed';
  const PROPOSED='Proposed rates, subject to approval';
  // What is billed, said the same way everywhere.
  const BILLABLE_EVENT='a successful (2xx) live call; failed calls, sandbox calls and repeated Idempotency-Key requests aren\'t billed';
  const TARIFF='The service ordered is billed under Iristel\'s tariff.';
  // "Standard 1¢ · Advanced 2.5¢" from the catalog's classes; pricedSentence
  // says "Standard 1¢ and Advanced 2.5¢".
  const pricedText=()=>rateClasses().filter(c=>c.priceCents).map(c=>c.name+' '+priceText(c.priceCents)).join(' · ');
  const pricedSentence=()=>rateClasses().filter(c=>c.priceCents).map(c=>c.name+' '+priceText(c.priceCents)).join(' and ');
  // Short, for Iris: "reads free; Standard 1¢; Advanced 2.5¢ per successful event; service orders no API fee".
  const rateCardText=()=>'reads free; '+rateClasses().filter(c=>c.priceCents).map(c=>c.name+' '+priceText(c.priceCents)).join('; ')
    +' per successful event; service orders no API fee'+(proposed()?' ('+PROPOSED.toLowerCase()+')':'');
  function rateLabel(r){
    if(!r)return '';
    if(r.id==='service')return 'Service order · no API fee';
    return r.priceCents?r.name+' · '+priceText(r.priceCents):'Free';
  }
  function rateTitle(r){
    if(!r)return '';
    if(r.id==='service')return 'Orders telecom service: no API fee. '+TARIFF;
    if(!r.priceCents)return 'Free: never charged.';
    return r.name+' event: '+priceText(r.priceCents)+' CAD per successful live call. Billable event: '+BILLABLE_EVENT+'.'+(proposed()?' '+PROPOSED+'.':'');
  }
  function rateBadge(e){
    const r=rateOf(e);
    return r?'<span class="rate '+esc(r.id)+'" title="'+esc(rateTitle(r))+'">'+esc(rateLabel(r))+'</span>':'';
  }
  // A bundle's API cost per run (its Standard and Advanced steps).
  function bundleCost(b){
    if(!b||b.apiCents==null)return '';
    const api=Number(b.apiCents)||0, svc=Number(b.serviceSteps)||0;
    const title='API cost per run: '+(api?priceText(api)+' CAD, for its Standard and Advanced steps':'none')+'.'
      +(svc?' '+svc+' step'+(svc===1?' orders':'s order')+' telecom service: no API fee; '+TARIFF.charAt(0).toLowerCase()+TARIFF.slice(1):'');
    return '<span class="rate bundle" title="'+esc(title)+'">'+esc(api?priceText(api)+' per run':'No API fee')+'</span>';
  }
  // One line per endpoint in the docs.
  function priceLine(e){
    const r=rateOf(e);
    if(!r)return '<p class="price-note"><b>Pricing:</b> not in the rate card, never charged.</p>';
    if(r.id==='service')return '<p class="price-note"><b>Service order:</b> no API fee. '+esc(TARIFF)+'</p>';
    if(!r.priceCents)return '<p class="price-note"><b>Free:</b> never charged.</p>';
    return '<p class="price-note"><b>'+esc(r.name)+':</b> '+esc(priceText(r.priceCents))+' CAD per successful live call.</p>';
  }
  // Staff and internal accounts are never billed.
  const exempt=()=>(ACCOUNT&&ACCOUNT.mode==='exempt')||!!(ME&&(ME.isStaff||ME.mode==='exempt'));
  // Espresso products have a test system the sandbox uses; the others are
  // read-only in the sandbox (409 no_test_system on a change).
  const ESPRESSO_IDS=['lnp-enterprise','did-orders','lrn'];
  const sandboxReadOnly=e=>!ESPRESSO_IDS.includes(e.pid)&&!/^(GET|HEAD|OPTIONS)$/.test(e.method);

  // ---- load registry ----------------------------------------------------
  let products,bundles=[],audiences=[],categories=[],pricing=null,pricingNote='';
  try{
    const reg=await (await fetch(ORIGIN+'/catalog.json')).json();
    products=reg.products; bundles=reg.bundles||[]; audiences=reg.audiences||[]; categories=reg.categories||[];
    pricing=reg.pricing&&typeof reg.pricing==='object'?reg.pricing:null;
    pricingNote=reg.pricingNote||(pricing&&pricing.pricingNote)||'';
  }
  catch(e){
    const msg='Could not load <code>GET /catalog.json</code>. Is the gateway running?';
    nav.innerHTML='<div class="empty" style="padding:14px">'+msg+'</div>';
    $('#docs-body').innerHTML='<p class="lead">'+msg+'</p>';
    irisUnavailable('catalog_unavailable');
    return;
  }

  // ---- partner type badge -----------------------------------------------
  const partnerType=(getCookie('partnerType')||'').trim();
  if(partnerType){
    const b=$('#partner-badge'); b.hidden=false; b.textContent=partnerType;
    b.title='Partner type from your portal login. Used for labelling only for now.';
  }

  // ---- marketplace access gating -----------------------------------------
  // Cookie/URL param give the login-time snapshot; when we know the email we
  // re-validate LIVE against the gateway on every load, so a revocation in
  // CRM (approved switch unchecked) locks the console on the next visit —
  // no re-login needed. The cookie is rewritten with the fresh value.
  let mpAuth=window.MarketplaceAccess?window.MarketplaceAccess.authorizedProducts():null;
  const mpEmail=window.MarketplaceAccess?window.MarketplaceAccess.email():null;
  if(mpEmail){
    try{
      const mpSession=window.MarketplaceAccess.session();
      const live=await (await fetch(ORIGIN+'/marketplace/authorizations?email='+encodeURIComponent(mpEmail),
        {headers:mpSession?{Authorization:'Bearer '+mpSession}:{}})).json();
      if(Array.isArray(live.products)){
        mpAuth=live.products;
        const d=new Date();d.setTime(d.getTime()+7*24*60*60*1000);
        document.cookie='marketplaceAccess='+encodeURIComponent(mpAuth.join(','))+'; expires='+d.toUTCString()+'; path=/; SameSite=None; Secure';
      }
    }catch(_){/* offline/lookup failure: keep the login-time snapshot */}
  }
  if(mpAuth!==null){
    products=products.filter(p=>mpAuth.includes(p.id));
    bundles=bundles.filter(b=>(b.steps||[]).every(s=>mpAuth.includes(s.product)));
    const badge=$('#partner-badge'); badge.hidden=false;
    const em=window.MarketplaceAccess.email();
    badge.textContent='Access: '+products.length+' API'+(products.length===1?'':'s')+(em?' · '+em:'');
    badge.title='API products authorized for your partner portal login.';
    if(!products.length){
      $('#docs-body').innerHTML='<h2>No API access yet</h2><p class="lead">Your partner portal login has no marketplace products authorized. <a href="'+REQUEST_URL+'" target="_top">Request access here</a>.</p>';
      // Already asked? Say it's being reviewed instead.
      const sess=window.MarketplaceAccess.session&&window.MarketplaceAccess.session();
      if(em&&sess)fetch(ORIGIN+'/marketplace/authorizations?email='+encodeURIComponent(em),{headers:{Authorization:'Bearer '+sess}})
        .then(r=>r.ok?r.json():null).then(a=>{if(a&&a.status==='pending'){$('#docs-body').innerHTML='<h2>Your request is under review</h2><p class="lead">We\'ll email you as soon as it\'s approved — your approved APIs then appear here automatically.</p>';irisUnavailable('under_review');}}).catch(()=>{});
      $('#product-bar').innerHTML='';
      irisUnavailable('no_access');
      return;
    }
  }

  // ---- account mode and the sandbox --------------------------------------
  // ACCOUNT is /marketplace/billing. Its mode: exempt (staff, never billed) |
  // live (card on file) | card_required (no card: Standard and Advanced need
  // one; free reads and service orders don't) | past_due (only free reads
  // work live). Separately, each call is live or sandbox: the Sandbox switch
  // in the mode bar sends X-Marketplace-Mode: sandbox on every console call
  // (1,000 a month, never billed). The switch is remembered per browser.
  // After each call the gateway's X-Sandbox-Calls-Remaining refreshes the
  // count (lib/entitlements.js).
  let ACCOUNT=null;
  const SANDBOX_KEY='iristel-api-sandbox';
  let SANDBOX=false;
  try{SANDBOX=localStorage.getItem(SANDBOX_KEY)==='1';}catch(_){/* storage blocked: live */}
  // Partners only: staff calls ignore the header (never billed anyway); for
  // staff the switch picks the Espresso system instead.
  const sandboxOn=()=>SANDBOX&&!exempt();
  const staffEnv=()=>SANDBOX?'test':'production';
  const callMode=()=>exempt()?null:(SANDBOX?'sandbox':'live');
  const acctMode=()=>ACCOUNT&&ACCOUNT.mode?ACCOUNT.mode:(ME&&ME.mode)||null;
  const sandboxState=()=>(ACCOUNT&&ACCOUNT.sandbox)||(ME&&ME.sandbox)||null;
  function setSandbox(on){
    SANDBOX=!!on;
    try{localStorage.setItem(SANDBOX_KEY,SANDBOX?'1':'0');}catch(_){/* not remembered */}
    renderModebar();
    // Code samples carry the sandbox header when it is on.
    ROOT.querySelectorAll('[data-snippet]').forEach(pre=>pre.dispatchEvent(new Event('mp-refresh')));
    try{irisNav();}catch(_){/* before the Iris hooks are set up */}
  }
  function openBilling(){const b=ROOT.querySelector('.pchip[data-id="billing"]');if(b)b.click();}
  ROOT.addEventListener('click',ev=>{
    if(ev.target.closest('[data-open-billing]')){ev.preventDefault();openBilling();return;}
    // "Try in sandbox" / "Send it live instead" switches in a response.
    const sw=ev.target.closest('[data-sandbox-set]');
    if(sw){
      ev.preventDefault();
      const on=sw.dataset.sandboxSet==='on';
      setSandbox(on);
      sw.setAttribute('aria-checked','true');
      sw.textContent=on?'Sandbox on: press Send again':'Live: press Send again';
    }
  });
  function renderModebar(){
    const el=$('#modebar'), app=ROOT.querySelector('.mp-app');
    const mode=acctMode(), staff=exempt();
    app.classList.toggle('sbx',sandboxOn());
    app.classList.toggle('nocard',!staff&&mode==='card_required');
    if(!mode&&!staff&&!mpSession()){el.hidden=true;return;}
    const stateEl=el.querySelector('.mb-state'), cardEl=el.querySelector('.mb-card'), sbx=el.querySelector('.mb-sbx'), toggle=$('#sandbox-toggle'), countEl=el.querySelector('.mb-count');
    const prop=proposed()?'<span class="mb-proposed" title="'+esc((pricing&&pricing.note)||PROPOSED)+'">'+PROPOSED+'</span>':'';
    const rates='<span>'+esc(pricedText())+' per successful event · reads free</span>'+prop;
    const cta=label=>'<button type="button" data-open-billing>'+label+'</button>';
    let cls, h, card='';
    if(staff){
      cls='staff';
      h='<b>Staff</b><span>Not billed · '+(SANDBOX?'Sandbox on: Espresso APIs use Espresso\'s test system (DID Orders and LRN have none yet)':'Live: Espresso APIs use Espresso\'s production system')+'</span>';
    }else if(sandboxOn()){
      cls='sandbox';
      h='<b>Sandbox</b><span>Test calls, never billed · Espresso APIs use its test system; other APIs are read-only</span>';
    }else if(mode==='past_due'){
      cls='block';
      h='<b>Payment due</b><span>Your last payment didn\'t go through. Free reads still work; other live calls are paused until you update your card.</span>'+cta('Update card →');
    }else{
      cls='live';
      h='<b>Live</b>'+rates;
      // Second row: what a card is for.
      if(mode==='card_required')card='<span>Add a card under Billing &amp; usage for Standard and Advanced calls</span>'+cta('Add a card →');
    }
    el.className='modebar '+cls;
    stateEl.innerHTML=h;
    cardEl.innerHTML=card;cardEl.hidden=!card;
    // The switch for everyone (staff: Espresso test or production); the
    // count for partners only.
    sbx.hidden=false;
    toggle.checked=SANDBOX;
    const s=sandboxState();
    countEl.textContent=staff||!s||s.left==null?'':num(s.left)+' of '+num(s.limit||sandboxLimit())+' sandbox calls left this month';
    el.hidden=false;
  }
  $('#sandbox-toggle').addEventListener('change',ev=>setSandbox(ev.target.checked));
  // After every call: the sandbox calls left, and what a refusal says about
  // the account (a card removed elsewhere, a payment that failed).
  function noteCall(r,parsed){
    if(!ACCOUNT||ACCOUNT.mode==='exempt')return;
    const left=r.headers.get('X-Sandbox-Calls-Remaining');
    if(left!==null&&left!==''&&Number.isFinite(Number(left))){
      const lim=sandboxLimit(), n=Math.max(0,Number(left));
      ACCOUNT.sandbox={limit:lim,used:Math.max(0,lim-n),left:n};
    }
    const err=parsed&&typeof parsed==='object'?parsed.error:null;
    if(r.status===402&&err==='card_required'&&ACCOUNT.mode==='live'){ACCOUNT.mode='card_required';ACCOUNT.cardOnFile=false;}
    if(r.status===402&&err==='payment_required'){ACCOUNT.mode='past_due';ACCOUNT.pastDue=true;}
    if(r.status===429&&err==='sandbox_limit'&&ACCOUNT.sandbox){ACCOUNT.sandbox.used=ACCOUNT.sandbox.limit;ACCOUNT.sandbox.left=0;}
    renderModebar();
  }
  // Who is calling (/marketplace/me): own agent ids, staff flag, granted
  // products. Feeds the runtime defaults below and the Iris bridge; the
  // console works the same without it. /me can wait on a slow upstream, so
  // the first render waits for it at most ~1.5 s; a later answer is applied
  // when it lands (meLate, below RUNTIME_DEFAULTS).
  let ME=null, meLate=null;
  const setMe=m=>{ME=m&&typeof m==='object'?m:null;if(ME&&!Array.isArray(ME.agents))ME.agents=[];};
  if(mpSession()){
    const meLoad=fetch(ORIGIN+'/marketplace/me',{headers:{Authorization:'Bearer '+mpSession()}})
      .then(r=>r.ok?r.json():null).catch(()=>null);
    const meWait=new Promise(r=>setTimeout(()=>r(undefined),1500));
    try{ACCOUNT=await billingApi('GET');}catch(_){/* billing unavailable: no banner */}
    renderModebar();
    const m=await Promise.race([meLoad,meWait]);
    if(m===undefined)meLate=meLoad;else setMe(m);
  }

  // Values that depend on who is logged in, per product: consulted after the
  // ui-hint default and before DEFAULTS (formHtml). Commissions: the caller's
  // own agent id when there is exactly one, last calendar month, first page.
  const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const NOW=new Date();
  const RUNTIME_DEFAULTS={
    'iristelx-commission':{
      agentId:ME&&ME.agents.length===1?String(ME.agents[0].id):'',
      startDate:ymd(new Date(NOW.getFullYear(),NOW.getMonth()-1,1)),
      endDate:ymd(new Date(NOW.getFullYear(),NOW.getMonth(),0)),
      limit:'500', offset:'0',
    },
  };
  const runtimeDefault=(e,name)=>{const r=RUNTIME_DEFAULTS[e.pid];return r&&r[name]!==undefined?r[name]:undefined;};
  // /me answered after the first render: its agent id becomes the default,
  // and commission cards already on screen get it where the field is still
  // empty and untouched. Runs after the synchronous first render below.
  if(meLate)meLate.then(m=>{
    setMe(m);
    renderModebar();   // staff, mode and sandbox from /me when billing had none
    irisReady();   // the Iris panel re-reads me() (its pilot flag) on this event
    const id=ME&&ME.agents.length===1?String(ME.agents[0].id):'';
    if(!id)return;
    RUNTIME_DEFAULTS['iristelx-commission'].agentId=id;
    ROOT.querySelectorAll('[data-path="agentId"]').forEach(i=>{
      if(i.value!==''||i.dataset.touched)return;
      i.value=id;i.dispatchEvent(new Event('input'));
    });
  });

  // Iris hooks: the last send attempt (any outcome) and listeners registered
  // through the bridge's on(). Declared here because markProduct() runs below.
  let LAST=null, irisStep=null, irisNavQueued=false, irisNavKey=null;
  const irisListeners={result:[],nav:[]};
  function irisEmit(name,payload){(irisListeners[name]||[]).forEach(cb=>{try{cb(payload);}catch(_){}});}
  // What a 'nav' event reports: only a change in one of these is news.
  const navKeyOf=c=>JSON.stringify([c.productId,c.tab,c.bundleId,c.bundleStep]);
  // After the click handler's synchronous re-render, so context() sees the new page.
  // Nothing moved (e.g. Iris filling the card the user is already on): no event.
  function irisNav(){
    if(irisNavQueued||!irisListeners.nav.length)return;
    irisNavQueued=true;
    Promise.resolve().then(()=>{
      irisNavQueued=false;
      const c=irisContext(), k=navKeyOf(c);
      if(k===irisNavKey)return;
      irisNavKey=k;irisEmit('nav',c);
    });
  }

  products.forEach(p=>(p.endpoints||[]).forEach(e=>{e.pid=p.id;}));

  // ---- product menu -----------------------------------------------------
  const bar=$('#product-bar');
  const hashProduct=(location.hash.match(/#([a-z0-9-]+)/)||[])[1];
  const isBundleId=id=>String(id).startsWith('bundle:');
  const bundleOf=id=>bundles.find(b=>'bundle:'+b.id===id);
  const hashFor=id=>isBundleId(id)?'bundle-'+id.slice(7):id;
  const hashBundle=(hashProduct||'').startsWith('bundle-')?'bundle:'+hashProduct.slice(7):null;
  let productId=hashProduct==='billing'?'billing'
    :(hashProduct==='bundles'&&bundles.length)?'bundles'
    :(hashBundle&&bundleOf(hashBundle))?hashBundle
    :products.some(p=>p.id===hashProduct)?hashProduct
    :(products.find(p=>p.status==='live')||products[0]).id;

  // Bundles: a collapsible group — an Overview page plus one guided console
  // per bundle (productId 'bundle:<id>', hash #bundle-<id>).
  let bundleOpen=false, setBundleOpen=()=>{};
  if(bundles.length){
    const bHead=document.createElement('button');
    bHead.className='pgroup-head'; bHead.type='button'; bHead.setAttribute('aria-controls','bundle-group');
    bHead.innerHTML='<span class="caret" aria-hidden="true">▾</span> 📦 Bundles <span class="cnt">('+bundles.length+')</span>';
    bar.appendChild(bHead);
    const bGroup=document.createElement('div');
    bGroup.id='bundle-group';
    bar.appendChild(bGroup);
    const chip=(id,label,title)=>{
      const b=document.createElement('button');
      b.className='pchip'; b.dataset.id=id; b.setAttribute('role','tab');
      b.innerHTML=label; b.title=title||'';
      b.onclick=()=>{ productId=id; location.hash='#'+hashFor(id); markProduct(); renderProduct(); };
      bGroup.appendChild(b);
    };
    chip('bundles','Overview','Every bundle and what it is for');
    audiences.forEach(a=>{
      const list=bundles.filter(b=>b.audience===a.id);
      if(!list.length)return;
      const sub=document.createElement('div');sub.className='pgroup-sub';sub.textContent=a.label;bGroup.appendChild(sub);
      list.forEach(b=>chip('bundle:'+b.id,esc(b.name),b.useCase));
    });
    // Collapsed by default; only a manual open (saved on click) is remembered.
    try{bundleOpen=localStorage.getItem('iristel-bundle-group-open-v2')==='1';}catch(_){}
    setBundleOpen=open=>{
      bundleOpen=open;
      bGroup.classList.toggle('collapsed',!open);
      bHead.setAttribute('aria-expanded',String(open));
    };
    bHead.onclick=()=>{
      setBundleOpen(!bundleOpen);
      try{localStorage.setItem('iristel-bundle-group-open-v2',bundleOpen?'1':'0');}catch(_){}
    };
    setBundleOpen(bundleOpen||isBundleId(productId));
  }
  // Individual products live under a collapsible "APIs" group.
  const groupHead=document.createElement('button');
  groupHead.className='pgroup-head'; groupHead.id='api-group-head'; groupHead.type='button';
  groupHead.innerHTML='<span class="caret" aria-hidden="true">▾</span> APIs <span class="cnt">('+products.length+')</span>';
  bar.appendChild(groupHead);
  const apiGroup=document.createElement('div');
  apiGroup.id='api-group';
  bar.appendChild(apiGroup);
  let groupOpen=true;
  try{groupOpen=localStorage.getItem('iristel-api-group-open')!=='0';}catch(_){}
  function setGroupOpen(open){
    groupOpen=open;
    apiGroup.classList.toggle('collapsed',!open);
    groupHead.setAttribute('aria-expanded',String(open));
    try{localStorage.setItem('iristel-api-group-open',open?'1':'0');}catch(_){}
  }
  groupHead.onclick=()=>setGroupOpen(!groupOpen);
  groupHead.setAttribute('aria-controls','api-group');

  products.forEach(p=>{
    const b=document.createElement('button');
    b.className='pchip'; b.dataset.id=p.id; b.setAttribute('role','tab');
    b.innerHTML=esc(p.name)+(p.status==='planned'||p.status==='preview'?'<span class="soon">soon</span>':'');
    b.title=p.summary||'';
    b.onclick=()=>{ productId=p.id; location.hash='#'+p.id; markProduct(); renderProduct(); };
    apiGroup.appendChild(b);
  });
  setGroupOpen(groupOpen||products.some(p=>p.id===productId));
  // Billing & usage: the partner's card on file, this month's usage and past
  // charges (lib/billing.js).
  {
    const b=document.createElement('button');
    b.className='pchip'; b.dataset.id='billing'; b.setAttribute('role','tab');
    b.innerHTML='💳 Billing &amp; usage'; b.title='Your card on file, usage this month and past charges';
    b.style.marginTop='10px';
    b.onclick=()=>{ productId='billing'; location.hash='#billing'; markProduct(); renderProduct(); };
    bar.appendChild(b);
  }
  // ---- phone pickers ----------------------------------------------------
  // Below 760px the CSS hides the product rail and the endpoint rail; these
  // two selects stand in for them. Picking an option clicks the matching rail
  // button, so the hash, bundles and the Iris bridge work exactly as on a
  // desktop, and the selects follow the rails' .active state.
  {
    const pSel=$('#m-product'), jSel=$('#m-jump'), jWrap=$('#m-jump-wrap');
    const label=el=>{const c=el.cloneNode(true);c.querySelectorAll('.soon').forEach(s=>s.replaceWith(' (soon)'));c.querySelectorAll('br').forEach(s=>s.replaceWith(' · '));return c.textContent.replace(/\s+/g,' ').trim();};
    const opt=(parent,value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;parent.appendChild(o);};
    const group=(name,chips)=>{
      if(!chips.length)return;
      const g=document.createElement('optgroup');g.label=name;
      chips.forEach(c=>opt(g,c.dataset.id,label(c)));
      pSel.appendChild(g);
    };
    group('APIs',[...bar.querySelectorAll('#api-group .pchip')]);
    group('Bundles',[...bar.querySelectorAll('#bundle-group .pchip')]);
    const bill=bar.querySelector('.pchip[data-id="billing"]');if(bill)opt(pSel,'billing',label(bill));
    const syncProduct=()=>{const a=bar.querySelector('.pchip.active');if(a&&pSel.value!==a.dataset.id)pSel.value=a.dataset.id;};
    pSel.onchange=()=>{const c=[...bar.querySelectorAll('.pchip')].find(x=>x.dataset.id===pSel.value);if(c)c.click();};
    new MutationObserver(syncProduct).observe(bar,{subtree:true,attributes:true,attributeFilter:['class']});

    const navButtons=()=>[...nav.querySelectorAll(':scope>button')];
    const syncJump=()=>{const i=navButtons().findIndex(b=>b.classList.contains('active'));jSel.value=i<0?'':String(i);};
    const fillJump=()=>{
      const btns=navButtons();
      jSel.innerHTML='';
      opt(jSel,'','Choose an endpoint…');
      let g=null;
      [...nav.children].forEach(el=>{
        if(el.classList.contains('group')){g=document.createElement('optgroup');g.label=el.textContent;jSel.appendChild(g);}
        else if(el.tagName==='BUTTON')opt(g||jSel,String(btns.indexOf(el)),[...el.children].map(label).join('  '));
      });
      jWrap.hidden=btns.length<2;
      syncJump();
    };
    jSel.onchange=()=>{const b=navButtons()[+jSel.value];if(b)b.click();};
    new MutationObserver(fillJump).observe(nav,{childList:true});
    new MutationObserver(syncJump).observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
    fillJump();
  }
  function markProduct(){
    bar.querySelectorAll('.pchip').forEach(b=>{
      const on=b.dataset.id===productId;
      b.classList.toggle('active',on);
      b.setAttribute('aria-selected',String(on));
    });
    // Never leave the active product invisible inside a collapsed group.
    if(!groupOpen&&products.some(p=>p.id===productId))setGroupOpen(true);
    if(!bundleOpen&&(productId==='bundles'||isBundleId(productId)))setBundleOpen(true);
    irisNav();
  }
  markProduct();

  const product=()=>products.find(p=>p.id===productId);
  const catalog=()=>product().endpoints||[];

  // ---- sidebar search ---------------------------------------------------
  // Intent map: everyday phrasings -> product ids. Keys are matched as
  // whole words/phrases against the query.
  const INTENT_MAP={
    'phone number|buy number|did|dids|order number|search number|number inventory|toll free|local number|available number|reserve number':['did-orders'],
    'lrn|lrn lookup|number lookup|carrier lookup|dip|dipping|who owns|porting history|local routing number':['lrn'],
    'spid':['lrn','lnp-wireless'],
    'port|porting|port in|port out|transfer number|move number|lnp|pon|migrate number':['lnp-enterprise','lnp-wireless'],
    'wireless|mobile port|cwnpg|syniverse':['lnp-wireless'],
    'wireline|enterprise port':['lnp-enterprise'],
    '911|e911|emergency|dispatch|address listing':['e911'],
    'trunk|sip|provision|uboss|welcome letter|welcome email':['provisioning','iristelx-accounts'],
    'account|customer|service|plan|plans|usage|address|billing':['iristelx-accounts'],
    'sim|esim|qr|sim card|activate sim':['iristelx-sim','iristelx-mobile'],
    'commission|agent|payout|revenue':['iristelx-commission'],
    'app|subscriber|notification|support ticket|top up|topup|payment|pay':['iristelx-mobile'],
    'broadworks|hosted pbx|pbx|seat|ucaas|hosted voice|service pack':['broadworks'],
  };
  const norm=s=>String(s||'').toLowerCase();
  function intentProducts(q){
    const hits=new Set();
    Object.entries(INTENT_MAP).forEach(([keys,ids])=>{
      if(keys.split('|').some(k=>new RegExp('\\b'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'s?\\b').test(q)))
        ids.forEach(id=>hits.add(id));
    });
    return hits;
  }
  // Per-product searchable text (same fields the docs render from).
  const searchIndex=products.map(p=>({
    id:p.id,
    nameL:norm(p.name),
    text:norm([p.name,p.summary,(p.endpoints||[]).map(e=>
      [e.method,e.path,e.summary,e.description,e.returns,
       (e.params||[]).map(x=>x.name+' '+(x.description||'')).join(' '),
       (e.fields||[]).map(f=>f.name+' '+(f.description||'')).join(' ')].join(' ')
    ).join(' ')].join(' ')),
    endpoints:(p.endpoints||[]).map(e=>({e,text:norm([e.method,e.path,e.summary,e.description].join(' '))})),
  }));
  function searchAll(qRaw){
    const q=norm(qRaw).trim();
    if(!q)return null;
    const tokens=q.split(/\s+/).filter(t=>t.length>1);
    const intents=intentProducts(q);
    const scored=searchIndex.map(ix=>{
      let s=0;
      // A product that isn't switched on yet never outranks a live one doing the same job.
      const preview=(products.find(p=>p.id===ix.id)||{}).status==='preview';
      if(ix.nameL.includes(q))s+=100;
      if(intents.has(ix.id)&&!preview)s+=60;
      tokens.forEach(t=>{
        if(ix.nameL.includes(t))s+=25;
        else if(ix.text.includes(t))s+=8;
      });
      const eps=ix.endpoints
        .map(x=>({...x,score:tokens.reduce((a,t)=>a+(x.text.includes(t)?10:0),0)}))
        .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
      if(eps.length)s+=5;
      if(preview&&s>0)s=Math.max(1,s-40);
      return {id:ix.id,score:s,eps};
    }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
    // Drop weak matches when a clearly better one exists.
    const top=scored.length?scored[0].score:0;
    return scored.filter(r=>r.score>=Math.max(10,top/4));
  }

  const searchEl=$('#product-search'), resultsEl=$('#search-results');
  function openEndpoint(pid,ep){
    if(productId!==pid){productId=pid;location.hash='#'+pid;markProduct();renderProduct();}
    showTab('console');
    const b=nav.querySelector('[data-ep="'+ep.method+' '+ep.path+'"]');
    if(b){b.click();b.scrollIntoView({block:'nearest'});}
    else{
      // Multi-card products have no endpoint list — scroll to the card.
      const card=$('#opgrid [data-ep="'+ep.method+' '+ep.path+'"]');
      if(card)card.scrollIntoView({block:'start',behavior:'smooth'});
    }
  }
  function openProduct(pid){
    productId=pid;location.hash='#'+pid;markProduct();renderProduct();
    clearSearch();
  }
  function clearSearch(){
    searchEl.value='';
    resultsEl.hidden=true;resultsEl.innerHTML='';
    bar.querySelectorAll('.pchip').forEach(b=>{b.hidden=false;b.style.order='';});
  }
  function runSearch(){
    const q=searchEl.value;
    const scored=searchAll(q);
    if(!scored){clearSearch();return;}
    if(!groupOpen)setGroupOpen(true);   // results must be visible
    const rank={};scored.forEach((r,i)=>rank[r.id]=i);
    bar.querySelectorAll('.pchip').forEach(b=>{
      const r=rank[b.dataset.id];
      b.hidden=r===undefined;
      b.style.order=r===undefined?'':String(r);
    });
    resultsEl.innerHTML='';
    const frag=document.createDocumentFragment();
    // Bundle matches first — "order a sip trunk" should surface the bundle.
    const qn=norm(q), qTokens=qn.split(/\s+/).filter(t=>t.length>2);
    bundles.map(b=>{
      const text=norm([b.name,b.useCase,b.summary,b.audience].join(' '));
      let s=0; if(text.includes(qn))s+=40;
      qTokens.forEach(t=>{if(text.includes(t))s+=10;});
      return {b,s};
    }).filter(x=>x.s>=20).sort((a,b)=>b.s-a.s).slice(0,2).forEach(x=>{
      const btn=document.createElement('button');
      btn.className='sres';
      btn.innerHTML='<span>📦 '+esc(x.b.name)+'</span><small>Bundle · '+esc(x.b.useCase)+'</small>';
      btn.onclick=()=>{clearSearch();openBundle(x.b.id);};
      frag.appendChild(btn);
    });
    let shown=0;
    scored.slice(0,4).forEach(r=>{
      const p=products.find(x=>x.id===r.id);
      r.eps.forEach(x=>{
        if(shown>=8)return;shown++;
        const btn=document.createElement('button');
        btn.className='sres';
        btn.innerHTML='<span><span class="m">'+x.e.method+'</span> '+esc(x.e.path)+'</span>'
          +'<small>'+esc(p.name)+(x.e.summary?' · '+esc(x.e.summary):'')+'</small>';
        btn.onclick=()=>{openEndpoint(r.id,x.e);clearSearch();};
        frag.appendChild(btn);
      });
    });
    if(!scored.length&&!frag.childNodes.length){
      resultsEl.innerHTML='<div class="snone">No API matches — try other words (e.g. “port a number”, “send text”, “911”).</div>';
    }else{
      resultsEl.appendChild(frag);
    }
    resultsEl.hidden=false;
  }
  let searchT;
  searchEl.addEventListener('input',()=>{clearTimeout(searchT);searchT=setTimeout(runSearch,150);});
  searchEl.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'){clearSearch();searchEl.blur();}
    if(ev.key==='Enter'){
      const scored=searchAll(searchEl.value);
      if(scored&&scored.length){
        if(scored[0].eps.length){openEndpoint(scored[0].id,scored[0].eps[0].e);}
        else openProduct(scored[0].id);
        clearSearch();
      }
    }
  });

  // ---- tabs -------------------------------------------------------------
  function showTab(which){
    const docs=which==='docs';
    $('#view-docs').hidden=!docs; $('#view-console').hidden=docs;
    $('#tab-docs').setAttribute('aria-selected',String(docs));
    $('#tab-console').setAttribute('aria-selected',String(!docs));
    irisNav();
  }
  $('#tab-docs').onclick=()=>showTab('docs');
  $('#tab-console').onclick=()=>showTab('console');
  showTab(location.hash.includes('console')?'console':'docs');

  // ---- auth snippet helpers --------------------------------------------
  function authHeaderLines(env,e){
    const L=["  -H 'Authorization: Bearer "+KEY_PH+"'"];
    return L;
  }

  function highlight(t){
    return esc(t)
      .replace(USER_PH,'<span class="cred">'+USER_PH+'</span>')
      .replace(PASS_PH,'<span class="cred">'+PASS_PH+'</span>')
      .replace(KEY_PH,'<span class="cred">'+KEY_PH+'</span>');
  }

  // ---- flow diagrams ----------------------------------------------------
  // Rendered from the authored specs in lib/catalogs/flows.js as HTML/CSS
  // rather than images, so they inherit the theme and stay readable on mobile.
  // Brand step colours, defined per theme in the CSS (--t1..--t6).
  const TONES={blue:1,green:2,purple:3,amber:4,teal:5,red:6};
  function renderFlow(flow){
    if(!flow||!flow.steps||!flow.steps.length)return '';
    let h='<div class="flow"><div class="flow-head"><h3>'+esc(flow.title||'How it works')+'</h3>';
    if(flow.subtitle)h+='<p>'+esc(flow.subtitle)+'</p>';
    h+='</div><div class="flow-scroll"><div class="flow-grid">';
    flow.steps.forEach((s,i)=>{
      const t=TONES[s.tone]||TONES.blue;
      h+='<div class="flow-col" style="--tone:var(--t'+t+');--tone-fill:var(--t'+t+'f)">'
        +'<div class="fstep"><div class="fnum">'+(i+1)+'</div>'
        +'<h4>'+esc(s.title||'')+'</h4><p>'+esc(s.text||'')+'</p></div>';
      if(s.detail){
        h+='<div class="fdetail">';
        if(s.detail.endpoint)h+='<code class="fep">'+esc(s.detail.endpoint)+'</code>';
        if(s.detail.rows&&s.detail.rows.length){
          h+='<dl>';
          s.detail.rows.forEach(r=>{h+='<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'});
          h+='</dl>';
        }
        h+='</div>';
      }
      h+='</div>';
    });
    h+='</div></div>';
    if(flow.notes&&flow.notes.length){
      h+='<div class="flow-notes"><span class="ni" aria-hidden="true">ⓘ</span><ul>'
        +flow.notes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></div>';
    }
    return h+'</div>';
  }
  function renderImages(images){
    if(!images||!images.length)return '';
    return images.map(im=>'<figure class="flow-img"><img src="'+esc(im.src)+'" alt="'+esc(im.alt||'')+'" loading="lazy">'
      +(im.caption?'<figcaption>'+esc(im.caption)+'</figcaption>':'')+'</figure>').join('');
  }

  // ---- documentation ----------------------------------------------------
  function introDocs(p){
    const c=cfg();
    let d='<h2>'+esc(p.name)+'</h2>'
      +'<p class="lead">'+esc(p.summary)+'</p>'
      ;
    if(p.status==='planned'){
      d+='<div class="callout"><b>Coming soon.</b> This product is on the marketplace roadmap; its endpoints have not been published yet.</div>';
      return d;
    }
    if(p.status==='preview'){
      d+='<div class="callout"><b>Switching on soon.</b> Everything below is how this API works, and you can fill in the forms, '
        +'but calls answer <code>503 not_enabled</code> until Iristel switches it on.</div>';
    }
    d+=renderFlow(p.flow)+renderImages(p.images);

    d+='<h3>Base URL</h3><pre>'+esc(c.base)+'</pre>'
      +'<p>All paths in this reference are relative to it.</p>';

    d+='<h3>Authentication</h3>'
      +'<p>Every request carries your personal marketplace API key:</p>'
      +'<pre>'+esc('Authorization: Bearer '+KEY_PH)+'</pre>'
      +'<p><button class="btn" type="button" data-getkey>Show my API key</button></p>'
      +'<pre data-mykey hidden></pre>'
      +'<p class="hint">Keep it secret, like a password. It works for the APIs your account is approved for, '
      +'and stops working if your marketplace access is removed. This console uses your portal login instead, '
      +'so you don\'t need the key here.</p>';

    if(c.auth==='edid'){
      d+='<h3>Live system and sandbox</h3>'
        +'<p>No Espresso login is needed — the gateway signs in to Espresso for you. Live calls go to Espresso\'s '
        +'<strong>production</strong> system: orders, ports and changes you make there are real. Sandbox calls '
        +'(<code>X-Marketplace-Mode: sandbox</code>) go to Espresso\'s separate test system instead.</p>';
    }else if(p.id==='e911'){
      d+='<h3>Account code</h3>'
        +'<p>Every request also carries <code>?code=</code>, the account code the listing belongs to. In the partner '
        +'portal this is read from the <code>code</code> cookie.</p>'
        +'<div class="callout"><b>Note:</b> this API may answer <code>200</code> even on failures, with the detail in an '
        +'<code>errors</code> array or a null <code>data</code> field — check the body, not just the HTTP status. '
        +'These are live emergency records: a wrong address here is what dispatch sees on a 911 call.</div>';
    }else if(c.auth==='proxy'){
      d+='<div class="callout"><b>Through the gateway.</b> WLNP is part of the IristelX API '
        +'(<a href="https://iristel-x.readme.io/reference/portin-submit" target="_blank" rel="noopener">IristelX reference</a>). '
        +'Call it at <code>'+esc(c.base)+'/api/wlnp/…</code> with your marketplace key; the gateway adds the IristelX key. '
        +'If IristelX doesn\'t answer you get <code>504 upstream_unreachable</code>.</div>';
    }else if(c.auth==='bw'){
      d+='<h3>Your enterprise</h3>'
        +'<p>Calls reach only the BroadWorks enterprise linked to your account. If your account isn\'t linked to one yet, '
        +'every call answers <code>403 broadworks_not_linked</code>: contact Iristel support and we\'ll link it. '
        +'Iristel staff name the enterprise with <code>?enterprise=</code>.</p>';
    }

    // Pricing: per successful event, by rate class (badges on every endpoint below).
    if((p.endpoints||[]).length){
      const counts=rateClasses().map(r=>{const n=(p.endpoints||[]).filter(e=>e.rateClass===r.id).length;return n?n+' '+(r.id==='service'?'service order'+(n===1?'':'s'):r.name):'';}).filter(Boolean);
      d+='<h3>Pricing</h3>'
        +(proposed()?'<div class="callout"><b>Not final:</b> '+esc((pricing&&pricing.note)||PROPOSED+'.')+'</div>':'')
        +'<p>'+esc(pricingNote||('Reads are free; '+pricedSentence()+' CAD per successful event; service orders add no API fee.'))+'</p>'
        +'<table><tr><th>Rate</th><th>Price (CAD)</th><th>What\'s in it</th></tr>'
        +rateClasses().map(r=>'<tr><td>'+rateBadge({rateClass:r.id})+'</td><td>'
          +(r.id==='service'?'No API fee':r.priceCents?'<b>'+esc(priceText(r.priceCents))+'</b><br><span class="hint">'+esc(String(r.billingUnit||'per successful event').toLowerCase())+'</span>':'No charge')+'</td><td>'
          +esc(r.whatsIn||(r.id==='service'?TARIFF:''))+'</td></tr>').join('')
        +'</table>'
        +'<p><b>Billable event:</b> '+esc(BILLABLE_EVENT)+'.</p>'
        +'<p><b>Sandbox:</b> add <code>X-Marketplace-Mode: sandbox</code> to a call (or switch on <b>Sandbox</b> at the top of this console): '
        +esc(num(sandboxLimit()))+' calls per account per calendar month, never billed. '
        +(ESPRESSO_IDS.includes(p.id)?'This API runs on Espresso\'s test system in the sandbox.'
          :'This API has no test system, so in the sandbox it is read-only: a change answers <code>409 no_test_system</code>.')+'</p>'
        +(counts.length?'<p class="hint">This API: '+esc(counts.join(' · '))+'.</p>':'');
    }

    if(p.id==='lnp-enterprise'){
      d+='<h3>How porting works</h3>'
        +'<p>A porting request (<strong>PON</strong>) is sent to the losing carrier, who confirms or rejects it. '
        +'Confirmed numbers are activated on the due date; rejected requests must be corrected and re-submitted.</p>'
        +'<h4>PON statuses</h4><table><tr><th>Status</th><th>Meaning</th></tr>'
        +[['New','Request was created'],['Pending','Waiting to be received by the losing carrier'],
          ['Processed','Sent to the losing carrier'],['Rejected. Pending Update','Rejected — correction required'],
          ['Confirmed','Confirmed for the specified due date'],['Closed','Final — successfully ported'],
          ['Pending Cancellation','Waiting for cancellation'],['Canceled','Final — request was canceled']]
          .map(r=>'<tr><td><code>'+r[0]+'</code></td><td>'+r[1]+'</td></tr>').join('')
        +'</table>'
        +'<h3>Typical flow</h3><ol>'
        +'<li><code>GET /api/lnp/portability/{npanxx}</code> — check the numbers can port at all.</li>'
        +'<li><code>GET /api/lnp/routing-profiles</code> — pick the routing profile id.</li>'
        +'<li><code>POST /api/lnp/pons</code> — create the porting request.</li>'
        +'<li><code>GET /api/lnp/pons/{pon}</code> — poll status; read <code>status_reason</code> on rejection.</li>'
        +'<li>On rejection: fix and <code>POST /api/lnp/pons/{pon}/edit</code>.</li>'
        +'<li>Once Confirmed, on the due date: <code>POST /api/lnp/pons/{pon}/activate</code>.</li></ol>'
        +'<p><code>POST /api/lnp/pons/{pon}/status</code> forces a status to walk the whole flow without a real losing carrier. '
        +'It works only on Espresso\'s test system (sandbox calls); on production it does nothing.</p>';
    }
    if(p.id==='lnp-wireless'){
      d+='<h3>Rules that trip people up</h3><table><tr><th>Rule</th><th>Detail</th></tr>'
        +[['CHC + auto-activate','A request with chc=Y cannot also have autoAct=Y.'],
          ['Modify remarks','Always required for a Modify (SUP=3), even when nothing else changes.'],
          ['Port Out ownership','You enter the NEW local / reseller / network; the old network is your home SPID.'],
          ['Delay responses','responseType=D sends lines: [] plus a delay code (6G, 6H, 6J, 6L, 8J).'],
          ['Cancel Service vs Port cancel','Cancel Service is its own request/response pair; a Port In cancel is SPR SUP=1 on an existing Port In.']]
          .map(r=>'<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>').join('')
        +'</table>';
    }
    if(p.id==='e911'){
      d+='<h3>Bulk CSV format</h3>'
        +'<p>The upload endpoint takes one CSV where each row is its own operation:</p>'
        +'<pre>'+esc('OperationType,accountCode,Id,Language,First_name,Last_name,Street_address,City,State,Zip,Country,Primary_addresss_validated\nA,5046353,1212121212,EN,Test,Subscriber,456 Abc,Brampton,ON,L6Y2H6,CA,N')+'</pre>'
        +'<p><code>OperationType</code>: A = add, U = update, D = delete. The response is one row per input row — check each one, since partial success is normal.</p>';
    }
    return d;
  }

  function docCurl(e,env){
    let p=e.path.replace(/:([a-zA-Z]+)/g,(_,n)=>encodeURIComponent(DEFAULTS[n]||n));
    const qs=(e.params||[]).filter(x=>x.in==='query'&&x.required)
      .map(x=>encodeURIComponent(x.name)+'='+encodeURIComponent(DEFAULTS[x.name]||x.name.toUpperCase()));
    if(qs.length)p+='?'+qs.join('&');
    const L=["curl -s -X "+e.method+" '"+cfg().base+p+"'",...authHeaderLines(env)];
    if(e.upload){
      L.push("  -F 'file=@listings.csv'");
    }else if(e.body){
      L.push("  -H 'Content-Type: application/json'");
      L.push("  -d '"+JSON.stringify(e.body)+"'");
    }
    return L.join(" \\\n");
  }

  function renderDocs(){
    const p=product();
    const anchor=e=>(e.method+e.path).replace(/[^a-zA-Z0-9]/g,'-').toLowerCase();
    let d=introDocs(p);
    const cat=catalog();
    if(cat.length){
      d+='<h3>Endpoints</h3><div class="toc">';
      cat.forEach(e=>{ d+='<a href="#'+anchor(e)+'">'+esc(e.path)+'</a>'; });
      d+='</div>';
      cat.forEach(e=>{
        d+='<div class="ep" id="'+anchor(e)+'">'
          +'<div class="sig"><span class="m '+e.method+'">'+e.method+'</span><strong>'+esc(e.path)+'</strong>'+rateBadge(e)+'</div>'
          +(e.soap||e.upstream?'<p class="soap" style="margin:6px 0 0">Maps to <code>'+esc(e.soap||e.upstream)+'</code></p>':'')
          +priceLine(e);
        if(e.description)d+='<p style="margin:8px 0 0">'+esc(e.description)+'</p>';
        if(e.precondition)d+='<div class="pre-note" style="margin:10px 0 0"><b>Precondition:</b> '+esc(e.precondition)+'</div>';
        if(e.params&&e.params.length){
          d+='<h4>Parameters</h4><table>';
          e.params.forEach(x=>d+='<tr><td><code>'+esc(x.name)+'</code></td><td>'+esc(x.in)+'</td><td>'
            +(x.required?'required':'optional')+'</td><td>'+esc(x.description||'')+'</td></tr>');
          d+='</table>';
        }
        if(e.body){ d+='<h4>Body</h4><pre>'+esc(JSON.stringify(e.body,null,2))+'</pre>'; }
        if(e.fields&&e.fields.length){
          d+='<h4>Body fields</h4><table>';
          e.fields.forEach(f=>d+='<tr><td><code>'+esc(f.name)+'</code></td><td>'+(f.required?'required':'optional')
            +'</td><td>'+esc(f.description||'')+'</td></tr>');
          d+='</table>';
        }
        if(e.returns)d+='<h4>Returns</h4><p style="margin:0">'+esc(e.returns)+'</p>';
        if(e.errors&&e.errors.length){
          d+='<h4>Common errors</h4><table>';
          e.errors.forEach(er=>d+='<tr><td class="errcode">'+er.code+'</td><td>'+esc(er.when||'')+'</td></tr>');
          d+='</table>';
        }
        d+='<h4>Example</h4><pre>'+highlight(docCurl(e,'production'))+'</pre></div>';
      });
    }
    $('#docs-body').innerHTML=d;
  }

  // ---- console nav ------------------------------------------------------
  function renderNav(multi){
    const cat=catalog(), c=cfg();
    nav.innerHTML='';
    if(!cat.length){
      nav.innerHTML='<div class="empty" style="padding:14px">No endpoints published for this product yet.</div>';
      reqEl.innerHTML='<div class="empty">This product is coming soon.</div>';
      return;
    }
    const groups={},order=[];
    cat.forEach(e=>{const g=c.group(e.path);if(!groups[g]){groups[g]=[];order.push(g)}groups[g].push(e)});
    order.forEach(g=>{
      const hd=document.createElement('div');hd.className='group';hd.textContent=g;nav.appendChild(hd);
      groups[g].forEach(e=>{
        const b=document.createElement('button');
        b.innerHTML='<span class="m '+e.method+'">'+e.method+'</span><span>'+esc(e.path)+'</span>';
        b.dataset.ep=e.method+' '+e.path;
        // In card mode the rail is a jump list: clicking scrolls to the card.
        b.onclick=multi?()=>{
          nav.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');
          const card=$('#opgrid [data-ep="'+e.method+' '+e.path+'"]');
          if(card)card.scrollIntoView({block:'start',behavior:'smooth'});
        }:()=>select(e,b);
        nav.appendChild(b);
      });
    });
    const rail=document.createElement('div');
    rail.className='railnote';
    let t='<strong>Base URL:</strong> <code>'+esc(c.base)+'</code><br>Every path above is relative to it.';
    if(c.auth==='edid'){
      t+='<br><br>No Espresso login needed — the gateway signs in for you. Live calls go to Espresso\'s production '
        +'system, so orders and changes are real; sandbox calls go to its test system.';
    }else if(c.auth==='ix'){
      t+='<br><br>Calls go through the marketplace gateway, which adds the IristelX key on the server — '
        +'no IristelX key is needed from you.'
        +(productId==='e911'?' These are live emergency records — dispatch sees what you save here.':'');
    }else if(c.auth==='bw'){
      t+='<br><br>Calls go through the marketplace gateway to Iristel\'s BroadWorks platform and reach only the enterprise linked to your account.';
    }else{
      t+='<br><br>Calls go through the marketplace gateway to the IristelX WLNP API; the gateway adds the IristelX key.';
    }
    rail.innerHTML=t;
    nav.appendChild(rail);
  }

  // ---- per-product chrome ----------------------------------------------
  // Every product renders the console as a grid of self-contained operation
  // cards (one per endpoint, each with its own inline response). The left
  // rail stays as a jump list into the grid.
  // ---- bundles view -----------------------------------------------------
  function renderBundlesView(){
    $('#baseurl').textContent=ORIGIN;
    nav.innerHTML='<div class="empty" style="padding:14px">Pick a bundle in the menu to run its steps in a guided console.</div>';
    $('#op-intro').hidden=true;$('#opgrid').hidden=true;$('#req').hidden=true;$('#resp-card').hidden=true;
    let h='<h2>Bundles</h2>'
      +'<p class="lead">Curated recipes per business model: the exact APIs to call, in order, for each use case. Open a bundle to run its steps in a guided console.</p>'
      +'<p class="hint">Each bundle shows its API cost per run: the Standard and Advanced steps, per successful live call. '
      +'Service-order steps add no API fee; the services they order are billed under Iristel\'s tariff.'+(proposed()?' '+PROPOSED+'.':'')+'</p>';
    audiences.forEach(a=>{
      const list=bundles.filter(b=>b.audience===a.id);
      if(!list.length)return;
      h+='<div class="bundle-aud">'+esc(a.label)+'</div><div class="bundle-grid">';
      list.forEach(b=>{
        const cat=(categories.find(c=>c.id===b.category)||{}).label;
        h+='<div class="bundle-card" id="bundle-'+esc(b.id)+'">'+(cat?'<div class="pgroup-sub" style="padding:0 0 4px">'+esc(cat)+'</div>':'')
          +'<h3><a href="#bundle-'+esc(b.id)+'" data-bopen="'+esc(b.id)+'">'+esc(b.name)+' →</a> '+bundleCost(b)+'</h3>'
          +'<p class="buse">'+esc(b.useCase)+'</p><p>'+esc(b.summary)+'</p><ol>';
        (b.steps||[]).forEach((s,i)=>{
          const p=products.find(x=>x.id===s.product);
          h+='<li><a href="#bundle-'+esc(b.id)+'" data-bstep data-bid="'+esc(b.id)+'" data-step="'+i+'">'
            +'<code>'+esc(s.endpoint)+'</code>'
            +'<small>'+esc((p?p.name+' — ':'')+(s.note||''))+'</small></a></li>';
        });
        h+='</ol></div>';
      });
      h+='</div>';
    });
    const body=$('#docs-body');
    body.innerHTML=h;
    body.querySelectorAll('[data-bopen]').forEach(a=>{
      a.onclick=ev=>{ev.preventDefault();openBundle(a.dataset.bopen);};
    });
    body.querySelectorAll('[data-bstep]').forEach(a=>{
      a.onclick=ev=>{ev.preventDefault();openBundle(a.dataset.bid,+a.dataset.step);};
    });
    showTab('docs');
  }

  // ---- billing & usage ---------------------------------------------------
  const cad=c=>'$'+(Number(c||0)/100).toFixed(2);
  const productName=id=>(products.find(p=>p.id===id)||{name:id}).name;
  async function billingApi(method,body){
    const r=await fetch(ORIGIN+'/marketplace/billing'+(method==='GET'?'':'/card'),{
      method,headers:Object.assign({Authorization:'Bearer '+mpSession()},body?{'Content-Type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error==='login_required'?'Your portal login has expired. Log in again and reopen the console.':(d.error||'HTTP '+r.status));
    return d;
  }
  // The card frame (public/v2/billing-card.html) asks for the login session,
  // reports its height and says when a card was saved. Only messages from the
  // gateway's own frame count, and the session is sent only to the gateway.
  window.addEventListener('message',ev=>{
    if(ev.origin!==ORIGIN)return;
    const frame=ROOT.querySelector('[data-card-frame]');
    if(!frame||ev.source!==frame.contentWindow)return;
    const d=ev.data||{};
    if(d.type==='mp-card-ready'){
      frame.contentWindow.postMessage({type:'mp-card-session',token:mpSession()},ORIGIN);
      frame.contentWindow.postMessage({type:'ir-theme',theme:HOST.dataset.theme||'light'},ORIGIN);
    }
    else if(d.type==='mp-card-height'&&Number(d.height)>0)frame.style.height=Math.min(Number(d.height)+4,900)+'px';
    else if(d.type==='mp-card-saved'){
      renderBillingView().then(()=>{
        if(d.retried)alert(d.pastDue?'Card saved, but the outstanding payment still didn\'t go through. Try another card or contact Iristel support.'
          :'Card saved and your outstanding balance was paid. API calls are back on.');
      });
    }
  });
  async function renderBillingView(){
    $('#baseurl').textContent=ORIGIN;
    const help='Reads are free; '+pricedSentence()+' CAD per successful event; service orders add no API fee '
      +'(the service is billed under Iristel\'s tariff). Each month is invoiced on the 1st and charged to your card on the 5th.';
    nav.innerHTML='<div class="railnote" style="border:0;margin:0"><strong>Billing &amp; usage</strong><br>'+esc(help)
      +(proposed()?'<br><br>'+PROPOSED+'.':'')+'</div>';
    $('#op-intro').hidden=true;$('#opgrid').hidden=true;$('#req').hidden=true;$('#resp-card').hidden=true;
    const body=$('#docs-body');
    body.innerHTML='<h2>💳 Billing &amp; usage</h2><p class="lead">Loading…</p>';
    showTab('docs');
    let d;
    try{d=await billingApi('GET');}
    catch(err){body.innerHTML='<h2>💳 Billing &amp; usage</h2><p class="lead">'+esc(err.message)+'</p>';return;}
    ACCOUNT=d;renderModebar();
    const usage=Array.isArray(d.usage)?d.usage:[], byClass=Array.isArray(d.byClass)?d.byClass:[];
    let h='<h2>💳 Billing &amp; usage</h2>'
      +'<p class="lead">'+(d.exempt?'Your API usage for '+esc(d.month)+'. Internal Iristel accounts are not billed.'
        :'You pay per successful event: reads are free, '+esc(pricedSentence())+' CAD per successful event, and service orders add no API fee '
          +'(the service ordered is billed under Iristel\'s tariff). Each month\'s total is invoiced on the 1st of the next month '
          +'(sales tax added for Canadian accounts) and charged to your card on file on the 5th.')+'</p>'
      +(!d.exempt&&proposed()?'<p class="hint">'+esc((pricing&&pricing.note)||PROPOSED+'.')+'</p>':'');
    if(d.pastDue)h+='<div class="callout"><b>Payment problem:</b> your last payment didn\'t go through. Free reads still work; '
      +'other live calls are paused. Save a card below and we\'ll retry the payment right away.</div>';

    h+='<h3>Card on file</h3>';
    if(d.exempt){
      h+='<p>Internal Iristel accounts aren\'t billed for API usage, so there\'s no card to add. Your calls are still listed below.</p>';
    }else if(!d.mindAccount){
      h+='<p>Your billing account isn\'t linked yet. Contact Iristel support and we\'ll set it up.</p>';
    }else if(d.card){
      h+='<p><b>'+esc(d.card.type)+'</b> <code>'+esc(d.card.masked)+'</code> · expires '+esc(d.card.expMonth+'/'+d.card.expYear)
        +' · '+esc(d.card.holder)+'</p>'
        +'<p><button class="btn" type="button" data-card-edit>Replace card</button> '
        +'<button class="btn danger" type="button" data-card-remove>Remove card</button></p>';
    }else{
      h+='<p><strong>No card yet.</strong> Free reads, service orders and the sandbox work without one. '
        +'Add a card below for Standard and Advanced calls.</p>';
    }
    if(d.mindAccount&&!d.exempt){
      // The card form runs on the gateway in its own frame (v2/billing-card.html),
      // so the page hosting the console never sees the card number or CVV.
      const src=ORIGIN+'/v2/billing-card?theme='+encodeURIComponent(HOST.dataset.theme||'light')+'&origin='+encodeURIComponent(location.origin);
      h+='<iframe data-card-frame title="Card details" src="'+esc(src)+'" style="display:'+(d.card?'none':'block')
        +';width:100%;max-width:480px;height:360px;border:0;background:transparent"></iframe>';
    }

    if(!d.exempt){
      // This month's live calls by rate class: what the invoice bills.
      const line=id=>byClass.find(l=>l.rateClass===id)||{calls:0,billableCalls:0,cents:0};
      const rows=rateClasses().map(r=>{
        const l=line(r.id), paid=!!r.priceCents;
        return '<tr><td>'+esc(r.name)+'</td><td class="num">'+num(l.calls||0)+'</td>'
          +'<td class="num">'+(paid?num(l.billableCalls||0)+' × '+esc(priceText(r.priceCents)):'—')+'</td>'
          +'<td class="num">'+(paid?cad(l.cents):r.id==='service'?'No API fee':'No charge')+'</td></tr>';
      });
      const other=byClass.filter(l=>!classById(l.rateClass));
      other.forEach(l=>rows.push('<tr><td>'+esc(l.name||'Not in the rate card')+'</td><td class="num">'+num(l.calls||0)+'</td><td class="num">—</td><td class="num">Not charged</td></tr>'));
      const tot=k=>byClass.reduce((s,l)=>s+Number(l[k]||0),0);
      h+='<h3>This month ('+esc(d.month)+')</h3>'
        +'<table class="bill names"><tr><th>Rate</th><th class="num">Live calls</th><th class="num">Billed events</th><th class="num">Amount</th></tr>'
        +rows.join('')
        +'<tr class="total"><td>Estimated total, before tax</td><td class="num">'+num(tot('calls'))+'</td><td class="num">'+num(tot('billableCalls'))+'</td>'
        +'<td class="num">'+cad(d.estimatedCents)+'</td></tr></table>'
        +'<p class="hint">Billable event: '+esc(BILLABLE_EVENT)+'. Each rate\'s total is rounded to the cent.</p>';
      const sb=d.sandbox||{};
      if(sb.limit!=null)h+='<h3>Sandbox</h3><p>'+num(sb.used||0)+' used · <strong>'+num(sb.left!=null?sb.left:Math.max(0,sb.limit-(sb.used||0)))
        +' of '+num(sb.limit)+' left</strong> this month. Sandbox calls are never billed; the allowance resets on the 1st. '
        +'Switch on <b>Sandbox</b> at the top of the console to use it.</p>';
    }

    h+='<h3>Calls by API</h3>';
    if(usage.length){
      h+='<table class="bill names"><tr><th>API</th><th class="num">Calls</th><th class="num">Billed events</th><th class="num">Amount</th></tr>'
        +usage.map(u=>'<tr><td>'+esc(productName(u.product))+'</td><td class="num">'+num(u.calls||0)+'</td><td class="num">'+num(u.billableCalls||0)+'</td>'
          +'<td class="num">'+cad(u.cents)+'</td></tr>').join('')
        +'<tr class="total"><td>Total</td><td class="num">'+num(usage.reduce((s,u)=>s+Number(u.calls||0),0))+'</td>'
        +'<td class="num">'+num(usage.reduce((s,u)=>s+Number(u.billableCalls||0),0))+'</td>'
        +'<td class="num">'+cad(usage.reduce((s,u)=>s+Number(u.cents||0),0))+'</td></tr></table>'
        +'<p class="hint">Every call this month, live and sandbox. Amounts by API are rounded to the cent.</p>';
    }else h+='<p>No API calls yet this month.</p>';
    h+='<h3>Invoices</h3>';
    h+=(d.invoices||[]).length
      ?'<table class="bill"><tr><th>Month</th><th>Invoice</th><th>Total (tax incl.)</th><th>Charged on</th><th></th></tr>'
        +d.invoices.map(i=>'<tr><td>'+esc(i.month)+'</td><td><code>'+esc(i.number)+'</code></td><td>'+cad(i.cents)+'</td><td>'+esc(i.dueOn)+'</td>'
          +'<td><a href="'+esc(i.url)+'" target="_blank" rel="noopener">View</a></td></tr>').join('')+'</table>'
      :'<p>No invoices yet. Each month\'s invoice is emailed on the 1st and charged on the 5th.</p>';
    h+='<h3>Past charges</h3>';
    h+=(d.charges||[]).length
      ?'<table class="bill"><tr><th>Month</th><th>Amount</th><th>Status</th><th>Reference</th></tr>'
        +d.charges.map(c=>'<tr><td>'+esc(c.month)+'</td><td>'+cad(c.cents)+'</td><td>'+esc(c.status)+'</td><td><code>'+esc(c.reference||'')+'</code></td></tr>').join('')+'</table>'
      :'<p>No charges yet.</p>';
    body.innerHTML=h;

    const frame=body.querySelector('[data-card-frame]');
    const edit=body.querySelector('[data-card-edit]');
    if(edit&&frame)edit.onclick=()=>{frame.style.display='block';frame.focus();};
    const remove=body.querySelector('[data-card-remove]');
    if(remove)remove.onclick=async()=>{
      if(!confirm('Remove this card? Standard and Advanced calls stop working until you add a new one.'))return;
      try{await billingApi('DELETE');renderBillingView();}catch(err){alert(err.message);}
    };
  }

  // ---- one bundle: its steps, in order, as live operation cards ----------
  // Values returned by a step (accountId, id, pon, iccid…) fill matching
  // fields in later steps, replacing whatever an untouched field holds
  // (defaults included). Fields the user typed in, or Iris filled, are never
  // overwritten (data-touched, set in buildOpCard / the Iris bridge).
  // Field names match ignoring case, "_" and "-" (AGENT_ID fills agentId).
  const carryKey=k=>String(k).toLowerCase().replace(/[_-]/g,'');
  // An agent id carries only when it is the caller's own (or the caller is
  // staff, or /me is unknown): a staff report's AGENT_ID must not replace a
  // partner's own agent id in a later step.
  const agentCarryOk=v=>!ME||ME.isStaff||ME.agents.some(a=>String(a.id)===String(v));
  function collectScalars(v,out,depth){
    if(depth>6||v==null)return out;
    if(Array.isArray(v)){v.forEach(x=>collectScalars(x,out,depth+1));return out;}
    if(typeof v==='object'){
      Object.entries(v).forEach(([k,x])=>{
        if(x!==null&&typeof x!=='object'){const key=carryKey(k);if(!(key in out)&&String(x)!=='')out[key]=String(x);}
        else collectScalars(x,out,depth+1);
      });
    }
    return out;
  }
  // A bundle's steps that resolve to a granted endpoint; the index in this
  // list is the card's data-step.
  function resolveBundleSteps(b){
    return (b.steps||[]).map(st=>{
      const p=products.find(x=>x.id===st.product);
      const e=p&&(p.endpoints||[]).find(x=>x.method+' '+x.path===st.endpoint);
      return e?{st,p,e}:null;
    }).filter(Boolean);
  }
  function renderBundleConsole(b){
    $('#baseurl').textContent=ORIGIN;
    current=null;
    nav.hidden=false;
    $('#req').hidden=true;$('#resp-card').hidden=true;
    const steps=resolveBundleSteps(b);

    // Docs tab: what the bundle is for and its ordered steps.
    let d='<h2>📦 '+esc(b.name)+'</h2><p class="lead">'+esc(b.useCase)+'</p><p>'+esc(b.summary||'')+'</p>'
      +'<h3>Steps</h3><ol>';
    steps.forEach(({st,p,e},i)=>{
      d+='<li><a href="#'+esc(hashFor(productId))+'" data-bjump="'+i+'"><code>'+esc(e.method+' '+e.path)+'</code></a> — '
        +esc(p.name)+(st.note?'<br><small>'+esc(st.note)+'</small>':'')+'</li>';
    });
    d+='</ol><p class="hint">Open the <b>Console</b> tab to run the steps in order.</p>';
    const docs=$('#docs-body');docs.innerHTML=d;
    docs.querySelectorAll('[data-bjump]').forEach(a=>a.onclick=ev=>{ev.preventDefault();showTab('console');jump(+a.dataset.bjump);});

    // Console: intro + one card per step.
    $('#op-intro').hidden=false;$('#opgrid').hidden=false;
    $('#op-intro').innerHTML='<h2 style="margin:0 0 2px;font:800 20px var(--head)">📦 '+esc(b.name)+' '+bundleCost(b)+'</h2>'
      +'<p class="hint" style="margin:0;font-size:13px">'+esc(b.useCase)+' — '+steps.length+' steps. '
      +'Run them in order: values returned by one step fill in the next ones automatically.</p>';
    const grid=$('#opgrid');grid.innerHTML='';
    const cards=[];
    const carryFrom=(idx,status,txt)=>{
      if(status<200||status>=300)return;
      let data;try{data=JSON.parse(txt);}catch(_){return;}
      // Values returned by the step win; values the step was sent with
      // (e.g. a date range) fill in anything the response didn't have.
      const carry=collectScalars(data,{},0);
      Object.entries(formValues(cards[idx])).forEach(([k,v])=>{const key=carryKey(k);if(v!==''&&!(key in carry))carry[key]=v;});
      cards.slice(idx+1).forEach(card=>{
        card.querySelectorAll('[data-path],[data-query],[data-body]').forEach(i=>{
          const name=carryKey(i.dataset.path||i.dataset.query||i.dataset.body||'');
          if(i.dataset.touched||!(name in carry))return;
          if(name==='agentid'&&!agentCarryOk(carry[name]))return;
          if(String(i.value)===carry[name])return;
          i.value=carry[name];
          i.dispatchEvent(new Event('input'));
          i.classList.add('carried');setTimeout(()=>i.classList.remove('carried'),2500);
        });
      });
    };
    steps.forEach(({st,p,e},i)=>{
      const card=buildOpCard(e,{
        before:'<div class="step-badge"><span class="num">'+(i+1)+'</span>Step '+(i+1)+' of '+steps.length
          +' <span class="prod">· '+esc(p.name)+'</span></div>'
          +(st.note?'<p class="step-note">'+esc(st.note)+'</p>':''),
        opts:{onResult:(status,txt)=>carryFrom(i,status,txt)},
      });
      card.dataset.step=i;
      cards.push(card);grid.appendChild(card);
    });

    // Left rail: numbered jump list.
    nav.innerHTML='<div class="group">'+esc(b.name)+'</div>';
    steps.forEach(({e,p},i)=>{
      const btn=document.createElement('button');
      btn.innerHTML='<span class="m '+e.method+'">'+(i+1)+'</span><span>'+esc(hintFor(e).title||autoTitle(e))
        +'<br><small style="opacity:.65">'+esc(p.name)+'</small></span>';
      btn.onclick=()=>jump(i);
      nav.appendChild(btn);
    });
    const rail=document.createElement('div');rail.className='railnote';
    rail.innerHTML='<strong>Base URL:</strong> <code>'+esc(ORIGIN)+'</code><br>Each step calls its own API through the gateway; '
      +'the curl example on every card shows the full URL.';
    nav.appendChild(rail);
    function jump(i){
      irisStep=i;
      nav.querySelectorAll('button').forEach((x,j)=>x.classList.toggle('active',j===i));
      if(cards[i])cards[i].scrollIntoView({block:'start',behavior:'smooth'});
      irisNav();
    }
    showTab('console');
  }
  function openBundle(id,step){
    productId='bundle:'+id;location.hash='#bundle-'+id;markProduct();renderProduct();
    if(step!=null){irisStep=step;const c=$('#opgrid [data-step="'+step+'"]');if(c)c.scrollIntoView({block:'start',behavior:'smooth'});}
  }

  function renderProduct(){
    irisStep=null;
    if(productId==='bundles')return renderBundlesView();
    if(productId==='billing')return renderBillingView();
    if(isBundleId(productId)){const b=bundleOf(productId);if(b)return renderBundleConsole(b);}
    const c=cfg(), p=product();
    $('#baseurl').textContent=c.base;
    current=null;
    const multi=catalog().length>0;
    nav.hidden=false;
    $('#op-intro').hidden=!multi;
    $('#opgrid').hidden=!multi;
    $('#req').hidden=!!multi;
    $('#resp-card').hidden=true;
    reqEl.innerHTML='<div class="empty">Pick an endpoint on the left to see its docs and try it.</div>';
    statusEl.hidden=true;timeEl.textContent='';
    respBody.innerHTML='<div class="resp-empty">Send a request to see the result here.</div>';
    renderDocs();
    renderNav(multi);
    if(multi)renderOpGrid(p);
  }
  const AUTO_ICON={GET:'🔍',POST:'➕',PUT:'✏️',PATCH:'✏️',DELETE:'🗑️'};
  function autoTitle(e){
    if(e.summary)return e.summary;
    const seg=e.path.split('/').filter(s=>s&&!s.startsWith(':')).pop()||e.path;
    return humanize(seg.replace(/-/g,' '));
  }
  function devDetailsHtml(e){
    let d='';
    if(e.precondition)d+='<div class="pre-note"><b>Precondition:</b> '+esc(e.precondition)+'</div>';
    d+='<div class="snip-tabs" role="tablist" aria-label="Code sample language">'
      +SNIP_LANGS.map(([id,label],i)=>'<button type="button" role="tab" data-snip-lang="'+id+'" aria-selected="'+(i===0)+'">'+label+'</button>').join('')
      +'</div>'
      +'<div class="snippet"><button class="copy" data-copy>Copy</button><pre data-snippet="curl"></pre></div>';
    if(e.returns)d+='<h4 style="font:700 11px var(--head);text-transform:uppercase;letter-spacing:.9px;color:var(--accent);margin:12px 0 4px">Returns</h4><p class="hint" style="margin:0;font-size:12px">'+esc(e.returns)+'</p>';
    if(e.errors&&e.errors.length){
      d+='<table class="doc" style="margin-top:8px">';
      e.errors.forEach(er=>d+='<tr><td class="k errcode">'+er.code+'</td><td>'+esc(er.when||'')+'</td></tr>');
      d+='</table>';
    }
    return '<details class="adv"><summary>Developer details</summary>'+d+'</details>';
  }
  // One self-contained operation card: title, form, developer details and an
  // inline response. `extra.before` is HTML placed above the title (bundle
  // step badge); `extra.opts` goes to wireForm/sendFrom.
  function buildOpCard(e,extra){
    extra=extra||{};
    const h=hintFor(e);
    const card=document.createElement('div');
    card.className='card';card.dataset.ep=e.method+' '+e.path;
    card.innerHTML=(extra.before||'')
      +'<h2 class="op-title"><span class="op-icon" aria-hidden="true">'+(h.icon||AUTO_ICON[e.method]||'⚙')+'</span>'
      +esc(h.title||autoTitle(e))+rateBadge(e)+'</h2>'
      +(e.description?'<p class="desc" style="font-size:12.5px;color:var(--muted)">'+esc(e.description)+'</p>':'')
      +(isService(e)?'<p class="svc-note">Service order: no API fee. '+esc(TARIFF)+'</p>':'')
      +formHtml(e,{compact:true})
      +devDetailsHtml(e)
      +'<div class="op-resp"></div>';
    wireForm(card,e,Object.assign({inline:true},extra.opts||{}));
    // Remember fields the user typed in (trusted events only), so bundle
    // carry-forward and Iris never overwrite them.
    card.querySelectorAll('[data-path],[data-query],[data-body]').forEach(inp=>{
      inp.addEventListener('input',ev=>{if(ev.isTrusted)inp.dataset.touched='1';});
    });
    return card;
  }
  function renderOpGrid(p){
    const ui=p.ui||{}, c=cfg();
    $('#op-intro').innerHTML='<h2 style="margin:0 0 2px;font:800 20px var(--head)">'+esc(ui.title||p.name)+'</h2>'
      +'<p class="hint" style="margin:0;font-size:13px">'+esc(ui.blurb||p.summary||'')+'</p>'
      +(p.status==='preview'?'<div class="callout" style="margin:10px 0 0"><b>Switching on soon.</b> You can fill in these forms, '
        +'but calls answer <code>503 not_enabled</code> until Iristel turns this API on. Nothing is charged.</div>':'');
    const grid=$('#opgrid');grid.innerHTML='';
    const groups={},order=[];
    catalog().forEach(e=>{const g=c.group(e.path);if(!groups[g]){groups[g]=[];order.push(g)}groups[g].push(e)});
    order.forEach(g=>{
      if(order.length>1){
        const hd=document.createElement('div');hd.className='opgroup';hd.textContent=g;grid.appendChild(hd);
      }
      groups[g].forEach(e=>grid.appendChild(buildOpCard(e)));
    });
  }

  // ---- guided endpoint forms --------------------------------------------
  // Field controls come from catalog metadata plus the optional per-endpoint
  // `ui` hints served with the catalog (labels, enums, help, defaults,
  // confirmation prompts, banner templates). Everything degrades gracefully
  // when no hints exist.
  let current=null;
  const hintFor=e=>e.ui||{};
  function interp(t,vals){return String(t).replace(/\{(\w+)\}/g,(_,k)=>vals[k]!==undefined&&vals[k]!==''?vals[k]:'{'+k+'}');}
  function fieldHtml(kind,name,meta,val,required,pdesc){
    meta=meta||{};
    const label=meta.label||humanize(name);
    const help=meta.help||pdesc||'';
    const attr=' data-'+kind+'="'+esc(name)+'"'+(required?' data-req="1"':'');
    let ctl;
    if(meta.enum){
      const opts=meta.enum.map(o=>{const v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;
        return '<option value="'+esc(v)+'"'+(String(v)===String(val)?' selected':'')+'>'+esc(l)+'</option>';}).join('');
      const hasVal=meta.enum.some(o=>String(Array.isArray(o)?o[0]:o)===String(val));
      const blank=hasVal?'':'<option value="" '+(required?'disabled ':'')+'selected>Select…</option>';
      ctl='<select'+attr+'>'+blank+opts+'</select>';
    }else if(meta.type==='textarea'){
      ctl='<textarea'+attr+(meta.placeholder?' placeholder="'+esc(meta.placeholder)+'"':'')+'>'
        +esc(val==null?'':String(val))+'</textarea>';
    }else{
      const t=meta.type==='tel'?'tel':meta.type==='number'?'number':'text';
      ctl='<input type="'+t+'"'+attr
        +' value="'+esc(val==null?'':String(val))+'"'
        +(meta.placeholder?' placeholder="'+esc(meta.placeholder)+'"':'')+'>';
    }
    return '<div class="gfield"><label>'+esc(label)+(required?' <span class="req">*</span>':'')+'</label>'+ctl
      +(help?'<div class="ghelp">'+esc(help)+'</div>':'')+'</div>';
  }
  function formHtml(e,opts){
    opts=opts||{};
    const h=hintFor(e), fm=h.fields||{};
    let html='';
    // Field value: ui-hint default, then the caller's runtime default, then DEFAULTS.
    const dflt=(m,name,fallback)=>m.default!==undefined?m.default
      :runtimeDefault(e,name)!==undefined?runtimeDefault(e,name):fallback();
    (e.params||[]).filter(p=>p.in==='path').forEach(p=>{
      const m=fm[p.name]||{};
      html+=fieldHtml('path',p.name,m,dflt(m,p.name,()=>DEFAULTS[p.name]||''),p.required,p.description);
    });
    (e.params||[]).filter(p=>p.in==='query').forEach(p=>{
      const m=fm[p.name]||{};
      html+=fieldHtml('query',p.name,m,dflt(m,p.name,()=>DEFAULTS[p.name]||''),p.required,p.description);
    });
    // BroadWorks: partners reach their own linked enterprise; staff name one.
    if(e.pid==='broadworks'&&exempt()&&!(e.params||[]).some(p=>p.name==='enterprise'))
      html+=fieldHtml('query','enterprise',{label:'Enterprise id (staff)'},'',true,'Staff name the BroadWorks enterprise; partners always reach the one linked to their account.');
    if(e.upload){
      html+='<div class="gfield"><label>File <span class="req">*</span></label><input type="file" data-upload accept="'+esc(e.upload.accept||'')+'">'
        +'<div class="ghelp">Sent as multipart/form-data field "'+esc(e.upload.field)+'".</div></div>';
      if(h.csvTemplate)html+='<button type="button" class="ghost-btn" data-template>📥 Download CSV template</button>';
    }else if(e.fields&&e.fields.length&&e.fields.some(f=>/[.\[]/.test(f.name))){
      // Nested/array field paths can't be edited as flat inputs — offer the
      // structured JSON template instead so the request body stays valid.
      html+='<div class="info-box"><strong>Structured request:</strong> this call takes a nested body — edit the JSON template below.</div>'
        +'<div class="gfield"><label>Body (JSON) <span class="req">*</span></label><textarea data-rawbody>'+esc(JSON.stringify(e.body||{},null,2))+'</textarea></div>';
    }else if(e.fields&&e.fields.length){
      e.fields.forEach(f=>{
        const m=fm[f.name]||{};
        // With curated hints the form starts empty (except explicit defaults);
        // without hints the example body is prefilled so it works as-is.
        const val=dflt(m,f.name,()=>h.fields?'':(e.body?e.body[f.name]:''));
        html+=fieldHtml('body',f.name,m,val,f.required,f.description);
      });
    }else if(e.body){
      html+='<div class="gfield"><label>Body (JSON) <span class="req">*</span></label><textarea data-rawbody>'+esc(JSON.stringify(e.body,null,2))+'</textarea></div>';
    }
    if(h.info)html+='<div class="info-box"><strong>Note:</strong> '+esc(h.info)+'</div>';
    const danger=h.danger!==undefined?h.danger:e.method==='DELETE';
    // Cues that follow the mode bar through CSS (.mp-app.sbx / .nocard): the
    // Send label says "sandbox", Standard and Advanced calls say they need a
    // card, and writes to an API with no test system say they're refused.
    const r=rateOf(e);
    html+='<div class="row"><button class="btn'+(danger?' danger':'')+'" data-send>'
      +'<span class="spin" aria-hidden="true"></span><span>'+esc(h.submitLabel||'Send request')+'</span><span class="sbx-tag"> · sandbox</span></button>'
      +(priced(e)?'<span class="needs-card" title="'+esc(r.name+' events ('+priceText(r.priceCents)+' CAD) need a card on file. Add one under Billing & usage, or switch on the sandbox.')+'">Needs a card</span>':'')
      +(sandboxReadOnly(e)?'<span class="sbx-ro">Sandbox: this API has no test system, so a change is refused (409). Switch the sandbox off to send it live.</span>':'')
      +(opts.compact?'':'<span class="url" data-url></span>')+'</div>';
    return html;
  }
  function formValues(root){
    const vals={};
    root.querySelectorAll('[data-path],[data-query],[data-body]').forEach(i=>{
      vals[i.dataset.path||i.dataset.query||i.dataset.body]=i.value;
    });
    return vals;
  }
  function buildPathFrom(root,e){
    let p=e.path;
    root.querySelectorAll('[data-path]').forEach(i=>{p=p.replace(':'+i.dataset.path,encodeURIComponent(i.value))});
    const qs=new URLSearchParams();
    root.querySelectorAll('[data-query]').forEach(i=>{if(i.value!=='')qs.set(i.dataset.query,i.value)});
    const s=qs.toString();return p+(s?'?'+s:'');
  }
  // A path value must stay inside its own segment. fetch() resolves "." and
  // ".." segments (%2e forms too, and the gateway decodes the path once before
  // its own upstream fetch), so such a value would reach a different endpoint
  // than the card's. "/", "\", "?" and "#" escape the segment the same way
  // once decoded.
  function decodedSeg(v){
    let d=String(v);
    for(let n=0;n<3;n++){let x;try{x=decodeURIComponent(d);}catch(_){break;}if(x===d)break;d=x;}
    return d;
  }
  const dotSeg=v=>/^\.{1,2}$/.test(decodedSeg(v));
  const unsafeSeg=v=>dotSeg(v)||/[\/\\?#]/.test(decodedSeg(v));
  // Returns the JSON body as a string, or undefined when the endpoint has none.
  // Throws on invalid raw JSON.
  function buildBodyFrom(root,e){
    const ta=root.querySelector('[data-rawbody]');
    if(ta){JSON.parse(ta.value);return ta.value;}
    const inputs=root.querySelectorAll('[data-body]');
    if(!inputs.length)return undefined;
    const out={};
    inputs.forEach(i=>{
      const v=i.value.trim();if(v==='')return;
      const ex=e.body?e.body[i.dataset.body]:undefined;
      out[i.dataset.body]=(typeof ex==='number'&&/^[0-9]+(\.[0-9]+)?$/.test(v))?Number(v):v;
    });
    return JSON.stringify(out);
  }
  // ---- code samples (curl / JavaScript / Python) -------------------------
  // All three are built from the card's current field values. The key is
  // never real: curl shows KEY_PH, JS and Python read IRISTEL_API_KEY from the
  // environment (with KEY_PH in the comment that says how to set it).
  const SNIP_LANGS=[['curl','curl'],['javascript','JavaScript'],['python','Python']];
  function requestParts(root,e){
    const r={method:e.method,url:cfgOf(e).base+buildPathFrom(root,e),upload:null,body:undefined,json:undefined,note:''};
    if(e.upload)r.upload={field:e.upload.field||'file',filename:'listings.csv'};
    else{
      let b;try{b=buildBodyFrom(root,e);}catch(_){b=undefined;}
      if(b!==undefined){
        try{r.json=JSON.parse(b);b=JSON.stringify(r.json);}catch(_){/* leave as typed */}
        r.body=b;
      }
    }
    // The sandbox header goes in the sample when the console sends it.
    r.sandbox=sandboxOn();
    r.note=snippetNote(e,r.sandbox);
    return r;
  }
  // One comment line on what the call costs, for the code samples.
  function snippetNote(e,sandbox){
    if(exempt())return '';
    const r=rateOf(e), mode=acctMode();
    if(sandbox)return 'Sandbox call: never billed ('+num(sandboxLimit())+' a month). Drop the X-Marketplace-Mode header to send it live.';
    if(mode==='past_due'&&!(r&&r.id==='free'))return 'Payment past due: live, this answers 402 payment_required until the card is updated under Billing & usage.';
    if(!r)return 'Not in the rate card: never charged.';
    if(r.id==='service')return 'Service order: no API fee. '+TARIFF;
    if(!r.priceCents)return 'Free: never charged.';
    return r.name+' event: '+priceText(r.priceCents)+' CAD per successful live call.'
      +(mode==='card_required'?' Needs a card on file: without one this answers 402 card_required.':'');
  }
  const shq=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
  function curlTextFor(root,e){
    const r=requestParts(root,e);
    const L=["curl -s -X "+r.method+" "+shq(r.url),...authHeaderLines(null,e)];
    if(r.sandbox)L.push("  -H 'X-Marketplace-Mode: sandbox'");
    if(r.upload){L.push("  -F "+shq(r.upload.field+'=@'+r.upload.filename));}
    else if(r.body!==undefined){
      L.push("  -H 'Content-Type: application/json'");
      L.push("  -d "+shq(r.body));
    }
    // Comments lead the snippet: after a '\' continuation a trailing '#' line
    // would reach curl as an argument, not a comment.
    return (r.note?'# '+r.note+'\n':'')+L.join(" \\\n");
  }
  const jsq=s=>"'"+String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n')+"'";
  function jsTextFor(root,e){
    const r=requestParts(root,e);
    const L=['// Call from your backend, never the browser: your API key must stay secret.',
      '// Node 18+ (built-in fetch). Set the key first: export IRISTEL_API_KEY='+KEY_PH];
    if(r.note)L.push('// '+r.note);
    if(r.upload)L.push("const { readFile } = require('node:fs/promises');");
    L.push('','async function main() {');
    if(r.upload){
      L.push('  const form = new FormData();',
        '  form.append('+jsq(r.upload.field)+", new Blob([await readFile("+jsq(r.upload.filename)+")], { type: 'text/csv' }), "+jsq(r.upload.filename)+');');
    }
    L.push('  const res = await fetch('+jsq(r.url)+', {','    method: '+jsq(r.method)+',','    headers: {',
      "      Authorization: 'Bearer ' + process.env.IRISTEL_API_KEY,");
    if(r.sandbox)L.push("      'X-Marketplace-Mode': 'sandbox',");
    if(r.body!==undefined)L.push("      'Content-Type': 'application/json',");
    L.push('    },');
    if(r.upload)L.push('    body: form,');
    else if(r.json!==undefined)L.push('    body: JSON.stringify('+JSON.stringify(r.json,null,2).split('\n').join('\n    ')+'),');
    else if(r.body!==undefined)L.push('    body: '+jsq(r.body)+',');
    L.push('  });','  const text = await res.text();',
      "  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text);",
      '  console.log(text ? JSON.parse(text) : null);','}','',
      'main().catch((err) => { console.error(err); process.exit(1); });');
    return L.join('\n');
  }
  // JSON value as a Python literal (None/True/False instead of null/true/false).
  function pyLit(v,ind){
    const n=ind+'    ';
    if(v===null||v===undefined)return 'None';
    if(v===true)return 'True';
    if(v===false)return 'False';
    if(typeof v!=='object')return typeof v==='number'?String(v):JSON.stringify(String(v));
    if(Array.isArray(v))return v.length?'[\n'+v.map(x=>n+pyLit(x,n)+',').join('\n')+'\n'+ind+']':'[]';
    const ks=Object.keys(v);
    return ks.length?'{\n'+ks.map(k=>n+JSON.stringify(k)+': '+pyLit(v[k],n)+',').join('\n')+'\n'+ind+'}':'{}';
  }
  function pyTextFor(root,e){
    const r=requestParts(root,e);
    const L=['# Call from your backend, never the browser: your API key must stay secret.',
      '# Set the key first: export IRISTEL_API_KEY='+KEY_PH];
    if(r.note)L.push('# '+r.note);
    L.push('import os','','import requests  # pip install requests','');
    const ind=r.upload?'    ':'';
    const hdr='{"Authorization": "Bearer " + os.environ["IRISTEL_API_KEY"]'
      +(r.sandbox?', "X-Marketplace-Mode": "sandbox"':'')
      +(r.body!==undefined&&r.json===undefined?', "Content-Type": "application/json"':'')+'}';
    if(r.upload)L.push('with open('+JSON.stringify(r.upload.filename)+', "rb") as f:');
    L.push(ind+'res = requests.request(',ind+'    '+JSON.stringify(r.method)+',',ind+'    '+JSON.stringify(r.url)+',',
      ind+'    headers='+hdr+',');
    if(r.upload)L.push(ind+'    files={'+JSON.stringify(r.upload.field)+': ('+JSON.stringify(r.upload.filename)+', f, "text/csv")},');
    else if(r.json!==undefined)L.push(ind+'    json='+pyLit(r.json,ind+'    ')+',');
    else if(r.body!==undefined)L.push(ind+'    data='+JSON.stringify(r.body)+',');
    L.push(ind+'    timeout=30,',ind+')','if not res.ok:','    raise SystemExit(f"HTTP {res.status_code}: {res.text}")',
      'print(res.json() if res.text else None)');
    return L.join('\n');
  }
  function snippetText(root,e,lang){
    return lang==='javascript'?jsTextFor(root,e):lang==='python'?pyTextFor(root,e):curlTextFor(root,e);
  }
  function wireForm(root,e,opts){
    opts=opts||{};
    const h=hintFor(e);
    const pre=root.querySelector('[data-snippet]');
    const refresh=()=>{
      const u=root.querySelector('[data-url]');if(u)u.textContent=e.method+' '+buildPathFrom(root,e);
      if(pre)pre.innerHTML=highlight(snippetText(root,e,pre.dataset.snippet));
    };
    root.querySelectorAll('[data-path],[data-query],[data-body],[data-rawbody]').forEach(i=>{
      i.addEventListener('input',refresh);i.addEventListener('change',refresh);
    });
    if(pre)pre.addEventListener('mp-refresh',refresh);
    root.querySelectorAll('[data-snip-lang]').forEach(t=>{
      t.onclick=()=>{
        root.querySelectorAll('[data-snip-lang]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));
        if(pre)pre.dataset.snippet=t.dataset.snipLang;
        refresh();
      };
    });
    refresh();
    const tpl=root.querySelector('[data-template]');
    if(tpl&&h.csvTemplate)tpl.onclick=()=>{
      const t=h.csvTemplate;
      const blob=new Blob([t.header+'\n'+(t.example||'')+'\n'],{type:'text/csv'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download=t.filename||'template.csv';
      a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    };
    const sendBtn=root.querySelector('[data-send]');
    if(sendBtn)sendBtn.onclick=()=>sendFrom(root,e,opts);
    const copy=root.querySelector('[data-copy]');
    if(copy)copy.onclick=()=>{
      navigator.clipboard.writeText(snippetText(root,e,pre?pre.dataset.snippet:'curl')).then(()=>{
        copy.textContent='✓ Copied';copy.classList.add('ok');
        setTimeout(()=>{copy.textContent='Copy';copy.classList.remove('ok')},1400);
      });
    };
  }

  function select(e,btn){
    current=e;
    nav.querySelectorAll('button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
    const h=hintFor(e);

    let html='<h2 class="op-title">'+esc(h.title||e.summary||e.path)+'<span class="mono">'+e.method+' '+e.path+'</span>'+rateBadge(e)+'</h2>';
    if(e.soap||e.upstream)html+='<p class="soap">Maps to <code>'+esc(e.soap||e.upstream)+'</code></p>';
    if(e.description)html+='<p class="desc">'+esc(e.description)+'</p>';
    if(isService(e))html+='<p class="svc-note">Service order: no API fee. '+esc(TARIFF)+'</p>';
    if(e.precondition)html+='<div class="pre-note"><b>Precondition:</b> '+esc(e.precondition)+'</div>';
    html+=formHtml(e);

    const a=cfg().auth;
    html+='<div class="doc"><h3>Call this from your own app</h3>'
      +'<p class="hint" style="margin:0 0 8px">Replace <code>'+KEY_PH+'</code> with your marketplace API key '
      +'(<b>Show my API key</b> on the Docs tab).</p>';
    if(a==='edid'){
      html+='<p class="hint" style="margin:0 0 8px">Live calls go to Espresso\'s production system: orders and changes are real. Sandbox calls go to its test system.</p>';
    }else if(productId==='e911'){
      html+='<p class="hint" style="margin:0 0 8px">The account code in <code>?code=</code> selects whose listings you touch.</p>';
    }
    html+='<div class="snippet"><button class="copy" data-copy>Copy</button><pre data-snippet="curl"></pre></div></div>';

    if(e.fields&&e.fields.length){
      html+='<div class="doc"><h3>Body fields</h3><table class="doc">';
      e.fields.forEach(f=>html+='<tr><td class="k">'+esc(f.name)+'</td><td class="req">'+(f.required?'required':'')+'</td><td>'+esc(f.description||'')+'</td></tr>');
      html+='</table></div>';
    }
    if(e.returns){ html+='<div class="doc"><h3>Returns</h3><p class="hint" style="margin:0">'+esc(e.returns)+'</p></div>'; }
    if(e.errors&&e.errors.length){
      html+='<div class="doc"><h3>Common errors</h3><table class="doc">';
      e.errors.forEach(er=>html+='<tr><td class="k errcode">'+er.code+'</td><td>'+esc(er.when||'')+'</td></tr>');
      html+='</table></div>';
    }

    reqEl.innerHTML=html;
    wireForm(reqEl,e,{});
  }

  async function sendFrom(root,e,opts){
    opts=opts||{};
    const h=hintFor(e), vals=formValues(root);
    const inlineEl=opts.inline?root.querySelector('.op-resp'):null;
    const fail=msg=>{showResult(e,vals,0,msg,0,inlineEl);recordLast(e,0,0,'',msg);};

    const miss=[...root.querySelectorAll('[data-req]')].find(i=>!String(i.value).trim());
    if(miss){
      const g=miss.closest('.gfield');
      const lb=g?g.querySelector('label').textContent.replace(/\s*\*\s*$/,'').trim():'a required field';
      fail('Please fill in “'+lb+'” before sending.');miss.focus();return;
    }
    const dot=[...root.querySelectorAll('[data-path]')].find(i=>dotSeg(i.value));
    if(dot){
      const g=dot.closest('.gfield');
      const lb=g?g.querySelector('label').textContent.replace(/\s*\*\s*$/,'').trim():'A path value';
      fail('“'+lb+'” can\'t be “.” or “..”: the request would reach a different endpoint.');dot.focus();return;
    }
    // Asked in the card first, never in a browser dialog: a service order
    // (except in the sandbox) and any destructive call.
    const confirmMsg=h.confirm||(e.method==='DELETE'?'This permanently deletes the record. Continue?':null);
    const svcOrder=isService(e)&&!sandboxOn();
    if((svcOrder||confirmMsg)&&!opts.confirmed){askConfirm(root,e,opts,svcOrder,confirmMsg?interp(confirmMsg,vals):'');return;}
    const pending=root.querySelector('.svc-confirm');if(pending)pending.remove();

    const c=cfgOf(e);
    const headers={};
    if(c.auth==='edid')headers['X-EDID-Env']=staffEnv();
    if(sandboxOn())headers['X-Marketplace-Mode']='sandbox';
    const session=mpSession();
    if(!session){fail('Your portal login has expired. Log in to the partner portal again and reopen the console.');return;}
    headers['Authorization']='Bearer '+session;
    const reqOpts={method:e.method,headers};
    if(e.upload){
      const f=root.querySelector('[data-upload]');
      if(!f||!f.files[0]){fail('Choose a CSV file first.');return;}
      const fd=new FormData();fd.append(e.upload.field,f.files[0]);reqOpts.body=fd;
    }else{
      let b;
      try{b=buildBodyFrom(root,e);}
      catch(err){fail('Body is not valid JSON: '+err.message);return;}
      if(b!==undefined){headers['Content-Type']='application/json';reqOpts.body=b;}
    }
    const btn=root.querySelector('[data-send]');
    btn.disabled=true;btn.setAttribute('aria-busy','true');
    if(inlineEl){
      inlineEl.innerHTML='<div class="resp-empty">Waiting for the response…</div>';
    }else{
      statusEl.hidden=true;timeEl.textContent='';
      respBody.innerHTML='<div class="resp-empty">Waiting for the response…</div>';
    }
    // The path as requested, secret-named values masked: what lastResult reports.
    let sentPath='';try{sentPath=buildPathFrom(redactedForm(root),e).split('?')[0];}catch(_){/* Iris only */}
    const t0=performance.now();
    try{
      const r=await fetch(c.base+buildPathFrom(root,e),reqOpts);
      const txt=await r.text();
      const ms=performance.now()-t0;
      let parsed=null;try{parsed=JSON.parse(txt);}catch(_){/* not JSON */}
      noteCall(r,parsed);
      showResult(e,vals,r.status,txt,ms,inlineEl);
      recordLast(e,r.status,ms,txt,'',sentPath,{mode:r.headers.get('X-Marketplace-Mode'),price:r.headers.get('X-Marketplace-Price')});
      if(opts.onResult)opts.onResult(r.status,txt);
    }catch(err){
      const ms=performance.now()-t0;
      showResult(e,vals,0,'Network error: '+err.message,ms,inlineEl);
      recordLast(e,0,ms,'','Network error: '+err.message,sentPath);
    }
    btn.disabled=false;btn.removeAttribute('aria-busy');
  }
  // The confirmation step under a card's Send row. Confirm sends; Cancel or
  // Escape closes it. Pressing Send again shows it again.
  function askConfirm(root,e,opts,svcOrder,msg){
    const btn=root.querySelector('[data-send]'), row=btn&&btn.closest('.row');
    if(!row)return;
    const old=root.querySelector('.svc-confirm');if(old)old.remove();
    const danger=btn.classList.contains('danger');
    const box=document.createElement('div');
    box.className='svc-confirm';box.setAttribute('role','group');box.setAttribute('aria-label','Confirm before sending');
    box.innerHTML=(svcOrder?'<p><b>This orders telecom service.</b> Service charges apply per the tariff.</p>':'')
      +(msg?'<p>'+esc(msg)+'</p>':'')
      +'<div class="row"><button type="button" class="btn'+(danger?' danger':'')+'" data-confirm-ok>Confirm</button>'
      +'<button type="button" class="btn-line" data-confirm-cancel>Cancel</button></div>';
    row.insertAdjacentElement('afterend',box);
    const close=()=>{box.remove();if(btn)btn.focus();};
    box.querySelector('[data-confirm-ok]').onclick=()=>{box.remove();sendFrom(root,e,Object.assign({},opts,{confirmed:true}));};
    box.querySelector('[data-confirm-cancel]').onclick=close;
    box.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.preventDefault();close();}});
    box.querySelector('[data-confirm-ok]').focus({preventScroll:true});
    box.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  // ---- friendly response rendering -------------------------------------
  function humanize(k){
    return String(k).replace(/_/g,' ')
      .replace(/([a-z0-9])([A-Z])/g,'$1 $2')   // camelCase -> spaced
      .replace(/\b\w/g,c=>c.toUpperCase());
  }
  function fmtValue(k,v){
    if(v===null||v===undefined||v==='')return '—';
    if(typeof v==='boolean')return v?'Yes':'No';
    if(/(_on|_date|datetime|_at|^date)/i.test(k)&&typeof v==='string'){
      const d=new Date(v);
      if(!isNaN(d))return esc(d.toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'}));
    }
    return null; // caller falls through to recursive render
  }
  function friendly(data,depth=0){
    if(data===null||data===undefined)return '<span class="hint">—</span>';
    if(typeof data!=='object')return esc(String(data));
    if(Array.isArray(data)){
      if(!data.length)return '<span class="hint">Empty list — no records.</span>';
      return data.map(it=>friendly(it,depth+1)).join('');
    }
    let rows='';
    for(const [k,v] of Object.entries(data)){
      const simple=fmtValue(k,v);
      const cell=simple!==null?simple
        :(typeof v==='object'&&v!==null)?friendly(v,depth+1)
        :esc(String(v));
      rows+='<tr><td>'+esc(humanize(k))+'</td><td>'+cell+'</td></tr>';
    }
    return '<table class="listing-table">'+rows+'</table>';
  }
  // Refusals the console explains: the next step for each (buttons to
  // Billing & usage, or to switch the sandbox on or off for the next Send).
  const billingBtn=label=>'<button type="button" class="btn-line" data-open-billing>'+label+'</button>';
  const sandboxBtn=on=>'<button type="button" class="btn-line" role="switch" aria-checked="false" data-sandbox-set="'+(on?'on':'off')+'">'
    +(on?'Try in sandbox':'Send it live instead')+'</button>';
  // title: the banner; text: said when the gateway sends no message;
  // actions: what to do next.
  const GATEWAY_REFUSALS={
    card_required:{status:402,title:'A card is needed for this call',
      text:'Standard and Advanced events are charged to a card on file. Add one, or try the call in the sandbox (never billed).',
      actions:()=>billingBtn('Open Billing &amp; usage')+sandboxBtn(true)},
    payment_required:{status:402,title:'Your last payment didn\'t go through',
      text:'Free reads still work. Update your card and we\'ll retry the payment right away.',
      actions:()=>billingBtn('Update card in Billing &amp; usage')},
    no_test_system:{status:409,title:'Read-only in the sandbox',
      text:'This API has no test system, so the sandbox can\'t make changes. Send it live to make the change.',
      actions:()=>sandboxBtn(false)},
    sandbox_limit:{status:429,title:'This month\'s sandbox calls are used up',
      text:'The sandbox allowance resets on the 1st. Live calls aren\'t affected.',
      actions:()=>sandboxBtn(false)},
    sandbox_unavailable:{status:503,title:'The sandbox isn\'t switched on for this API yet',
      text:'Espresso\'s test system for this API isn\'t connected yet. Call it live instead.',
      actions:()=>sandboxBtn(false)},
    broadworks_not_linked:{status:403,title:'Your account isn\'t linked to a BroadWorks enterprise yet',
      text:'Contact Iristel support and we\'ll link your account to its enterprise; these calls then work.',
      actions:()=>''},
  };
  const refusalOf=(code,parsed)=>{const g=parsed&&typeof parsed==='object'?GATEWAY_REFUSALS[parsed.error]:null;return g&&g.status===code?g:null;};
  function respTitle(code,parsed){
    if(code===0)return 'Connection error';
    if(code>=200&&code<300)return 'Success';
    const gw=refusalOf(code,parsed);
    if(gw)return gw.title;
    if(parsed&&parsed.message)return String(parsed.message);
    if(code===401)return 'Not authorized — check your API key or credentials';
    if(code===402)return 'Payment required — add or update your card under Billing & usage';
    if(code===404)return 'Not found — verify the identifier';
    if(code===409)return 'Wrong state — the record already exists or cannot change';
    if(code===422||code===400)return 'Invalid request — check the fields';
    if(code>=500)return 'Upstream service problem — try again shortly';
    return 'Request failed';
  }
  function showResult(e,vals,code,body,ms,inlineEl){
    let parsed=null;
    try{ parsed=JSON.parse(body); }catch(_){ /* plain text */ }
    const good=code>=200&&code<300;
    const hint=hintFor(e);
    const title=good&&hint.successMsg?interp(hint.successMsg,vals):respTitle(code,parsed);
    let h='<div class="resp-banner '+(good?'good':'bad')+'">'
      +'<span class="icon">'+(good?'✓':'✕')+'</span>'
      +'<span>'+esc(title)+'</span></div>';
    // Billing and sandbox refusals (lib/entitlements.js): the gateway's
    // message is the banner; say what to do next instead of listing fields.
    const gw=good?null:refusalOf(code,parsed);
    if(gw){
      h+='<div class="resp-next"><span>'+esc(parsed.message||gw.text)+'</span>'+gw.actions(parsed)+'</div>';
      h+='<details class="raw"><summary>View raw JSON</summary><pre class="out">'
        +esc(JSON.stringify(parsed,null,2))+'</pre></details>';
    }else if(parsed&&typeof parsed==='object'){
      if(!good&&parsed.code!==undefined){
        h+='<p class="hint" style="margin:0 0 8px">Espresso error code <span class="errcode">'+esc(String(parsed.code))+'</span>'
          +(parsed.error?' · '+esc(String(parsed.error)):'')+'</p>';
        if(parsed.errors)h+=friendly(parsed.errors);
      }else{
        h+=friendly(parsed);
      }
      h+='<details class="raw"><summary>View raw JSON</summary><pre class="out">'
        +esc(JSON.stringify(parsed,null,2))+'</pre></details>';
    }else{
      h+='<pre class="out">'+esc(String(body))+'</pre>';
    }
    if(inlineEl){
      inlineEl.innerHTML=(code?'<div class="hint" style="margin:8px 0 4px">HTTP '+code+(ms?' · '+Math.round(ms)+' ms':'')+'</div>':'')+h;
    }else{
      statusEl.hidden=false;statusEl.textContent=code||'ERR';
      statusEl.className='status '+(good?'ok':code>=400&&code<500?'warn':'err');
      timeEl.textContent=ms?Math.round(ms)+' ms':'';
      respBody.innerHTML=h;
    }
  }

  // ---- Iris bridge (public/v2/iris-console.js) ----------------------------
  // What the Iris panel may do here: read the loaded catalog, move around,
  // fill fields and point at Send. Only the user sends. The bridge never
  // reads the API-key output, the billing form, cookies, the session or the
  // page text, and every product, endpoint and bundle id is checked against
  // what this login was granted (the filtered products / bundles) first.
  // Methods return plain JSON-safe objects and never throw ({error} instead).
  const clip=(s,n)=>{s=String(s==null?'':s);return s.length>n?s.slice(0,n-1)+'…':s;};
  const scrub=s=>String(s).replace(/mk_[A-Za-z0-9_-]+/g,'mk_[redacted]');
  const REDACT=/key|token|secret|pass|card|cvv|iccid/i;
  // PIN / PUK / OTP / IMSI as a word of the name (pin, oldPin, PIN1, sim_puk,
  // otpCode), so names like "shipping" or "footprint" stay readable.
  const REDACT_WORD=/^(?:pin|puk|otp|imsi)\d*$/;
  const nameWords=k=>String(k).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/);
  const isSecretName=k=>REDACT.test(k)||nameWords(k).some(w=>REDACT_WORD.test(w));
  // Staff reporting across all agents: kept out of Iris's guidance for partners.
  const STAFF_ONLY=['GET /commission/agents','GET /agent-commissions'];
  const isStaff=()=>!!(ME&&ME.isStaff);
  const staffOnly=e=>e.pid==='iristelx-commission'&&STAFF_ONLY.includes(e.method+' '+e.path);
  const hiddenFromIris=e=>staffOnly(e)&&!isStaff();
  const pick=(o,k)=>o[k]!==undefined?o[k]:o[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())];
  // Positional arguments, or one object ({productId} or {product_id}).
  function argsOf(list,names){
    const a=list[0], o={};
    if(a&&typeof a==='object'&&!Array.isArray(a))names.forEach(n=>{o[n]=pick(a,n);});
    else names.forEach((n,i)=>{o[n]=list[i];});
    return o;
  }
  function findEp(pid,method,path){
    const p=products.find(x=>x.id===String(pid||''));
    if(!p)return {error:'not_granted',message:'Unknown product, or not granted to this account: '+clip(pid,60)};
    const m=String(method||'').toUpperCase(), pa=String(path||'');
    const e=(p.endpoints||[]).find(x=>x.method===m&&x.path===pa);
    return e?{p,e}:{error:'not_found',message:'No '+clip(m+' '+pa,80)+' in '+p.name+'. Use find_endpoint for the exact path template.'};
  }
  const grantedBundle=id=>{id=String(id||'').replace(/^bundle:/,'');return bundles.find(b=>b.id===id)||null;};
  // Changes real data: any write sent live. Staff Espresso calls go to its
  // test system when the Sandbox switch is on; sandbox calls go to Espresso's test system or
  // are refused (no test system), so neither changes real data.
  const changesData=e=>!/^(GET|HEAD|OPTIONS)$/.test(e.method)&&!(exempt()&&cfgOf(e).auth==='edid'&&SANDBOX)&&!sandboxOn();
  const epTitle=e=>hintFor(e).title||autoTitle(e);
  const bodyModeOf=e=>e.upload?'upload':(e.fields&&e.fields.length)?(e.fields.some(f=>/[.\[]/.test(f.name))?'raw':'fields'):e.body?'raw':'none';
  const isDestructive=e=>{const h=hintFor(e);return (h.danger!==undefined?!!h.danger:e.method==='DELETE')||!!h.confirm;};
  // What a call costs the caller right now, for Iris (one or two sentences).
  function costNote(e){
    const mode=acctMode(), r=rateOf(e);
    if((products.find(p=>p.id===e.pid)||{}).status==='preview')
      return 'Switching on soon: calls answer 503 until Iristel turns this API on. Nothing is charged.';
    if(exempt())return 'Internal account: never billed'+(cfgOf(e).auth==='edid'?(SANDBOX?' (Espresso test system).':' (Espresso production system).'):'.');
    if(sandboxOn()){
      const sb=sandboxState();
      return 'Sandbox call: never billed'+(sb&&sb.left!=null?' ('+sb.left+' of '+(sb.limit||sandboxLimit())+' sandbox calls left this month)':'')+'.'
        +(ESPRESSO_IDS.includes(e.pid)?' Runs on Espresso\'s test system.'
          :sandboxReadOnly(e)?' This API has no test system, so the change answers 409 no_test_system; switch the sandbox off to send it live.':' Reads live data.');
    }
    if(mode==='past_due'&&!(r&&r.id==='free'))return 'Payment past due: only free reads work until the card is updated under Billing & usage (402 payment_required).';
    if(!r)return 'Not in the rate card: never charged.';
    if(r.id==='service')return 'Service order: no API fee; '+TARIFF.charAt(0).toLowerCase()+TARIFF.slice(1)+' Send asks the user to confirm first.';
    if(!r.priceCents)return 'Free: never charged.';
    return r.name+' event: '+priceText(r.priceCents)+' CAD per successful live call.'
      +(mode==='card_required'?' No card on file, so it answers 402 card_required: add a card under Billing & usage, or switch on the sandbox.':'');
  }
  function flowText(flow){
    if(!flow||!flow.steps||!flow.steps.length)return '';
    let t=(flow.title||'')+(flow.subtitle?' — '+flow.subtitle:'')+'\n'
      +flow.steps.map((s,i)=>(i+1)+'. '+(s.title||'')+': '+(s.text||'')+(s.detail&&s.detail.endpoint?' ['+s.detail.endpoint+']':'')).join('\n');
    if(flow.notes&&flow.notes.length)t+='\nNotes: '+flow.notes.join(' ');
    return clip(t.trim(),1500);
  }
  function meSnapshot(){
    if(!ME)return null;
    const m=JSON.parse(JSON.stringify(ME));
    delete m.email;
    // Fields of the retired sandbox model, should an older gateway send them.
    ['sandboxCallsUsed','sandboxCallsLimit','sandboxCallsLeft','environment'].forEach(k=>{delete m[k];});
    if(ACCOUNT&&ACCOUNT.mode)m.mode=ACCOUNT.mode;
    // Billing's sandbox count is the freshest (updated after every call).
    const sb=sandboxState();if(sb)m.sandbox={limit:sb.limit,used:sb.used,left:sb.left};
    m.callMode=callMode();
    m.rateCard=rateCardText();
    if(proposed())m.ratesStatus='proposed';
    return m;
  }
  // Where the user is: allowlisted fields only.
  function irisContext(){
    const b=isBundleId(productId)?bundleOf(productId):null;
    const p=products.find(x=>x.id===productId)||null;
    const eps=b?resolveBundleSteps(b).map(s=>s.e):p?(p.endpoints||[]):[];
    return {
      productId:p?p.id:null, productName:p?p.name:null,
      view:b?'bundle':p?'product':productId==='billing'?'billing':productId==='bundles'?'bundles':null,
      tab:$('#view-docs').hidden?'console':'docs',
      bundleId:b?b.id:null, bundleName:b?b.name:null, bundleStep:b&&irisStep!=null?irisStep:null,
      visibleEndpoints:eps.filter(e=>!hiddenFromIris(e)).slice(0,40)
        .map(e=>({productId:e.pid,method:e.method,path:e.path,title:clip(epTitle(e),80),rateClass:e.rateClass||null,priceCents:Number(e.priceCents)||0})),
      mode:acctMode(), callMode:callMode(),
      sandbox:(s=>s?{limit:s.limit,used:s.used,left:s.left}:null)(sandboxState()),
    };
  }
  // { results: endpoints only (max 5), products (max 5), bundles (max 3) }.
  function irisFind(query){
    const q=clip(query,200), qn=norm(q).trim();
    if(!qn)return {results:[],products:[],bundles:[]};
    const scored=searchAll(q)||[], results=[];
    scored.forEach(r=>r.eps.forEach(x=>{
      if(results.length<5&&!hiddenFromIris(x.e)&&x.e.method&&x.e.path)
        results.push({productId:r.id,method:x.e.method,path:x.e.path,title:clip(epTitle(x.e),80)});
    }));
    const prods=scored.map(r=>products.find(x=>x.id===r.id)).filter(Boolean).slice(0,5)
      .map(p=>({productId:p.id,title:clip(p.name,80)}));
    // Same bundle scoring as the sidebar search.
    const qt=qn.split(/\s+/).filter(t=>t.length>2);
    const bl=bundles.map(b=>{
      const text=norm([b.name,b.useCase,b.summary,b.audience].join(' '));
      let s=text.includes(qn)?40:0; qt.forEach(t=>{if(text.includes(t))s+=10;});
      return {b,s};
    }).filter(x=>x.s>=20).sort((a,b)=>b.s-a.s).slice(0,3)
      .map(x=>({bundleId:x.b.id,title:clip(x.b.name,80)}));
    return {results,products:prods,bundles:bl};
  }
  function irisDocs(pid,method,path){
    const f=findEp(pid,method,path);if(f.error)return f;
    const {p,e}=f, h=hintFor(e), fm=h.fields||{}, mode=bodyModeOf(e);
    const param=(x,where)=>{
      const m=fm[x.name]||{};
      const o={name:x.name,in:where,required:!!x.required,type:m.enum?'enum':(m.type||'string'),
        description:clip(m.help||x.description||'',240)};
      if(m.label)o.label=clip(m.label,60);
      if(m.enum){
        const en=m.enum.slice(0,50);
        o.options=en.map(v=>String(Array.isArray(v)?v[0]:v));
        if(en.some(v=>Array.isArray(v)&&String(v[1])!==String(v[0])))
          o.optionLabels=Object.fromEntries(en.filter(Array.isArray).map(v=>[String(v[0]),clip(v[1],60)]));
      }
      const rd=runtimeDefault(e,x.name);
      if(m.default!==undefined)o.default=clip(m.default,80);
      else if(rd!==undefined&&rd!=='')o.default=clip(rd,80);
      return o;
    };
    const params=[...(e.params||[]).filter(x=>x.in==='path').map(x=>param(x,'path')),
      ...(e.params||[]).filter(x=>x.in==='query').map(x=>param(x,'query')),
      ...(mode==='fields'?e.fields.map(x=>param(x,'body')):[])];
    const out={productId:p.id,productName:p.name,method:e.method,path:e.path,title:clip(epTitle(e),100),
      description:clip(e.description||h.description||'',600),returns:clip(e.returns||h.returns||'',600),
      params:params.slice(0,40),bodyMode:mode,rateClass:e.rateClass||null,priceCents:Number(e.priceCents)||0,
      costNote:costNote(e),live:changesData(e),destructive:isDestructive(e)};
    if(isService(e))out.serviceOrder='Orders telecom service: no API fee. '+TARIFF+' Send asks the user to confirm in the card first (not in the sandbox).';
    if(priced(e))out.billableEvent=BILLABLE_EVENT;
    if(p.status==='preview')out.comingSoon='Not switched on yet: calls answer 503 not_enabled until Iristel turns this API on. Nothing is charged.';
    if(mode==='raw'&&e.body)out.bodyTemplate=clip(JSON.stringify(e.body),600);
    if(mode==='upload')out.upload={field:e.upload.field||'file',accept:e.upload.accept||''};
    if(e.precondition)out.precondition=clip(e.precondition,300);
    if(h.info)out.info=clip(h.info,300);
    if(e.errors&&e.errors.length)out.errors=e.errors.slice(0,8).map(er=>({code:er.code,when:clip(er.when||'',120)}));
    const flow=flowText(p.flow);if(flow)out.flow=flow;
    // Indexed like get_bundle / open_bundle: 0-based over the steps this account can run.
    const notes=[];
    bundles.forEach(b=>{
      const steps=resolveBundleSteps(b);
      steps.forEach(({st,e:se},i)=>{
        if(se===e&&st.note&&notes.length<6)
          notes.push({bundleId:b.id,step:i,label:'Step '+(i+1)+' of '+steps.length,note:clip(st.note,160)});
      });
    });
    if(notes.length)out.bundleNotes=notes;
    if(staffOnly(e))out.staffOnly=true;
    return out;
  }
  // The keys a step's documented returns name, as carryKey()s: what carryFrom
  // can pick up from its response. Undocumented returns name nothing.
  const returnKeys=e=>(String(e.returns||hintFor(e).returns||'').match(/[A-Za-z_]\w*/g)||[]).map(carryKey);
  function irisBundle(id){
    const b=grantedBundle(id);
    if(!b)return {error:'not_granted',message:'Unknown bundle, or not available to this account.'};
    const resolved=resolveBundleSteps(b), returned=new Set();
    const steps=resolved.map(({st,p,e},i)=>{
      const names=[...(e.params||[]).map(x=>x.name),
        ...(bodyModeOf(e)==='fields'?e.fields.map(x=>x.name):[])];
      // Fields an earlier step's response can fill (carryFrom in renderBundleConsole
      // matches response keys by carryKey). Only keys an earlier step documents in
      // its returns count; an earlier step with no documented returns adds none.
      const mayCarry=[...new Set(names.filter(n=>returned.has(carryKey(n))))].slice(0,20);
      returnKeys(e).forEach(k=>returned.add(k));
      const s={step:i,label:'Step '+(i+1)+' of '+resolved.length,productId:p.id,method:e.method,path:e.path,
        title:clip(epTitle(e),80),note:clip(st.note||'',200),bodyMode:bodyModeOf(e),mayCarryFrom:mayCarry};
      if(staffOnly(e))s.staffOnly=true;
      return s;
    });
    return {id:b.id,name:b.name,useCase:clip(b.useCase||'',200),summary:clip(b.summary||'',300),steps};
  }

  // The card for an endpoint. Inside an open bundle that has the endpoint as
  // a step, the step's card; otherwise the product page, navigating there
  // only when needed (navigation re-renders and wipes every form).
  function irisTarget(a,navigate){
    const f=findEp(a.productId,a.method,a.path);if(f.error)return f;
    if(staffOnly(f.e)&&!isStaff())return {error:'staff_only',message:'This endpoint is for Iristel staff reporting.'};
    const b=isBundleId(productId)?bundleOf(productId):null;
    const hasStep=a.step!=null&&a.step!=='';
    if(b){
      const steps=resolveBundleSteps(b);
      const i=hasStep?Number(a.step):steps.findIndex(s=>s.e===f.e);
      if(hasStep&&(!Number.isInteger(i)||!steps[i]||steps[i].e!==f.e))
        return {error:'step_mismatch',message:'Step '+clip(a.step,10)+' of this bundle is not '+f.e.method+' '+f.e.path+'.'};
      const card=i>=0?$('#opgrid [data-step="'+i+'"]'):null;
      if(card)return {p:f.p,e:f.e,card,bundleId:b.id,step:i};
    }
    if(productId!==f.p.id){
      if(!navigate)return {p:f.p,e:f.e,card:null};
      productId=f.p.id;location.hash='#'+f.p.id;markProduct();renderProduct();
    }
    const key=f.e.method+' '+f.e.path;
    const card=[...ROOT.querySelectorAll('#opgrid .card[data-ep]')].find(c=>c.dataset.ep===key)||null;
    return card||!navigate?{p:f.p,e:f.e,card}:{error:'not_rendered',message:'That endpoint has no console card.'};
  }
  // Marks the target's button in the left rail (and the bundle step) active.
  // Emits nothing itself: callers decide whether the move is news.
  function markRail(t){
    if(t.bundleId!=null){irisStep=t.step;nav.querySelectorAll('button').forEach((x,j)=>x.classList.toggle('active',j===t.step));}
    else{const key=t.e.method+' '+t.e.path;nav.querySelectorAll('button[data-ep]').forEach(x=>x.classList.toggle('active',x.dataset.ep===key));}
  }
  function focusCard(t){
    showTab('console');
    markRail(t);
    t.card.scrollIntoView({block:'start',behavior:'smooth'});
  }
  const fieldName=i=>i.dataset.path||i.dataset.query||i.dataset.body||'';
  const fieldIn=i=>i.dataset.path!==undefined?'path':i.dataset.query!==undefined?'query':'body';
  const myAgentIds=()=>(ME?ME.agents:[]).map(x=>String(x.id));
  // What Iris may not point at or write code for: a card whose path values
  // leave their segment, or whose agent id (typed, or carried in by a bundle
  // step) is not one of the caller's own. null when the card is fine.
  function cardProblem(root){
    const ins=[...root.querySelectorAll('[data-path],[data-query],[data-body]')];
    const bad=ins.find(i=>fieldIn(i)==='path'&&unsafeSeg(i.value));
    if(bad)return {error:'bad_path_value',message:'The '+clip(fieldName(bad),40)+' value on this card would reach a different endpoint. Correct it first.'};
    const mine=myAgentIds();
    const fa=ins.find(i=>carryKey(fieldName(i))==='agentid'&&String(i.value).trim()!==''&&!mine.includes(String(i.value).trim()));
    if(fa)return {error:'foreign_agent',message:'The '+clip(fieldName(fa),40)+' on this card is not one of the caller\'s own agent ids ('
      +(clip(mine.join(', '),120)||'none on file')+'). Fill in one of theirs first.'};
    return null;
  }
  // A copy of a JSON value with everything under a secret-named key masked;
  // objects keep their shape so a code sample stays readable.
  function maskDeep(v,hide,d){
    if(d>20)return '[redacted]';
    if(Array.isArray(v))return v.map(x=>maskDeep(x,hide,d+1));
    if(v&&typeof v==='object'){const o={};Object.keys(v).forEach(k=>{o[k]=maskDeep(v[k],hide||isSecretName(k),d+1);});return o;}
    if(hide&&v!==null&&v!=='')return '[redacted]';
    return typeof v==='string'?scrub(v):v;
  }
  // A detached copy of a card's request fields for what reaches Iris (code
  // samples, the path lastResult reports): secret-named values masked, and a
  // raw JSON body masked under secret-named keys (invalid JSON is left out,
  // as the snippet does anyway).
  function redactedForm(card){
    const root=document.createElement('div');
    card.querySelectorAll('[data-path],[data-query],[data-body]').forEach(i=>{
      const x=document.createElement('input'), name=fieldName(i);
      x.dataset[fieldIn(i)]=name;
      x.value=isSecretName(name)&&i.value!==''?'[redacted]':scrub(i.value);
      root.appendChild(x);
    });
    const ta=card.querySelector('[data-rawbody]');
    if(ta){
      const x=document.createElement('textarea');x.dataset.rawbody='';
      try{x.value=JSON.stringify(maskDeep(JSON.parse(ta.value),false,0));}catch(_){x.value='';}
      root.appendChild(x);
    }
    return root;
  }
  // Re-queried every time: any navigation rebuilds the inputs.
  function cardFields(card){
    return [...card.querySelectorAll('[data-path],[data-query],[data-body]')].slice(0,40).map(i=>{
      const name=fieldName(i);
      const o={name,in:fieldIn(i),required:i.dataset.req==='1',
        type:i.tagName==='SELECT'?'enum':i.tagName==='TEXTAREA'?'textarea':(i.type||'text'),
        value:isSecretName(name)&&i.value?'[redacted]':clip(scrub(i.value),200),touched:!!i.dataset.touched};
      if(i.dataset.touched)o.touchedBy=i.dataset.touched==='iris'?'iris':'user';
      if(i.tagName==='SELECT')o.options=[...i.options].filter(x=>!x.disabled&&x.value!=='').slice(0,50).map(x=>x.value);
      return o;
    });
  }
  const cardBodyMode=card=>card.querySelector('[data-upload]')?'upload':card.querySelector('[data-rawbody]')?'raw'
    :card.querySelector('[data-body]')?'fields':'none';
  function openShape(t){
    const e=t.e;
    const o={ok:true,productId:e.pid,method:e.method,path:e.path,fields:cardFields(t.card),bodyMode:cardBodyMode(t.card),
      live:changesData(e),destructive:isDestructive(e),costNote:costNote(e),rateClass:e.rateClass||null,priceCents:Number(e.priceCents)||0,
      callMode:callMode()};
    if(isService(e)&&!sandboxOn())o.confirmStep=true;
    if(t.bundleId!=null){o.bundleId=t.bundleId;o.step=t.step;}
    if(staffOnly(e))o.staffOnly=true;
    const pr=cardProblem(t.card);if(pr)o.warning=pr.message;
    return o;
  }
  function irisOpen(pid,method,path){
    const t=irisTarget({productId:pid,method,path},true);if(t.error)return t;
    focusCard(t);
    return openShape(t);
  }
  function irisOpenBundle(id,step){
    const b=grantedBundle(id);
    if(!b)return {error:'not_granted',message:'Unknown bundle, or not available to this account.'};
    const steps=resolveBundleSteps(b);
    if(!steps.length)return {error:'not_found',message:'This bundle has no steps this account can run.'};
    const i=step==null||step===''?0:Number(step);
    if(!Number.isInteger(i)||!steps[i])return {error:'bad_step',message:'step must be 0 to '+(steps.length-1)+' (0 is Step 1).'};
    if(staffOnly(steps[i].e)&&!isStaff())return {error:'staff_only',message:'Step '+(i+1)+' is for Iristel staff reporting.'};
    if(productId!=='bundle:'+b.id){productId='bundle:'+b.id;location.hash='#bundle-'+b.id;markProduct();renderProduct();}
    const card=$('#opgrid [data-step="'+i+'"]');
    if(!card)return {error:'not_rendered',message:'That step has no console card.'};
    const t={p:steps[i].p,e:steps[i].e,card,bundleId:b.id,step:i};
    focusCard(t);
    return openShape(t);
  }
  function irisShowDocs(pid){
    pid=String(pid||'');
    const b=isBundleId(pid)||!products.some(p=>p.id===pid)?grantedBundle(pid):null;
    const target=b?'bundle:'+b.id:products.some(p=>p.id===pid)?pid:null;
    if(!target)return {error:'not_granted',message:'Unknown product, or not granted to this account: '+clip(pid,60)};
    if(productId!==target){productId=target;location.hash='#'+hashFor(target);markProduct();renderProduct();}
    showTab('docs');
    return {ok:true};
  }
  function irisFill(a){
    a=a||{};
    let values=pick(a,'values');
    if(values===undefined)values=a.values_json;
    if(typeof values==='string'){try{values=JSON.parse(values);}catch(_){values=null;}}
    if(!values||typeof values!=='object'||Array.isArray(values))
      return {error:'bad_values',message:'values must be a JSON object of field name to value.'};
    const where={productId:pick(a,'productId'),method:a.method,path:a.path,step:a.step};
    const t=irisTarget(where,true);if(t.error)return t;   // also refuses staff-only endpoints
    focusCard(t);
    const overwrite=a.overwrite===true||a.overwrite==='true';
    const inputs=[...t.card.querySelectorAll('[data-path],[data-query],[data-body]')];
    const myAgents=myAgentIds();
    const results=Object.entries(values).slice(0,40).map(([field,raw])=>{
      field=clip(field,60);
      const inp=inputs.find(i=>fieldName(i)===field)||inputs.find(i=>carryKey(fieldName(i))===carryKey(field));
      if(!inp){
        if(t.card.querySelector('[data-upload]'))return {field,status:'needs-upload',detail:'This call takes a file: the user picks it in the card.'};
        if(t.card.querySelector('[data-rawbody]'))return {field,status:'needs-raw-body',detail:'This call takes a JSON body: the user edits it in the Body (JSON) box.'};
        return {field,status:'not-found',detail:'Fields on this card: '+clip(inputs.map(fieldName).join(', ')||'none',200)};
      }
      const name=fieldName(inp);
      let v=raw==null?'':typeof raw==='object'?JSON.stringify(raw):String(raw).trim();
      if(carryKey(name)==='agentid'&&v!==''&&!myAgents.includes(v))
        return {field:name,status:'refused',detail:'Only the caller\'s own agent ids can be used ('+(clip(myAgents.join(', '),120)||'none on file')+').'};
      if(fieldIn(inp)==='path'&&unsafeSeg(v))
        return {field:name,status:'refused',detail:'A path value can\'t be "." or ".." or contain / \\ ? #: the call would reach a different endpoint.'};
      if(inp.dataset.touched&&!overwrite)
        return {field:name,status:'skipped-touched',detail:(inp.dataset.touched==='iris'?'Filled earlier by Iris':'Typed by the user')+'; pass overwrite to replace it.'};
      if(inp.tagName==='SELECT'){
        const opts=[...inp.options].filter(o=>!o.disabled);
        if(!opts.some(o=>o.value===v))
          return {field:name,status:'invalid-option',detail:'Allowed: '+clip(opts.filter(o=>o.value!=='').map(o=>o.value).join(', '),200)};
      }else if(inp.type==='number'&&v!==''&&!Number.isFinite(Number(v))){
        return {field:name,status:'invalid-option',detail:'Expects a number.'};
      }
      inp.value=v.slice(0,2000);
      inp.dataset.touched='iris';            // carry-forward leaves it alone
      inp.dispatchEvent(new Event('input',{bubbles:true}));   // URL and code preview refresh
      inp.dispatchEvent(new Event('change',{bubbles:true}));
      inp.classList.add('iris-filled');setTimeout(()=>inp.classList.remove('iris-filled'),2500);
      return {field:name,status:'filled'};
    });
    const missingRequired=inputs.filter(i=>i.dataset.req&&!String(i.value).trim()).map(fieldName);
    const up=t.card.querySelector('[data-upload]');
    if(up&&!(up.files&&up.files[0]))missingRequired.push((t.e.upload&&t.e.upload.field)||'file');
    const out={results,missingRequired};
    if(t.bundleId!=null){out.bundleId=t.bundleId;out.step=t.step;}
    const pr=cardProblem(t.card);if(pr)out.warning=pr.message;
    return out;
  }
  // Points at Send with a pulse and a short cue. It only points: the user
  // presses Send themselves.
  let cueTimer=null;
  function clearCue(){
    clearTimeout(cueTimer);
    ROOT.querySelectorAll('.iris-pulse').forEach(c=>c.classList.remove('iris-pulse'));
    ROOT.querySelectorAll('.iris-cue').forEach(c=>c.remove());
  }
  function irisHighlightSend(a){
    a=a||{};
    const t=irisTarget({productId:pick(a,'productId'),method:a.method,path:a.path,step:a.step},true);if(t.error)return t;
    const btn=t.card.querySelector('[data-send]');
    if(!btn)return {error:'not_found',message:'No Send button on that card.'};
    const pr=cardProblem(t.card);if(pr)return pr;
    clearCue();
    showTab('console');
    markRail(t);
    t.card.classList.add('iris-pulse');
    const cue=document.createElement('span');
    cue.className='iris-cue';cue.setAttribute('role','status');
    cue.textContent='Iris filled this — press Send when ready';
    btn.insertAdjacentElement('afterend',cue);
    // The Send button itself, not the card: on a tall card (or above the
    // phone bottom sheet) centring the card can leave Send off screen.
    btn.scrollIntoView({block:'center',behavior:'smooth'});
    cueTimer=setTimeout(clearCue,6000);
    return {ok:true};
  }

  // ---- last send attempt, summarised for Iris ----------------------------
  // path: the path actually requested (secret-named values masked), so the
  // summary never reports only the card's template for a different call.
  // call: {mode, price} from the gateway's X-Marketplace-Mode / -Price.
  function recordLast(e,status,ms,txt,message,path,call){
    try{
      LAST={e,status,ms,txt:String(txt||''),message:message||'',path:path||'',call:call||{}};
      if(irisListeners.result.length)irisEmit('result',summarizeLast(3));
    }catch(_){/* never break the console over Iris */}
  }
  function redactDeep(v,d){
    if(typeof v==='string')return scrub(v);
    if(d>4||v===null||typeof v!=='object')return v;
    if(Array.isArray(v))return v.slice(0,5).map(x=>redactDeep(x,d+1));
    const o={};
    Object.keys(v).slice(0,20).forEach(k=>{o[k]=isSecretName(k)?'[redacted]':redactDeep(v[k],d+1);});
    return o;
  }
  function redactVal(k,v){
    if(isSecretName(k))return '[redacted]';
    if(v===null||v===undefined||typeof v==='number'||typeof v==='boolean')return v===undefined?null:v;
    if(typeof v==='object')v=JSON.stringify(redactDeep(v,0));
    return clip(scrub(v),80);
  }
  function findRows(v){
    if(Array.isArray(v))return v;
    if(!v||typeof v!=='object')return null;
    const keys=['data','rows','items','results','records','list'];
    for(const k of keys)if(Array.isArray(v[k]))return v[k];
    if(v.data&&typeof v.data==='object')for(const k of keys)if(Array.isArray(v.data[k]))return v.data[k];
    return Object.values(v).find(x=>Array.isArray(x)&&x.length&&x[0]&&typeof x[0]==='object')||null;
  }
  // Commission = Base × Percentage ÷ 100, summed per currency symbol.
  function commissionTotals(rows){
    const t={};let any=false;
    rows.forEach(r=>{
      if(!('BASE_AMOUNT' in r)||!('PERCENTAGE' in r))return;
      const v=Number(r.BASE_AMOUNT)*Number(r.PERCENTAGE)/100;
      if(!Number.isFinite(v))return;
      const s=clip(String(r.SYMBOL==null?'':r.SYMBOL).trim()||'?',12);
      t[s]=(t[s]||0)+v;any=true;
    });
    if(!any)return null;
    Object.keys(t).forEach(s=>{t[s]=Math.round(t[s]*100)/100;});
    return t;
  }
  // Each explanation stays under 80 characters (Iris reads it out).
  function explainStatus(s,rows,err){
    if(s>=200&&s<300)return 'OK: the call succeeded'+(rows!=null?' and returned '+rows+' row'+(rows===1?'':'s'):'')+'.';
    switch(s){
      case 0:return 'Not sent: a form check or the network failed. See message, then retry.';
      case 400:return 'Bad input: check formats and required fields, then send again.';
      case 401:return 'Portal login expired: log in again and reopen the console.';
      case 402:return err==='payment_required'?'Payment past due: update the card under Billing & usage.'
        :'Card needed for Standard/Advanced calls: add one, or use the sandbox.';
      case 403:return err==='broadworks_not_linked'?'Account not linked to a BroadWorks enterprise: contact Iristel.'
        :'This API product is not granted to this account.';
      case 404:return 'not_found: path not in the catalog, or no such record. Check the ID.';
      case 409:return err==='no_test_system'?'No test system: read-only in the sandbox. Send it live to change it.'
        :'Upstream rejected it (wrong state or invalid data). Fix the input.';
      case 422:return 'Upstream rejected it (wrong state or invalid data). Fix the input.';
      case 429:return err==='sandbox_limit'?'This month\'s sandbox calls are used up. Send it live instead.'
        :'Too many requests: slow down and try again shortly.';
      case 502:return 'The upstream service is unavailable right now. Try again later.';
      case 503:return err==='sandbox_unavailable'?'Sandbox not switched on for this API yet. Send it live instead.'
        :'A gateway dependency is unavailable right now. Try again later.';
    }
    return s>=500?'Server-side problem upstream. Try again later.':'The request failed (HTTP '+clip(s,6)+'). Read the message.';
  }
  function summarizeLast(maxRows){
    if(!LAST)return {none:true};
    let n=parseInt(maxRows,10);if(!Number.isFinite(n))n=3;n=Math.max(0,Math.min(10,n));
    const {e,status,ms,txt,message,path,call}=LAST, ok=status>=200&&status<300;
    const out={endpoint:e.method+' '+e.path,productId:e.pid,status,ms:Math.round(ms||0),ok,rows:null,columns:[],sample:[]};
    // live | sandbox, and the call's rate ("standard 1"), as the gateway answered.
    if(call&&call.mode)out.callMode=clip(call.mode,10);
    if(call&&call.price)out.rate=clip(call.price,30);
    if(path)out.path=clip(scrub(path),200);
    let parsed;try{parsed=txt?JSON.parse(txt):undefined;}catch(_){parsed=undefined;}
    if(message)out.message=clip(scrub(message),80);
    if(ok&&parsed!==undefined){
      const rows=findRows(parsed);
      if(rows){
        out.rows=rows.length;
        const objs=rows.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)), cols=[];
        objs.slice(0,20).forEach(r=>Object.keys(r).forEach(k=>{if(cols.length<30&&!cols.includes(k))cols.push(k);}));
        out.columns=cols.map(c=>clip(c,40));
        out.sample=rows.slice(0,n).map(r=>{
          if(!r||typeof r!=='object'||Array.isArray(r))return redactVal('',r);
          const o={};cols.forEach(c=>{if(c in r)o[clip(c,40)]=redactVal(c,r[c]);});return o;
        });
        const tot=commissionTotals(objs);
        if(tot)out.totals={totalCommission:tot};
      }else if(parsed&&typeof parsed==='object'){
        const cols=Object.keys(parsed).slice(0,30);
        out.columns=cols.map(c=>clip(c,40));
        if(n>0){const o={};cols.forEach(c=>{o[clip(c,40)]=redactVal(c,parsed[c]);});out.sample=[o];}
      }else if(n>0)out.sample=[redactVal('',parsed)];
    }else if(!message&&parsed&&typeof parsed==='object'){
      const m=parsed.message||parsed.error_description||parsed.error||parsed.detail;
      out.message=clip(scrub(typeof m==='string'?m:JSON.stringify(redactDeep(parsed,0))),80);
      if(parsed.code!==undefined)out.errorCode=clip(parsed.code,40);
      if(typeof parsed.error==='string')out.error=clip(parsed.error,40);
    }else if(!message&&txt){
      out.message=clip(scrub(txt.replace(/\s+/g,' ')),80);
    }
    out.explanation=explainStatus(status,out.rows,!ok&&parsed&&typeof parsed==='object'?parsed.error:null);
    // Keep it under 4 KB: drop sample rows first, then columns.
    while(JSON.stringify(out).length>4096&&out.sample.length)out.sample.pop();
    if(JSON.stringify(out).length>4096)out.columns=out.columns.slice(0,10);
    return out;
  }
  function irisSnippet(a){
    a=a||{};
    const LANGS={curl:'curl',javascript:'javascript',js:'javascript',node:'javascript',python:'python',py:'python'};
    const want=String(pick(a,'lang')||a.language||'curl').toLowerCase();
    const lang=Object.prototype.hasOwnProperty.call(LANGS,want)?LANGS[want]:null;
    if(!lang)return {error:'bad_language',message:'language must be curl, javascript or python.'};
    const t=irisTarget({productId:pick(a,'productId'),method:a.method,path:a.path,step:a.step},false);if(t.error)return t;
    // Not on screen: build it from a detached form with the default values.
    let root=t.card;
    if(!root){root=document.createElement('div');root.innerHTML=formHtml(t.e,{compact:true});}
    const pr=cardProblem(root);if(pr)return pr;
    // The code goes to Iris: secret-named values and raw-body secrets masked.
    return {lang,code:snippetText(redactedForm(root),t.e,lang)};
  }
  function irisOn(name,cb){
    if(!['result','nav'].includes(name)||typeof cb!=='function')return {error:'bad_event',message:'on() takes "result" or "nav" and a function.'};
    if(!irisListeners[name].includes(cb)){
      irisListeners[name].push(cb);
      // The page as it is now is the baseline: the next 'nav' means a real move.
      if(name==='nav')irisNavKey=navKeyOf(irisContext());
    }
    return {ok:true};
  }
  const safe=fn=>(...args)=>{
    const failed=err=>({error:'internal_error',message:clip(err&&err.message||err,120)});
    try{const r=fn(...args);return r&&typeof r.then==='function'?r.catch(failed):r;}catch(err){return failed(err);}
  };
  const bridge=Object.freeze({
    context:safe(()=>irisContext()),
    me:safe(()=>meSnapshot()),
    find:safe((...a)=>irisFind(argsOf(a,['query']).query)),
    docs:safe((...a)=>{const o=argsOf(a,['productId','method','path']);return irisDocs(o.productId,o.method,o.path);}),
    bundle:safe((...a)=>irisBundle(argsOf(a,['bundleId']).bundleId)),
    open:safe((...a)=>{const o=argsOf(a,['productId','method','path']);return irisOpen(o.productId,o.method,o.path);}),
    openBundle:safe((...a)=>{const o=argsOf(a,['bundleId','step']);return irisOpenBundle(o.bundleId,o.step);}),
    showDocs:safe((...a)=>irisShowDocs(argsOf(a,['productId']).productId)),
    fill:safe(a=>irisFill(a)),
    highlightSend:safe(a=>irisHighlightSend(a)),
    lastResult:safe(n=>irisLastResult(n)),
    snippet:safe(a=>irisSnippet(a)),
    on:safe((name,cb)=>irisOn(name,cb)),
    // Where the Iris panel mounts: inside this shadow root, next to the console.
    root:ROOT,
    host:HOST,
  });
  function irisLastResult(n){
    if(n&&typeof n==='object')n=pick(n,'maxRows');
    return summarizeLast(n);
  }
  const irisReady=()=>document.dispatchEvent(new CustomEvent('iris:console-ready',{detail:bridge}));
  document.addEventListener('iris:console-request',irisReady);
  irisReady();

  renderProduct();
}

  // ---- mount -------------------------------------------------------------
  function mount() {
    let host = document.getElementById('mp-console');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mp-console';
      document.body.appendChild(host);
    }
    if (host.shadowRoot) return;
    // Web fonts declared inside a shadow root aren't loaded, so the brand
    // fonts come from the page. The portal and /v2/console already load
    // Heebo and Ubuntu; any other host gets them here.
    if (!document.querySelector('link[data-mp-font], link[href*="family=Heebo"]')) {
      const font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&family=Ubuntu:wght@400;500;700&display=swap';
      font.setAttribute('data-mp-font', '');
      document.head.appendChild(font);
    }
    // Set before the first paint; main() then follows the page's changes.
    host.dataset.theme = pageTheme();

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' + MARKUP;
    if (!OWN_CHROME) root.querySelector('.mp-app').classList.add('embedded');

    // The brand links to the marketplace page: "/" on the gateway, the
    // portal's /api-marketplace page anywhere else.
    const brand = root.getElementById('brand-link');
    if (brand && GATEWAY !== location.origin) brand.href = '/api-marketplace';

    // The rails stick below the mode bar, whose height changes with its text.
    const bar = root.getElementById('modebar');
    const app = root.querySelector('.mp-app');
    const barHeight = () => app.style.setProperty('--mp-bar', (bar && !bar.hidden ? bar.offsetHeight : 0) + 'px');
    if (bar && window.ResizeObserver) new ResizeObserver(barHeight).observe(bar);
    barHeight();

    // In-page links (the docs' endpoint list) can't use the URL fragment
    // inside a shadow root, so scroll to the target here.
    root.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a[href^="#"]');
      if (!a || ev.defaultPrevented) return;
      const target = root.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      if (!target) return;
      ev.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    main(root, host, GATEWAY).catch((err) => console.error('[console]', err));

    // The Iris panel (v2), from the same gateway. It mounts inside this shadow
    // root once the console hands it the bridge.
    const iris = document.createElement('script');
    iris.src = GATEWAY + '/v2/iris-console.js';
    iris.defer = true;
    document.head.appendChild(iris);
  }

  function start() {
    if (window.MarketplaceAccess) return mount();
    const access = document.createElement('script');
    access.src = GATEWAY + '/marketplace-access.js';
    access.onload = access.onerror = mount;
    document.head.appendChild(access);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
