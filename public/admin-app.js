/**
 * Staff dashboard (/dashboards/api-marketplace, or /admin on the gateway):
 * access, requests, calls, billing, and the security & audit trail.
 *
 * Loaded by public/admin.html. That page is also pasted into a Webflow embed,
 * which is limited to 50,000 characters, so the code lives here. Every call
 * goes to the gateway with the staff session from marketplace-access.js.
 */
(async function(){
  // Served from the gateway AND loaded by the Webflow copy: call the gateway
  // absolutely unless this page is already running on it.
  const GATEWAY = (location.hostname.endsWith('onrender.com') || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '' : 'https://api-marketplace-1im9.onrender.com';
  const $ = s => document.querySelector(s);
  // Also used inside attribute values (data-*, title), so quotes are escaped.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-CA');
  const cad = c => '$' + (Number(c || 0) / 100).toFixed(2);
  const tip = $('#tip');
  const PAGE = 20;                    // feeds open on the newest 20

  // ---- icons and bubbles ---------------------------------------------------
  const ICON = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.5 2.4 3.5 5.2"/>',
    userplus: '<circle cx="10" cy="8" r="4"/><path d="M3 21c0-4 3-6 7-6 1.5 0 3 .3 4 .9M19 14v6M16 17h6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  };
  const svg = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || ICON.spark) + '</svg>';
  const bubble = (tone, inner, title, small) => '<span class="bubble ' + (small ? 'sm ' : '') + 't-' + tone + '"' + (title ? ' title="' + esc(title) + '"' : ' aria-hidden="true"') + '>' + inner + '</span>';
  const pill = (cls, text, title) => '<span class="pill ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>';
  const apiPill = p => '<span class="pill api">' + esc(p) + '</span>';
  const none = '<span class="muted">—</span>';
  // Section headings: fill their icon bubbles.
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = svg(el.dataset.icon); el.setAttribute('aria-hidden', 'true'); });

  // "3 min. ago", with the exact UTC time kept for the title.
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  function ago(iso){
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.round((t - Date.now()) / 1000);
    const a = Math.abs(s);
    if (a < 45) return 'just now';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
    return new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const utc = t => String(t || '').slice(0, 19).replace('T', ' ');
  const timeEl = t => '<time datetime="' + esc(t) + '" title="' + esc(utc(t)) + ' UTC">' + esc(ago(t)) + '</time>';
  const initials = s => (String(s || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();

  // ---- theme -------------------------------------------------------------
  $('#theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('iristel-api-theme', next); } catch {}
    if (last) render(last);           // re-draw charts with the new tokens
  };

  // ---- who is asking -----------------------------------------------------
  const email = (window.MarketplaceAccess && window.MarketplaceAccess.email()) || '';
  const session = (window.MarketplaceAccess && window.MarketplaceAccess.session()) || '';
  const auth = session ? { Authorization: 'Bearer ' + session } : {};
  $('#who').textContent = email || 'not signed in';

  // ---- date range --------------------------------------------------------
  const iso = d => d.toISOString().slice(0, 10);
  function setDays(n){
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - (n - 1));
    $('#from').value = iso(from); $('#to').value = iso(to);
  }
  setDays(30);
  const rangeChips = document.querySelectorAll('.filters .chip');
  rangeChips.forEach(c => c.onclick = () => {
    rangeChips.forEach(o => o.setAttribute('aria-pressed', String(o === c)));
    setDays(+c.dataset.days); load();
  });
  $('#apply').onclick = load;
  $('#product').onchange = load;

  let last = null;

  function query(extra){
    const p = new URLSearchParams({ from: $('#from').value, to: $('#to').value });
    if ($('#product').value) p.set('product', $('#product').value);
    Object.entries(extra || {}).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }

  async function load(){
    try {
      const r = await fetch(GATEWAY + '/marketplace/admin/summary?' + query(), { headers: auth });
      if (r.status === 401 || r.status === 403) {
        const body = await r.json().catch(() => ({}));
        $('#gate').hidden = false; $('#board').hidden = true;
        if (body.message) $('#gate-msg').textContent = body.message +
          (email ? ' (signed in as ' + email + ')' : '');
        return;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      $('#gate').hidden = true; $('#board').hidden = false;
      last = data;
      usageShown = PAGE;              // a new range starts on the newest 20 again
      render(data);
      // The nav's "access requests waiting" row links here; the board is
      // hidden until the first load, so the browser couldn't scroll to it.
      if (location.hash === '#requests' && !load.scrolled) {
        load.scrolled = true;
        $('#requests').scrollIntoView({ block: 'start' });
      }
    } catch (err) {
      $('#gate').hidden = false; $('#board').hidden = true;
      $('#gate-msg').textContent = 'Could not load the dashboard: ' + err.message;
    }
  }

  // ---- charts ------------------------------------------------------------
  // Inline SVG, no libraries. One series per chart, so identity never depends
  // on color; every bar carries its own value label.
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function showTip(ev, html){
    tip.innerHTML = html; tip.style.opacity = '1';
    const pad = 14;
    tip.style.left = Math.min(ev.clientX + pad, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top  = Math.max(ev.clientY - tip.offsetHeight - pad, 8) + 'px';
  }
  const hideTip = () => { tip.style.opacity = '0'; };

  // Line + area over time, with a crosshair on hover.
  function lineChart(el, days, values, color, label){
    const W = 560, H = 190, L = 40, R = 12, T = 12, B = 26;
    const max = Math.max(1, ...values);
    const x = i => L + (values.length <= 1 ? 0 : i * (W - L - R) / (values.length - 1));
    const y = v => T + (H - T - B) * (1 - v / max);
    const pts = values.map((v, i) => x(i) + ',' + y(v));
    const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    const short = d => d.slice(5).replace('-', '/');

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(label) + '">';
    ticks.forEach(t => {
      s += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
           '<text class="axis" x="' + (L - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end" style="font:11px var(--sans);fill:var(--muted)">' + fmt(t) + '</text>';
    });
    s += '<polygon points="' + L + ',' + y(0) + ' ' + pts.join(' ') + ' ' + x(values.length - 1) + ',' + y(0) +
         '" fill="' + color + '" opacity=".13"/>';
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    // last point emphasised
    if (values.length) {
      s += '<circle cx="' + x(values.length - 1) + '" cy="' + y(values[values.length - 1]) +
           '" r="4" fill="' + color + '" stroke="var(--surface-1)" stroke-width="2"/>';
    }
    [0, Math.floor(days.length / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i && v >= 0).forEach(i => {
      s += '<text class="axis" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" style="font:11px var(--sans);fill:var(--muted)">' + esc(short(days[i])) + '</text>';
    });
    // invisible hover columns
    const w = (W - L - R) / Math.max(1, values.length);
    values.forEach((v, i) => {
      s += '<rect x="' + (x(i) - w / 2) + '" y="' + T + '" width="' + w + '" height="' + (H - T - B) +
           '" fill="transparent" data-i="' + i + '"/>';
    });
    s += '</svg>';
    el.innerHTML = s;
    el.querySelectorAll('rect[data-i]').forEach(rect => {
      rect.addEventListener('mousemove', ev => {
        const i = +rect.dataset.i;
        showTip(ev, '<div>' + esc(days[i]) + '</div><b>' + fmt(values[i]) + '</b> ' + esc(label));
      });
      rect.addEventListener('mouseleave', hideTip);
    });
  }

  // Horizontal bars: category on the left, value labelled at the end.
  function barChart(el, rows, color, label){
    if (!rows.length) { el.innerHTML = '<p class="empty">Nothing in this range yet.</p>'; return; }
    const rowH = 30, W = 560, L = 200, R = 56, T = 4;
    const H = T + rows.length * rowH;
    const max = Math.max(1, ...rows.map(r => r.value));
    const bw = v => Math.max(2, (W - L - R) * v / max);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(label) + '">';
    rows.forEach((r, i) => {
      const y = T + i * rowH + 5;
      s += '<text class="catlabel" x="' + (L - 10) + '" y="' + (y + 13) + '" text-anchor="end" style="font:12px var(--sans);fill:var(--ink)">' + esc(r.name) + '</text>';
      // 4px rounded data-end, anchored to the baseline
      s += '<rect x="' + L + '" y="' + y + '" width="' + bw(r.value) + '" height="18" rx="4" fill="' + color + '" data-i="' + i + '"/>';
      s += '<text class="barlabel" x="' + (L + bw(r.value) + 8) + '" y="' + (y + 13) + '" style="font:600 11px var(--sans);fill:var(--ink)">' + fmt(r.value) + '</text>';
    });
    s += '</svg>';
    el.innerHTML = s;
    el.querySelectorAll('rect[data-i]').forEach(rect => {
      rect.addEventListener('mousemove', ev => {
        const r = rows[+rect.dataset.i];
        showTip(ev, '<div>' + esc(r.name) + '</div><b>' + fmt(r.value) + '</b> ' + esc(label) +
          (r.extra ? '<div style="color:var(--muted)">' + esc(r.extra) + '</div>' : ''));
      });
      rect.addEventListener('mouseleave', hideTip);
    });
  }

  function sparkline(values, color){
    if (!values || values.length < 2) return '';
    const W = 130, H = 26, max = Math.max(1, ...values);
    const pts = values.map((v, i) => (i * W / (values.length - 1)) + ',' + (H - (H - 3) * v / max)).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // ---- render ------------------------------------------------------------
  function kpiCard(k, label, spark, color, showDelta, icon, tone){
    const d = showDelta && k.prev !== k.value
      ? '<div class="d ' + (k.change >= 0 ? 'up' : 'down') + '"><b>' + (k.change >= 0 ? '+' : '') + fmt(k.change) +
        '</b> vs previous period</div>'
      : '<div class="d">' + (showDelta ? 'no change vs previous period' : 'current total') + '</div>';
    return '<div class="kpi">' + bubble(tone || 'info', svg(icon)) + '<div class="k">' + esc(label) + '</div><div class="v">' + fmt(k.value) + '</div>' +
      d + (spark ? sparkline(spark, color) : '') + '</div>';
  }

  // Access cards: state of an account, for its pill, edge and the filter.
  const stateOf = g => g.plan && g.plan.pastDue ? 'pastdue' : g.approved ? 'approved'
    : ((g.requested || []).length || (g.bundles || []).length) ? 'waiting' : 'none';
  const STATES = [
    { id: '', name: 'All' }, { id: 'approved', name: 'Approved' }, { id: 'waiting', name: 'Waiting' },
    { id: 'none', name: 'No access' }, { id: 'pastdue', name: 'Past due' },
  ];
  let grantState = '', grantQuery = '', usageShown = PAGE;

  function render(d){
    const c1 = css('--series-1'), c2 = css('--series-2');

    // product filter options (once)
    const sel = $('#product');
    if (sel.options.length <= 1 && d.products) {
      d.products.forEach(p => {
        const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o);
      });
    }

    $('#source-note').innerHTML = (d.sources.crm.available
      ? 'Access data comes from Dynamics 365 and is permanent. '
      : '<b>Dynamics is not configured on this gateway</b> — the access list is empty until the D365 environment variables are set. ') +
      (d.sources.local.durable
        ? 'Requests, usage and billing are stored on the persistent disk (<code>' + esc(d.sources.local.dataDir) + '</code>) and survive redeploys.'
        : '<b>Requests, usage and billing are NOT on a persistent disk</b> (<code>' + esc(d.sources.local.dataDir) + '</code>' +
          (d.sources.local.fromEnv ? ' is not a mounted disk' : ', DATA_DIR is not set') +
          ') — they are wiped on every deploy. Set DATA_DIR on Render to the disk\'s mount path.') +
      (d.sources.crm.error ? ' CRM error: ' + esc(d.sources.crm.error) : '');

    const waiting = d.kpis.pendingRequests && d.kpis.pendingRequests.value > 0;
    $('#kpis').innerHTML =
      kpiCard(d.kpis.approvedAccounts, 'Accounts with access', null, c1, false, 'building', 'info') +
      kpiCard(d.kpis.productsGranted, 'APIs granted', null, c1, false, 'grid', 'info') +
      kpiCard(d.kpis.pendingRequests, 'Requests awaiting review', null, c1, false, 'clock', waiting ? 'warn' : 'ok') +
      kpiCard(d.kpis.requests, 'Requests in range', d.series.requests, c1, true, 'inbox', 'info') +
      kpiCard(d.kpis.calls, 'API calls in range', d.series.calls, c2, true, 'activity', 'ok') +
      kpiCard(d.kpis.activeUsers, 'People calling APIs', null, c2, true, 'users', 'ok');

    $('#req-sub').textContent = d.range.from + ' to ' + d.range.to;
    $('#calls-sub').textContent = d.range.from + ' to ' + d.range.to;
    lineChart($('#chart-requests'), d.series.days, d.series.requests, c1, 'requests');
    lineChart($('#chart-calls'), d.series.days, d.series.calls, c2, 'calls');

    barChart($('#chart-accounts'),
      d.byProduct.filter(p => p.accounts > 0).sort((a, b) => b.accounts - a.accounts)
        .map(p => ({ name: p.name, value: p.accounts })), c1, 'accounts');
    barChart($('#chart-product-calls'),
      d.byProduct.filter(p => p.calls > 0).map(p => ({
        name: p.name, value: p.calls,
        extra: p.errors ? p.errors + ' failed' : 'all succeeded'
      })), c2, 'calls');

    renderGrants(d);
    renderRequests(d);
    renderUsage(d);

    // Downloads go through fetch so the session token rides in a header.
    ['grants', 'requests', 'usage', 'audit'].forEach(view => {
      $('#csv-' + view).onclick = async (ev) => {
        ev.preventDefault();
        const r = await fetch(GATEWAY + '/marketplace/admin/export.csv?' + query(view === 'audit' ? { view, ...auditFilter() } : { view }), { headers: auth });
        if (!r.ok) { alert('Export failed: HTTP ' + r.status); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await r.blob());
        a.download = 'marketplace-' + view + '.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
    });
  }

  // ---- who has access: one card per account ---------------------------------
  function grantCard(g, crmOk){
    const st = stateOf(g), p = g.plan;
    const statePill = { approved: pill('yes dot', 'Approved'), waiting: pill('pending dot', 'Waiting'),
      none: pill('no dot', 'No access'), pastdue: pill('err dot', 'Past due') }[st];
    const tone = { approved: 'ok', waiting: 'warn', none: 'muted', pastdue: 'err' }[st];
    const reg = g.businessRegNumber ? pill('', 'Reg # ' + g.businessRegNumber)
      : g.department ? pill('', g.department + ' (dept.)') : '';
    const regCheck = g.regCheck ? pill(/^verified/.test(g.regCheck) ? 'yes' : /^invalid/.test(g.regCheck) ? 'no' : 'pending', g.regCheck.split(' · ')[0], g.regCheck) : '';
    const asked = (g.requested || []).filter(x => !g.products.includes(x));
    // Sandbox: the account's calls / limit (+ext: extended); Grant if approved.
    const used = p ? Number(p.sandboxCalls || 0) : 0, limit = p && p.sandboxLimit ? Number(p.sandboxLimit) : 0;
    const pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
    const sandbox = !p ? none
      : '<div class="v">' + esc(fmt(used)) + (limit ? ' <span class="muted" style="font-weight:500">/ ' + esc(fmt(limit)) + '</span>' : '') +
        (p.sandboxExtra > 0 ? ' ' + pill('pending', '+ext', 'Includes an extension of ' + fmt(p.sandboxExtra) + ' calls') : '') + '</div>' +
        (limit ? '<div class="meter' + (pct >= 100 ? ' full' : pct >= 80 ? ' hot' : '') + '" title="' + pct + '% of this month\'s sandbox calls"><i style="width:' + pct + '%"></i></div>' : '');
    const cardPill = !p ? none : p.pastDue ? pill('err', 'past due') : p.cardOnFile ? pill('yes', 'on file') : pill('no', 'none');
    // BroadWorks: the one enterprise this account's users reach through the
    // BroadWorks API (empty unlinks). Shown when the account holds or asked
    // for that product, or is already linked.
    const showBw = g.products.concat(g.requested || []).includes('broadworks') || g.broadworksEnterprise;
    return '<article class="acct ' + st + '" data-state="' + st + '">' +
      '<div class="ahead">' + bubble(tone, esc(initials(g.organization))) +
        '<div class="id"><b>' + esc(g.organization || '(no name)') + '</b><span class="muted">' + esc(g.email || '—') + '</span></div>' + statePill + '</div>' +
      ((g.accountType || reg || regCheck) ? '<div class="pills">' + (g.accountType ? pill('info', g.accountType) : '') + reg + regCheck + '</div>' : '') +
      ((g.bundles || []).length ? '<div class="field"><span class="lbl">Bundles</span><div class="pills">' +
        g.bundles.map(b => pill('staff', b.name, b.apis.length ? b.apis.join(', ') : '')).join('') + '</div></div>' : '') +
      '<div class="field"><span class="lbl">APIs granted</span><div class="pills">' + (g.products.length ? g.products.map(apiPill).join('') : none) + '</div></div>' +
      (asked.length ? '<div class="field"><span class="lbl">Asked for</span><div class="pills">' + asked.map(x => pill('pending', x)).join('') + '</div></div>' : '') +
      '<div class="stats">' +
        '<div class="stat"><div class="lbl">Card</div><div style="margin-top:3px">' + cardPill + '</div></div>' +
        '<div class="stat"><div class="lbl">This month</div><div class="v">' + (p ? esc(cad(p.cents)) : none) + '</div>' +
          (p ? '<div class="s">' + esc(fmt(p.standardEvents)) + ' Std · ' + esc(fmt(p.advancedEvents)) + ' Adv</div>' : '') + '</div>' +
        '<div class="stat" title="Sandbox calls this month, shared by the account"><div class="lbl">Sandbox</div>' + sandbox + '</div>' +
      '</div>' +
      (p && g.approved ? '<div class="field"><span class="lbl">Extra sandbox calls this month</span><form class="bw sx" data-account="' + esc(g.accountId) + '">' +
        '<input name="sx" type="number" min="1" max="100000" step="1" required placeholder="+calls" aria-label="Extra sandbox calls for ' + esc(g.organization) + '">' +
        '<button type="submit" class="ctl">Grant</button></form><span class="ctl-err"></span></div>' : '') +
      (showBw ? '<div class="field"><span class="lbl">BroadWorks enterprise</span><form class="bw bwlink" data-account="' + esc(g.accountId) + '"><input name="bw" value="' + esc(g.broadworksEnterprise || '') +
        '" placeholder="not linked" aria-label="BroadWorks enterprise for ' + esc(g.organization) + '">' +
        '<button type="submit" class="ctl">Save</button></form><span class="ctl-err"></span></div>' : '') +
      '<div class="afoot"><span class="muted">' + (g.application ? 'App: ' + esc(g.application) : 'No application name') + '</span>' +
        (crmOk
          ? '<button type="button" class="ctl ' + (g.approved ? 'revoke' : 'approve') + '" data-account="' + esc(g.accountId) + '" data-next="' + (!g.approved) + '">' +
            (g.approved ? 'Revoke' : 'Approve') + '</button>'
          : '<span class="muted" style="font-size:11px;flex:none">CRM offline</span>') +
        '<span class="ctl-err" style="flex-basis:100%"></span></div>' +
      '</article>';
  }

  function renderGrants(d){
    const crmOk = d.sources.crm.available;
    const counts = {};
    d.grants.forEach(g => { const s = stateOf(g); counts[s] = (counts[s] || 0) + 1; });
    $('#grants-seg').innerHTML = STATES.map(s => '<button type="button" data-state="' + s.id + '" aria-pressed="' + (s.id === grantState) + '">' +
      esc(s.name) + '<span class="n">' + fmt(s.id ? counts[s.id] || 0 : d.grants.length) + '</span></button>').join('');
    const q = grantQuery.trim().toLowerCase();
    const shown = d.grants.filter(g => (!grantState || stateOf(g) === grantState) &&
      (!q || (String(g.organization) + ' ' + String(g.email)).toLowerCase().includes(q)));
    $('#grants-count').textContent = shown.length === d.grants.length ? fmt(d.grants.length) + ' accounts' : fmt(shown.length) + ' of ' + fmt(d.grants.length);
    $('#grants').innerHTML = shown.length ? shown.map(g => grantCard(g, crmOk)).join('')
      : '<p class="empty">' + (d.grants.length ? 'No accounts match.' : 'No accounts have been through the marketplace flow yet.') + '</p>';
    wireGrants();
  }
  $('#grants-seg').onclick = ev => {
    const b = ev.target.closest('button[data-state]');
    if (!b || !last) return;
    grantState = b.dataset.state; renderGrants(last);
  };
  $('#grants-q').oninput = ev => { grantQuery = ev.target.value; if (last) renderGrants(last); };

  // The controls inside the access cards; each reports errors in its own .field.
  const errFor = el => el.closest('.field, .afoot').querySelector('.ctl-err');
  function wireGrants(){
    const box = $('#grants');
    // Approve / Revoke flips the CRM approved switch.
    box.querySelectorAll('[data-next]').forEach(btn => {
      btn.onclick = async () => {
        const approve = btn.dataset.next === 'true';
        if (!approve && !confirm('Revoke marketplace access for this account? Their console closes on their next visit.')) return;
        btn.disabled = true; const label = btn.textContent; btn.textContent = 'Saving…';
        try {
          const r = await fetch(GATEWAY + '/marketplace/admin/access', {
            method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: btn.dataset.account, approved: approve })
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
          await load();                       // pill, KPIs and charts move together
        } catch (err) {
          btn.disabled = false; btn.textContent = label;
          const e = errFor(btn); if (e) e.textContent = err.message;
        }
      };
    });
    // BroadWorks link: same route, { accountId, broadworksEnterprise }.
    box.querySelectorAll('form.bwlink').forEach(f => {
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const inp = f.elements.bw, v = inp.value.trim(), btn = f.querySelector('button');
        const e = errFor(f);
        if (!v && inp.defaultValue && !confirm('Unlink this account from BroadWorks enterprise ' + inp.defaultValue + '?')) return;
        if (e) e.textContent = '';
        btn.disabled = true;
        try {
          const r = await fetch(GATEWAY + '/marketplace/admin/access', {
            method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: f.dataset.account, broadworksEnterprise: v })
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
          await load();                       // shows the saved link
          if (body.warning) {                 // e.g. the enterprise is linked to another account too
            const nf = [...$('#grants').querySelectorAll('form.bwlink')].find(x => x.dataset.account === f.dataset.account);
            const ne = nf && errFor(nf);
            if (ne) ne.textContent = body.warning;
          }
        } catch (err) {
          btn.disabled = false;
          if (e) e.textContent = err.message;
        }
      };
    });
    // Sandbox extension for this month, then reload.
    box.querySelectorAll('form.sx').forEach(f => {
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const n = Number(f.elements.sx.value), btn = f.querySelector('button'), e = errFor(f);
        e.textContent = '';
        if (!Number.isInteger(n) || n < 1 || n > 100000) { e.textContent = 'Enter 1 to 100,000 calls'; return; }
        if (!confirm('Grant ' + fmt(n) + ' extra sandbox calls this month? A grant can\'t be taken back.')) return;
        btn.disabled = true;
        try {
          const r = await fetch(GATEWAY + '/marketplace/admin/sandbox-extension', {
            method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: f.dataset.account, extraCalls: n })
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
          await load();
        } catch (err) { btn.disabled = false; e.textContent = err.message; }
      };
    });
  }

  // ---- access requests -------------------------------------------------------
  function renderRequests(d){
    const waitingN = d.requests.filter(r => r.status === 'pending-review').length;
    $('#requests-count').textContent = d.requests.length ? fmt(d.requests.length) + ' in range' + (waitingN ? ' · ' + fmt(waitingN) + ' waiting' : '') : '';
    $('#t-requests').innerHTML = d.requests.length
      ? d.requests.map(r => {
          const wait = r.status === 'pending-review';
          return '<article class="req' + (wait ? ' waiting' : '') + '">' +
            '<div class="ahead">' + bubble(wait ? 'warn' : 'ok', svg(wait ? 'clock' : 'check')) +
              '<div class="id"><b>' + esc(r.organization || '(no name)') + '</b><span class="muted">' + esc(r.email) + '</span></div>' +
              pill(wait ? 'pending dot' : 'yes dot', wait ? 'Waiting' : r.status === 'approved' ? 'Approved' : r.status) + '</div>' +
            '<div class="pills">' + (r.accountType ? pill('info', r.accountType) : '') +
              (r.bundles || []).map(b => pill('staff', b.name)).join('') +
              (r.other ? pill('', 'Other: ' + r.other) : '') + '</div>' +
            '<div class="field"><span class="lbl">APIs</span><div class="pills">' + ((r.products || []).length ? r.products.map(apiPill).join('') : none) + '</div></div>' +
            ((r.reasons || []).length ? '<div class="muted" style="font-size:12px">' + esc(r.reasons.join('; ')) + '</div>' : '') +
            '<div class="afoot"><span class="muted">' + (r.applicationName ? 'App: ' + esc(r.applicationName) : 'No application name') + '</span>' + timeEl(r.receivedAt) + '</div>' +
          '</article>';
        }).join('')
      : '<p class="empty">No access requests in this range.</p>';
  }

  // ---- recent API calls: a feed, newest 20 first -----------------------------
  const statusTone = s => s == null ? 'muted' : s >= 200 && s < 300 ? 'ok' : s >= 500 ? 'err' : 'warn';
  function renderUsage(d){
    const rows = d.usage, shown = rows.slice(0, usageShown);
    $('#t-usage').innerHTML = shown.length
      ? shown.map(u => '<li>' + bubble(statusTone(u.status), u.status == null ? '—' : esc(u.status), 'HTTP ' + (u.status == null ? 'no answer' : u.status)) +
          '<div class="body"><div class="l1"><span class="pill method">' + esc(u.method || '?') + '</span><span class="ep">' + esc(u.endpoint || '') + '</span></div>' +
          '<div class="l2">' + (u.product ? apiPill(u.product) : '') +
            (u.mode === 'sandbox' ? pill('staff', 'sandbox') : '') +
            (u.billable ? pill('yes', (u.rateClass || 'billed') + ' ' + (u.priceCents || 0) + '¢') : '') +
            '<span>' + esc(u.email || '—') + '</span>' +
            (u.ip ? '<span class="pill ip" title="' + esc(u.userAgent || '') + '">' + esc(u.ip) + '</span>' : '') +
            (u.ms == null ? '' : '<span>' + esc(fmt(u.ms)) + ' ms</span>') + '</div></div>' +
          timeEl(u.at) + '</li>').join('')
      : '<li class="empty" style="border:0">No API calls recorded in this range. Every call through the gateway is counted, from the console or a partner\'s own app.</li>';
    // The summary carries the newest 500 calls in range; Export CSV has them all.
    const total = d.kpis.calls ? d.kpis.calls.value : rows.length;
    $('#usage-more').innerHTML = rows.length
      ? '<span>Showing ' + fmt(shown.length) + ' of ' + (total > rows.length ? 'the ' + fmt(rows.length) + ' newest · ' + fmt(total) + ' calls in range (Export CSV has them all)' : fmt(rows.length)) + '</span>' +
        (shown.length < rows.length ? '<button type="button" class="ctl" id="usage-next">Show ' + Math.min(PAGE, rows.length - shown.length) + ' more</button>' : '')
      : '';
    const next = $('#usage-next');
    if (next) next.onclick = () => { usageShown += PAGE; renderUsage(last); };
  }

  load();

  // ---- security & audit ----------------------------------------------------
  const OUTCOME_PILL = { ok: 'yes', denied: 'err', locked: 'err', rejected: 'err', error: 'err', partial: 'pending', declined: 'pending', unlocked: 'yes', skipped: 'no' };
  // Event families: label for the filter pills, tone and icon for the bubble.
  const FAMILY = {
    login: ['Logins', 'info', 'user'], session: ['Sessions', 'info', 'user'], signup: ['Sign-ups', 'ok', 'userplus'],
    apikey: ['API keys', 'info', 'key'], admin: ['Staff actions', 'staff', 'shield'], billing: ['Billing', 'ok', 'card'],
    access: ['Access requests', 'warn', 'inbox'], account: ['Accounts', 'ok', 'unlock'], password: ['Passwords', 'warn', 'key'],
    iris: ['Iris', 'info', 'spark'],
  };
  // Pill order: the families staff look at most come first.
  const FAM_ORDER = ['login', 'signup', 'apikey', 'admin', 'billing', 'access', 'session', 'account', 'password', 'iris'];
  const famOf = ev => String(ev || '').split('.')[0];
  const failed = a => ['denied', 'locked', 'rejected', 'error'].includes(a.outcome) || /fail|locked|rate_limited|blocked/.test(a.event);
  function eventBubble(a){
    if (failed(a)) return bubble('err', svg(/lock/.test(a.event) || a.outcome === 'locked' ? 'lock' : /rate_limited/.test(a.event) ? 'timer' : 'alert'), a.event);
    const f = FAMILY[famOf(a.event)];
    return bubble(f ? f[1] : 'muted', svg(f ? f[2] : 'spark'), a.event);
  }
  const auditFilter = () => {
    const f = Object.fromEntries(new FormData($('#audit-filter')).entries());
    Object.keys(f).forEach(k => { if (!f[k]) delete f[k]; });
    return f;
  };
  let auditRows = [], auditTotal = 0;
  const auditRow = a => '<li>' + eventBubble(a) +
    '<div class="body"><div class="l1"><b>' + esc(a.event) + '</b>' +
      (a.outcome ? pill(OUTCOME_PILL[a.outcome] || 'pending', a.outcome) : '') + '</div>' +
    '<div class="l2"><span>' + esc(a.email || '—') + '</span>' +
      (a.ip ? '<span class="pill ip" title="' + esc(a.user_agent || '') + '">' + esc(a.ip) + '</span>' : '') + '</div>' +
    (a.detail ? '<div class="detail">' + esc(a.detail) + '</div>' : '') + '</div>' +
    timeEl(a.at) + '</li>';
  function renderAuditRows(){
    $('#t-audit').innerHTML = auditRows.length ? auditRows.map(auditRow).join('')
      : '<li class="empty" style="border:0">No events match in this range.</li>';
    $('#audit-more').innerHTML = auditRows.length
      ? '<span>Showing ' + fmt(auditRows.length) + ' of ' + fmt(auditTotal) + '</span>' +
        (auditRows.length < auditTotal ? '<button type="button" class="ctl" id="audit-next">Show ' + Math.min(PAGE, auditTotal - auditRows.length) + ' more</button>' : '')
      : '';
    const next = $('#audit-next');
    if (next) next.onclick = () => loadAudit(true);
  }
  // Event-family pills; the select keeps exact events (and the families).
  function renderAuditSeg(events){
    const sel = $('#audit-event');
    const rank = f => { const i = FAM_ORDER.indexOf(f); return i < 0 ? FAM_ORDER.length : i; };
    const fams = [...new Set(events.map(famOf))].filter(Boolean).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    fams.forEach(f => {
      if (![...sel.options].some(o => o.value === f + '.')) {
        const o = document.createElement('option'); o.value = f + '.'; o.textContent = (FAMILY[f] ? FAMILY[f][0] : f) + ' (all)';
        sel.insertBefore(o, sel.options[1] || null);
      }
    });
    events.forEach(ev => {
      if (![...sel.options].some(o => o.value === ev)) {
        const o = document.createElement('option'); o.value = ev; o.textContent = ev; sel.appendChild(o);
      }
    });
    const cur = sel.value;
    $('#audit-seg').innerHTML = [''].concat(fams.slice(0, 5)).map(f => {
      const v = f ? f + '.' : '';
      return '<button type="button" data-event="' + esc(v) + '" aria-pressed="' + (cur === v) + '">' + esc(f ? (FAMILY[f] ? FAMILY[f][0] : f) : 'All') + '</button>';
    }).join('');
  }
  $('#audit-seg').onclick = ev => {
    const b = ev.target.closest('button[data-event]');
    if (!b) return;
    $('#audit-event').value = b.dataset.event;
    loadAudit();
  };
  $('#audit-event').onchange = () => loadAudit();

  // more: append the next 20 of the same filter; otherwise start again.
  async function loadAudit(more){
    const offset = more ? auditRows.length : 0;
    const [ra, rl] = await Promise.all([
      fetch(GATEWAY + '/marketplace/admin/audit?' + query({ ...auditFilter(), limit: PAGE, offset }), { headers: auth }),
      more ? null : fetch(GATEWAY + '/marketplace/admin/locked', { headers: auth }),
    ]);
    if (!ra.ok || (rl && !rl.ok)) { if (!more) $('#audit-card').hidden = true; return; }
    const d = await ra.json();
    auditRows = more ? auditRows.concat(d.rows) : d.rows;
    // Older gateways send no total: then "more" is offered while pages come back full.
    auditTotal = typeof d.total === 'number' ? d.total : auditRows.length + (d.rows.length === PAGE ? PAGE : 0);
    renderAuditSeg(d.events || []);
    renderAuditRows();
    if (more) return;
    const locked = (await rl.json()).rows;
    const k = d.kpis;
    const tile = (label, v, note, icon, hot) => '<div class="kpi">' + bubble(v > 0 ? hot : 'ok', svg(icon)) +
      '<div class="k">' + esc(label) + '</div><div class="v">' + fmt(v) + '</div><div class="d">' + esc(note) + '</div></div>';
    $('#audit-kpis').innerHTML =
      tile('Sign-ins', k.logins24h, 'last 24 hours', 'user', 'info') + tile('Wrong passwords', k.failed24h, 'last 24 hours', 'alert', 'warn') +
      tile('Locked now', k.lockedNow, 'auto-unlock after 30 min', 'lock', 'err') + tile('Sign-ups', k.signups24h, 'last 24 hours', 'userplus', 'info') +
      tile('Rate-limited', k.rateLimited24h, 'last 24 hours', 'timer', 'warn');
    $('#t-locked').innerHTML = locked.length
      ? '<div class="minis">' + locked.map(x => '<div class="mini">' + bubble('err', svg('lock')) +
          '<div class="id"><b>' + esc(x.email) + '</b><span class="pills" style="margin-top:4px">' + pill('err', fmt(x.failures) + ' wrong') +
          (x.lastIp ? '<span class="pill ip">' + esc(x.lastIp) + '</span>' : '') + '</span>' +
          '<span class="muted" title="' + esc(utc(x.lockedUntil)) + ' UTC">until ' + esc(utc(x.lockedUntil).slice(11, 16)) + ' UTC</span></div>' +
          '<button type="button" class="ctl approve" data-unlock="' + esc(x.email) + '">Unlock</button></div>').join('') + '</div>'
      : '<p style="margin:0 0 16px">' + pill('yes dot', 'No accounts are locked') + '</p>';
  }
  $('#t-locked').onclick = async (ev) => {
    const btn = ev.target.closest('[data-unlock]');
    if (!btn) return;
    if (!confirm('Unlock ' + btn.dataset.unlock + ' now?')) return;
    btn.disabled = true;
    const r = await fetch(GATEWAY + '/marketplace/admin/unlock', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: btn.dataset.unlock }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'HTTP ' + r.status); }
    loadAudit();
  };
  $('#audit-filter').onsubmit = (ev) => { ev.preventDefault(); loadAudit(); };
  $('#apply').addEventListener('click', () => loadAudit());
  rangeChips.forEach(c => c.addEventListener('click', () => loadAudit()));
  loadAudit();

  // ---- billing ------------------------------------------------------------
  const billMonth = $('#bill-month');
  billMonth.value = new Date().toISOString().slice(0, 7);
  const STATUS_PILL = { paid: 'yes', declined: 'pending', unknown: 'pending', pending: 'pending', no_card: 'no', no_account: 'no' };
  async function loadBilling(){
    const r = await fetch(GATEWAY + '/marketplace/admin/billing?month=' + encodeURIComponent(billMonth.value), { headers: auth });
    if (!r.ok) { $('#billing-card').hidden = true; return; }
    const d = await r.json();
    $('#bill-note').textContent = 'Billed for ' + d.month + ': ' + cad(d.totalCents) + ' CAD before tax — successful live Standard and Advanced events at the proposed per-event rates. Free reads, service orders and sandbox calls are never billed. ' +
      'Invoices go out automatically on the 1st and are charged on the 5th (both buttons do it now). Only emailed invoices are charged, tax included. ' +
      'Running charges again retries declined ones but never repeats a paid or unknown one — for unknown, check the payment in MIND, then Retry or Mark paid.';
    // Months billed per call (before rate classes): keep that column for them.
    const perCall = d.rows.some(x => x.billableCalls > (x.standardEvents || 0) + (x.advancedEvents || 0));
    $('#t-billing').innerHTML = d.rows.length
      ? '<thead><tr><th>Partner</th><th>MIND account</th><th class="num">Calls</th><th class="num">Standard events</th><th class="num">Advanced events</th><th class="num">Sandbox calls</th>' + (perCall ? '<th class="num">Billed calls</th>' : '') +
        '<th class="num">Amount</th><th>Invoice</th><th>Card</th><th>Charge</th></tr></thead><tbody>' +
        d.rows.map(x => '<tr><td>' + esc(x.email) + (x.pastDue ? ' <span class="pill err">past due</span>' : '') + '</td>' +
          '<td>' + (x.mindAccount ? '<code>' + esc(x.mindAccount) + '</code>' : '<span style="color:var(--muted)">not linked</span>') + '</td>' +
          '<td class="num">' + fmt(x.calls) + '</td><td class="num">' + esc(fmt(x.standardEvents)) + '</td><td class="num">' + esc(fmt(x.advancedEvents)) + '</td><td class="num">' + esc(fmt(x.sandboxCalls)) + '</td>' + (perCall ? '<td class="num">' + fmt(x.billableCalls) + '</td>' : '') + '<td class="num">' + cad(x.cents) + '</td>' +
          '<td>' + (x.invoice
            ? '<code>' + esc(x.invoice.number) + '</code> ' + cad(x.invoice.cents) + (x.invoice.sent ? '' : ' <span class="pill pending">not sent</span>') +
              (x.invoice.taxReview ? ' <span class="pill pending" title="No province on file: GST only">check tax</span>' : '') +
              ' <button type="button" class="ctl" data-inv="' + esc(x.invoice.number) + '">View</button>'
            : '<button type="button" class="ctl" data-preview="' + esc(x.email) + '">Preview</button>') + '</td>' +
          '<td>' + (x.card ? '<code>' + esc(x.card) + '</code>' : '<span style="color:var(--muted)">none</span>') + '</td>' +
          '<td>' + (x.charge ? '<span class="pill ' + (STATUS_PILL[x.charge.status] || 'no') + '">' + esc(x.charge.status.replace('_', ' ')) + '</span> ' + cad(x.charge.cents) +
            (['declined', 'unknown'].includes(x.charge.status) ? ' <button type="button" class="ctl approve" data-bill="retry" data-email="' + esc(x.email) + '">Retry</button>' : '') +
            (x.charge.status === 'unknown' ? ' <button type="button" class="ctl" data-bill="mark-paid" data-email="' + esc(x.email) + '">Mark paid</button>' : '')
            : '<span style="color:var(--muted)">—</span>') + '</td></tr>').join('') + '</tbody>'
      : '<tbody><tr><td class="empty">No usage recorded for this month.</td></tr></tbody>';
  }
  // Invoices are served as HTML behind the staff session: fetch, then open.
  async function openHtml(url){
    const w = window.open('', '_blank');
    const r = await fetch(url, { headers: auth });
    const html = await r.text();
    if (!r.ok) { if (w) w.close(); alert(html || 'HTTP ' + r.status); return; }
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  }
  $('#t-billing').onclick = async (ev) => {
    const inv = ev.target.closest('[data-inv]'), pre = ev.target.closest('[data-preview]');
    if (inv) return openHtml(GATEWAY + '/marketplace/invoices/' + encodeURIComponent(inv.dataset.inv));
    if (pre) return openHtml(GATEWAY + '/marketplace/admin/invoices/preview?email=' + encodeURIComponent(pre.dataset.preview) + '&month=' + encodeURIComponent(billMonth.value));
    const btn = ev.target.closest('[data-bill]');
    if (!btn) return;
    const action = btn.dataset.bill, email = btn.dataset.email, m = billMonth.value;
    const ask = action === 'mark-paid'
      ? 'Mark ' + email + '\'s ' + m + ' charge as paid? Only do this after confirming the payment in MIND.'
      : 'Charge ' + email + ' for ' + m + ' again? For an unknown charge, first confirm in MIND that the earlier attempt did not go through.';
    if (!confirm(ask)) return;
    btn.disabled = true;
    try {
      const r = await fetch(GATEWAY + '/marketplace/admin/billing/' + action, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, month: m }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      if (action === 'retry') alert('Result: ' + d.status);
    } catch (err) { alert(err.message); }
    loadBilling();
  };
  billMonth.onchange = loadBilling;
  $('#bill-run').onclick = async () => {
    const m = billMonth.value;
    if (!confirm('Charge every emailed ' + m + ' invoice now? Paid charges are never repeated.')) return;
    const btn = $('#bill-run'); btn.disabled = true; btn.textContent = 'Charging…';
    try {
      const r = await fetch(GATEWAY + '/marketplace/admin/billing/run', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      const errs = (d.results || []).filter(x => x.status === 'error');
      const noInv = (d.results || []).filter(x => x.status === 'no_invoice');
      alert((d.results || []).length - noInv.length + ' invoice(s) processed.' +
        (noInv.length ? '\n' + noInv.length + ' partner(s) have no emailed invoice yet — send invoices first.' : '') +
        (errs.length ? '\n' + errs.map(x => x.email + ': ' + x.error).join('\n') : ''));
    } catch (err) { alert('Charge run failed: ' + err.message); }
    btn.disabled = false; btn.textContent = 'Run charges';
    loadBilling();
  };
  $('#bill-invoices').onclick = async () => {
    const m = billMonth.value;
    if (!confirm('Issue and email the ' + m + ' invoices now? Partners already invoiced for ' + m + ' are not emailed again.')) return;
    const btn = $('#bill-invoices'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await fetch(GATEWAY + '/marketplace/admin/billing/invoices', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      const sent = (d.results || []).filter(x => x.status === 'sent').length;
      const errs = (d.results || []).filter(x => x.status === 'error');
      alert(sent + ' invoice(s) emailed.' + (errs.length ? '\n' + errs.map(x => x.email + ': ' + x.error).join('\n') : ''));
    } catch (err) { alert('Sending invoices failed: ' + err.message); }
    btn.disabled = false; btn.textContent = 'Send invoices';
    loadBilling();
  };
  $('#bill-account').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target).entries());
    const r = await fetch(GATEWAY + '/marketplace/admin/billing/account', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    $('#bill-account-msg').textContent = r.ok ? 'Saved.' : (d.error || 'HTTP ' + r.status);
    if (r.ok) { ev.target.reset(); loadBilling(); }
  };
  loadBilling();
})();
