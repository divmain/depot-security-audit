import { tool } from 'ai';
import { z } from 'zod';
import type { FsTools } from './fs-tools';

/**
 * The reviewer's complete toolset: read-only filesystem access, sandboxed to the
 * audit workspace. Every tool paginates or caps its output so a single call can
 * never blow the item's context window.
 */
export function buildAuditTools(fs: FsTools) {
  return {
    read_file: tool({
      description:
        'Read a UTF-8 text file as 1-based numbered lines. Paths are absolute under /opt/depot ' +
        '(e.g. /opt/depot/packages/control-plane/app.ts) or relative to the repository root ' +
        '(e.g. packages/control-plane/app.ts — inventory bullets use this form). ' +
        'At most 500 lines per call; pass offset to continue a large file, ' +
        'or grep first to locate the relevant lines.',
      inputSchema: z.object({
        path: z.string().describe('File path, e.g. /opt/depot/packages/control-plane/app.ts or packages/control-plane/app.ts'),
        offset: z.number().int().min(1).optional().describe('First line to return (1-based). Default 1.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(200)
          .describe('Number of lines to return (default 200, max 500).'),
      }),
      execute: async ({ path, offset, limit }) => fs.readFile(path, offset ?? 1, limit ?? 200),
    }),

    read_dir: tool({
      description:
        'List the entries of a directory (one level, non-recursive). Directory names end with "/". ' +
        'Paths are absolute under /opt/depot or repository-relative; default is the repository root /opt/depot.',
      inputSchema: z.object({
        path: z.string().default('.').describe('Directory path. Default "." (repository root /opt/depot).'),
      }),
      execute: async ({ path }) => fs.readDir(path ?? '.'),
    }),

    grep: tool({
      description:
        'Search file contents with a JavaScript regular expression. Default scope is the whole ' +
        'repository (/opt/depot); pass path to scope tighter (e.g. /opt/depot/packages/control-plane). ' +
        'Results are path:line:text with /opt/depot-prefixed paths, capped. ' +
        'Use include (e.g. "*.ts") to restrict which files are searched.',
      inputSchema: z.object({
        pattern: z.string().describe('JavaScript regular expression source, e.g. forwardScim|forwardBetterAuth'),
        include: z.string().optional().describe('Glob filter for file names, e.g. "*.ts".'),
        path: z.string().optional().describe('Search root, absolute under /opt/depot or repository-relative. Default "/opt/depot".'),
        limit: z.number().int().min(1).max(100).default(50).describe('Maximum matches (default 50).'),
      }),
      execute: async ({ pattern, include, path, limit }) =>
        fs.grep(pattern, include, path, limit ?? 50),
    }),

    glob: tool({
      description:
        'Find files by glob pattern (e.g. "packages/control-plane/**/*.ts" or "/opt/depot/packages/**/*.ts"). ' +
        'Returns /opt/depot-prefixed paths, capped. Default scope is the repository root.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern; matched against both repository-relative and /opt/depot-prefixed paths.'),
        path: z.string().optional().describe('Search root, absolute under /opt/depot or repository-relative. Default "/opt/depot".'),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum paths to return (default 50).'),
      }),
      execute: async ({ pattern, path, limit }) => fs.glob(pattern, path, limit ?? 50),
    }),
  };
}
