import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { Glob } from 'bun';

export interface FsToolsOptions {
  /** The real repository directory all tools are confined to (e.g. ~/dev/depot-security-audit/depot). */
  repoDir: string;
  /** Virtual mount point presented to the model (e.g. /opt/depot). */
  virtualRoot: string;
}

export interface FsTools {
  readFile(path: string, offset?: number, limit?: number): Promise<string>;
  readDir(path: string): Promise<string>;
  grep(pattern: string, include?: string, path?: string, limit?: number): Promise<string>;
  glob(pattern: string, path?: string, limit?: number): Promise<string>;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.turbo',
  '.next',
  'target',
  '.venv',
  '__pycache__',
  '.idea',
  '.vscode',
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIR_ENTRIES = 500;
const MAX_GREP_LINES = 100;
const MAX_GREP_FILES = 20_000;
const MAX_GLOB_RESULTS = 200;

type ResolveResult = { ok: true; abs: string; display: string } | { ok: false; error: string };

export function createFsTools(opts: FsToolsOptions): FsTools {
  const repoReal = realpathSync(opts.repoDir);
  const virtualRoot = opts.virtualRoot.replace(/\/+$/, '') || '/';

  /**
   * Maps a model-supplied path to a repository-relative path. Accepted forms:
   * "" / "." / virtualRoot  -> repo root;  "/opt/depot/x" -> "x";  "x" -> "x".
   * Any other absolute path is rejected outright.
   */
  function toRepoRelative(
    input: string | undefined,
  ): { ok: true; rel: string } | { ok: false; error: string } {
    let rel = input == null ? '' : input.trim();
    if (rel === '') rel = '.';
    if (rel === virtualRoot) return { ok: true, rel: '.' };
    if (rel.startsWith(`${virtualRoot}/`)) return { ok: true, rel: rel.slice(virtualRoot.length + 1) };
    if (rel.startsWith('/')) {
      return { ok: false, error: `only paths under ${virtualRoot} are accessible, got: ${input}` };
    }
    return { ok: true, rel };
  }

  /** Resolves and validates against the real repository root (realpath guards symlink escapes). */
  function resolveInput(input: string | undefined): ResolveResult {
    const mapped = toRepoRelative(input);
    if (!mapped.ok) return mapped;
    const abs = resolve(repoReal, mapped.rel);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      return { ok: false, error: `path not found: ${input}` };
    }
    if (real !== repoReal && !real.startsWith(repoReal + sep)) {
      return { ok: false, error: `path escapes the repository root: ${input}` };
    }
    const inside = relative(repoReal, real);
    const display = inside === '' ? virtualRoot : `${virtualRoot}/${inside}`;
    return { ok: true, abs: real, display };
  }

  /** Converts an internal path back into the /opt/depot-prefixed form the model sees. */
  function virtualize(repoRelativePath: string): string {
    const stripped = repoRelativePath.replace(/^\.\//, '').replace(/^\//, '');
    return stripped === '' ? virtualRoot : `${virtualRoot}/${stripped}`;
  }

  /** Iterative file walker that never follows symlinks and skips heavy/irrelevant directories. */
  function* walkFiles(rootAbs: string): Generator<string> {
    const stack = [rootAbs];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir == null) continue;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
        } else if (entry.isFile()) {
          yield abs;
        }
      }
    }
  }

  async function readFile(path: string, offset = 1, limit = 200): Promise<string> {
    const resolved = resolveInput(path);
    if (!resolved.ok) return `[error] ${resolved.error}`;

    let stats;
    try {
      stats = statSync(resolved.abs);
    } catch {
      return `[error] cannot stat ${path}`;
    }
    if (stats.isDirectory()) {
      return `[error] ${resolved.display} is a directory; use read_dir instead`;
    }
    if (!stats.isFile()) {
      return `[error] ${resolved.display} is not a regular file`;
    }
    if (stats.size > MAX_FILE_BYTES) {
      return (
        `[error] ${resolved.display} is ${(stats.size / 1e6).toFixed(1)} MB, above the 2 MB read limit; ` +
        'use grep to locate the relevant lines, then read a window'
      );
    }

    const file = Bun.file(resolved.abs);
    const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
    if (head.includes(0)) {
      return `[error] ${resolved.display} appears to be a binary file`;
    }

    const text = await file.text();
    const lines = text.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const total = lines.length;
    if (total === 0) return `${resolved.display} — empty file`;
    if (offset > total) {
      return `${resolved.display} — offset ${offset} is past the end of the file (it has ${total} lines)`;
    }

    const start = Math.max(1, offset);
    const end = Math.min(total, start + limit - 1);
    const out = [
      `${resolved.display} — lines ${start}\u2013${end} of ${total}` +
        (end < total ? ` (continue with offset=${end + 1})` : ''),
    ];
    for (let i = start; i <= end; i++) {
      out.push(`${i}: ${lines[i - 1]}`);
    }
    return out.join('\n');
  }

  function readDir(path: string): Promise<string> {
    const resolved = resolveInput(path ?? '.');
    if (!resolved.ok) return Promise.resolve(`[error] ${resolved.error}`);
    let stats;
    try {
      stats = statSync(resolved.abs);
    } catch {
      return Promise.resolve(`[error] cannot stat ${path}`);
    }
    if (stats.isFile()) {
      return Promise.resolve(`[error] ${resolved.display} is a file; use read_file instead`);
    }
    let entries;
    try {
      entries = readdirSync(resolved.abs, { withFileTypes: true });
    } catch {
      return Promise.resolve(`[error] cannot list ${path}`);
    }
    const visible = entries.filter(e => e.name !== '.DS_Store');
    const shown = visible
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_DIR_ENTRIES)
      .map(e => (e.isDirectory() ? `${e.name}/` : e.name));
    const note = visible.length > MAX_DIR_ENTRIES ? ` (showing first ${MAX_DIR_ENTRIES})` : '';
    const header =
      `${resolved.display}${resolved.abs === repoReal ? ' (repository root)' : ''} — ` +
      `${visible.length} entries${note}`;
    return Promise.resolve([header, ...shown].join('\n'));
  }

  let ripgrepAvailable: boolean | null = null;
  function hasRipgrep(): boolean {
    if (ripgrepAvailable == null) {
      try {
        const probe = Bun.spawnSync({ cmd: ['rg', '--version'], stdout: 'ignore', stderr: 'ignore' });
        ripgrepAvailable = probe.exitCode === 0;
      } catch {
        ripgrepAvailable = false;
      }
    }
    return ripgrepAvailable;
  }

  async function grep(
    pattern: string,
    include?: string,
    path?: string,
    limit = 50,
  ): Promise<string> {
    const rootArg = path == null || path.trim() === '' ? '.' : path.trim();
    const mapped = toRepoRelative(rootArg);
    if (!mapped.ok) return `[error] ${mapped.error}`;
    const resolved = resolveInput(rootArg);
    if (!resolved.ok) return `[error] ${resolved.error}`;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      return `[error] invalid JavaScript regular expression: ${pattern} (${(error as Error).message})`;
    }

    const capped = Math.min(limit, MAX_GREP_LINES);

    if (hasRipgrep()) {
      const args = [
        'rg',
        '--line-number',
        '--no-heading',
        '--max-columns',
        '300',
        '--max-filesize',
        '2M',
      ];
      if (include != null && include !== '') args.push('-g', include);
      for (const dir of SKIP_DIRS) args.push('-g', `!**/${dir}/**`);
      args.push('--', pattern, mapped.rel);
      const proc = Bun.spawnSync({
        cmd: args,
        cwd: repoReal,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      // rg exits 0 on matches, 1 on no matches, 2 on error (e.g. unsupported regex syntax).
      if (proc.exitCode !== 2) {
        const lines = String(proc.stdout)
          .split('\n')
          .filter(l => l !== '')
          .map(l => virtualize(l.split(':')[0] ?? '') + l.slice(l.indexOf(':')));
        if (lines.length === 0) {
          return `no matches for /${pattern}/ under ${resolved.display}`;
        }
        const shown = lines.slice(0, capped);
        const note =
          lines.length > capped ? `\n(${lines.length} matches; showing first ${capped} — refine the pattern or scope)` : '';
        return `${shown.join('\n')}${note}`;
      }
    }

    // JavaScript fallback: also used when rg is missing or rejects the regex (lookaround etc.).
    const includeGlob = include != null && include !== '' ? new Glob(include) : undefined;
    const matches: string[] = [];
    let filesScanned = 0;
    let truncated = false;
    for (const absFile of walkFiles(resolved.abs)) {
      if (matches.length >= capped || filesScanned >= MAX_GREP_FILES) {
        truncated = true;
        break;
      }
      filesScanned++;
      const display = virtualize(relative(repoReal, absFile));
      if (includeGlob != null && !includeGlob.match(basename(display)) && !includeGlob.match(display)) {
        continue;
      }
      let stats;
      try {
        stats = statSync(absFile);
      } catch {
        continue;
      }
      if (stats.size > MAX_FILE_BYTES) continue;
      let text: string;
      try {
        text = readFileSync(absFile, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\0')) continue;
      const fileLines = text.split('\n');
      for (let i = 0; i < fileLines.length; i++) {
        if (regex.test(fileLines[i])) {
          matches.push(`${display}:${i + 1}:${fileLines[i].trim().slice(0, 300)}`);
          if (matches.length >= capped) break;
        }
      }
    }
    matches.sort();
    if (matches.length === 0) {
      return truncated
        ? `no matches for /${pattern}/ under ${resolved.display} (search truncated after ${filesScanned} files — scope it tighter)`
        : `no matches for /${pattern}/ under ${resolved.display}`;
    }
    const note = truncated ? `\n(results truncated after ${filesScanned} files scanned — scope the search tighter)` : '';
    return `${matches.join('\n')}${note}`;
  }

  function globSearch(pattern: string, path?: string, limit = 50): string {
    const rootArg = path == null || path.trim() === '' ? '.' : path.trim();
    const resolved = resolveInput(rootArg);
    if (!resolved.ok) return `[error] ${resolved.error}`;

    const capped = Math.min(limit, MAX_GLOB_RESULTS);
    // Accept both "packages/x/*.ts" and "/opt/depot/packages/x/*.ts" style patterns.
    const strippedPattern = pattern.startsWith(`${virtualRoot}/`)
      ? pattern.slice(virtualRoot.length + 1)
      : pattern;
    const direct = new Glob(strippedPattern);
    const anyDepth = new Glob(`**/${strippedPattern}`);
    const asGiven = new Glob(pattern);
    const matches: string[] = [];
    for (const absFile of walkFiles(resolved.abs)) {
      const relToRoot = relative(resolved.abs, absFile);
      const display = virtualize(relative(repoReal, absFile));
      if (
        direct.match(relToRoot) ||
        anyDepth.match(relToRoot) ||
        asGiven.match(display)
      ) {
        matches.push(display);
      }
    }
    matches.sort();
    const shown = matches.slice(0, capped);
    if (shown.length === 0) {
      return `no files match glob '${pattern}' under ${resolved.display}`;
    }
    const note = matches.length > capped ? `\n(${matches.length} matches; showing first ${capped})` : '';
    return `${matches.length} file(s) matching '${pattern}' under ${resolved.display}:\n${shown.join('\n')}${note}`;
  }

  return {
    readFile,
    readDir,
    grep,
    glob: (pattern: string, path?: string, limit?: number) =>
      Promise.resolve(globSearch(pattern, path, limit)),
  };
}
