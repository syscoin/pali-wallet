import { ActivityError, type ActivityViewState, type ActivityCandidate } from './types.ts';
export const ACTIVITY_CACHE_LIMIT = 24;
export const ACTIVITY_VIEW_LIMIT = 20;
const invalid = (): never => { throw new ActivityError('INVALID'); };
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const names = Object.keys(value);
  if (names.length !== fields.length || names.some(name => !fields.includes(name))) return invalid();
  return value as Record<string, unknown>;
}
export function validateActivityView(value: unknown): ActivityViewState {
  const data = exact(value, ['filter', 'showZero', 'anchor', 'offset']);
  if (
    !['all', 'sent', 'received'].includes(data.filter as string) ||
    typeof data.showZero !== 'boolean' ||
    !(
      data.anchor === null ||
      (typeof data.anchor === 'string' && /^0x[0-9a-f]{64}$/.test(data.anchor))
    ) ||
    typeof data.offset !== 'number' ||
    !Number.isFinite(data.offset) ||
    data.offset < 0 ||
    data.offset > 10000
  )
    return invalid();
  return Object.freeze(data as unknown as ActivityViewState);
}
export function validateActivityCandidate(value: unknown): ActivityCandidate {
  const data = exact(value, ['hash', 'blockNumber', 'timestamp', 'tokenHint']);
  if (
    typeof data.hash !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(data.hash) ||
    typeof data.blockNumber !== 'string' ||
    !/^(0|[1-9][0-9]{0,77})$/.test(data.blockNumber) ||
    typeof data.tokenHint !== 'boolean' ||
    !(
      data.timestamp === null ||
      (Number.isSafeInteger(data.timestamp) && (data.timestamp as number) >= 0)
    )
  )
    return invalid();
  return Object.freeze(data as unknown as ActivityCandidate);
}
