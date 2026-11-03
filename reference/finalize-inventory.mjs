import { createHash } from 'node:crypto';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'out');
const partsDirectory = resolve(output, 'audit-inventory');
const parts = [
  ['01-http-ingress.md', 'HTTP'],
  ['02-authentication-sessions.md', 'AUTH'],
  ['03-identity-authorization.md', 'IAM'],
  ['04-federation-scim.md', 'FED'],
  ['05-trusted-publishing.md', 'OIDC'],
  ['06-privileged-access.md', 'PAM'],
  ['07-repository-lifecycle.md', 'REPO'],
  ['08-policy-facts.md', 'POL'],
  ['09-governance-security.md', 'GOV'],
  ['10-search-dashboard-management.md', 'READ'],
  ['11-evidence-events.md', 'EVID'],
  ['12-integrations-delivery.md', 'INT'],
  ['13-coordination-operations.md', 'OPS'],
  ['14-registry-core.md', 'REG'],
  ['15-npm-cargo.md', 'NPMCR'],
  ['16-docker-helm.md', 'OCI'],
  ['17-pypi-rubygems-composer.md', 'PYRC'],
  ['18-go-maven-nuget.md', 'GMN'],
  ['19-distro-generic.md', 'DIST'],
  ['20-database-persistence.md', 'DATA'],
  ['21-egress-upstreams.md', 'NET'],
  ['22-blobs-binary-crypto.md', 'BIN'],
  ['23-browser-ui.md', 'WEB'],
  ['24-cli-sdk-config.md', 'CLI'],
  ['25-build-deployment-tooling.md', 'BUILD'],
];
const actualParts = (await readdir(partsDirectory)).sort();
const expectedParts = parts.map(([file]) => file).sort();
if (JSON.stringify(actualParts) !== JSON.stringify(expectedParts)) {
  throw new Error(`Part directory differs from the reviewed manifest: ${JSON.stringify(actualParts)}`);
}
if (!(await Bun.file(resolve(output, 'Finding-Categories.md')).exists())) {
  throw new Error('The taxonomy must be complete before consolidation.');
}

const hash = (text) => createHash('sha256').update(text).digest('hex');
const seen = new Set();
const allItems = [];
const manifest = [];
for (const [file, prefix] of parts) {
  const content = await Bun.file(resolve(partsDirectory, file)).text();
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`Empty inventory part: ${file}`);
  }
  for (const [index, line] of lines.entries()) {
    const match = /^- \[([A-Z]+)-(\d+)\] \*\*(.+?)\*\*\s*[—–:-]\s*(.+)$/.exec(line);
    if (match === null || match[1] !== prefix || Number(match[2]) !== index + 1) {
      throw new Error(`Expected one sequential ${prefix} bullet on each nonblank line: ${file}:${String(index + 1)} ${line.slice(0, 160)}`);
    }
    const id = `${match[1]}-${match[2]}`;
    if (seen.has(id)) {
      throw new Error(`Duplicate item ID: ${id}`);
    }
    seen.add(id);
    allItems.push({ id, prefix, title: match[3], description: match[4], line });
  }
  manifest.push({ sourcePart: file, prefix, itemCount: lines.length, sha256: hash(content) });
}

const inventory = `${allItems.map((item) => item.line).join('\n')}\n`;
await Bun.write(resolve(output, 'audit-inventory.md'), inventory);
const reread = await Bun.file(resolve(output, 'audit-inventory.md')).text();
if (reread !== inventory) {
  throw new Error('Merged inventory read-back differs from the validated source items.');
}

const columns = ['inventory_id', 'area', 'surface', 'status', 'reviewer', 'reviewed_revision', 'category_ids', 'outcome', 'evidence', 'notes'];
const existingRows = new Map();
const ledgerFile = Bun.file(resolve(output, 'audit-ledger.tsv'));
if (await ledgerFile.exists()) {
  // Remove only the terminal newline; trailing tabs encode empty review fields.
  const existing = (await ledgerFile.text()).replace(/\r?\n$/, '').split('\n');
  if (existing.shift() !== columns.join('\t')) {
    throw new Error('Existing audit ledger uses a different schema; preserve and reconcile it manually.');
  }
  for (const line of existing) {
    const cells = line.split('\t');
    if (cells.length !== columns.length) {
      throw new Error('Existing audit ledger has a non-rectangular row; preserve and reconcile it manually.');
    }
    existingRows.set(cells[0], cells);
  }
  for (const id of existingRows.keys()) {
    if (!seen.has(id)) {
      throw new Error(`Existing ledger has an item absent from consolidation: ${id}`);
    }
  }
}
const cell = (text) => String(text ?? '').replace(/[\t\r\n]/g, ' ');
const rows = allItems.map((item) => {
  const existing = existingRows.get(item.id);
  return existing ?? [item.id, item.prefix, item.title, 'not_started', '', '', '', '', '', ''];
});
await Bun.write(resolve(output, 'audit-ledger.tsv'), `${[columns, ...rows].map((row) => row.map(cell).join('\t')).join('\n')}\n`);

const census = await Bun.file(resolve(output, 'reference/surface-census.json')).json();
const routeCoverage = census.httpRegistrationCandidates.map((route) => {
  const items = allItems.filter((item) => item.line.includes(route.file));
  return [route.file, route.line, route.method, route.declaredPath ?? route.pathExpression, items.map((item) => item.id).join(','), items.length === 0 ? 'needs_source_reference_reconciliation' : 'source_referenced_not_audit_verified'];
});
await Bun.write(resolve(output, 'reference/http-source-crosswalk.tsv'), `${[
  ['source_file', 'source_line', 'method', 'local_path_expression', 'inventory_ids_referencing_source', 'traceability_status'],
  ...routeCoverage,
].map((row) => row.map(cell).join('\t')).join('\n')}\n`);
await Bun.write(resolve(output, 'reference/preparation-manifest.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceCommit: census.commit,
  inventorySha256: hash(inventory),
  totalItems: allItems.length,
  parts: manifest,
  sourceRegistrationCandidates: routeCoverage.length,
  candidatesWhoseSourceIsReferenced: routeCoverage.filter((row) => row[4].length > 0).length,
  caveat: 'Source-file references are traceability only, not method-specific coverage, completed review, or evidence of security.',
}, null, 2)}\n`);

if (process.argv.includes('--remove-parts')) {
  // Delete only the explicitly enumerated, validated source parts after merged content is read back.
  for (const [file] of parts) {
    await unlink(resolve(partsDirectory, file));
  }
  await rmdir(partsDirectory);
}
console.log(JSON.stringify({ totalItems: allItems.length, areas: manifest.map(({ prefix, itemCount }) => ({ prefix, itemCount })), sourceCandidatesWithoutReference: routeCoverage.filter((row) => row[4].length === 0), partsRemoved: process.argv.includes('--remove-parts') }, null, 2));
