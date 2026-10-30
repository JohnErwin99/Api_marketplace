// Script of the public API Marketplace page: the website's /api-marketplace embed and the gateway's /public.
// Served by the gateway so the website embed stays under Webflow's 50,000-character limit (2026-10-30).
// The page's small inline loader calls window.iristelMarketplacePublic() on every visit, so it also runs
// again after a swup navigation on the website (swup re-runs inline scripts, but loads a script file once).
window.iristelMarketplacePublic = function () {

const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  themeToggle.querySelector(".theme-label").textContent = isDark ? "Dark" : "Light";
}

applyTheme(document.documentElement.dataset.theme || "light");

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("iristel-api-theme", next); } catch {}
  applyTheme(next);
});

// Built-in copy of the account types (same text as ACCOUNT_TYPES in
// lib/catalogs/bundles.js) so "Choose your path" still renders when the
// catalog can't be loaded.
const FALLBACK_ACCOUNT_TYPES = [
  { id: "business", label: "Business customer", short: "Your business uses Iristel services for itself.",
    description: "Cloud calling, SIP trunks, phone numbers, toll-free, Teams and Webex calling, SMS and 911 for your own organization. Iristel bills you directly.",
    build: ["Order SIP trunks and phone numbers", "Keep your numbers when you move to Iristel", "Keep your 911 addresses up to date"] },
  { id: "partner", label: "Iristel partner", short: "You resell Iristel services to your own customers.",
    description: "Carriers, ISPs, MSPs, VARs, UCaaS providers, white-label and co-branded partners who sell Iristel services and bill their own customers.",
    build: ["Activate subscribers end to end", "Order numbers at scale", "Port your customers onto the network"] },
  { id: "agent", label: "Agent", short: "You sign customers up for Iristel and earn commission.",
    description: "Iristel owns billing and support; you sign customers up in the field and earn commission on their recurring revenue.",
    build: ["Sign customers up from your own tools", "Assign SIMs and eSIMs", "Track your commissions"] },
  { id: "internal", label: "Internal employee", short: "You work at Iristel and need API access for your team.",
    description: "Iristel staff building internal tools, reports or integrations. Use your @iristel.com email and tell us your department — no business registration needed, and internal usage isn't billed.",
    build: ["Automate provisioning and porting tasks", "Build reports on numbers and subscribers", "Integrate Iristel systems with your team's tools"] },
];

// ---- "Choose your path": the account types from the catalog
function renderAccountTypes(reg) {
  const types = reg.accountTypes || [];
  const bundles = reg.bundles || [];
  const products = reg.products || [];
  const buttons = document.getElementById("at-buttons");
  const card = document.getElementById("at-card");
  if (!types.length) { card.innerHTML = "<p>Account types unavailable.</p>"; return; }
  const esc = escHtml;
  const show = (id) => {
    const t = types.find((x) => x.id === id) || types[0];
    buttons.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === t.id);
      b.setAttribute("aria-pressed", b.dataset.type === t.id ? "true" : "false");
    });
    const picks = [
      ...bundles.filter((b) => (t.audiences || []).includes(b.audience)).map((b) => "📦 " + b.name),
      ...products.filter((p) => (t.products || []).includes(p.id)).map((p) => p.name),
    ];
    card.innerHTML =
      `<div class="tag external">${esc(t.label.toUpperCase())}</div>` +
      `<h3>${esc(t.short)}</h3><p>${esc(t.description)}</p>` +
      `<dl><div><dt>What you can build</dt><dd><ul>${(t.build || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></dd></div>` +
      (picks.length ? `<div><dt>Suggested for you</dt><dd><div class="at-bundles">${picks.map((x) => `<span>${esc(x)}</span>`).join("")}</div></dd></div>` : "") +
      `</dl>` + ACCOUNT_TYPE_CTA(t);
  };
  buttons.innerHTML = types.map((t) =>
    `<button type="button" data-type="${esc(t.id)}" aria-pressed="false">${esc(t.label)}</button>`).join("");
  buttons.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => show(b.dataset.type)));
  show(types[0].id);
}
const ACCOUNT_TYPE_CTA = (t) =>
  t.id === "internal"
    ? `<p style="margin-top:18px"><a class="console-cta" href="https://www.iristelpartnerportal.com/">Log in with your Iristel account →</a></p>` +
      `<p style="font-size:.85rem;opacity:.75">Iristel employees already have a portal login — open API Marketplace from the menu to request access.</p>`
    : `<p style="margin-top:18px"><a class="console-cta" href="https://www.iristelpartnerportal.com/sign-up?type=${encodeURIComponent(t.id)}&from=marketplace">Sign up as ${escHtml(t.label)} →</a></p>`;

// ---- Pricing, from the catalog: per-event rate classes, the sandbox and the
// telecom rates, PROPOSED until approved. The static #pricing markup is the
// same render, kept for when the catalog is down.
const centsLabel = (c) => (c < 100 ? c + "¢" : "$" + (c / 100).toFixed(2));
const CLASS_COLOR = { free: "var(--green)", standard: "var(--blue)", advanced: "var(--orange)" };
const CLASS_FOOT = {
  free: "No card needed. Sandbox calls are never billed.",
  standard: "Billed only when the call succeeds. Needs a card on file.",
  advanced: "One request is one event, however many items it carries. Needs a card on file.",
};
function renderPricing(p) {
  const cls = (p && p.classes) || [];
  if (!cls.length) return;
  const $ = (id) => document.getElementById(id);
  $("pr-tags").innerHTML = `<span class="pr-prop">${p.status === "proposed" ? "Proposed rates, subject to approval" : "Rates in CAD"} · taxes extra</span>` +
    `<span>Effective date: ${p.effective ? escHtml(p.effective) : "to be announced"}</span>`;
  const free = ["No subscription or platform fee"].concat(p.sandboxCalls ? [`Developer sandbox: ${Number(p.sandboxCalls).toLocaleString("en-CA")} calls a month per account`] : []);
  $("pr-grid").innerHTML = cls.filter((c) => c.id !== "service").map((c) =>
    `<article class="pr-card" style="--tc:${CLASS_COLOR[c.id] || "var(--blue)"}"><h3>${escHtml(c.name)}</h3>` +
    `<p class="pr-price"><strong>${c.priceCents ? escHtml(centsLabel(c.priceCents)) : "$0"}</strong>${c.priceCents ? "CAD" : ""}</p>` +
    `<p class="pr-unit">${escHtml(c.billingUnit || "")}</p><p>${escHtml(c.whatsIn || "")}</p>` +
    `<ul>${(c.id === "free" ? free : []).concat(c.examples || []).map((x) => `<li>${escHtml(x)}</li>`).join("")}</ul>` +
    (CLASS_FOOT[c.id] ? `<p class="pr-foot">${CLASS_FOOT[c.id]}</p>` : "") + `</article>`).join("");
  const svc = cls.find((c) => c.id === "service");
  $("pr-svc").hidden = !svc;
  if (svc) $("pr-svc").innerHTML = `<strong>${escHtml(svc.name)}</strong><b>${escHtml(svc.billingUnit || "")}</b><span>${escHtml(svc.whatsIn || "")}</span>`;
  if ((p.telecomRates || []).length) $("pr-tel").innerHTML = p.telecomRates.map((r) =>
    `<tr><td>${escHtml(r.service)}</td><td>${escHtml(r.rate)}</td><td>${escHtml(r.note || "")}</td></tr>`).join("");
  if (p.note) $("pr-note").textContent = p.note;
}

// ---- Bundles, from the catalog: one card per bundle, grouped by audience,
// steps folded away; a step that isn't free shows its rate. apiCents = the API
// cost of one run, serviceSteps = steps that order telecom service.
const CATEGORY_ICON = {
  voice: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  numbers: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  partner: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
};
const categoryIcon = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  (CATEGORY_ICON[id] || '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>') + `</svg>`;
const runCost = (b) => (b.apiCents == null ? "" : b.apiCents ? escHtml(centsLabel(b.apiCents)) : "Free");
function renderBundles(reg) {
  const grid = document.getElementById("bundles-grid");
  const bundles = reg.bundles || [];
  const audiences = (reg.audiences || []).filter((a) => bundles.some((b) => b.audience === a.id));
  const catLabel = (id) => ((reg.categories || []).find((c) => c.id === id) || {}).label || "";
  const productName = (id) => ((reg.products || []).find((p) => p.id === id) || { name: id }).name;
  const rateName = Object.fromEntries(((reg.pricing || {}).classes || []).map((c) => [c.id, c.name]));
  const ep = {};   // "product METHOD /path" -> catalog endpoint (rateClass, priceCents)
  (reg.products || []).forEach((p) => (p.endpoints || []).forEach((e) => { ep[p.id + " " + e.method + " " + e.path] = e; }));
  const stepRate = (s) => {
    const e = ep[s.product + " " + s.endpoint];
    const t = !e ? "" : e.rateClass === "service" ? rateName.service || "Service order" : e.priceCents ? (rateName[e.rateClass] || "") + " " + centsLabel(e.priceCents) : "";
    return t ? `<span class="bx-rt">${escHtml(t.trim())}</span>` : "";
  };
  const card = (b) => {
    const steps = b.steps || [];
    return `<article class="bx-card">` +
      `<span class="bx-cat">${categoryIcon(b.category)}${escHtml(catLabel(b.category))}</span>` +
      `<h4>${escHtml(b.name)}</h4><p class="bx-lead">${escHtml(b.useCase || "")}</p>` +
      (b.summary ? `<p class="bx-sum">${escHtml(b.summary)}</p>` : "") +
      (runCost(b) ? `<p class="bx-cost">API cost per run: <strong>${runCost(b)}</strong>${b.serviceSteps ? " + service charges" : ""}</p>` : "") +
      `<ul class="bx-apis" aria-label="APIs used">${[...new Set(steps.map((s) => s.product))]
        .map((id) => `<li>${escHtml(productName(id))}</li>`).join("")}</ul>` +
      (steps.length ? `<details><summary>See the ${steps.length} steps</summary><ol class="bx-steps">` + steps.map((s, i) =>
        `<li><span class="bx-n" aria-hidden="true">${i + 1}</span><div><p>${escHtml(s.note || s.endpoint)}</p>` +
        `<code>${escHtml(s.endpoint)}</code>${stepRate(s)}</div></li>`).join("") + `</ol></details>` : "") +
      `</article>`;
  };
  let active = "";
  const draw = () => {
    const filter = audiences.length > 1
      ? `<div class="segmented bx-filter" role="group" aria-label="Who it’s for">` +
        [{ id: "", label: "All" }, ...audiences].map((a) =>
          `<button type="button" data-aud="${escHtml(a.id)}" class="${a.id === active ? "active" : ""}" aria-pressed="${a.id === active}">` +
          `${escHtml(a.label)}<span class="bx-count">${bundles.filter((b) => !a.id || b.audience === a.id).length}</span></button>`).join("") +
        `</div>`
      : "";
    grid.innerHTML = filter + (audiences.filter((a) => !active || a.id === active).map((a) =>
      `<div class="bx-group">${active ? "" : `<h3 class="bx-aud">${escHtml(a.label)}</h3>`}<div class="bx-grid">` +
      bundles.filter((b) => b.audience === a.id).map(card).join("") + `</div></div>`).join("") || "<p>No bundles published yet.</p>");
    grid.querySelectorAll("[data-aud]").forEach((btn) => btn.addEventListener("click", () => {
      active = btn.dataset.aud;
      draw();
      grid.querySelector(`[data-aud="${active}"]`).focus();   // keep keyboard focus on the filter
    }));
  };
  draw();

  // What one run of each bundle costs in API fees.
  const priced = bundles.filter((b) => runCost(b));
  if (priced.length) document.getElementById("bundle-costs").innerHTML =
    `<h3>What one run costs</h3><table class="mp-rt"><thead><tr><th>Bundle</th><th>API cost per run</th><th>Service orders included</th></tr></thead><tbody>` +
    priced.map((b) => `<tr><td>${escHtml(b.name)}</td><td>${runCost(b)}</td><td>${b.serviceSteps ? escHtml(b.serviceSteps) + " service order" + (b.serviceSteps > 1 ? "s" : "") : "None"}</td></tr>`).join("") +
    `</tbody></table><p class="mp-note">Proposed rates, subject to approval · taxes extra. Service orders add no API fee: the services they order are billed under the tariff.</p>`;
}

// ---- Catalog
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// When this page is copied into Webflow, relative fetches would hit the
// Webflow domain (404) — call the gateway absolutely unless we ARE the gateway.
const GATEWAY = (location.hostname.endsWith("onrender.com") || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "" : "https://api-marketplace-1im9.onrender.com";
(async () => {
  let reg;
  try { reg = await (await fetch(GATEWAY + "/catalog.json")).json(); }
  catch {
    document.getElementById("bundles-grid").innerHTML = "<p>Catalog unavailable — is the gateway running?</p>";
    renderAccountTypes({ accountTypes: FALLBACK_ACCOUNT_TYPES });
    return;
  }
  renderAccountTypes(reg);
  renderBundles(reg);
  renderPricing(reg.pricing);
})();

document.getElementById("copy-code").addEventListener("click", async (event) => {
  // currentTarget is gone once the handler awaits: keep the button.
  const btn = event.currentTarget;
  try {
    await navigator.clipboard.writeText(document.getElementById("auth-code").innerText);
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = "Copy"; }, 1600);
  } catch {
    btn.textContent = "Select text";
  }
});
};
window.iristelMarketplacePublic();
