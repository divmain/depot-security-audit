"""Export a small review batch with complete inventory descriptions; never reserve or edit master rows."""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
STATUSES = ('not_started', 'in_review', 'reviewed_no_finding', 'finding_identified', 'needs_validation')


def render(columns, rows, delimiter):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=columns, delimiter=delimiter, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', action='append', help='Exact inventory prefix; repeat to include neighbors')
    parser.add_argument('--criticality', action='append', choices=('critical', 'high', 'medium', 'low'))
    parser.add_argument('--status', choices=STATUSES, help='Defaults to not_started for filtered exports; explicit IDs have no default status filter')
    parser.add_argument('--reviewer', help='Filter by the exact reviewer already recorded in the master')
    parser.add_argument('--limit', type=int, help='Defaults to 10 for filtered exports')
    parser.add_argument('--offset', type=int, default=0, help='Offset within the filtered rows; ID selection is preferable for final assignments')
    parser.add_argument('--ids', help='Exact comma-separated IDs; exclusive with prefix/criticality/limit/offset selectors')
    parser.add_argument('--out', required=True, help='New output directory under out/, relative to the repository root or absolute')
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0 or args.offset < 0:
        raise ValueError('Limit must be positive and offset nonnegative')
    if args.ids is not None and (args.prefix or args.criticality or args.limit is not None or args.offset):
        raise ValueError('Use exact --ids or prefix/criticality/limit/offset selection, not both')
    destination = Path(args.out)
    if not destination.is_absolute():
        destination = ROOT / destination
    destination = destination.resolve()
    try:
        destination.relative_to(OUT)
    except ValueError:
        raise ValueError('Batch output must stay within the audit out/ directory')
    if destination.exists():
        raise ValueError('Output directory already exists; preserve its review work and choose a new name')

    ledger_bytes = (OUT / 'audit-ledger.tsv').read_bytes()
    reader = csv.DictReader(io.StringIO(ledger_bytes.decode(), newline=''), delimiter='\t')
    columns = reader.fieldnames
    rows = list(reader)
    if not columns or 'criticality' not in columns or len(set(columns)) != len(columns):
        raise ValueError('Master ledger must have unique columns and criticality')
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError('Malformed master ledger row')
    ids = [row['inventory_id'] for row in rows]
    if len(set(ids)) != len(ids) or any(row['criticality'] not in ('critical', 'high', 'medium', 'low') for row in rows):
        raise ValueError('Duplicate IDs or invalid criticality in master ledger')
    prefixes = set(row['area'] for row in rows)
    if args.prefix and set(args.prefix) - prefixes:
        raise ValueError('Unknown prefixes: ' + ', '.join(sorted(set(args.prefix) - prefixes)))

    if args.ids is not None:
        selected_ids = [item.strip() for item in args.ids.split(',')]
        if not all(selected_ids) or len(set(selected_ids)) != len(selected_ids):
            raise ValueError('Explicit IDs must be nonempty and unique')
        if set(selected_ids) - set(ids):
            raise ValueError('Unknown IDs: ' + ', '.join(sorted(set(selected_ids) - set(ids))))
        selected = [row for row in rows if row['inventory_id'] in set(selected_ids)]
        if args.status and any(row['status'] != args.status for row in selected):
            raise ValueError('An explicitly selected item has a different status')
        if args.reviewer is not None and any(row['reviewer'] != args.reviewer for row in selected):
            raise ValueError('An explicitly selected item has a different reviewer')
    else:
        selected = [row for row in rows if
                    (not args.prefix or row['area'] in args.prefix) and
                    (not args.criticality or row['criticality'] in args.criticality) and
                    row['status'] == (args.status or 'not_started') and
                    (args.reviewer is None or row['reviewer'] == args.reviewer)]
        selected = selected[args.offset:args.offset + (args.limit if args.limit is not None else 10)]
    if not selected:
        raise ValueError('No rows match the selection')

    inventory_bytes = (OUT / 'audit-inventory.md').read_bytes()
    inventory = {}
    for line in inventory_bytes.decode().splitlines():
        if not line.strip():
            continue
        match = re.match(r'^- \[([A-Z]+-\d+)\] \*\*(.+?)\*\*', line)
        if not match or match.group(1) in inventory:
            raise ValueError('Malformed or duplicate inventory item')
        inventory[match.group(1)] = (line, match.group(2))
    for row in selected:
        item = inventory.get(row['inventory_id'])
        if item is None or item[1] != row['surface']:
            raise ValueError('Inventory identity mismatch: ' + row['inventory_id'])
    selected_ids = [row['inventory_id'] for row in selected]
    baseline = json.loads((OUT / 'reference/preparation-manifest.json').read_text())['sourceCommit']
    metadata = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'inventoryBaselineRevision': baseline,
        'checkoutRevisionAtExport': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'sourceLedgerSha256': hashlib.sha256(ledger_bytes).hexdigest(),
        'sourceInventorySha256': hashlib.sha256(inventory_bytes).hexdigest(),
        'inventoryIds': selected_ids,
        'counts': dict(Counter(row['criticality'] for row in selected)),
        'rows': len(selected),
        'masterModified': False,
        'assignmentReserved': False,
    }
    references = ['Audit-Brief.md', 'Criticality-Rubric.md', 'High-Critical-Rubric.md', 'Audit-Plan.md', 'Finding-Categories.md', 'Finding-Template.md', 'Trust-Boundaries.md', 'Audit-Coverage.md']
    reference_links = '\n'.join('- [{}]({})'.format(name, os.path.relpath(OUT / name, destination)) for name in references)
    handoff = '''# Audit batch

This packet contains {count} explicitly identified review targets. The master ledger is unchanged; this export does not reserve assignments. The coordinator records the reviewer and status in the master before work begins.

- Inventory baseline: `{revision}`.
- IDs: {ids}.
- [TSV ledger](audit-ledger.tsv) and [CSV view](audit-ledger.csv) contain the same rows and fields.
- [Full item descriptions](audit-inventory.md) contain the actual audit scope; a ledger title alone is insufficient.
- [Batch manifest](batch-manifest.json) records the source hashes and selection.

## Shared materials

Use the repository checkout and shared audit materials alongside this packet. These links resolve within the original checkout; when handing files to another engineer, provide the shared pack and preserve its repository-relative layout.

{references}

## Return

Return the ledger with the same IDs, evidence/revision fields, findings using the shared template, and explicit untested questions. The coordinator merges review fields by ID and resolves concurrent edits. A criticality change is a proposed recalibration with a consequence-based rationale; it does not substitute for a finding severity. Do not infer review of sibling items from a shared test.
'''.format(count=len(selected), revision=baseline, ids=', '.join('`' + item_id + '`' for item_id in selected_ids), references=reference_links)
    destination.mkdir(parents=True)
    (destination / 'audit-ledger.tsv').write_text(render(columns, selected, '\t'))
    (destination / 'audit-ledger.csv').write_text(render(columns, selected, ','))
    (destination / 'audit-inventory.md').write_text('\n'.join(inventory[item_id][0] for item_id in selected_ids) + '\n')
    (destination / 'batch-manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (destination / 'Handoff.md').write_text(handoff)
    if (OUT / 'audit-ledger.tsv').read_bytes() != ledger_bytes:
        raise ValueError('Master changed during export; packet is a snapshot, reconcile against the current master')
    print(json.dumps({'directory': str(destination.relative_to(ROOT)), **metadata}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
