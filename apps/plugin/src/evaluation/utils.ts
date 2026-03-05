import type { Evaluator } from './types';

const VALID_ID_PATTERN = /^[\w.]+$/;

/** Returns true if the given ID contains only word characters and dots. */
export function isValidResourceID(id: string): boolean {
  return VALID_ID_PATTERN.test(id);
}

export const INVALID_ID_MESSAGE = 'Only letters, digits, _, and . are allowed';

/** Returns one evaluator per evaluator_id, keeping the one with the latest updated_at. */
export function pickLatestVersionPerEvaluator(evaluators: Evaluator[]): Evaluator[] {
  const byId = new Map<string, Evaluator>();
  for (const e of evaluators) {
    const existing = byId.get(e.evaluator_id);
    if (existing == null || new Date(e.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
      byId.set(e.evaluator_id, e);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.evaluator_id.localeCompare(b.evaluator_id));
}
