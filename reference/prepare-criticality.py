"""Freeze per-prefix classification inputs without changing the audit ledger."""

import csv
import hashlib
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
INPUTS = OUT / 'reference/criticality-inputs'
MANIFEST = OUT / 'reference/criticality-input-manifest.json'
BACKUP = OUT / 'reference/audit-ledger.before-criticality.tsv'


def digest(content):
    return hashlib.sha256(content).hexdigest()


ledger_bytes = (OUT / 'audit-ledger.tsv').read_bytes()
inventory_bytes = (OUT / 'audit-inventory.md').read_bytes()
rubric_bytes = (OUT / 'Criticality-Rubric.md').read_bytes()
with (OUT / 'audit-ledger.tsv').open(newline='') as handle:
    reader = csv.DictReader(handle, delimiter='\t')
    columns = reader.fieldnames
    rows = list(reader)
if not columns or len(columns) != len(set(columns)):
    raise SystemExit('Missing or duplicate ledger columns')
optional_fields = {'reviewer', 'reviewed_revision', 'category_ids', 'outcome', 'evidence', 'notes'}
missing_empty_fields = []
for row in rows:
    if None in row:
        raise SystemExit('Extra fields in ledger row')
    absent = [name for name, value in row.items() if value is None]
    if any(name not in optional_fields for name in absent):
        raise SystemExit('Missing required ledger field')
    if absent:
        missing_empty_fields.append({'inventory_id': row['inventory_id'], 'emptyTrailingFields': absent})
        for name in absent:
            row[name] = ''
ids = [row['inventory_id'] for row in rows]
if len(ids) != len(set(ids)):
    raise SystemExit('Duplicate ledger IDs')
inventory = {}
for line in inventory_bytes.decode().splitlines():
    if not line.strip():
        continue
    match = re.match(r'^- \[([A-Z]+-\d+)\] \*\*(.+?)\*\*', line)
    if not match or match.group(1) in inventory:
        raise SystemExit('Malformed or duplicate inventory item')
    inventory[match.group(1)] = {'line': line, 'surface': match.group(2)}
if set(ids) != set(inventory):
    raise SystemExit('Inventory and ledger IDs differ')

groups = {}
for row in rows:
    item_id = row['inventory_id']
    prefix = item_id.split('-')[0]
    if row['area'] != prefix or row['surface'] != inventory[item_id]['surface']:
        raise SystemExit('Ledger identity differs from inventory: ' + item_id)
    groups.setdefault(prefix, []).append(item_id)

if MANIFEST.exists() or BACKUP.exists() or INPUTS.exists():
    raise SystemExit('Classification input snapshot already exists; preserve it rather than overwriting it')
companions = OUT / 'criticality'
if companions.exists() and any(companions.iterdir()):
    raise SystemExit('Companion directory is not empty')
INPUTS.mkdir(parents=True)
companions.mkdir(exist_ok=True)
with BACKUP.open('xb') as handle:
    handle.write(ledger_bytes)
group_manifest = {}
for prefix, group_ids in groups.items():
    content = ('\n'.join(inventory[item_id]['line'] for item_id in group_ids) + '\n').encode()
    input_path = INPUTS / (prefix + '.md')
    with input_path.open('xb') as handle:
        handle.write(content)
    group_manifest[prefix] = {
        'ids': group_ids,
        'count': len(group_ids),
        'input': str(input_path.relative_to(OUT)),
        'inputSha256': digest(content),
        'companion': 'criticality/{}.tsv'.format(prefix),
    }
manifest = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'inventorySha256': digest(inventory_bytes),
    'rubricSha256': digest(rubric_bytes),
    'originalLedgerSha256': digest(ledger_bytes),
    'originalLedgerColumns': columns,
    'originalLedgerBackup': str(BACKUP.relative_to(OUT)),
    'csvExistedBeforeClassification': (OUT / 'audit-ledger.csv').exists(),
    'trailingEmptyFieldNormalization': missing_empty_fields,
    'totalItems': len(ids),
    'groups': group_manifest,
}
with MANIFEST.open('x') as handle:
    handle.write(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({
    'totalItems': len(ids),
    'prefixes': {prefix: len(group_ids) for prefix, group_ids in groups.items()},
    'existingStatusCounts': dict(Counter(row['status'] for row in rows)),
    'masterLedgerChanged': False,
}, indent=2))
