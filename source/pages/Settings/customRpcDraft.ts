import {
  getControllerStatus,
  subscribeControllerStatus,
} from 'hooks/controllerStatus';
import store from 'state/store';
import { getWalletNavigationScope } from 'utils/navigationState';

export interface ICustomRpcDraft {
  isSyscoinRpc: boolean;
  values: Record<string, string>;
}

const FIELD_NAMES = ['label', 'url', 'chainId', 'symbol', 'explorer', 'apiUrl'];
const MAX_DRAFTS = 8;
const MAX_AGE = 15 * 60 * 1000;
const drafts = new Map<
  string,
  { draft: ICustomRpcDraft; editor: string; scope: string; timestamp: number }
>();
let stopStore: (() => void) | undefined;
let stopStatus: (() => void) | undefined;

export const clearCustomRpcDrafts = () => {
  drafts.clear();
  stopStore?.();
  stopStatus?.();
  stopStore = undefined;
  stopStatus = undefined;
};

const prune = () => {
  const scope = JSON.stringify(getWalletNavigationScope());
  if (!getControllerStatus().isUnlocked) {
    clearCustomRpcDrafts();
    return;
  }
  for (const [id, entry] of drafts) {
    if (entry.scope !== scope || Date.now() - entry.timestamp > MAX_AGE)
      drafts.delete(id);
  }
  if (!drafts.size) clearCustomRpcDrafts();
};

/** Endpoint text stays only in this document's bounded, authenticated memory. */
export const writeCustomRpcDraft = (
  id: string,
  scope: string,
  editor: string,
  draft: ICustomRpcDraft
) => {
  prune();
  if (
    !getControllerStatus().isUnlocked ||
    scope !== JSON.stringify(getWalletNavigationScope())
  )
    return;
  const values: Record<string, string> = {};
  for (const key of FIELD_NAMES) {
    const value = draft.values[key];
    if (typeof value === 'string') values[key] = value.slice(0, 4096);
    else if (typeof value === 'number' && Number.isFinite(value))
      values[key] = String(value);
  }
  drafts.delete(id);
  drafts.set(id, {
    scope,
    editor,
    draft: { isSyscoinRpc: draft.isSyscoinRpc, values },
    timestamp: Date.now(),
  });
  while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
  stopStore ||= store.subscribe(prune);
  stopStatus ||= subscribeControllerStatus(prune);
};

export const readCustomRpcDraft = (
  id: unknown,
  scope: string,
  editor: string
): ICustomRpcDraft | undefined => {
  prune();
  if (typeof id !== 'string') return;
  const entry = drafts.get(id);
  if (!entry || entry.scope !== scope || entry.editor !== editor) return;
  return {
    isSyscoinRpc: entry.draft.isSyscoinRpc,
    values: { ...entry.draft.values },
  };
};

export const discardCustomRpcDraft = (id: string) => {
  drafts.delete(id);
  if (!drafts.size) clearCustomRpcDrafts();
};
