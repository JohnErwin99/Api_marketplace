// API Marketplace page script (public/index.html and its Webflow copy on
// /api-marketplace). Served by the gateway at /marketplace-page.js so the
// Webflow embed stays under its 50,000-character limit. Loaded at the end of
// the page body, after the markup it drives.
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
  {
    "id": "business",
    "label": "Business customer",
    "short": "Your business uses Iristel services for itself.",
    "description": "Cloud calling, SIP trunks, phone numbers, toll-free, Teams and Webex calling, SMS and 911 for your own organization. Iristel bills you directly.",
    "build": [
      "Order SIP trunks and phone numbers",
      "Keep your numbers when you move to Iristel",
      "Keep your 911 addresses up to date"
    ],
    "audiences": [
      "enterprise"
    ],
    "products": []
  },
  {
    "id": "partner",
    "label": "Iristel partner",
    "short": "You resell Iristel services to your own customers.",
    "description": "Carriers, ISPs, MSPs, VARs, UCaaS providers, white-label and co-branded partners who sell Iristel services and bill their own customers.",
    "build": [
      "Activate subscribers end to end",
      "Order numbers at scale",
      "Port your customers onto the network"
    ],
    "audiences": [
      "resellers",
      "carriers"
    ],
    "products": []
  },
  {
    "id": "agent",
    "label": "Agent",
    "short": "You sign customers up for Iristel and earn commission.",
    "description": "Iristel owns billing and support; you sign customers up in the field and earn commission on their recurring revenue.",
    "build": [
      "Sign customers up from your own tools",
      "Assign SIMs and eSIMs",
      "Track your commissions"
    ],
    "audiences": [
      "agents"
    ],
    "products": []
  },
  {
    "id": "internal",
    "label": "Internal employee",
    "short": "You work at Iristel and need API access for your team.",
    "description": "Iristel staff building internal tools, reports or integrations. Use your @iristel.com email and tell us your department — no business registration needed, and internal usage isn't billed.",
    "build": [
      "Automate provisioning and porting tasks",
      "Build reports on numbers and subscribers",
      "Integrate Iristel systems with your team's tools"
    ],
    "audiences": [],
    "products": []
  }
];

// ---- "Choose your path": the five account types from the catalog --------
function renderAccountTypes(reg) {
const types = reg.accountTypes || [];
const bundles = reg.bundles || [];
const products = reg.products || [];
const buttons = document.getElementById("at-buttons");
const card = document.getElementById("at-card");
if (!types.length) { card.innerHTML = "<p>Account types unavailable.</p>"; return; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
`<p style="margin-top:18px"><a class="console-cta" href="#request-form" data-request-as="${t.id}">Request access as ${t.label} →</a></p>`;
document.addEventListener("click", (ev) => {
const a = ev.target.closest("[data-request-as]");
if (!a) return;
const sel = document.querySelector('#access-form select[name="accountType"]');
// Bubbles, so the form's own change listener redraws the price summary too.
if (sel) { sel.value = a.dataset.requestAs; sel.dispatchEvent(new Event("change", { bubbles: true })); }
});

// ---- Console links only for partners logged into the portal --------------
// The portal sets `userEmail` (and `marketplaceAccess`) at login; both cookies
// are readable here because the portal and marketplace share the domain.
(function () {
const loggedIn = !!(window.MarketplaceAccess && window.MarketplaceAccess.email());
document.querySelectorAll("[data-auth-only]").forEach((el) => { el.hidden = !loggedIn; });
document.querySelectorAll("[data-guest-only]").forEach((el) => { el.hidden = loggedIn; });
})();

// ---- Prefill from the portal login ---------------------------------------
// Logged-in partners get their portal email prefilled and the existing-
// customer box ticked; editing the email shows an informational hint.
(function () {
const portalEmail = window.MarketplaceAccess && window.MarketplaceAccess.email();
if (!portalEmail) return;
const form = document.getElementById("access-form");
const emailInput = form.querySelector('input[name="email"]');
const hint = document.getElementById("email-hint");
emailInput.value = portalEmail;
form.querySelector('input[name="existingCustomer"]').checked = true;
emailInput.addEventListener("input", () => {
  const differs = emailInput.value.trim().toLowerCase() !== portalEmail.toLowerCase();
  hint.style.display = differs ? "block" : "none";
  hint.textContent = differs ? "Differs from your portal login (" + portalEmail + ") — approval will attach to the email entered here." : "";
});
})();

// ---- Bundles section + access-request form (data-driven from the catalog)
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// When this page is copied into Webflow, relative fetches would hit the
// Webflow domain (404) — call the gateway absolutely unless we ARE the gateway.
const GATEWAY = (location.hostname.endsWith("onrender.com") || location.hostname === "localhost" || location.hostname === "127.0.0.1")
? "" : "https://api-marketplace-1im9.onrender.com";

// ---- Request status for logged-in partners ---------------------------------
// Pending: say so and fold the form away (it stays one click away for a
// second request). Approved: point at the console.
window.__showRequestStatus = function (a) {
const box = document.getElementById("req-status");
const form = document.getElementById("access-form");
if (!box || !a) return;
const reopen = () => { form.hidden = false; form.scrollIntoView({ behavior: "smooth" }); };
const when = a.requestedAt ? new Date(a.requestedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : "";
if (a.status === "pending") {
  box.innerHTML = `<strong>Your request is under review${a.id ? " (" + escHtml(a.id) + ")" : ""}</strong>` +
    `Submitted${when ? " " + escHtml(when) : ""}. We'll email you as soon as it's approved — the API Console then appears in your portal menu. ` +
    `<button type="button" id="req-again">Submit another request</button>`;
  form.hidden = true;
  box.querySelector("#req-again").onclick = reopen;
} else if (a.status === "approved") {
  box.innerHTML = `<strong>You have API access</strong>${a.isInternal ? "Internal usage isn't billed. " : ""}Open the API console to get your key and start calling. ` +
    `<a href="/console">Open the API console →</a> · <button type="button" id="req-again">Request more APIs</button>`;
  form.hidden = true;
  box.querySelector("#req-again").onclick = reopen;
} else return;
box.hidden = false;
};
(function () {
const MA = window.MarketplaceAccess;
const email = MA && MA.email(), session = MA && MA.session && MA.session();
if (!email || !session) return;
fetch(GATEWAY + "/marketplace/authorizations?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + session } })
  .then((r) => (r.ok ? r.json() : null)).then((a) => { if (a) window.__showRequestStatus(a); }).catch(() => {});
})();

(async () => {
// The bundles grid (older copies of this page, like the live Webflow embed
// until it is pasted again, still call it packages-grid).
const grid = document.getElementById("bundles-grid") || document.getElementById("packages-grid");
let reg;
try { reg = await (await fetch(GATEWAY + "/catalog.json")).json(); }
catch {
  grid.innerHTML = "<p>Catalog unavailable — is the gateway running?</p>";
  renderAccountTypes({ accountTypes: FALLBACK_ACCOUNT_TYPES });
  return;
}

// Bundles grid
window.__mpCatalog = reg;   // the submit handler reads bundles from here
renderAccountTypes(reg);
// Pricing (proposed, per event): every endpoint carries its rateClass and
// priceCents, every bundle its apiCents (API cost of one run) and
// serviceSteps (steps that order telecom service, billed under the tariff).
const P = reg.pricing || {};
const CLS = Object.fromEntries((P.classes || []).map((c) => [c.id, c]));
const cents = (c) => (c < 100 ? c + "¢" : "$" + (c / 100).toFixed(2));
// The rate classes an API's operations fall in, in rate-card order.
const classesOf = (id) => {
  const have = new Set((((reg.products || []).find((p) => p.id === id) || {}).endpoints || []).map((e) => e.rateClass));
  return Object.keys(CLS).filter((c) => have.has(c));
};
const runCost = (b) => (b.apiCents == null ? "" : `API cost per run: <strong>${b.apiCents ? escHtml(cents(b.apiCents)) : "Free"}</strong>${b.serviceSteps ? " + service charges" : ""}`);
const PROPOSED = `${P.status === "proposed" ? "Proposed rates, subject to approval" : "Rates in CAD"} · taxes extra`;

const bundles = reg.bundles || [], audiences = reg.audiences || [];
// Self-contained cards: every step visible with its explanation, no console
// link — visitors without marketplace access can still see how each bundle
// would be used.
// Filter by what the bundle does (category); grouped by who it's for.
const categories = reg.categories || [];
const catLabel = (id) => (categories.find((c) => c.id === id) || {}).label || "";
let activeCat = "";
const drawBundles = () => {
  const filter = categories.length
    ? `<div class="pk-filter" role="group" aria-label="Filter bundles">` +
      [{ id: "", label: "All" }, ...categories].map((c) =>
        `<button type="button" data-cat="${escHtml(c.id)}" aria-pressed="${c.id === activeCat}">${escHtml(c.label)}</button>`).join("") +
      `</div>`
    : "";
  grid.innerHTML = filter + (audiences.map((a) => {
    const list = bundles.filter((b) => b.audience === a.id && (!activeCat || b.category === activeCat));
    if (!list.length) return "";
    return `<div class="pk-aud">${escHtml(a.label)}</div><div class="pk-grid">` + list.map((b) =>
      `<div class="pk-card">${b.category ? `<span class="pk-cat">${escHtml(catLabel(b.category))}</span>` : ""}` +
      `<h3>📦 ${escHtml(b.name)}</h3><p class="use">${escHtml(b.useCase)}</p>` +
      (runCost(b) ? `<p class="pk-cost">${runCost(b)}</p>` : "") +
      `<p class="pk-sum">${escHtml(b.summary || "")}</p>` +
      `<ol class="pk-steps">${(b.steps || []).map((s) =>
        `<li><code>${escHtml(s.endpoint)}</code><span>${escHtml(s.note || "")}</span></li>`).join("")}</ol></div>`
    ).join("") + `</div>`;
  }).join("") || "<p>No bundles published yet.</p>");
  grid.querySelectorAll("[data-cat]").forEach((btn) => btn.addEventListener("click", () => { activeCat = btn.dataset.cat; drawBundles(); }));
};
drawBundles();

// Older copies of this markup (the live Webflow embed until it is pasted
// again) still carry a retired plan picker (radios) or the "Sandbox /
// Production" select: drop them, so the request sends neither.
const form = document.getElementById("access-form");
const oldPlan = form.querySelector('input[type="radio"]');
if (oldPlan && oldPlan.closest("fieldset")) oldPlan.closest("fieldset").remove();
const oldEnv = form.querySelector('select[name="environment"]');
if (oldEnv) (oldEnv.closest("label") || oldEnv).remove();

// Requests can be BUNDLE-based (ready-made bundles), individual APIs, or
// Other free text — any mix. Everything is reviewed by the team.
const okClass = new Set(["public", "customer-confidential"]);
const choices = document.getElementById("product-choices");
// Tags: a bundle's API cost per run; for an API, the price range of its
// operations (free reads and service orders cost no API fee).
const rateTag = (text, title) => `<span class="price-tag" title="${escHtml(title)}">${escHtml(text)}</span>`;
const bundleTag = (b) => (b.apiCents == null ? "" : rateTag(`API ${b.apiCents ? cents(b.apiCents) : "free"}/run`,
  `API cost per run: ${b.apiCents ? cents(b.apiCents) : "free"}${b.serviceSteps ? " + service charges" : ""} (${PROPOSED})`));
const apiTag = (id) => {
  const cs = classesOf(id);
  if (!cs.length) return "";
  const prices = cs.map((c) => CLS[c].priceCents || 0), lo = Math.min(...prices), hi = Math.max(...prices);
  const text = !hi ? (cs.every((c) => c === "service") ? CLS.service.billingUnit : "Free")
    : (lo === hi ? "" : (lo ? cents(lo) : "Free") + "–") + cents(hi);
  return rateTag(text, cs.map((c) => CLS[c].name + (CLS[c].priceCents ? " " + cents(CLS[c].priceCents) : "")).join(" · ") + ` (${PROPOSED})`);
};
choices.innerHTML = "<legend>Requested access</legend>" +
  `<p style="font-weight:400;font-size:.78rem;opacity:.75;margin:2px 0 8px">Every request is reviewed by our team. Pick the bundles that match your use case, choose individual APIs, or Other and tell us what you need.</p>` +
  `<div style="font-weight:700;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;opacity:.65;margin:6px 0 2px">Bundles</div>` +
  bundles.map((b) => `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:6px 0">` +
    `<input type="checkbox" data-bundle="${escHtml(b.id)}" style="width:auto;margin-top:3px" />` +
    `<span>📦 <strong>${escHtml(b.name)}</strong>${bundleTag(b)} — ${escHtml(b.useCase)}<br>` +
    `<span style="opacity:.6;font-size:.74rem">APIs: ${escHtml([...new Set((b.steps || []).map((s) => s.product))].map((id) => ((reg.products || []).find((p) => p.id === id) || { name: id }).name).join(", "))}</span></span></label>`).join("") +
  `<div style="font-weight:700;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;opacity:.65;margin:12px 0 2px">Individual APIs</div>` +
  (reg.products || []).filter((p) => okClass.has(p.classification))
    .map((p) => `<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin:4px 0">` +
      `<input type="checkbox" data-api="${escHtml(p.id)}" style="width:auto" /> ${escHtml(p.name)}${apiTag(p.id)}</label>`).join("") +
  `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:12px 0 4px">` +
  `<input type="checkbox" id="bundle-other" style="width:auto;margin-top:3px" /><span><strong>Other</strong> — something not covered above</span></label>` +
  `<textarea id="other-text" placeholder="Describe what you need and which systems you want to reach…" style="display:none;margin-top:6px"></textarea>`;

// A bundle tick checks its member APIs; unticking releases only members no
// other checked bundle needs AND that the user did not tick individually.
const userPicks = new Set();
choices.querySelectorAll("[data-api]").forEach((cb) => {
  cb.addEventListener("change", () => {
    if (cb.checked) userPicks.add(cb.dataset.api); else userPicks.delete(cb.dataset.api);
  });
});
const membersOf = (id) => {
  const b = bundles.find((x) => x.id === id);
  return [...new Set((b && b.steps || []).map((s) => s.product))];
};
choices.querySelectorAll("[data-bundle]").forEach((cb) => {
  cb.addEventListener("change", () => {
    const mine = membersOf(cb.dataset.bundle);
    const stillNeeded = new Set([...choices.querySelectorAll("[data-bundle]:checked")]
      .flatMap((o) => membersOf(o.dataset.bundle)));
    choices.querySelectorAll("[data-api]").forEach((p) => {
      if (cb.checked && mine.includes(p.dataset.api)) p.checked = true;
      if (!cb.checked && mine.includes(p.dataset.api) && !stillNeeded.has(p.dataset.api) && !userPicks.has(p.dataset.api)) p.checked = false;
    });
  });
});

// "I am a…" pre-ticks the bundles and APIs suggested for that type. Only
// boxes ticked this way are cleared when the type changes.
const typeSel = document.querySelector('#access-form select[name="accountType"]');
const autoTicked = new Set();
const applyType = () => {
  const t = (reg.accountTypes || []).find((x) => x.id === typeSel.value);
  autoTicked.forEach((cb) => { if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event("change")); } });
  autoTicked.clear();
  if (!t) return;
  choices.querySelectorAll("[data-bundle]").forEach((cb) => {
    const b = bundles.find((x) => x.id === cb.dataset.bundle);
    if (b && (t.audiences || []).includes(b.audience) && !cb.checked) {
      cb.checked = true; cb.dispatchEvent(new Event("change")); autoTicked.add(cb);
    }
  });
  choices.querySelectorAll("[data-api]").forEach((cb) => {
    if ((t.products || []).includes(cb.dataset.api) && !cb.checked) { cb.checked = true; autoTicked.add(cb); }
  });
};
typeSel.addEventListener("change", applyType);

// Business customers, partners and agents give a registration number (checked live) and
// document; internal employees give their department instead (and aren't billed).
const applyTypeFields = () => {
  const t = typeSel.value;
  const needsReg = t === "business" || t === "partner" || t === "agent";
  form.querySelectorAll('[data-for="business"]').forEach((el) => { el.hidden = !needsReg; });
  form.querySelectorAll('[data-for="internal"]').forEach((el) => { el.hidden = t !== "internal"; });
  form.querySelector('[name="businessRegNumber"]').required = needsReg;
  form.querySelector('[name="registrationFile"]').required = needsReg;
  form.querySelector('[name="department"]').required = t === "internal";
  form.querySelector('[name="organization"]').placeholder = t === "internal" ? "Iristel" : "Your company";
  form.querySelector('[name="email"]').placeholder = t === "internal" ? "you@iristel.com" : "you@company.com";
};
typeSel.addEventListener("change", applyTypeFields);
applyType();
applyTypeFields();

// Live registration check (the server checks again on submit).
const regInput = form.querySelector('[name="businessRegNumber"]');
const countrySel = form.querySelector('[name="country"]');
const regOut = document.getElementById("reg-status");
const REG_HINT = { CA: "CRA Business Number, e.g. 123456789", US: "EIN, e.g. 12-3456789", RO: "CUI / CIF, e.g. RO14399840", KE: "KRA PIN, e.g. P051234567X" };
let regTimer = null;
const checkReg = async () => {
  const number = regInput.value.trim();
  regInput.setCustomValidity("");
  if (!number) { regOut.textContent = ""; regOut.className = "reg-status"; return; }
  regOut.textContent = "Checking…"; regOut.className = "reg-status";
  try {
    const r = await fetch(GATEWAY + "/portal/verify-registration", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: countrySel.value, number, name: form.querySelector('[name="organization"]').value }) });
    const v = await r.json();
    regOut.className = "reg-status " + (v.status === "verified" ? "ok" : v.status === "invalid" ? "bad" : "review");
    regOut.textContent = v.status === "verified" ? "✓ Verified" + (v.legalName ? ": " + v.legalName : "") : (v.status === "invalid" ? "⚠ " : "") + (v.reason || "");
    if (v.status === "invalid") regInput.setCustomValidity(v.reason || "Check the registration number.");
  } catch { regOut.textContent = ""; regOut.className = "reg-status"; }
};
regInput.addEventListener("input", () => { clearTimeout(regTimer); regTimer = setTimeout(checkReg, 700); });
countrySel.addEventListener("change", () => { regInput.placeholder = REG_HINT[countrySel.value] || ""; checkReg(); });

// Running summary under the picker: which rate classes the picked APIs
// involve, the sandbox allowance, and whether a card will be needed.
const summary = document.getElementById("price-summary");
const drawSummary = () => {
  const ids = [...choices.querySelectorAll("[data-api]:checked")].map((cb) => cb.dataset.api);
  const picked = [...choices.querySelectorAll("[data-bundle]:checked")].map((cb) => bundles.find((x) => x.id === cb.dataset.bundle)).filter(Boolean);
  const count = ids.length ? `<strong>${ids.length} API${ids.length > 1 ? "s" : ""}</strong>${picked.length ? ` from ${picked.length} bundle${picked.length > 1 ? "s" : ""}` : ""} · ` : "";
  if (typeSel.value === "internal") { summary.innerHTML = count + "Internal Iristel usage isn't billed."; return; }
  if (!ids.length || !P.classes) { summary.innerHTML = count + "Pick the bundles or APIs you need."; return; }
  const has = new Set(ids.flatMap(classesOf));
  const paid = ["standard", "advanced"].filter((c) => has.has(c)).map((c) => `${CLS[c].name} (${cents(CLS[c].priceCents)})`);
  const parts = [has.has("free") && "free reads", paid.length && paid.join(" and ") + " operations", has.has("service") && "service orders"].filter(Boolean);
  const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0] || "";
  summary.innerHTML = count + (list ? `Includes ${escHtml(list)}; ` : "") +
    (P.sandboxCalls ? `sandbox ${escHtml(Number(P.sandboxCalls).toLocaleString("en-CA"))} calls/month; ` : "") +
    (paid.length ? "card needed only for Standard and Advanced live calls." : "no card needed.") +
    `<p class="ps-note">${escHtml(PROPOSED)}</p>`;
};
form.addEventListener("change", () => setTimeout(drawSummary, 0));
drawSummary();

const otherBox = document.getElementById("bundle-other");
const otherText = document.getElementById("other-text");
otherBox.addEventListener("change", () => {
  otherText.style.display = otherBox.checked ? "block" : "none";
  otherText.required = otherBox.checked;
});
})();

document.getElementById("access-form").addEventListener("submit", async (ev) => {
ev.preventDefault();
const form = ev.currentTarget;
const out = document.getElementById("form-result");
const data = Object.fromEntries(new FormData(form).entries());
delete data.registrationFile;
data.existingCustomer = !!form.querySelector('input[name="existingCustomer"]').checked;

// Bundles selected (+ Other free text). Products derived from the bundles.
const reg2 = window.__mpCatalog || {};
const selected = [...form.querySelectorAll("[data-bundle]:checked")].map((cb) => {
  const b = (reg2.bundles || []).find((x) => x.id === cb.dataset.bundle);
  return b ? { id: b.id, name: b.name, products: [...new Set((b.steps || []).map((s) => s.product))] } : null;
}).filter(Boolean);
const otherOn = document.getElementById("bundle-other").checked;
const bundleProducts = new Set(selected.flatMap((b) => b.products));
// APIs ticked on their own (outside any selected bundle) travel separately
// so CRM and the admin dashboard can show them as a Custom selection.
const individual = [...form.querySelectorAll("[data-api]:checked")]
  .map((cb) => cb.dataset.api).filter((id) => !bundleProducts.has(id));
data.bundles = selected;
data.individualProducts = individual;
data.other = otherOn ? document.getElementById("other-text").value.trim() : "";
data.products = [...new Set([...bundleProducts, ...individual])];
if (!selected.length && !individual.length && !data.other) {
  out.hidden = false; out.textContent = "⚠ Pick at least one bundle or API, or Other with a description."; return;
}

// Business registration document -> base64 (5 MB cap).
const fileInput = form.querySelector('input[name="registrationFile"]');
const file = fileInput && fileInput.files[0];
const needsReg = ["business", "partner", "agent"].includes(data.accountType);
if (data.accountType === "internal" && !/@iristel\.com$/i.test(data.email || "")) {
  out.hidden = false; out.textContent = "⚠ Internal employees request access with their @iristel.com email."; return;
}
if (!needsReg) { delete data.businessRegNumber; delete data.country; }
if (data.accountType !== "internal") delete data.department;
if (!file && needsReg) { out.hidden = false; out.textContent = "⚠ Attach your business registration document."; return; }
if (file && file.size > 5 * 1024 * 1024) { out.hidden = false; out.textContent = "⚠ Document must be 5 MB or smaller."; return; }
data.registrationDocument = !file ? null : await new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name, type: file.type, dataB64: String(r.result).split(",")[1] || "" });
  r.onerror = reject;
  r.readAsDataURL(file);
}).catch(() => null);
if (file && !data.registrationDocument) { out.hidden = false; out.textContent = "⚠ Could not read the document — try another file."; return; }

out.hidden = false; out.textContent = "Submitting…";
try {
  const r = await fetch(GATEWAY + "/marketplace/access-request", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const res = await r.json();
  if (!r.ok) { out.textContent = "⚠ " + (res.error || "Submission failed."); return; }
  out.textContent = "✓ Received (" + res.id + "). We've emailed you what happens next — our team usually reviews requests within 1–2 business days.";
  if (window.__showRequestStatus) window.__showRequestStatus({ status: "pending", requestedAt: new Date().toISOString(), id: res.id });
} catch { out.textContent = "⚠ Could not reach the gateway. Try again."; }
});

// The live Webflow copy of the page may still show the retired /api/ping
// example until it is pasted again: point it at a live Free operation.
const authCode = document.getElementById("auth-code");
if (authCode) authCode.textContent = authCode.textContent.replace("/api/ping ", "/api/lnp/routing-profiles ");
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

