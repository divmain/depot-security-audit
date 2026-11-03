import { readFileSync } from 'node:fs';

export interface InventoryEntry {
  id: string;
  /** The complete bullet line, verbatim. */
  text: string;
  line: number;
}

/** audit-inventory.md is a flat list: one bullet per line, e.g. `- [HTTP-001] **Title** — description`. */
const BULLET_RE = /^- \[([A-Z][A-Z0-9]*-\d+)\]/;

/**
 * Builds the full ID → bullet index once at startup (the file is ~2.8 MB and must
 * never enter model context). Per item, only the single matched bullet is used.
 */
export function parseInventory(path: string): Map<string, InventoryEntry> {
  const raw = readFileSync(path, 'utf8');
  const entries = new Map<string, InventoryEntry>();
  let lineNumber = 0;
  for (const line of raw.split('\n')) {
    lineNumber++;
    const match = BULLET_RE.exec(line);
    if (match == null) continue;
    const id = match[1];
    if (entries.has(id)) continue; // first occurrence wins
    entries.set(id, { id, text: line.trim(), line: lineNumber });
  }
  return entries;
}
