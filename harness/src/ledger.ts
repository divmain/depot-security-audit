import { readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface LedgerRow {
  /** Original row order in the file (after the header), used as a stable tie-breaker. */
  index: number;
  /** All columns verbatim; only ever mutated through setField. */
  fields: string[];
  inventory_id: string;
  area: string;
  surface: string;
  criticality: string;
  status: string;
}

export interface Ledger {
  path: string;
  header: string[];
  col: Map<string, number>;
  rows: LedgerRow[];
  eol: string;
}

const CRITICALITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const REQUIRED_COLUMNS = ['inventory_id', 'area', 'surface', 'criticality', 'status'];

export function parseLedger(path: string): Ledger {
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const header = lines[0].split('\t');
  const col = new Map(header.map((name, i) => [name, i]));
  for (const name of REQUIRED_COLUMNS) {
    if (!col.has(name)) {
      throw new Error(`ledger at ${path} is missing required column '${name}'`);
    }
  }

  const rows: LedgerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const fields = lines[i].split('\t');
    while (fields.length < header.length) fields.push('');
    const get = (name: string): string => {
      const idx = col.get(name);
      return idx == null ? '' : (fields[idx] ?? '');
    };
    rows.push({
      index: rows.length,
      fields,
      inventory_id: get('inventory_id'),
      area: get('area'),
      surface: get('surface'),
      criticality: get('criticality'),
      status: get('status'),
    });
  }
  return { path, header, col, rows, eol };
}

export function setField(ledger: Ledger, row: LedgerRow, column: string, value: string): void {
  const idx = ledger.col.get(column);
  if (idx == null) throw new Error(`unknown ledger column: ${column}`);
  row.fields[idx] = value;
  if (column === 'status') row.status = value;
}

export function renderLedger(ledger: Ledger): string {
  const lines = [ledger.header.join('\t')];
  for (const row of ledger.rows) lines.push(row.fields.join('\t'));
  return lines.join(ledger.eol) + ledger.eol;
}

/** Write-then-rename so a crash never leaves a truncated ledger behind. */
export function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export interface SelectionFilter {
  statuses: string[];
  prefixes: string[];
  criticalities: string[];
  ids: Set<string>;
  limit?: number;
}

/**
 * Selection keeps ledger order within each criticality band, and orders bands
 * critical → high → medium → low, so the most important work is always dispatched first.
 */
export function selectItems(ledger: Ledger, filter: SelectionFilter): LedgerRow[] {
  const selected = ledger.rows.filter(row => {
    if (filter.statuses.length > 0 && !filter.statuses.includes(row.status)) return false;
    if (filter.prefixes.length > 0) {
      const matched = filter.prefixes.some(p =>
        row.inventory_id.toUpperCase().startsWith(`${p.toUpperCase()}-`),
      );
      if (!matched) return false;
    }
    if (filter.criticalities.length > 0 && !filter.criticalities.includes(row.criticality)) return false;
    if (filter.ids.size > 0 && !filter.ids.has(row.inventory_id)) return false;
    return true;
  });
  selected.sort(
    (a, b) =>
      (CRITICALITY_RANK[a.criticality] ?? 9) - (CRITICALITY_RANK[b.criticality] ?? 9) || a.index - b.index,
  );
  return filter.limit == null ? selected : selected.slice(0, filter.limit);
}
