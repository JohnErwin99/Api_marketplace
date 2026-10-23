#!/usr/bin/env python3
"""Import the pricing-tier map workbook into lib/catalogs/tiers.json.

The workbook (api-tier-map.xlsx, next to this repo) is where tiers are
decided: sheet "Tier map", one row per catalog operation, with the product's
display name (column B), method (D), path (E) and proposed tier (G). This
writes {productId: {"METHOD /path": tier}} with tier one of free, standard,
premium, keyed exactly like lib/catalogs/pricing.js keys an endpoint, so
pricing.tierFor() can look it up. Tiers are now packages (Premium includes
Standard, which includes Free): the workbook's old "Service transaction"
tier is part of Premium, and rows for retired products are skipped.

Operations that aren't in the workbook yet (added to the catalog after it was
built) are kept from the existing tiers.json, so hand-set tiers survive a
re-import. Run from the repo root:

    python3 scripts/import-tier-map.py [path/to/api-tier-map.xlsx]
"""

import json
import os
import subprocess
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKBOOK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'api-tier-map.xlsx')
OUT = os.path.join(ROOT, 'lib', 'catalogs', 'tiers.json')
TIER_IDS = {'Free': 'free', 'Standard': 'standard', 'Premium': 'premium', 'Service transaction': 'premium'}
# Products removed from the marketplace that the workbook still lists.
RETIRED = {'Phone Numbers (DIDs)'}

# Product display name -> id, from the catalog itself.
names = json.loads(subprocess.check_output(
    ['node', '-e', "process.stdout.write(JSON.stringify(require('./lib/catalogs').PRODUCTS.map(p=>[p.name,p.id])))"],
    cwd=ROOT, stderr=subprocess.DEVNULL))
product_id = dict(names)

existing = {}
if os.path.exists(OUT):
    with open(OUT) as f:
        existing = json.load(f)

tiers = {pid: dict(existing.get(pid, {})) for _, pid in names}
ws = openpyxl.load_workbook(WORKBOOK, data_only=True)['Tier map']
imported = 0
for row in ws.iter_rows(min_row=2, values_only=True):
    if row[0] is None:
        continue
    name, method, path, tier = row[1], row[3], row[4], row[6]
    if name in RETIRED:
        continue
    if name not in product_id:
        sys.exit(f'Unknown product name in workbook: {name!r}')
    if tier not in TIER_IDS:
        sys.exit(f'Unknown tier {tier!r} for {method} {path}')
    tiers[product_id[name]][f'{method} {path}'] = TIER_IDS[tier]
    imported += 1

with open(OUT, 'w') as f:
    json.dump({pid: dict(sorted(ops.items())) for pid, ops in tiers.items()}, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f'Wrote {OUT}: {imported} operations from the workbook, '
      f'{sum(len(v) for v in tiers.values())} in total')
