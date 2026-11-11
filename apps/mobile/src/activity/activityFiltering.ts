import { getEvmHistoryDirection } from '../../../../source/shared/evmHistory.ts';
import type { ActivityRow } from './nativeActivity.ts';
import type { ActivityViewState } from './types.ts';

export function activityRowDirection(row: ActivityRow, owner: string) {
  const collectible = row.local?.collectibleTransfer;
  if (collectible) return getEvmHistoryDirection({ from: collectible.from, to: collectible.recipient }, owner);
  if (row.indexed) return getEvmHistoryDirection(row.indexed, owner);
  if (row.local) return getEvmHistoryDirection({ from: owner, to: row.local.recipient }, owner);
  return row.observation ? getEvmHistoryDirection(row.observation, owner, row.observation.events) : 'unknown';
}

export const zeroOnlyActivity = (row: ActivityRow): boolean => row.indexed ? row.zeroValueToken === true
  : !row.local && row.observation?.valueUnits === '0' && row.observation.events.length > 0 && row.observation.events.every(event => event.amountUnits === '0');

export function matchesActivityView(row: ActivityRow, owner: string, view: ActivityViewState, unknown: 'include' | 'exclude'): boolean {
  if (!view.showZero && zeroOnlyActivity(row)) return false;
  const direction = activityRowDirection(row, owner);
  return view.filter === 'all' || direction === 'self' || direction === view.filter ||
    (unknown === 'include' && direction === 'unknown');
}
