import { dirname, resolve } from 'node:path';

const SRC_DIR = import.meta.dir;
/** The harness/ directory itself. */
export const HARNESS_DIR = resolve(SRC_DIR, '..');
/** Audit workspace root: the directory holding audit-ledger.tsv, audit-inventory.md, reference/ and depot/. */
export const WORKSPACE_DIR = resolve(HARNESS_DIR, '..');

export interface ModelConfig {
  default: string;
  critical: string;
  high: string;
  medium: string;
  low: string;
}

export interface Config {
  baseUrl: string;
  apiKey: string;
  providerName: string;
  models: ModelConfig;
  concurrency: number;
  maxSteps: number;
  tokenBudget: number;
  doneStatus: string;
  virtualRoot: string;
  ledgerPath: string;
  inventoryPath: string;
  categoriesPath: string;
  repoDir: string;
  resultsDir: string;
  transcriptsDir: string;
}

function strEnv(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw == null || raw.trim() === '' ? fallback : raw.trim();
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  const model = strEnv('AUDIT_MODEL');
  const models: ModelConfig = {
    default: model,
    critical: strEnv('AUDIT_MODEL_CRITICAL', model),
    high: strEnv('AUDIT_MODEL_HIGH', model),
    medium: strEnv('AUDIT_MODEL_MEDIUM', model),
    low: strEnv('AUDIT_MODEL_LOW', model),
  };
  return {
    baseUrl: strEnv('AUDIT_BASE_URL'),
    apiKey: strEnv('AUDIT_API_KEY'),
    providerName: strEnv('AUDIT_PROVIDER_NAME', 'audit-provider'),
    models,
    concurrency: intEnv('AUDIT_CONCURRENCY', 8),
    maxSteps: intEnv('AUDIT_MAX_STEPS', 40),
    tokenBudget: intEnv('AUDIT_TOKEN_BUDGET', 200_000),
    doneStatus: strEnv('AUDIT_DONE_STATUS', 'done'),
    virtualRoot: strEnv('AUDIT_VIRTUAL_ROOT', '/opt/depot'),
    ledgerPath: resolve(WORKSPACE_DIR, 'audit-ledger.tsv'),
    inventoryPath: resolve(WORKSPACE_DIR, 'audit-inventory.md'),
    categoriesPath: resolve(WORKSPACE_DIR, 'Finding-Categories.md'),
    repoDir: resolve(WORKSPACE_DIR, 'depot'),
    resultsDir: resolve(HARNESS_DIR, 'results'),
    transcriptsDir: resolve(HARNESS_DIR, 'transcripts'),
  };
}

export function modelFor(models: ModelConfig, criticality: string): string {
  switch (criticality) {
    case 'critical':
      return models.critical;
    case 'high':
      return models.high;
    case 'medium':
      return models.medium;
    case 'low':
      return models.low;
    default:
      return models.default;
  }
}

export function assertInferenceConfig(cfg: Config): void {
  const missing: string[] = [];
  if (cfg.baseUrl === '') missing.push('AUDIT_BASE_URL');
  if (cfg.apiKey === '') missing.push('AUDIT_API_KEY');
  if (cfg.models.default === '') missing.push('AUDIT_MODEL');
  if (missing.length > 0) {
    throw new Error(
      `Missing inference configuration: ${missing.join(', ')}. ` +
        'Copy harness/.env.example to harness/.env and fill in the values (Bun loads .env automatically).',
    );
  }
}
