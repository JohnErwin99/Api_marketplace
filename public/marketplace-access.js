'use strict';
/**
 * MarketplaceAccess — reads the partner-portal cookies that gate the API
 * Marketplace. Standalone on purpose: the console loads it via <script src>,
 * and the same file is pasted into its own Webflow embed on portal pages.
 *
 * Cookies (set by the partner portal login page):
 *   marketplaceAccess — comma-separated authorized product ids ("e911,dids"),
 *                       sourced from the CRM field iristel_apimarketplaceaccess.
 *   userEmail         — the logged-in partner's email.
 * No cookie => no portal login context; callers decide the open/default view.
 *
 * Cross-origin embeds: when the console runs inside an iframe on the portal
 * (Webflow) domain, the marketplace domain cannot see the portal cookies.
 * The embed script forwards them as URL params instead — ?mpa=<ids>&mpe=<email>
 * — which take precedence here and are persisted as first-party cookies so
 * in-console navigation keeps working.
 */
(function (root) {
  var params = null;
  try { params = new URLSearchParams(root.location ? root.location.search : ''); } catch (e) { /* older engines */ }
  var urlAccess = params ? params.get('mpa') : null;
  var urlEmail = params ? params.get('mpe') : null;
  if (urlAccess !== null) {
    document.cookie = 'marketplaceAccess=' + encodeURIComponent(urlAccess) + '; path=/; SameSite=None; Secure';
  }
  if (urlEmail) {
    document.cookie = 'userEmail=' + encodeURIComponent(urlEmail) + '; path=/; SameSite=None; Secure';
  }
  function getCookie(name) {
    var nameEQ = name + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
    }
    return null;
  }
  root.MarketplaceAccess = {
    getCookie: getCookie,
    // null = no cookie/param (open behavior); [] = logged in, nothing authorized.
    authorizedProducts: function () {
      var v = urlAccess !== null ? urlAccess : getCookie('marketplaceAccess');
      if (v === null || v === '') return v === '' ? [] : null;
      return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    },
    email: function () { return (urlEmail || getCookie('userEmail') || '').trim() || null; },
    partnerType: function () { return (getCookie('partnerType') || '').trim() || null; },
  };
})(window);
