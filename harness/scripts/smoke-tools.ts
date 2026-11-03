/**
 * Smoke test for the sandboxed, virtualized filesystem tools. Run from harness/:
 *   bun run scripts/smoke-tools.ts
 * The model sees the repository mounted at /opt/depot (AUDIT_VIRTUAL_ROOT);
 * every access must stay inside the real repository directory. Exits non-zero
 * if any check fails.
 */
import { createFsTools } from '../src/fs-tools';
import { loadConfig } from '../src/config';

const cfg = loadConfig();
const V = cfg.virtualRoot;
const fs = createFsTools({ repoDir: cfg.repoDir, virtualRoot: cfg.virtualRoot });

let failures = 0;
async function check(name: string, run: () => Promise<string>, expect: (result: string) => boolean) {
  const result = await run();
  const ok = expect(result);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
  if (!ok) console.log(`  got: ${result.slice(0, 300).replaceAll('\n', '\\n')}`);
}

// --- Virtual path forms -------------------------------------------------------
await check('read_file virtual absolute', () => fs.readFile(`${V}/package.json`, 1, 5), r => r.includes(`${V}/package.json — lines 1–5`));
await check('read_file repo-relative', () => fs.readFile('package.json', 1, 5), r => r.includes('1:'));
await check('read_file pagination hint', () => fs.readFile('package.json', 1, 5), r => r.includes('continue with offset='));
await check('read_file offset past EOF', () => fs.readFile('package.json', 100000, 10), r => r.includes('past the end'));
await check('read_dir virtual root', () => fs.readDir(`${V}`), r => r.includes('(repository root)') && r.includes('packages/'));
await check('read_dir nested', () => fs.readDir('packages'), r => r.length > 10);
await check('read_dir on a file is refused', () => fs.readDir('package.json'), r => r.startsWith('[error]') && r.includes('use read_file'));

// --- Search tools -------------------------------------------------------------
await check('grep default scope (whole repo)', () => fs.grep('forwardScim', undefined, undefined, 5), r => r.startsWith(`${V}/`) && r.includes(':'));
await check('grep include filter', () => fs.grep('forwardScim', '*.ts', undefined, 5), r => !r.includes('.md:'));
await check('grep scoped virtual path', () => fs.grep('forwardScim', undefined, `${V}/packages/control-plane`, 5), r => r.split('\n').every(l => l.startsWith(`${V}/packages/control-plane`) || l.startsWith('(') || l === '' || !l.includes(':')));
await check('grep never leaks real host paths', () => fs.grep('forwardScim', undefined, undefined, 20), r => !r.includes('/Users/') && !r.includes(cfg.repoDir));
await check('glob any-depth', () => fs.glob('**/auth-middleware.ts', undefined, 5), r => r.includes(`${V}/packages/shared/server/auth-middleware.ts`));
await check('glob virtual-absolute pattern', () => fs.glob(`${V}/packages/shared/server/auth-*.ts`, undefined, 5), r => r.includes('auth-middleware.ts'));

// --- Sandbox guards: nothing outside the repository is accessible -------------
await check('deny foreign absolute path', () => fs.readFile('/etc/passwd', 1, 5), r => r.startsWith('[error]') && r.includes(`only paths under ${V}`));
await check('deny escape via ..', () => fs.readFile('../../AGENTS.md', 1, 5), r => r.startsWith('[error]') && r.includes('escapes the repository root'));
await check('deny virtual traversal', () => fs.readFile(`${V}/../../../etc/passwd`, 1, 5), r => r.startsWith('[error]'));
await check('deny missing path', () => fs.readFile('no-such-file.ts'), r => r.startsWith('[error]') && r.includes('not found'));

// --- Resource caps ------------------------------------------------------------
await check(
  'read_file size cap',
  () => fs.readFile('packages/shared/server/version-match/golden/rpm.json', 1, 5),
  r => r.startsWith('[error]') && r.includes('2 MB'),
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
