"""Validate per-prefix judgments and join criticality into the live master by ID."""

import argparse
import csv
import hashlib
import io
import json
import os
import stat
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
BANDS = ('high', 'medium', 'low')
OPTIONAL_REVIEW_FIELDS = {'reviewer', 'reviewed_revision', 'category_ids', 'outcome', 'evidence', 'notes'}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def load_table(path, delimiter='\t', allow_empty_tail=False):
    content = path.read_bytes()
    reader = csv.DictReader(io.StringIO(content.decode(), newline=''), delimiter=delimiter)
    columns = reader.fieldnames
    if not columns or len(columns) != len(set(columns)):
        raise ValueError('Missing or duplicate columns: ' + str(path))
    rows = list(reader)
    for number, row in enumerate(rows, 2):
        if None in row:
            raise ValueError('Extra fields at {}:{}'.format(path, number))
        for name, value in row.items():
            if value is None:
                if allow_empty_tail and name in OPTIONAL_REVIEW_FIELDS:
                    row[name] = ''
                else:
                    raise ValueError('Missing field {} at {}:{}'.format(name, path, number))
    return columns, rows, content


def render_table(columns, rows, delimiter):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=columns, delimiter=delimiter, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def atomic_write(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        os.fchmod(descriptor, stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare_merge():
    manifest = json.loads((OUT / 'reference/criticality-input-manifest.json').read_text())
    if digest((OUT / 'audit-inventory.md').read_bytes()) != manifest['inventorySha256']:
        raise ValueError('Inventory changed since classification inputs were frozen')
    rubric_path = OUT / 'Criticality-Rubric.initial.md'
    if not rubric_path.exists():
        rubric_path = OUT / 'Criticality-Rubric.md'
    if digest(rubric_path.read_bytes()) != manifest['rubricSha256']:
        raise ValueError('Rubric changed since classification inputs were frozen')
    backup_path = OUT / manifest['originalLedgerBackup']
    baseline_columns, baseline_rows, baseline_bytes = load_table(backup_path, allow_empty_tail=True)
    if digest(baseline_bytes) != manifest['originalLedgerSha256']:
        raise ValueError('Original ledger backup hash differs')
    if baseline_columns != manifest['originalLedgerColumns']:
        raise ValueError('Original ledger columns differ from snapshot')
    baseline_by_id = {row['inventory_id']: row for row in baseline_rows}
    expected_ids = [item_id for group in manifest['groups'].values() for item_id in group['ids']]
    if len(set(expected_ids)) != len(expected_ids) or set(expected_ids) != set(baseline_by_id):
        raise ValueError('Input manifest and original ledger IDs differ')
    expected_files = {Path(group['companion']).name for group in manifest['groups'].values()}
    actual_files = {path.name for path in (OUT / 'criticality').iterdir() if path.is_file()}
    if actual_files != expected_files:
        raise ValueError('Companion file set mismatch: missing={}, extra={}'.format(sorted(expected_files - actual_files), sorted(actual_files - expected_files)))

    classifications = {}
    companions = []
    by_area = {}
    for prefix, group in manifest['groups'].items():
        if digest((OUT / group['input']).read_bytes()) != group['inputSha256']:
            raise ValueError('Classification input changed: ' + prefix)
        columns, rows, content = load_table(OUT / group['companion'])
        if columns != ['inventory_id', 'criticality']:
            raise ValueError('Companion must have exactly inventory_id and criticality: ' + prefix)
        row_ids = [row['inventory_id'] for row in rows]
        if len(set(row_ids)) != len(row_ids):
            raise ValueError('Duplicate companion IDs: ' + prefix)
        if row_ids != group['ids']:
            raise ValueError('Companion IDs/order mismatch: {} missing={} extra={}'.format(prefix, sorted(set(group['ids']) - set(row_ids)), sorted(set(row_ids) - set(group['ids']))))
        for row in rows:
            if row['criticality'] not in BANDS:
                raise ValueError('Invalid criticality for ' + row['inventory_id'])
            if row['inventory_id'] in classifications:
                raise ValueError('ID repeated across companions: ' + row['inventory_id'])
            classifications[row['inventory_id']] = row['criticality']
        counts = Counter(row['criticality'] for row in rows)
        by_area[prefix] = {band: counts[band] for band in BANDS}
        companions.append({'path': group['companion'], 'sha256': digest(content), 'rows': len(rows)})
    if set(classifications) != set(expected_ids):
        raise ValueError('Classification ID set differs from frozen inventory')

    ledger_path = OUT / 'audit-ledger.tsv'
    old_columns, old_rows, old_bytes = load_table(ledger_path, allow_empty_tail=True)
    if any(name not in old_columns for name in ('inventory_id', 'area', 'surface', 'status')):
        raise ValueError('Live ledger is missing required columns')
    live_ids = [row['inventory_id'] for row in old_rows]
    if len(set(live_ids)) != len(live_ids) or set(live_ids) != set(expected_ids):
        raise ValueError('Live ledger ID set differs; reconcile additions/deletions before merging')
    for row in old_rows:
        baseline = baseline_by_id[row['inventory_id']]
        if any(row[name] != baseline[name] for name in ('area', 'surface')):
            raise ValueError('Item identity changed during classification: ' + row['inventory_id'])
    changed_existing = [row['inventory_id'] for row in old_rows if 'criticality' in old_columns and row['criticality'] not in ('', classifications[row['inventory_id']])]
    new_columns = old_columns.copy()
    if 'criticality' not in new_columns:
        new_columns.insert(new_columns.index('surface') + 1, 'criticality')
    new_rows = [dict(row, criticality=classifications[row['inventory_id']]) for row in old_rows]
    if any(any(new[name] != old[name] for name in old_columns if name != 'criticality') for old, new in zip(old_rows, new_rows)):
        raise ValueError('A non-criticality value changed')
    result = render_table(new_columns, new_rows, '\t')
    counts = Counter(classifications.values())
    report = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'inventorySha256': manifest['inventorySha256'],
        'rubricSha256': manifest['rubricSha256'],
        'totalRows': len(new_rows),
        'counts': {band: counts[band] for band in BANDS},
        'byArea': by_area,
        'companions': companions,
        'classificationSha256': digest(render_table(['inventory_id', 'criticality'], [{'inventory_id': item_id, 'criticality': classifications[item_id]} for item_id in sorted(classifications)], '\t')),
        'beforeLedgerSha256': digest(old_bytes),
        'afterLedgerSha256': digest(result),
        'allOtherFieldsPreserved': True,
        'rowOrderPreserved': True,
        'existingCriticalityChanges': changed_existing,
        'columns': new_columns,
        'trailingEmptyFieldNormalization': manifest.get('trailingEmptyFieldNormalization', []),
        'scope': 'Initial conditional-impact classification; not audited vulnerabilities, likelihood, or confirmed severity.',
    }
    return manifest, old_bytes, new_columns, new_rows, result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate companions and preview counts without writing the master')
    parser.add_argument('--replace-existing', action='store_true', help='Explicitly replace differing criticality labels; all other fields stay unchanged')
    args = parser.parse_args()
    if (OUT / 'reference/high-criticality-input-manifest.json').exists() and not args.check:
        raise ValueError('The initial three-band merge is archived; use merge-high-criticality.py for the scoped refinement')
    manifest, old_bytes, columns, rows, result, report = prepare_merge()
    if report['existingCriticalityChanges'] and not args.replace_existing and not args.check:
        raise ValueError('Existing criticality labels differ; reconcile them or explicitly use --replace-existing')
    if args.check:
        print(json.dumps(dict(report, applied=False), indent=2))
        return

    csv_path = OUT / 'audit-ledger.csv'
    report_path = OUT / 'reference/criticality-merge-report.json'
    if csv_path.exists():
        if not report_path.exists():
            raise ValueError('A CSV ledger already exists outside this merge; preserve/reconcile it first')
        previous = json.loads(report_path.read_text())
        if digest(csv_path.read_bytes()) != previous.get('csvSha256'):
            raise ValueError('CSV differs from its generated snapshot; preserve/reconcile its edits first')
    if manifest['csvExistedBeforeClassification'] and not report_path.exists():
        raise ValueError('Input snapshot records a pre-existing CSV ledger; preserve/reconcile it first')
    if (OUT / 'audit-ledger.tsv').read_bytes() != old_bytes:
        raise ValueError('Live ledger changed while preparing the merge; retry against the new contents')
    csv_bytes = render_table(columns, rows, ',')
    atomic_write(OUT / 'audit-ledger.tsv', result)
    atomic_write(csv_path, csv_bytes)
    actual_columns, actual_rows, actual_bytes = load_table(OUT / 'audit-ledger.tsv')
    csv_columns, csv_rows, _ = load_table(csv_path, delimiter=',')
    if actual_bytes != result or actual_columns != columns or actual_rows != rows or csv_columns != columns or csv_rows != rows:
        raise ValueError('Read-back comparison failed')
    report['csvSha256'] = digest(csv_bytes)
    report['applied'] = True
    atomic_write(report_path, (json.dumps(report, indent=2) + '\n').encode())
    summary_columns = ['area', 'high', 'medium', 'low', 'total']
    summary_rows = [{'area': prefix, **counts, 'total': sum(counts.values())} for prefix, counts in report['byArea'].items()]
    summary_rows.append({'area': 'TOTAL', **report['counts'], 'total': report['totalRows']})
    atomic_write(OUT / 'reference/criticality-summary.tsv', render_table(summary_columns, summary_rows, '\t'))
    print(json.dumps({'totalRows': report['totalRows'], 'counts': report['counts'], 'allOtherFieldsPreserved': True, 'rowOrderPreserved': True, 'csvMatchesMaster': True, 'applied': True}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
