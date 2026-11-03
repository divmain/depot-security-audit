"""Validate audit working artifacts, not product behavior or security controls."""

import csv
import hashlib
import json
import re
import runpy
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
errors = []
notes = []


def headings(path):
    result = set()
    occurrences = {}
    for line in path.read_text().splitlines():
        match = re.match(r'^#{1,6}\s+(.+?)\s*#*$', line)
        if not match:
            continue
        text = re.sub(r'<[^>]*>', '', match.group(1)).lower()
        slug = ''.join(char for char in text if char.isalnum() or char in ' _-').replace(' ', '-')
        occurrence = occurrences.get(slug, 0)
        occurrences[slug] = occurrence + 1
        result.add(slug if occurrence == 0 else '{}-{}'.format(slug, occurrence))
    return result


def check_link(document, target):
    target = target.strip().strip('<>')
    if not target or target.startswith(('http:', 'https:', 'mailto:', 'data:')):
        return
    split = urlsplit(target)
    destination = (document.parent / unquote(split.path)).resolve() if split.path else document
    # The validation report is produced by this invocation after its inputs are checked.
    if not destination.exists() and destination != OUT / 'reference/pack-validation.json':
        errors.append('{}: missing link target {}'.format(document.relative_to(ROOT), target))
    elif split.fragment and destination.suffix == '.md' and unquote(split.fragment) not in headings(destination):
        errors.append('{}: unresolved heading {}'.format(document.relative_to(ROOT), target))


for document in sorted(OUT.glob('*.md')):
    text = document.read_text()
    for match in re.finditer(r'\[[^\]\n]*\]\(([^)\n]+)\)', text):
        check_link(document, match.group(1))
    for match in re.finditer(r'^\[[^\]]+\]:\s*(\S+)', text, re.MULTILINE):
        check_link(document, match.group(1))

inventory = OUT / 'audit-inventory.md'
items = []
ids = set()
if not inventory.exists():
    errors.append('Missing consolidated audit inventory')
else:
    for number, line in enumerate(inventory.read_text().splitlines(), 1):
        if not line.strip():
            continue
        match = re.match(r'^- \[([A-Z]+-\d+)\] \*\*(.+?)\*\*\s*[—–:-]\s*(.+)$', line)
        if not match:
            errors.append('Inventory line {} is not a discrete labeled bullet'.format(number))
            continue
        item_id = match.group(1)
        if item_id in ids:
            errors.append('Duplicate inventory ID {}'.format(item_id))
        ids.add(item_id)
        items.append((item_id, line))

ledger = OUT / 'audit-ledger.tsv'
criticality_validation = {}
if not ledger.exists():
    errors.append('Missing audit ledger')
else:
    with ledger.open(newline='') as handle:
        reader = csv.DictReader(handle, delimiter='\t')
        ledger_columns = reader.fieldnames
        rows = list(reader)
    if not ledger_columns or len(ledger_columns) != len(set(ledger_columns)) or any(None in row or any(value is None for value in row.values()) for row in rows):
        errors.append('Ledger has duplicate columns or non-rectangular rows')
    ledger_ids = [row['inventory_id'] for row in rows]
    if len(set(ledger_ids)) != len(ledger_ids) or set(ledger_ids) != ids:
        errors.append('Ledger item IDs differ from inventory or repeat')
    notes.append({'ledger_status_counts': {status: sum(row['status'] == status for row in rows) for status in sorted({row['status'] for row in rows})}})
    bands = ('critical', 'high', 'medium', 'low')
    if not ledger_columns or 'criticality' not in ledger_columns:
        errors.append('Ledger is missing criticality')
    else:
        invalid = [row['inventory_id'] for row in rows if row.get('criticality') not in bands]
        if invalid:
            errors.append('Invalid or empty criticality labels: ' + ', '.join(invalid))
        counts = Counter(row.get('criticality') for row in rows)
        criticality_validation['counts'] = {band: counts[band] for band in bands}
        criticality_validation['rows'] = len(rows)
        companion_ids = set()
        companion_values = {}
        input_manifest_path = OUT / 'reference/criticality-input-manifest.json'
        if not input_manifest_path.exists():
            errors.append('Missing criticality input manifest')
        else:
            classification_inputs = json.loads(input_manifest_path.read_text())
            if classification_inputs['inventorySha256'] != hashlib.sha256(inventory.read_bytes()).hexdigest():
                errors.append('Criticality inputs refer to a different inventory')
            initial_rubric_path = OUT / 'Criticality-Rubric.initial.md'
            if not initial_rubric_path.exists():
                initial_rubric_path = OUT / 'Criticality-Rubric.md'
            if classification_inputs['rubricSha256'] != hashlib.sha256(initial_rubric_path.read_bytes()).hexdigest():
                errors.append('Criticality rubric differs from classification snapshot')
            expected_companions = {Path(group['companion']).name for group in classification_inputs['groups'].values()}
            if {path.name for path in (OUT / 'criticality').glob('*.tsv')} != expected_companions:
                errors.append('Criticality companion file set differs from input manifest')
            for prefix, group in classification_inputs['groups'].items():
                path = OUT / group['companion']
                if not path.exists():
                    errors.append('Missing criticality companion: ' + prefix)
                    continue
                with path.open(newline='') as handle:
                    reader = csv.DictReader(handle, delimiter='\t')
                    companion_rows = list(reader)
                    if reader.fieldnames != ['inventory_id', 'criticality']:
                        errors.append('Wrong companion columns: ' + prefix)
                        continue
                if [row.get('inventory_id') for row in companion_rows] != group['ids']:
                    errors.append('Companion ID/order mismatch: ' + prefix)
                for row in companion_rows:
                    item_id = row.get('inventory_id')
                    if None in row or row.get('criticality') not in ('high', 'medium', 'low') or item_id in companion_ids:
                        errors.append('Invalid or duplicate companion classification: ' + str(item_id))
                    companion_ids.add(item_id)
                    companion_values[item_id] = row.get('criticality')
            if companion_ids != ids:
                errors.append('Companion IDs differ from inventory')
            criticality_validation['companionRows'] = len(companion_ids)
            criticality_validation['matchesInitialCompanions'] = all(row.get('criticality') == companion_values.get(row['inventory_id']) for row in rows)
        refinement_manifest_path = OUT / 'reference/high-criticality-input-manifest.json'
        if refinement_manifest_path.exists():
            refinement_tools = runpy.run_path(str(OUT / 'reference/merge-high-criticality.py'), run_name='high_criticality_validation')
            try:
                _, _, _, _, projected_rows, _, refinement = refinement_tools['prepare_refinement']()
                criticality_validation['highOnlyRefinement'] = {
                    'reassessedRows': refinement['reassessedRows'],
                    'protectedRows': refinement['protectedRows'],
                    'onlyOriginalHighRatingsChanged': refinement['onlyOriginalHighRatingsChanged'],
                    'mediumLowRowsPreserved': refinement['mediumLowRowsPreserved'],
                    'matchesRefinedDecisions': rows == projected_rows,
                }
                if rows != projected_rows:
                    errors.append('Master ratings differ from the High-only refinement decisions')
            except (ValueError, OSError) as error:
                errors.append('High-only refinement invariant: ' + str(error))
        merge_report_path = OUT / 'reference/criticality-merge-report.json'
        if (OUT / 'reference/high-criticality-merge-report.json').exists():
            merge_report_path = OUT / 'reference/high-criticality-merge-report.json'
        merge_report = json.loads(merge_report_path.read_text()) if merge_report_path.exists() else {}
        unchanged_since_merge = hashlib.sha256(ledger.read_bytes()).hexdigest() == merge_report.get('afterLedgerSha256')
        criticality_validation['ledgerUnchangedSinceLatestMerge'] = unchanged_since_merge
        criticality_validation['latestMergeReport'] = str(merge_report_path.relative_to(OUT))
        csv_path = OUT / 'audit-ledger.csv'
        if not csv_path.exists():
            errors.append('Missing CSV ledger snapshot')
        else:
            with csv_path.open(newline='') as handle:
                reader = csv.DictReader(handle)
                csv_rows = list(reader)
                csv_columns = reader.fieldnames
            csv_matches = csv_columns == ledger_columns and csv_rows == rows
            criticality_validation['csvMatchesCurrentMaster'] = csv_matches
            if unchanged_since_merge and not csv_matches:
                errors.append('CSV differs from the unchanged merged master')
            if not csv_matches and hashlib.sha256(csv_path.read_bytes()).hexdigest() != merge_report.get('csvSha256'):
                errors.append('CSV matches neither the current master nor the recorded export snapshot')

taxonomy = (OUT / 'Finding-Categories.md').read_text()
category_sections = re.split(r'^### (FC-[A-Z0-9-]+)\s*$', taxonomy, flags=re.MULTILINE)
category_ids = category_sections[1::2]
if not category_ids or len(category_ids) != len(set(category_ids)):
    errors.append('Taxonomy category IDs are absent or repeated')
for category, content in zip(category_sections[1::2], category_sections[2::2]):
    if '**Hypothetical example' not in content:
        errors.append('{} has no labeled hypothetical example'.format(category))


def expand_braces(path):
    match = re.search(r'\{([^{}]+)\}', path)
    if not match:
        return [path]
    if ',' not in match.group(1):
        return []
    return [expanded for option in match.group(1).split(',') for expanded in expand_braces(path[:match.start()] + option + path[match.end():])]


checked_paths = set()
unresolved_paths = {}
for item_id, line in items:
    for token in re.findall(r'`([^`]+)`', line):
        # Repository-absolute spelling is required for automatic checks; symbolic/contextual shorthand stays manual.
        for raw_path in re.findall(r'(?<![\w./:$-])(?:packages|tools|test|docs|bench|patches|\.github)/[^\s;()]+', token):
            raw_path = raw_path.rstrip('.,:')
            raw_path = re.sub(r'[:#]\d+(?:-\d+)?$', '', raw_path)
            raw_path = raw_path.split('#')[0]
            if '...' in raw_path or '…' in raw_path or '<' in raw_path or '>' in raw_path:
                continue
            for path in expand_braces(raw_path):
                if (ROOT / path).exists() or ('*' in path and any(ROOT.glob(path))):
                    checked_paths.add(path)
                else:
                    unresolved_paths.setdefault(path, []).append(item_id)

manifest_path = OUT / 'reference/preparation-manifest.json'
if manifest_path.exists() and inventory.exists():
    manifest = json.loads(manifest_path.read_text())
    if manifest['totalItems'] != len(items):
        errors.append('Manifest item total differs from inventory')
    if manifest['inventorySha256'] != hashlib.sha256(inventory.read_bytes()).hexdigest():
        errors.append('Manifest checksum differs from inventory')

census_path = OUT / 'reference/surface-census.json'
surface_traceability = {}
if census_path.exists() and items:
    census = json.loads(census_path.read_text())
    literal_rows = [row for row in census['httpRegistrationCandidates'] if not row['computed']]
    missing_routes = []
    for row in literal_rows:
        if not any(row['file'] in line and row['declaredPath'] in line and re.search(r'\b' + re.escape(row['method']) + r'\b', line) for _, line in items):
            missing_routes.append({key: row[key] for key in ('file', 'line', 'method', 'declaredPath')})
    missing_browser_sources = [row for row in census['browserRoutes'] if not any(row['file'] in line for _, line in items)]
    surface_traceability = {
        'literal_http_registration_candidates': len(literal_rows),
        'literal_method_path_source_reconciliation': missing_routes,
        'computed_registration_candidates_for_composition_review': sum(row['computed'] for row in census['httpRegistrationCandidates']),
        'browser_route_declarations': len(census['browserRoutes']),
        'browser_route_source_reconciliation': missing_browser_sources,
        'meaning': 'Textual entry-point traceability only; not semantic coverage, mounted-runtime observation, or completed security review.',
    }
    if missing_routes:
        errors.append('Literal HTTP source/method/path references require reconciliation')
    if missing_browser_sources:
        errors.append('Browser route source references require reconciliation')

result = {
    'inventory_items': len(items),
    'finding_categories': len(category_ids),
    'checked_source_path_spellings': len(checked_paths),
    'errors': errors,
    'source_paths_requiring_reconciliation': unresolved_paths,
    'surface_traceability': surface_traceability,
    'criticality': criticality_validation,
    'notes': notes,
    'scope': 'Artifact format, links, IDs, ledger parity, manifest checksum and literal source paths only; no product tests or security review.',
}
(OUT / 'reference/pack-validation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(1 if errors or unresolved_paths else 0)
