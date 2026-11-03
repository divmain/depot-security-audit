import { readFileSync } from 'node:fs';

/**
 * The complete taxonomy document is embedded verbatim in the system prompt so
 * classification never depends on the model choosing to read it. It also lives
 * outside the repository sandbox, so the tools could not reach it anyway.
 */
export function readCategoriesDocument(path: string): string {
  return readFileSync(path, 'utf8').trim();
}
