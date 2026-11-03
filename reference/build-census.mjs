import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY_LOGICAL_ROUTES } from '../../packages/shared/universal/registry-logical-routes.ts';
import { MUTATION_ROUTE_POLICY_REGISTRY } from '../../packages/shared/universal/mutation-route-policy.ts';
import { TOKEN_MINT_CENSUS } from '../../packages/shared/universal/token-mint-census.ts';
import { DOCKER_LOGICAL_ROUTE_LIST } from '../../packages/registry-api/routes/docker/logical-routes.ts';

// Static discovery only: application factories, listeners, databases, and test preloads are not run.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'out/reference');
await mkdir(output, { recursive: true });
const parserSpecifier = process.env.AUDIT_PARSER_PATH ?? 'oxc-parser';
const { parseSync } = await import(parserSpecifier);

function git(args) {
  const result = Bun.spawnSync(['git', ...args], { cwd: root });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}

const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
const sourceFiles = tracked.filter((file) =>
  /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file) &&
  !/\.(?:test|vitest|spec|type-test|test-double)\./.test(file) &&
  !file.endsWith('.d.ts') &&
  !/(?:^|\/)(?:test|testing|fixtures|node_modules)\//.test(file) &&
  !/(?:^|\/)(?:test-helpers|test-fixtures)\.[^/]+$/.test(file) &&
  !file.endsWith('routeTree.gen.ts'),
);
const serviceFiles = sourceFiles.filter((file) =>
  ['packages/control-plane/', 'packages/registry-api/', 'packages/shared-routes/']
    .some((prefix) => file.startsWith(prefix)),
);
const browserFiles = sourceFiles.filter((file) => file.startsWith('packages/ui/routes/'));
const methods = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace', 'all', 'route', 'ws', 'mount']);
const registrations = [];
const excludedMethodCalls = [];
const browserRoutes = [];
const parseErrors = [];

function walk(node, callback) {
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const value of node) {
      walk(value, callback);
    }
    return;
  }
  if (typeof node.type === 'string') {
    callback(node);
  }
  for (const [key, value] of Object.entries(node)) {
    if (!['comments', 'tokens', 'loc', 'range'].includes(key) && value && typeof value === 'object') {
      walk(value, callback);
    }
  }
}

function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((part) => part.value.cooked ?? part.value.raw).join('');
  }
  return null;
}

for (const file of [...serviceFiles, ...browserFiles]) {
  const source = await Bun.file(resolve(root, file)).text();
  const parsed = parseSync(file, source, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' });
  if (parsed.errors.length > 0) {
    parseErrors.push({ file, messages: parsed.errors.map((error) => error.message) });
    continue;
  }
  const prefixes = [];
  const lineOf = (node) => source.slice(0, node.start).split('\n').length;
  const expressionOf = (node) => node ? source.slice(node.start, node.end).replace(/\s+/g, ' ') : '';
  walk(parsed.program, (node) => {
    if (node.type === 'Property' && !node.computed && node.key?.name === 'prefix') {
      prefixes.push({ line: lineOf(node), expression: expressionOf(node.value) });
    }
    if (node.type !== 'CallExpression') {
      return;
    }
    if (file.startsWith('packages/ui/') && node.callee.type === 'Identifier' && node.callee.name === 'createFileRoute') {
      browserRoutes.push({ file, line: lineOf(node), routeId: literal(node.arguments[0]), expression: expressionOf(node.arguments[0]) });
      return;
    }
    if (file.startsWith('packages/ui/') || node.callee.type !== 'MemberExpression' || node.callee.computed) {
      return;
    }
    const method = node.callee.property.name;
    if (!methods.has(method) || node.arguments.length < 2) {
      return;
    }
    const pathNode = node.arguments[method === 'route' ? 1 : 0];
    const path = literal(pathNode);
    if (path !== null && !path.startsWith('/') && path !== '*') {
      return;
    }
    const pathLikeExpression =
      pathNode?.type === 'TemplateLiteral' ||
      (pathNode?.type === 'Identifier' && /(?:PATH|PATTERN|ROUTE|TEMPLATE)$/.test(pathNode.name)) ||
      (pathNode?.type === 'CallExpression' && pathNode.callee.type === 'Identifier' && /[Pp]ath|[Rr]oute/.test(pathNode.callee.name));
    if (path === null && !pathLikeExpression) {
      excludedMethodCalls.push({ file, line: lineOf(node.callee.property), method, expression: expressionOf(node.callee), firstArgument: expressionOf(pathNode) });
      return;
    }
    // Keep computed paths visible rather than pretending a source scan resolves their mounting.
    registrations.push({
      file,
      line: lineOf(node.callee.property),
      method: method === 'route' ? literal(node.arguments[0]) ?? expressionOf(node.arguments[0]) : method.toUpperCase(),
      declaredPath: path,
      pathExpression: expressionOf(pathNode),
      computed: path === null,
      registration: method,
      prefixesDeclaredInFile: prefixes,
    });
  });
}

registrations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
browserRoutes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const packageSourceCounts = Object.fromEntries(
  [...new Set(sourceFiles.filter((file) => file.startsWith('packages/')).map((file) => file.split('/')[1]))]
    .sort()
    .map((name) => [name, sourceFiles.filter((file) => file.startsWith(`packages/${name}/`)).length]),
);
const census = {
  generatedAt: new Date().toISOString(),
  tooling: { bun: Bun.version, parserSpecifier },
  commit: git(['rev-parse', 'HEAD']).trim(),
  initialTrackedDiff: git(['diff', '--stat', 'HEAD']).trim(),
  scope: 'Tracked source at this revision; source-only registration candidates, not a running router or a vulnerability scan.',
  limitations: [
    'HTTP registration paths are local source arguments. Constructor prefixes, caller mounts, loops, .all() expansion, implicit HEAD, conditional routes, and framework/plugin-owned routes require composition review.',
    'Method-name scanning can include non-router calls with the same signature; computed arguments remain explicitly unresolved. Non-path-like computed calls are retained separately in excludedMethodCalls for manual recheck.',
    'Canonical registry and mutation/mint tables are discovery cross-checks, not independent evidence that every live route enforces its classification.',
    'Browser routeId includes TanStack pathless/layout conventions and is not necessarily the public URL.',
    'Source file counts exclude tests/fixtures/declarations and generated route trees; they do not measure audit depth or security coverage.',
  ],
  packageSourceCounts,
  parseErrors,
  httpRegistrationCandidates: registrations,
  excludedMethodCalls,
  registryLogicalRoutes: REGISTRY_LOGICAL_ROUTES,
  dockerWildcardRefinements: DOCKER_LOGICAL_ROUTE_LIST,
  mutationRoutePolicy: MUTATION_ROUTE_POLICY_REGISTRY,
  tokenMintCensus: TOKEN_MINT_CENSUS,
  browserRoutes,
  sourceFiles,
};
await Bun.write(resolve(output, 'surface-census.json'), `${JSON.stringify(census, null, 2)}\n`);
const cleanCell = (value) => String(value ?? '').replace(/[\t\r\n]/g, ' ');
const tsv = [
  ['file', 'line', 'method', 'declared_path', 'path_expression', 'computed', 'prefixes_declared_in_file'],
  ...registrations.map((row) => [row.file, row.line, row.method, row.declaredPath, row.pathExpression, row.computed, row.prefixesDeclaredInFile.map((prefix) => prefix.expression).join(' ; ')]),
].map((row) => row.map(cleanCell).join('\t')).join('\n');
await Bun.write(resolve(output, 'http-registrations.tsv'), `${tsv}\n`);
console.log(JSON.stringify({
  commit: census.commit,
  sourceFiles: sourceFiles.length,
  packageSourceCounts,
  httpRegistrationCandidates: registrations.length,
  computedRegistrations: registrations.filter((row) => row.computed).length,
  registryLogicalRoutes: REGISTRY_LOGICAL_ROUTES.length,
  dockerWildcardRefinements: DOCKER_LOGICAL_ROUTE_LIST.length,
  mutationRoutes: MUTATION_ROUTE_POLICY_REGISTRY.length,
  tokenMintRows: TOKEN_MINT_CENSUS.length,
  browserRoutes: browserRoutes.length,
  parseErrors,
}, null, 2));
