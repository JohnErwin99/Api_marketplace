'use strict';

// "/accounts/:accountId" -> /^\/accounts\/[^/]+$/ — matches a request path
// against a catalog endpoint template.
const templateRegex = (p) =>
  new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$');

module.exports = { templateRegex };
