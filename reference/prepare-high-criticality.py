"""Freeze only current High items for a binary Critical/High refinement."""

import hashlib
import json
import re
import runpy
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
helpers = runpy.run_path(str(OUT / 'reference/merge-criticality.py'), run_name='criticality_io')
load_table = helpers['load_table']
manifest_path = OUT / 'reference/high-criticality-input-manifest.json'
inputs = OUT / 'reference/high-criticality-inputs'
companions = OUT / 'high-criticality'
ledger_backup = OUT / 'reference/audit-ledger.before-critical-split.tsv'
csv_backup = OUT / 'reference/audit-ledger.before-critical-split.csv'
rubric_archive = OUT / 'Criticality-Rubric.initial.md'


def digest(content):
    return hashlib.sha256(content).hexdigest()


columns, rows, ledger_bytes = load_table(OUT / 'audit-ledger.tsv')
if 'criticality' not in columns or any(row['criticality'] not in ('high', 'medium', 'low') for row in rows):
    raise SystemExit('Expected the existing three-band ledger for this first High-only refinement')
ids = [row['inventory_id'] for row in rows]
if len(set(ids)) != len(ids):
    raise SystemExit('Duplicate master IDs')
inventory_bytes = (OUT / 'audit-inventory.md').read_bytes()
inventory = {}
for line in inventory_bytes.decode().splitlines():
    if not line.strip():
        continue
    match = re.match(r'^- \[([A-Z]+-\d+)\] \*\*(.+?)\*\*', line)
    if not match or match.group(1) in inventory:
        raise SystemExit('Malformed or duplicate inventory item')
    inventory[match.group(1)] = (line, match.group(2))
if set(ids) != set(inventory):
    raise SystemExit('Ledger and inventory IDs differ')
groups = {}
protected_ids = []
for row in rows:
    item_id = row['inventory_id']
    prefix = item_id.split('-')[0]
    if row['area'] != prefix or row['surface'] != inventory[item_id][1]:
        raise SystemExit('Item identity differs: ' + item_id)
    if row['criticality'] == 'high':
        groups.setdefault(prefix, []).append(item_id)
    else:
        protected_ids.append(item_id)
if not groups:
    raise SystemExit('No High items to refine')
for path in (manifest_path, inputs, ledger_backup, csv_backup, rubric_archive):
    if path.exists():
        raise SystemExit('Snapshot path already exists; preserve it: ' + str(path))
if companions.exists() and any(companions.iterdir()):
    raise SystemExit('High-only companion directory is not empty')
initial_rubric = (OUT / 'Criticality-Rubric.md').read_bytes()
first_manifest = json.loads((OUT / 'reference/criticality-input-manifest.json').read_text())
if digest(initial_rubric) != first_manifest['rubricSha256']:
    raise SystemExit('Initial rubric differs from its recorded version; reconcile before archiving')
refinement_rubric = (OUT / 'High-Critical-Rubric.md').read_bytes()
csv_bytes = (OUT / 'audit-ledger.csv').read_bytes() if (OUT / 'audit-ledger.csv').exists() else None
inputs.mkdir(parents=True)
companions.mkdir(exist_ok=True)
for path, content in ((ledger_backup, ledger_bytes), (rubric_archive, initial_rubric)):
    with path.open('xb') as handle:
        handle.write(content)
if csv_bytes is not None:
    with csv_backup.open('xb') as handle:
        handle.write(csv_bytes)
group_manifest = {}
for prefix, group_ids in groups.items():
    content = ('\n'.join(inventory[item_id][0] for item_id in group_ids) + '\n').encode()
    path = inputs / (prefix + '.md')
    with path.open('xb') as handle:
        handle.write(content)
    group_manifest[prefix] = {
        'ids': group_ids,
        'count': len(group_ids),
        'input': str(path.relative_to(OUT)),
        'inputSha256': digest(content),
        'companion': 'high-criticality/{}.tsv'.format(prefix),
    }
manifest = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'scope': 'Only IDs whose starting criticality is high; medium and low are protected, not reassessed.',
    'inventorySha256': digest(inventory_bytes),
    'rubric': 'High-Critical-Rubric.md',
    'rubricSha256': digest(refinement_rubric),
    'initialRubricArchive': str(rubric_archive.relative_to(OUT)),
    'initialRubricSha256': digest(initial_rubric),
    'originalLedgerBackup': str(ledger_backup.relative_to(OUT)),
    'originalLedgerSha256': digest(ledger_bytes),
    'originalLedgerColumns': columns,
    'originalCsvBackup': str(csv_backup.relative_to(OUT)) if csv_bytes is not None else None,
    'originalCsvSha256': digest(csv_bytes) if csv_bytes is not None else None,
    'startingCounts': dict(Counter(row['criticality'] for row in rows)),
    'totalRows': len(rows),
    'eligibleRows': sum(len(group_ids) for group_ids in groups.values()),
    'protectedRows': len(protected_ids),
    'protectedIds': protected_ids,
    'groups': group_manifest,
}
with manifest_path.open('x') as handle:
    handle.write(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'totalRows': len(rows), 'eligibleHighRows': manifest['eligibleRows'], 'protectedMediumLowRows': len(protected_ids), 'highByPrefix': {prefix: len(group_ids) for prefix, group_ids in groups.items()}, 'masterChanged': False}, indent=2))
