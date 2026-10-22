/**
 * Iris panel for the API console: a chat drawer (text by default, voice on
 * request) that walks a logged-in partner through the APIs they've been
 * granted. v2: the same panel in the Iristel brand (magenta pill for the
 * launcher and Send, royal for the partner's messages, Heebo/Ubuntu). Its
 * colours are the v2 console's custom properties, so it follows the
 * console's theme. v2/console-app.js loads it from the same gateway once the console
 * is mounted; the panel then mounts inside the console's shadow root
 * (bridge.root) and calls the gateway that served this file.
 *
 * Iris fills, the partner sends. Every action goes through the bridge the
 * console hands over in its 'iris:console-ready' event (open an endpoint,
 * fill fields, point at Send, read the last result, show a code sample).
 * This file never clicks [data-send], and never reads the API-key output,
 * the billing card form, cookies, the page URL or page text. The login
 * session is sent only to this gateway, never to Iris.
 *
 * The launcher shows only when bridge.me() (GET /marketplace/me) says
 * irisEnabled: true, so accounts outside the pilot never see it.
 *
 * Talks to:
 *   GET /marketplace/iris/session   signed ElevenLabs URL (gated, rate limited)
 *   @elevenlabs/client (jsDelivr)   pinned, loaded on first open only
 * Defines no globals.
 */
(function () {
  'use strict';

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.28.0/+esm';
  // The gateway that served this file; the console may be hosted elsewhere
  // (the partner portal's /console page).
  const GATEWAY = document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src).origin : location.origin;
  const SESSION_URL = GATEWAY + '/marketplace/iris/session';
  const PROGRESS_KEY = 'iris-console-progress';
  const LANG = String(navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const LANG_NAMES = { curl: 'curl', javascript: 'JavaScript', python: 'Python' };

  const STRINGS = {
    en: {
      launcher: 'Ask Iris',
      launcherTitle: 'Ask Iris, your API guide',
      region: 'Iris, API guide',
      subtitle: 'API guide',
      close: 'Close Iris',
      logLabel: 'Conversation with Iris',
      disclosure: 'Conversations with Iris are processed by ElevenLabs and kept for 30 days. Never paste API keys or card numbers.',
      inputLabel: 'Message Iris',
      placeholder: 'Ask about your APIs…',
      send: 'Send',
      talk: 'Talk',
      stop: 'Stop',
      talkTitle: 'Talk to Iris with your microphone',
      stopTitle: 'Stop voice and go back to typing',
      you: 'You',
      connecting: 'Connecting…',
      online: 'Online',
      offline: 'Offline',
      thinking: 'Thinking…',
      listening: 'Listening…',
      speaking: 'Speaking…',
      voiceOn: 'Voice is on. Speak when you\'re ready.',
      voiceOff: 'Voice is off. Back to typing.',
      noVoice: 'Voice isn\'t available here — keep typing.',
      loginExpired: 'Your login expired — log in again and reopen the console.',
      notApproved: 'Iris is available once your API access is approved.',
      rateLimited: (min) => 'You\'ve reached the limit for Iris conversations. Try again '
        + (min ? 'in about ' + min + ' min.' : 'later.'),
      unavailable: 'Iris is unavailable right now.',
      sdkFail: 'Couldn\'t load the chat. Check your connection and try again.',
      connectFail: 'Couldn\'t connect to Iris. Try again in a moment.',
      ended: 'Conversation ended. Send a message to start a new one.',
      dropped: 'The connection to Iris dropped. Send a message to reconnect.',
      error: 'Something went wrong. Try again.',
      secretBlocked: 'That looks like an API key, login token or card number. Remove it — Iris never needs it.',
      opened: (ep) => 'Opened ' + ep,
      filled: (n, ep) => 'Filled ' + n + (n === 1 ? ' field' : ' fields') + ' on ' + ep + '. Check them, then press Send.',
      sample: (name) => name + ' sample',
      code: 'Code',
      copy: 'Copy',
      copied: 'Copied',
      copyFail: 'Select and copy',
    },
    fr: {
      launcher: 'Demander à Iris',
      launcherTitle: 'Demander à Iris, votre guide des API',
      region: 'Iris, guide des API',
      subtitle: 'Guide des API',
      close: 'Fermer Iris',
      logLabel: 'Conversation avec Iris',
      disclosure: 'Les conversations avec Iris sont traitées par ElevenLabs et conservées 30 jours. Ne collez jamais de clé d\'API ni de numéro de carte.',
      inputLabel: 'Message à Iris',
      placeholder: 'Posez une question sur vos API…',
      send: 'Envoyer',
      talk: 'Parler',
      stop: 'Arrêter',
      talkTitle: 'Parler à Iris avec votre micro',
      stopTitle: 'Couper la voix et revenir au clavier',
      you: 'Vous',
      connecting: 'Connexion…',
      online: 'En ligne',
      offline: 'Hors ligne',
      thinking: 'Réflexion…',
      listening: 'À l\'écoute…',
      speaking: 'Iris parle…',
      voiceOn: 'La voix est activée. Parlez quand vous êtes prêt.',
      voiceOff: 'La voix est coupée. Retour au clavier.',
      noVoice: 'La voix n\'est pas disponible ici — continuez à écrire.',
      loginExpired: 'Votre session a expiré — reconnectez-vous et rouvrez la console.',
      notApproved: 'Iris sera disponible une fois votre accès aux API approuvé.',
      rateLimited: (min) => 'Vous avez atteint la limite de conversations avec Iris. Réessayez '
        + (min ? 'dans environ ' + min + ' min.' : 'plus tard.'),
      unavailable: 'Iris n\'est pas disponible pour le moment.',
      sdkFail: 'Impossible de charger la conversation. Vérifiez votre connexion et réessayez.',
      connectFail: 'Impossible de joindre Iris. Réessayez dans un instant.',
      ended: 'Conversation terminée. Envoyez un message pour en commencer une nouvelle.',
      dropped: 'La connexion avec Iris a été coupée. Envoyez un message pour vous reconnecter.',
      error: 'Une erreur s\'est produite. Réessayez.',
      secretBlocked: 'Cela ressemble à une clé d\'API, à un jeton de connexion ou à un numéro de carte. Retirez-le — Iris n\'en a jamais besoin.',
      opened: (ep) => 'Ouvert : ' + ep,
      filled: (n, ep) => n + (n === 1 ? ' champ rempli' : ' champs remplis') + ' sur ' + ep + '. Vérifiez-les, puis cliquez sur Send.',
      sample: (name) => 'Exemple ' + name,
      code: 'Code',
      copy: 'Copier',
      copied: 'Copié',
      copyFail: 'Sélectionnez et copiez',
    },
  };
  const T = STRINGS[LANG];

  let bridge = null;       // the console's bridge (null until 'iris:console-ready')
  let hooked = null;       // the bridge whose result/nav hooks are registered
  let gone = false;        // the session route said 404: no Iris on this page
  let fatal = '';          // 'login' | 'not_approved': stop asking for sessions
  let ui = null;           // drawer DOM, built the first time the launcher shows
  let conv = null;         // live Conversation (text or voice)
  let convMode = 'text';
  let gen = 0;             // bumped on every end; callbacks of older sessions go quiet
  let connecting = null;   // in-flight connect promise
  let switching = false;   // Talk/Stop in progress
  let submitting = false;
  let hadSession = false;  // a session ran before: re-inject progress on the next one
  let ctx = null;          // /marketplace/me object from the session response
  let sdkPromise = null;
  let navTimer = 0;
  let toolNavUntil = 0;    // ignore nav events caused by Iris's own open/show/fill/highlight calls
  const echoes = [];       // texts rendered locally; dropped if the server echoes them

  function hook(b) {
    if (hooked === b || typeof b.on !== 'function') return;
    hooked = b;
    try {
      b.on('result', onConsoleResult);
      b.on('nav', onConsoleNav);
    } catch (_) { /* no live updates from this console build */ }
  }

  function hasLogin() {
    try {
      const ma = window.MarketplaceAccess;
      return !!(ma && typeof ma.session === 'function' && ma.session());
    } catch (_) { return false; }
  }

  // The pilot gate (IRIS_CONSOLE_ENABLED / IRIS_CONSOLE_EMAILS), as GET
  // /marketplace/me reports it through bridge.me(). Anything but
  // irisEnabled === true (no flag, no /me, an error) keeps Iris hidden, so
  // nobody outside the pilot sees a launcher or costs a session request.
  function irisEnabled() {
    try {
      const me = bridge && typeof bridge.me === 'function' ? bridge.me() : null;
      return !!(me && typeof me === 'object' && me.irisEnabled === true);
    } catch (_) { return false; }
  }

  function refreshLauncher() {
    const show = !!bridge && !gone && hasLogin() && irisEnabled();
    if (!show && !ui) return;
    build();
    if (!show && !ui.drawer.hidden) closeDrawer(false);
    ui.launcher.hidden = !show;
  }

  // ---- console hooks → contextual updates --------------------------------
  function onConsoleResult(s) {
    if (!s || s.none || !s.endpoint) return;
    const p = loadProgress();
    p.lastEndpoint = clip(s.endpoint, 160);
    p.lastStatus = s.status;
    p.lastRows = s.rows == null ? null : s.rows;
    saveProgress(p);
    update('User sent ' + s.endpoint + ' → ' + s.status + (s.rows != null ? ', ' + s.rows + ' rows' : '')
      + '. Explanation: ' + (s.explanation || ''));
  }

  function onConsoleNav(c) {
    if (!c || (!c.productId && !c.bundleId)) return;
    const place = placeText(c);
    const p = loadProgress();
    p.place = place;
    saveProgress(p);
    if (!live() || Date.now() < toolNavUntil) return;
    clearTimeout(navTimer);
    navTimer = setTimeout(() => update('User is now on ' + place + '.'), 800);
  }

  // On a bundle the console reports no productId, only bundleId and the
  // 0-based bundleStep that get_bundle and open_bundle use.
  function placeText(c) {
    if (c.bundleId) {
      const s = stepOf(c.bundleStep);
      return 'bundle ' + clip(c.bundleId, 80) + (s != null ? ', step ' + stepText(s) : '')
        + ', tab ' + (c.tab || 'console');
    }
    return 'product ' + clip(c.productId, 80) + ', tab ' + (c.tab || 'docs');
  }

  function stepText(n) {
    return n + ' (Step ' + (n + 1) + ' on screen)';
  }

  function live() {
    try { return !!(conv && conv.isOpen()); } catch (_) { return false; }
  }

  function update(text) {
    if (!live()) return;
    try { conv.sendContextualUpdate(clip(text, 1500)); } catch (_) { /* session closing */ }
  }

  // ---- drawer -------------------------------------------------------------
  const CSS = [
    '.irp-launch{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;padding:8px 16px 8px 8px;border:0;border-radius:999px;background:var(--primary,#d1155a);color:var(--on-primary,#fff);font:500 13.5px var(--sans,Ubuntu,Helvetica,Arial,sans-serif);box-shadow:var(--shadow,0 8px 24px rgba(1,17,30,.08));cursor:pointer}',
    '.irp-launch[hidden]{display:none}',
    '.irp-launch:hover{background:var(--primary-hover,#b0104b)}',
    '.irp-launch:focus-visible{outline:2px solid var(--focus,#004a9f);outline-offset:3px}',
    '.irp-mark{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:rgba(1,17,30,.28);font:800 12px var(--sans,Ubuntu,Helvetica,Arial,sans-serif)}',
    '.irp-drawer{position:fixed;top:var(--mp-top,0px);right:0;bottom:0;z-index:2147483001;width:360px;max-width:100%;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#0b1f3a);border-left:1px solid var(--line,#e8edf2);box-shadow:var(--shadow,0 8px 24px rgba(1,17,30,.08));font:14px/1.5 var(--sans,Ubuntu,Helvetica,Arial,sans-serif)}',
    '.irp-drawer[hidden]{display:none}',
    // Room for the drawer: on the console's host element when the panel is in
    // the console's shadow root, on the body otherwise.
    '@media (min-width:761px){:host(.irp-open){padding-right:360px}}',
    '@media (min-width:761px){body.irp-open{padding-right:360px}}',
    // Phones: a bottom sheet instead of a full-screen drawer, so the card Iris
    // fills (and the Send button she points at) stays visible above it. The
    // page gets room below its content, and scrollIntoView keeps targets
    // clear of the sheet (scroll-padding).
    '@media (max-width:760px){.irp-drawer{top:auto;left:0;width:100%;height:min(60vh,560px);border-left:0;border-top:1px solid var(--line,#e8edf2);border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom)}'
      + ':host(.irp-open){padding-bottom:62vh}'
      + 'body.irp-open{padding-bottom:62vh}'
      + '.irp-launch{right:12px;bottom:calc(12px + env(safe-area-inset-bottom));padding:6px 14px 6px 6px;font-size:12.5px}}',
    '.irp-head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line,#e8edf2)}',
    '.irp-head .irp-mark{background:var(--sel,#004a9f);color:var(--on-sel,#fff);font-family:var(--head,Heebo,Arial,sans-serif)}',
    '.irp-titles{display:flex;flex-direction:column;line-height:1.25;min-width:0}',
    '.irp-titles b{font:700 15px var(--head,Heebo,Arial,sans-serif);color:var(--heading,#01111e)}',
    '.irp-sub{font-size:11.5px;color:var(--muted,#5b6b7f)}',
    '.irp-state{margin-left:auto;font-size:11.5px;color:var(--muted,#5b6b7f);white-space:nowrap}',
    '.irp-voice .irp-state{color:var(--accent,#004a9f);font-weight:600}',
    '.irp-x{flex:none;width:30px;height:30px;border:1px solid var(--line,#e8edf2);border-radius:8px;background:none;color:var(--ink,#0b1f3a);font:400 18px/1 var(--sans,Ubuntu,Helvetica,Arial,sans-serif);cursor:pointer}',
    '.irp-x:hover{border-color:var(--accent,#004a9f)}',
    '.irp-x:focus-visible,.irp-talk:focus-visible,.irp-send:focus-visible,.irp-copy:focus-visible{outline:2px solid var(--accent,#004a9f);outline-offset:2px}',
    '.irp-disclose{flex:none;margin:0;padding:8px 14px;font-size:11.5px;line-height:1.45;color:var(--muted,#5b6b7f);border-bottom:1px solid var(--line,#e8edf2)}',
    '.irp-log{flex:1;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}',
    '.irp-log:focus-visible{outline:2px solid var(--accent,#004a9f);outline-offset:-2px}',
    '.irp-msg{max-width:92%;padding:8px 11px;border-radius:var(--r,14px);font-size:13.5px;overflow-wrap:anywhere}',
    '.irp-agent{align-self:flex-start;background:color-mix(in srgb,var(--accent,#004a9f) 7%,var(--panel,#fff));border:1px solid var(--line,#e8edf2);border-top-left-radius:4px}',
    '.irp-user{align-self:flex-end;background:var(--sel,#004a9f);color:var(--on-sel,#fff);border-top-right-radius:4px}',
    '.irp-sample{align-self:stretch;max-width:100%;padding:0;border:0;background:none}',
    '.irp-text{white-space:pre-wrap}',
    '.irp-note{align-self:center;text-align:center;font-size:12px;color:var(--muted,#5b6b7f);padding:2px 6px}',
    '.irp-note.irp-err{color:var(--err,#c62828)}',
    '.irp-note.irp-warn{color:var(--warn,#8a5a00)}',
    '.irp-code{margin:6px 0;border:1px solid var(--code-line,rgba(255,255,255,.1));border-radius:10px;overflow:hidden;background:var(--code-bg,#01111e);color:var(--code-ink,#d8e6f3)}',
    '.irp-codebar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px 4px 10px;font:600 11px var(--sans,Ubuntu,Helvetica,Arial,sans-serif);border-bottom:1px solid var(--code-line,rgba(255,255,255,.1))}',
    '.irp-copy{border:1px solid currentColor;background:none;color:inherit;border-radius:6px;font:600 11px var(--sans,Ubuntu,Helvetica,Arial,sans-serif);padding:3px 9px;cursor:pointer}',
    '.irp-code pre{margin:0;padding:10px;font:12px/1.55 var(--mono,ui-monospace,monospace);white-space:pre;overflow-x:auto;max-height:320px}',
    '.irp-form{flex:none;border-top:1px solid var(--line,#e8edf2);padding:10px 14px 12px;display:flex;flex-direction:column;gap:8px}',
    '.irp-drawer textarea.irp-input{min-height:0;resize:none;width:100%;font:13.5px/1.45 var(--sans,Ubuntu,Helvetica,Arial,sans-serif);padding:8px 10px;border:1px solid var(--field-line,var(--line,#d5dde6));border-radius:10px;background:var(--field,var(--panel,#fff));color:var(--ink,#0b1f3a);box-shadow:none}',
    '.irp-drawer textarea.irp-input:focus{outline:none;border-color:var(--accent,#004a9f);box-shadow:0 0 0 3px var(--ring,rgba(0,114,206,.22))}',
    '.irp-actions{display:flex;gap:8px;justify-content:flex-end}',
    '.irp-talk,.irp-send{border-radius:999px;padding:7px 18px;font:500 13px var(--sans,Ubuntu,Helvetica,Arial,sans-serif);cursor:pointer}',
    '.irp-talk{background:none;border:1px solid var(--outline,#b9c7d6);color:var(--accent,#004a9f)}',
    '.irp-talk[aria-pressed="true"]{background:var(--err-deep,#c62828);border-color:transparent;color:#fff}',
    '.irp-send{background:var(--primary,#d1155a);border:1px solid var(--primary,#d1155a);color:var(--on-primary,#fff)}',
    '.irp-send:hover:not(:disabled){background:var(--primary-hover,#b0104b);border-color:var(--primary-hover,#b0104b)}',
    '.irp-talk:disabled,.irp-send:disabled{opacity:.55;cursor:progress}',
    '.irp-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
  ].join('\n');

  // Inside the console's shadow root when it hands one over, else the page.
  function mountRoot() { return bridge && bridge.root && typeof bridge.root.append === 'function' ? bridge.root : null; }
  function openHost() { return (bridge && bridge.host && bridge.host.classList) ? bridge.host : document.body; }
  // On phones the drawer is a bottom sheet; keep scrolled-to targets above it.
  function sheetPadding(on) {
    try { document.documentElement.style.scrollPaddingBottom = on && matchMedia('(max-width:760px)').matches ? '62vh' : ''; } catch (_) { /* old browser */ }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    if (ui) return ui;
    const style = el('style');
    style.textContent = CSS;
    (mountRoot() || document.head).appendChild(style);

    const launcher = el('button', 'irp-launch');
    launcher.type = 'button';
    launcher.hidden = true;
    launcher.title = T.launcherTitle;
    launcher.setAttribute('aria-controls', 'irp-drawer');
    launcher.setAttribute('aria-expanded', 'false');
    const lmark = el('span', 'irp-mark', 'I');
    lmark.setAttribute('aria-hidden', 'true');
    launcher.append(lmark, el('span', null, T.launcher));

    const drawer = el('aside', 'irp-drawer');
    drawer.id = 'irp-drawer';
    drawer.hidden = true;
    drawer.lang = LANG;
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', T.region);

    const head = el('div', 'irp-head');
    const mark = el('span', 'irp-mark', 'I');
    mark.setAttribute('aria-hidden', 'true');
    const titles = el('div', 'irp-titles');
    titles.append(el('b', null, 'Iris'), el('span', 'irp-sub', T.subtitle));
    const state = el('span', 'irp-state');
    const close = el('button', 'irp-x', '×');
    close.type = 'button';
    close.setAttribute('aria-label', T.close);
    head.append(mark, titles, state, close);

    const log = el('div', 'irp-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-label', T.logLabel);
    log.tabIndex = 0;

    const form = el('form', 'irp-form');
    form.noValidate = true;
    const label = el('label', 'irp-sr', T.inputLabel);
    label.htmlFor = 'irp-input';
    const input = el('textarea', 'irp-input');
    input.id = 'irp-input';
    input.rows = 2;
    input.maxLength = 2000;
    input.placeholder = T.placeholder;
    input.autocomplete = 'off';
    const actions = el('div', 'irp-actions');
    const talk = el('button', 'irp-talk', T.talk);
    talk.type = 'button';
    talk.title = T.talkTitle;
    talk.setAttribute('aria-pressed', 'false');
    const send = el('button', 'irp-send', T.send);
    send.type = 'submit';
    actions.append(talk, send);
    form.append(label, input, actions);

    drawer.append(head, el('p', 'irp-disclose', T.disclosure), log, form);
    (mountRoot() || document.body).append(launcher, drawer);

    launcher.addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer(true)));
    close.addEventListener('click', () => closeDrawer(true));
    drawer.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); closeDrawer(true); }
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); submit(); }
    });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
    talk.addEventListener('click', () => (convMode === 'voice' && live() ? stopVoice() : startVoice()));

    ui = { launcher, drawer, state, log, input, send, talk };
    return ui;
  }

  function openDrawer() {
    if (!bridge || gone || !irisEnabled()) return;
    build();
    ui.drawer.hidden = false;
    openHost().classList.add('irp-open');
    sheetPadding(true);
    ui.launcher.setAttribute('aria-expanded', 'true');
    ui.input.focus();
    scrollLog();
    if (fatal) noteFatal();
    else if (!live() && !connecting && !switching) ensureConv();
  }

  function closeDrawer(returnFocus) {
    if (!ui) return;
    // Never leave the microphone running (or about to start) behind a closed
    // drawer. A text session stays open so reopening carries on.
    if (convMode === 'voice' || switching) { endConv(); setVoiceUi(false); setState(T.offline); }
    ui.drawer.hidden = true;
    openHost().classList.remove('irp-open');
    sheetPadding(false);
    ui.launcher.setAttribute('aria-expanded', 'false');
    if (returnFocus && !ui.launcher.hidden) ui.launcher.focus();
  }

  function setState(text) { if (ui) ui.state.textContent = text || ''; }

  function setVoiceUi(on) {
    if (!ui) return;
    ui.talk.textContent = on ? T.stop : T.talk;
    ui.talk.title = on ? T.stopTitle : T.talkTitle;
    ui.talk.setAttribute('aria-pressed', on ? 'true' : 'false');
    ui.drawer.classList.toggle('irp-voice', on);
  }

  function scrollLog() { if (ui) ui.log.scrollTop = ui.log.scrollHeight; }

  function append(node) {
    build();
    ui.log.appendChild(node);
    while (ui.log.childElementCount > 200) ui.log.removeChild(ui.log.firstElementChild);
    scrollLog();
  }

  function note(text, kind) {
    append(el('div', 'irp-note' + (kind ? ' irp-' + kind : ''), text));
  }

  function noteFatal() {
    note(fatal === 'login' ? T.loginExpired : T.notApproved, 'err');
  }

  // All message text goes in through textContent. ``` fences become <pre>.
  function addMsg(role, text) {
    const wrap = el('div', 'irp-msg ' + (role === 'user' ? 'irp-user' : 'irp-agent'));
    wrap.appendChild(el('span', 'irp-sr', (role === 'user' ? T.you : 'Iris') + ': '));
    String(text).split('```').forEach((part, i) => {
      if (i % 2 === 0) {
        const t = part.replace(/^\n+|\n+$/g, '');
        if (t.trim()) wrap.appendChild(el('div', 'irp-text', t));
        return;
      }
      let code = part;
      let lang = '';
      const m = /^([A-Za-z0-9_+#.-]{1,20})[ \t]*\r?\n/.exec(code);
      if (m) { lang = m[1]; code = code.slice(m[0].length); }
      wrap.appendChild(codeBlock(code.replace(/^\r?\n/, '').replace(/\s+$/, ''), lang || T.code));
    });
    append(wrap);
  }

  function addSample(lang, code) {
    const wrap = el('div', 'irp-msg irp-sample');
    wrap.appendChild(codeBlock(code, T.sample(LANG_NAMES[lang] || lang)));
    append(wrap);
  }

  function codeBlock(code, label) {
    const box = el('div', 'irp-code');
    const bar = el('div', 'irp-codebar');
    const btn = el('button', 'irp-copy', T.copy);
    btn.type = 'button';
    btn.addEventListener('click', () => copyText(code, btn));
    bar.append(el('span', null, label), btn);
    box.append(bar, el('pre', null, code));
    return box;
  }

  async function copyText(text, btn) {
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (_) { /* iframe without clipboard-write: fall back */ }
    if (!ok) {
      try {
        const ta = el('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (_) { ok = false; }
    }
    btn.textContent = ok ? T.copied : T.copyFail;
    setTimeout(() => { btn.textContent = T.copy; }, 1600);
  }

  // ---- chat ---------------------------------------------------------------
  async function submit() {
    if (!ui || submitting) return;
    const text = ui.input.value.trim();
    if (!text) return;
    if (fatal) { noteFatal(); return; }
    if (looksSecret(text)) { note(T.secretBlocked, 'warn'); return; }
    submitting = true;
    ui.send.disabled = true;
    try {
      if (!(await ensureConv()) || !live()) return;
      ui.input.value = '';
      addMsg('user', text);
      remember('user', text);
      echoes.push(text);
      if (echoes.length > 10) echoes.shift();
      try {
        conv.sendUserMessage(text);
        if (convMode !== 'voice') setState(T.thinking);
      } catch (_) { note(T.error, 'err'); }
    } finally {
      submitting = false;
      ui.send.disabled = false;
    }
  }

  // Refuse to forward what looks like a marketplace key, a login token or a
  // card number (13–16 digits passing the Luhn check; dates don't count).
  function looksSecret(t) {
    if (/\bmk_[A-Za-z0-9_-]{8,}/.test(t)) return true;
    if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/.test(t)) return true;
    return (t.match(/\b\d(?:[ -]?\d){12,15}\b/g) || [])
      .some((run) => !/\d{4}-\d{2}-\d{2}/.test(run) && luhn(run.replace(/\D/g, '')));
  }

  function luhn(d) {
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i];
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  }

  function scrub(s) {
    return String(s)
      .replace(/\bmk_[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, 'YOUR_MARKETPLACE_KEY')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g, '[redacted]');
  }

  // ---- sessions -----------------------------------------------------------
  function ensureConv() {
    if (live()) return Promise.resolve(true);
    return begin('text', hadSession);
  }

  function begin(mode, resume) {
    if (connecting) return connecting;
    connecting = connect(mode)
      .then((ok) => {
        if (ok && resume) update(progressSummary(mode));
        return ok;
      })
      .finally(() => { connecting = null; });
    return connecting;
  }

  async function connect(mode) {
    const voice = mode === 'voice';
    const my = ++gen; // an endConv() while this runs makes it stand down
    const mine = () => my === gen;
    setState(T.connecting);
    const s = await fetchSession();
    if (!mine()) return false;
    if (!s.ok) { setState(''); failSession(s); return false; }
    const sdk = await loadSdk();
    if (!mine()) return false;
    if (!sdk) { setState(T.offline); note(T.sdkFail, 'err'); return false; }
    if (s.data.context && typeof s.data.context === 'object') ctx = s.data.context;
    let c;
    try {
      c = await sdk.Conversation.startSession({
        signedUrl: s.data.signedUrl,
        textOnly: !voice,
        userId: s.data.userId ? String(s.data.userId) : undefined,
        dynamicVariables: await dynamicVariables(),
        clientTools: clientTools(),
        onMessage: (m) => { if (mine()) onMessage(m); },
        onError: (msg, info) => { if (mine()) onSdkError(msg, info); },
        onDisconnect: (d) => { if (mine()) onDisconnect(d); },
        onModeChange: (m) => {
          if (mine() && voice) setState(m && m.mode === 'speaking' ? T.speaking : T.listening);
        },
      });
    } catch (_) {
      if (mine()) { setState(T.offline); note(T.connectFail, 'err'); }
      return false;
    }
    if (!mine()) { try { await c.endSession(); } catch (_) { /* already closed */ } return false; }
    conv = c;
    convMode = voice ? 'voice' : 'text';
    hadSession = true;
    setState(voice ? T.listening : T.online);
    return true;
  }

  async function endConv() {
    const c = conv;
    conv = null;
    gen++;
    convMode = 'text';
    clearTimeout(navTimer);
    if (c) { try { await c.endSession(); } catch (_) { /* already closed */ } }
  }

  async function fetchSession() {
    let token = '';
    try { token = window.MarketplaceAccess.session() || ''; } catch (_) { token = ''; }
    if (!token) return { ok: false, kind: 'login' };
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), 15000) : 0;
    try {
      const r = await fetch(SESSION_URL, {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
        signal: ac ? ac.signal : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d && typeof d.signedUrl === 'string' && d.signedUrl) return { ok: true, data: d };
      if (r.status === 404) return { ok: false, kind: 'gone' };
      if (r.status === 401) return { ok: false, kind: 'login' };
      if (r.status === 403) return { ok: false, kind: 'not_approved' };
      if (r.status === 429) {
        return { ok: false, kind: 'rate', retry: Number(d && d.retryAfterSeconds) || Number(r.headers.get('Retry-After')) || 0 };
      }
      return { ok: false, kind: 'unavailable' };
    } catch (_) {
      return { ok: false, kind: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  function failSession(s) {
    if (s.kind === 'gone') {
      // Not enabled for this account: hide for the rest of this page, quietly.
      gone = true;
      closeDrawer(false);
      if (ui) ui.launcher.hidden = true;
      return;
    }
    if (s.kind === 'login' || s.kind === 'not_approved') { fatal = s.kind; noteFatal(); return; }
    if (s.kind === 'rate') { note(T.rateLimited(s.retry ? Math.max(1, Math.ceil(s.retry / 60)) : 0), 'warn'); return; }
    note(T.unavailable, 'err');
  }

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL)
        .then((mod) => (mod && mod.Conversation && typeof mod.Conversation.startSession === 'function' ? mod : null))
        .catch(() => null);
      sdkPromise.then((mod) => { if (!mod) sdkPromise = null; }); // allow a retry later
    }
    return sdkPromise;
  }

  async function dynamicVariables() {
    const me = ctx || await safe(() => bridge && bridge.me());
    const cc = await safe(() => bridge && bridge.context());
    const products = me && Array.isArray(me.products) ? me.products : [];
    const agents = me && Array.isArray(me.agents) ? me.agents : [];
    const left = me && me.sandboxCallsLeft != null ? me.sandboxCallsLeft
      : (cc && cc.sandboxCallsLeft != null ? cc.sandboxCallsLeft : '');
    // The gateway looks the name up from trusted records (CRM / agent /
    // employees). greeting_name carries its own leading space so the agent's
    // first message "Hi{{greeting_name}} — …" reads cleanly when it is empty.
    const firstName = String((me && me.firstName) || '');
    return {
      first_name: firstName,
      greeting_name: firstName ? ' ' + firstName : '',
      product_names: products.map((p) => p && p.name).filter(Boolean).join(', '),
      agent_count: String(agents.length),
      mode: String((me && me.mode) || (cc && cc.mode) || ''),
      sandbox_calls_left: String(left),
      lang: LANG,
    };
  }

  async function safe(fn) {
    try { return await fn(); } catch (_) { return null; }
  }

  function onMessage(m) {
    if (!m || typeof m.message !== 'string' || !m.message.trim()) return;
    const role = m.role === 'agent' || m.source === 'ai' ? 'agent' : 'user';
    if (role === 'user') {
      const i = echoes.indexOf(m.message.trim());
      if (i !== -1) { echoes.splice(i, 1); return; }
    } else if (convMode !== 'voice') {
      setState(T.online);
    }
    addMsg(role, m.message);
    remember(role, m.message);
  }

  function onSdkError(msg, info) {
    // A failed or unknown client tool is already reported back to the agent.
    if (info && info.clientToolName) { console.warn('[iris] client tool failed:', info.clientToolName); return; }
    console.warn('[iris]', clip(scrub(msg), 200));
    note(T.error, 'err');
    if (live()) setState(convMode === 'voice' ? T.listening : T.online);
  }

  function onDisconnect(d) {
    const wasVoice = convMode === 'voice';
    conv = null;
    gen++;
    convMode = 'text';
    if (wasVoice) setVoiceUi(false);
    setState(T.offline);
    note(d && d.reason === 'error' ? T.dropped : T.ended);
  }

  // ---- voice --------------------------------------------------------------
  function micAllowed() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return false;
    try {
      const pp = document.permissionsPolicy || document.featurePolicy;
      if (pp && typeof pp.allowsFeature === 'function') return pp.allowsFeature('microphone');
    } catch (_) { /* no policy API: let getUserMedia decide */ }
    return true;
  }

  async function startVoice() {
    if (switching) return;
    if (fatal) { noteFatal(); return; }
    if (!micAllowed()) { note(T.noVoice, 'warn'); return; }
    switching = true;
    ui.talk.disabled = true;
    try {
      // Ask for the mic only now, after the click; the SDK opens its own stream.
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) { note(T.noVoice, 'warn'); return; }
      stream.getTracks().forEach((t) => t.stop());
      if (connecting) await connecting;
      if (ui.drawer.hidden) return; // closed while the mic prompt was up
      await endConv();
      const ok = await begin('voice', true);
      if (!ok || convMode !== 'voice') return; // next message reconnects in text
      if (ui.drawer.hidden) { await endConv(); return; }
      setVoiceUi(true);
      note(T.voiceOn);
    } finally {
      switching = false;
      ui.talk.disabled = false;
    }
  }

  async function stopVoice() {
    if (switching) return;
    switching = true;
    ui.talk.disabled = true;
    try {
      await endConv();
      setVoiceUi(false);
      note(T.voiceOff);
      await begin('text', true);
    } finally {
      switching = false;
      ui.talk.disabled = false;
    }
  }

  // ---- progress kept across sessions (this tab only) ---------------------
  function loadProgress() {
    try {
      const p = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || '{}');
      return p && typeof p === 'object' ? p : {};
    } catch (_) { return {}; }
  }

  function saveProgress(p) {
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (_) { /* storage blocked */ }
  }

  function remember(role, text) {
    const p = loadProgress();
    const turns = Array.isArray(p.turns) ? p.turns : [];
    turns.push({ r: role === 'user' ? 'user' : 'iris', t: clip(scrub(text), 240) });
    p.turns = turns.slice(-6);
    saveProgress(p);
  }

  function setGuideStep(text) {
    const p = loadProgress();
    p.step = clip(text, 160);
    saveProgress(p);
  }

  function progressSummary(mode) {
    const p = loadProgress();
    const parts = [];
    if (p.lastEndpoint) {
      parts.push('last request ' + p.lastEndpoint + ' → ' + p.lastStatus + (p.lastRows != null ? ', ' + p.lastRows + ' rows' : ''));
    }
    if (p.step) parts.push('last guide step: ' + p.step);
    if (p.place) parts.push('console position: ' + p.place);
    if (Array.isArray(p.turns) && p.turns.length) {
      parts.push('recent turns: ' + p.turns.map((x) => (x.r === 'user' ? 'User' : 'Iris') + ': ' + x.t).join(' / '));
    }
    return 'New ' + (mode === 'voice' ? 'voice' : 'text') + ' session continuing the same conversation with this user'
      + ' (they switched mode or reconnected). '
      + (parts.length ? 'Progress so far: ' + parts.join('; ').replace(/[.\s]+$/, '') + '. ' : '')
      + 'Pick up where you left off without repeating the introduction.';
  }

  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ---- client tools (contract E) → bridge (contract D) -------------------
  function str(v) { return v == null ? '' : clip(String(v).trim(), 300); }

  function stepOf(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  function rowsOf(v) {
    const n = Math.floor(Number(v));
    return n >= 1 ? Math.min(n, 10) : 3;
  }

  function langOf(v) {
    const k = str(v).toLowerCase();
    if (!k || k === 'curl' || k === 'bash' || k === 'shell' || k === 'sh') return 'curl';
    if (k === 'javascript' || k === 'js' || k === 'node' || k === 'nodejs' || k === 'node.js') return 'javascript';
    if (k === 'python' || k === 'py' || k === 'python3') return 'python';
    return '';
  }

  function parseValues(v) {
    let o = v;
    if (typeof v === 'string') {
      try { o = JSON.parse(v); } catch (_) { return null; }
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out = {};
    Object.keys(o).slice(0, 60).forEach((k) => {
      const x = o[k];
      if (x == null) return;
      out[k] = typeof x === 'object' ? JSON.stringify(x) : String(x);
    });
    return out;
  }

  function target(p) {
    return {
      productId: str(p.product_id),
      method: str(p.method).toUpperCase(),
      path: str(p.path),
      step: stepOf(p.step),
    };
  }

  function epLabel(t) { return [t.method, t.path].filter(Boolean).join(' ') || t.productId; }

  // For the saved progress: the endpoint plus, inside a bundle, its step.
  function guideLabel(t, r) {
    const b = r && typeof r.bundleId === 'string' ? clip(r.bundleId, 80) : '';
    const s = r && stepOf(r.step) != null ? stepOf(r.step) : t.step;
    if (!b && s == null) return epLabel(t);
    return epLabel(t) + ' [bundle' + (b ? ' ' + b : '') + (s != null ? ', step ' + stepText(s) : '') + ']';
  }

  function callBridge(method, ...args) {
    if (!bridge) return { error: 'console_unavailable' };
    if (typeof bridge[method] !== 'function') return { error: 'not_supported' };
    return bridge[method](...args);
  }

  function tool(fn) {
    return async (params) => {
      const p = params && typeof params === 'object' ? params : {};
      let out;
      try { out = await fn(p); } catch (_) { out = { error: 'tool_failed' }; }
      if (out == null) out = { error: 'unavailable' };
      let json;
      try { json = JSON.stringify(out); } catch (_) { json = '{"error":"unserialisable_result"}'; }
      return scrub(json);
    };
  }

  function clientTools() {
    return {
      get_console_context: tool(() => callBridge('context')),
      get_my_account: tool(async () => (await callBridge('me')) || ctx),
      find_endpoint: tool((p) => callBridge('find', str(p.query))),
      get_endpoint_docs: tool((p) => {
        const t = target(p);
        return callBridge('docs', t.productId, t.method, t.path);
      }),
      get_bundle: tool((p) => callBridge('bundle', str(p.bundle_id))),
      open_endpoint: tool(async (p) => {
        const t = target(p);
        toolNavUntil = Date.now() + 1500;
        const r = await callBridge('open', t.productId, t.method, t.path);
        if (r && r.ok) { note(T.opened(epLabel(t))); setGuideStep('opened ' + guideLabel(t, r)); }
        return r;
      }),
      open_bundle: tool(async (p) => {
        const id = str(p.bundle_id);
        const step = stepOf(p.step);
        toolNavUntil = Date.now() + 1500;
        const r = await callBridge('openBundle', id, step);
        if (r && r.ok) {
          const at = stepOf(r.step) != null ? stepOf(r.step) : step;
          const label = 'bundle ' + id;
          note(T.opened(label + (at != null ? ', Step ' + (at + 1) : '')));
          setGuideStep('opened ' + label + (at != null ? ' at step ' + stepText(at) : ''));
        }
        return r;
      }),
      show_docs: tool((p) => {
        toolNavUntil = Date.now() + 1500;
        return callBridge('showDocs', str(p.product_id));
      }),
      fill_fields: tool(async (p) => {
        const values = parseValues(p.values_json);
        if (!values) return { error: 'bad_values_json', detail: 'values_json must be a JSON object of field name to value' };
        const t = target(p);
        toolNavUntil = Date.now() + 1500;
        const r = await callBridge('fill', {
          productId: t.productId, method: t.method, path: t.path, step: t.step,
          values, overwrite: p.overwrite === true || p.overwrite === 'true',
        });
        const n = r && Array.isArray(r.results) ? r.results.filter((x) => x && x.status === 'filled').length : 0;
        if (n) { note(T.filled(n, epLabel(t))); setGuideStep('filled ' + n + ' field(s) on ' + guideLabel(t, r)); }
        return r;
      }),
      highlight_send: tool(async (p) => {
        const t = target(p);
        toolNavUntil = Date.now() + 1500;
        const r = await callBridge('highlightSend', { productId: t.productId, method: t.method, path: t.path, step: t.step });
        if (r && r.ok) setGuideStep('pointed at Send on ' + guideLabel(t, r));
        return r;
      }),
      get_last_response: tool((p) => callBridge('lastResult', rowsOf(p.max_rows))),
      show_code_sample: tool(async (p) => {
        const lang = langOf(p.language);
        if (!lang) return { error: 'unsupported_language', detail: 'use curl, javascript or python' };
        const t = target(p);
        const r = await callBridge('snippet', { productId: t.productId, method: t.method, path: t.path, step: t.step, lang });
        if (!r || typeof r.code !== 'string' || !r.code) return r;
        const code = scrub(r.code);
        addSample(lang, code);
        setGuideStep('showed the ' + LANG_NAMES[lang] + ' sample for ' + guideLabel(t, r));
        return { lang, code, shownInPanel: true };
      }),
    };
  }

  // ---- handshake with the console (no globals) --------------------------
  // Last, so everything above is initialised when the console answers the
  // request synchronously.
  document.addEventListener('iris:console-ready', (ev) => {
    const b = ev && ev.detail;
    if (!b || typeof b !== 'object') return;
    bridge = b;
    hook(b);
    refreshLauncher();
  });
  document.addEventListener('iris:console-unavailable', () => {
    bridge = null;
    setVoiceUi(false);
    endConv();
    refreshLauncher();
  });
  // The console may have announced itself before this deferred script ran, so
  // ask it to repeat. If neither event ever arrives (no access, older console
  // build, script error) the panel simply never shows.
  document.dispatchEvent(new CustomEvent('iris:console-request'));
  window.addEventListener('pagehide', () => { if (conv) endConv(); });
})();
