"""Apply only Critical/High decisions for the frozen original-High ID set."""

import argparse
import hashlib
import json
import runpy
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
helpers = runpy.run_path(str(OUT / 'reference/merge-criticality.py'), run_name='criticality_io')
load_table = helpers['load_table']
render_table = helpers['render_table']
atomic_write = helpers['atomic_write']
BANDS = ('critical', 'high', 'medium', 'low')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def prepare_refinement():
    manifest = json.loads((OUT / 'reference/high-criticality-input-manifest.json').read_text())
    if digest((OUT / 'audit-inventory.md').read_bytes()) != manifest['inventorySha256']:
        raise ValueError('Inventory differs from the frozen High-only assignment')
    if digest((OUT / manifest['rubric']).read_bytes()) != manifest['rubricSha256']:
        raise ValueError('High/Critical rubric differs from the assignment snapshot')
    baseline_columns, baseline_rows, baseline_bytes = load_table(OUT / manifest['originalLedgerBackup'])
    if baseline_columns != manifest['originalLedgerColumns'] or digest(baseline_bytes) != manifest['originalLedgerSha256']:
        raise ValueError('Before-refinement ledger snapshot differs')
    baseline = {row['inventory_id']: row for row in baseline_rows}
    if len(baseline) != len(baseline_rows) or any(row['criticality'] not in ('high', 'medium', 'low') for row in baseline_rows):
        raise ValueError('Invalid original three-band ledger')
    eligible = {item_id for item_id, row in baseline.items() if row['criticality'] == 'high'}
    protected = set(baseline) - eligible
    expected_ids = [item_id for group in manifest['groups'].values() for item_id in group['ids']]
    if len(expected_ids) != len(set(expected_ids)) or set(expected_ids) != eligible:
        raise ValueError('Refinement assignments are not exactly the original High IDs')
    if set(manifest['protectedIds']) != protected:
        raise ValueError('Protected Medium/Low ID set differs from snapshot')
    if manifest['eligibleRows'] != len(eligible) or manifest['protectedRows'] != len(protected) or manifest['totalRows'] != len(baseline):
        raise ValueError('Refinement snapshot counts disagree with its IDs')

    expected_files = {Path(group['companion']).name for group in manifest['groups'].values()}
    actual_files = {path.name for path in (OUT / 'high-criticality').iterdir() if path.is_file()}
    if actual_files != expected_files:
        raise ValueError('High-only companion file set mismatch: missing={}, extra={}'.format(sorted(expected_files - actual_files), sorted(actual_files - expected_files)))
    decisions = {}
    companions = []
    for prefix, group in manifest['groups'].items():
        if digest((OUT / group['input']).read_bytes()) != group['inputSha256']:
            raise ValueError('High-only input changed: ' + prefix)
        columns, rows, content = load_table(OUT / group['companion'])
        if columns != ['inventory_id', 'criticality']:
            raise ValueError('Companion must contain only inventory_id and criticality: ' + prefix)
        row_ids = [row['inventory_id'] for row in rows]
        if len(set(row_ids)) != len(row_ids):
            raise ValueError('Duplicate refinement IDs: ' + prefix)
        forbidden = set(row_ids) - eligible
        if forbidden:
            raise ValueError('Refinement contains protected or unknown IDs: ' + ', '.join(sorted(forbidden)))
        if row_ids != group['ids']:
            raise ValueError('Refinement companion ID/order mismatch: ' + prefix)
        for row in rows:
            item_id = row['inventory_id']
            if row['criticality'] not in ('critical', 'high'):
                raise ValueError('A former High may only be critical or high: ' + item_id)
            if item_id in decisions:
                raise ValueError('ID repeated across refinement companions: ' + item_id)
            decisions[item_id] = row['criticality']
        companions.append({'path': group['companion'], 'sha256': digest(content), 'rows': len(rows)})
    if set(decisions) != eligible:
        raise ValueError('Refinement does not cover every original High exactly once')

    columns, old_rows, old_bytes = load_table(OUT / 'audit-ledger.tsv')
    if any(column not in columns for column in baseline_columns):
        raise ValueError('Live master is missing original columns')
    live_ids = [row['inventory_id'] for row in old_rows]
    if len(set(live_ids)) != len(live_ids) or set(live_ids) != set(baseline):
        raise ValueError('Live ledger ID set changed; preserve and reconcile it before applying')
    new_rows = []
    changed_ids = []
    for row in old_rows:
        item_id = row['inventory_id']
        original = baseline[item_id]
        if any(row[name] != original[name] for name in ('area', 'surface')):
            raise ValueError('Item identity changed during refinement: ' + item_id)
        updated = dict(row)
        if item_id in protected:
            if row['criticality'] != original['criticality']:
                raise ValueError('A protected Medium/Low rating changed concurrently: ' + item_id)
        else:
            if row['criticality'] not in ('high', 'critical'):
                raise ValueError('An eligible High was independently moved outside this refinement: ' + item_id)
            if row['criticality'] == 'critical' and decisions[item_id] != 'critical':
                raise ValueError('Refusing to overwrite an existing Critical decision: ' + item_id)
            updated['criticality'] = decisions[item_id]
            if updated['criticality'] != row['criticality']:
                changed_ids.append(item_id)
        if item_id in protected and updated != row:
            raise ValueError('A protected row changed: ' + item_id)
        if any(updated[name] != row[name] for name in columns if name != 'criticality'):
            raise ValueError('A non-criticality field changed: ' + item_id)
        new_rows.append(updated)
    if set(changed_ids) - eligible:
        raise ValueError('Change set escaped the original High scope')
    before_protected = render_table(columns, [row for row in old_rows if row['inventory_id'] in protected], '\t')
    after_protected = render_table(columns, [row for row in new_rows if row['inventory_id'] in protected], '\t')
    if before_protected != after_protected:
        raise ValueError('Protected row serialization changed')
    counts = Counter(row['criticality'] for row in new_rows)
    original_counts = Counter(row['criticality'] for row in baseline_rows)
    if counts['medium'] != original_counts['medium'] or counts['low'] != original_counts['low']:
        raise ValueError('Medium or Low totals changed')
    result = render_table(columns, new_rows, '\t')
    by_area = {}
    for row in new_rows:
        by_area.setdefault(row['area'], Counter())[row['criticality']] += 1
    report = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'scope': 'Only originally High items; Medium/Low ratings are carried forward unchanged without reassessment.',
        'inventorySha256': manifest['inventorySha256'],
        'rubricSha256': manifest['rubricSha256'],
        'beforeLedgerSha256': digest(old_bytes),
        'afterLedgerSha256': digest(result),
        'totalRows': len(new_rows),
        'reassessedRows': len(eligible),
        'protectedRows': len(protected),
        'counts': {band: counts[band] for band in BANDS},
        'refinementCounts': {band: sum(value == band for value in decisions.values()) for band in ('critical', 'high')},
        'byArea': {prefix: {band: area_counts[band] for band in BANDS} for prefix, area_counts in by_area.items()},
        'changedIds': changed_ids,
        'criticalIds': [item_id for item_id in expected_ids if decisions[item_id] == 'critical'],
        'companions': companions,
        'onlyOriginalHighRatingsChanged': True,
        'mediumLowRowsPreserved': True,
        'protectedRowsCanonicalSha256': digest(after_protected),
        'allOtherFieldsPreserved': True,
        'rowOrderPreserved': [row['inventory_id'] for row in new_rows] == live_ids,
        'columnsPreserved': True,
    }
    return manifest, baseline_rows, columns, old_bytes, new_rows, result, report


def summary(rows, bands):
    by_area = {}
    for row in rows:
        by_area.setdefault(row['area'], Counter())[row['criticality']] += 1
    counts = Counter(row['criticality'] for row in rows)
    columns = ['area', *bands, 'total']
    data = [{'area': prefix, **{band: values[band] for band in bands}, 'total': sum(values.values())} for prefix, values in by_area.items()]
    data.append({'area': 'TOTAL', **{band: counts[band] for band in bands}, 'total': len(rows)})
    return render_table(columns, data, '\t')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate the High-only decisions and preservation invariants without writing')
    args = parser.parse_args()
    manifest, baseline_rows, columns, old_bytes, new_rows, result, report = prepare_refinement()
    if args.check:
        print(json.dumps(dict(report, applied=False), indent=2))
        return
    csv_path = OUT / 'audit-ledger.csv'
    report_path = OUT / 'reference/high-criticality-merge-report.json'
    permitted_csv_hashes = {manifest.get('originalCsvSha256')}
    if report_path.exists():
        permitted_csv_hashes.add(json.loads(report_path.read_text()).get('csvSha256'))
    if csv_path.exists() and digest(csv_path.read_bytes()) not in permitted_csv_hashes:
        raise ValueError('CSV changed independently; preserve/reconcile those edits before replacing its snapshot')
    initial_summary = summary(baseline_rows, ('high', 'medium', 'low'))
    initial_summary_path = OUT / 'reference/criticality-summary.initial.tsv'
    if initial_summary_path.exists() and initial_summary_path.read_bytes() != initial_summary:
        raise ValueError('Initial summary archive differs; preserve it')
    if (OUT / 'audit-ledger.tsv').read_bytes() != old_bytes:
        raise ValueError('Master changed during merge preparation; retry against the new contents')
    if not initial_summary_path.exists():
        atomic_write(initial_summary_path, initial_summary)
    csv_bytes = render_table(columns, new_rows, ',')
    atomic_write(OUT / 'audit-ledger.tsv', result)
    atomic_write(csv_path, csv_bytes)
    actual_columns, actual_rows, actual_bytes = load_table(OUT / 'audit-ledger.tsv')
    csv_columns, csv_rows, _ = load_table(csv_path, delimiter=',')
    if actual_bytes != result or actual_columns != columns or actual_rows != new_rows or csv_columns != columns or csv_rows != new_rows:
        raise ValueError('Read-back mismatch')
    report['csvSha256'] = digest(csv_bytes)
    report['applied'] = True
    atomic_write(report_path, (json.dumps(report, indent=2) + '\n').encode())
    atomic_write(OUT / 'reference/criticality-summary.tsv', summary(new_rows, BANDS))
    high_ids = {item_id for group in manifest['groups'].values() for item_id in group['ids']}
    atomic_write(OUT / 'reference/high-criticality-summary.tsv', summary([row for row in new_rows if row['inventory_id'] in high_ids], ('critical', 'high')))
    print(json.dumps({key: report[key] for key in ('totalRows', 'reassessedRows', 'protectedRows', 'counts', 'refinementCounts', 'onlyOriginalHighRatingsChanged', 'mediumLowRowsPreserved', 'allOtherFieldsPreserved', 'rowOrderPreserved', 'applied')}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
