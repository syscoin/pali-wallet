import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { controllerEmitter } from '../../scripts/Background/controllers/controllerEmitter';
import { SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT } from '../../shared/smartAccountControllerAuthority';
import { KeyringAccountType } from '../../types/network';
import { getWalletNavigationScope } from '../../utils/navigationState';

import { useSmartAccountCancellation } from './useSmartAccountCancellation';
import type { RootState } from '../../state/store';
import type { SmartAccountAuthorizationObservation } from '../../utils/smartAccount/authorizationStatus';
import type { SmartAccountAuthorizationSummary } from '../../wallet/smartAccountAuthorization';

const HASH = /^0x[\da-f]{64}$/i;
const QUANTITY = /^(?:0|[1-9]\d{0,77})$/;
const MAX_STATUS_READS = 8;
const button =
  'rounded-lg border border-bkg-white200 px-3 py-2 text-sm text-brand-white hover:bg-alpha-whiteAlpha50 disabled:opacity-60';

export type InstructionGroup = {
  cancellations: SmartAccountAuthorizationSummary[];
  hash: string;
  original?: SmartAccountAuthorizationSummary;
};
type InstructionStatus =
  | 'cancellationConfirmed'
  | 'cancellationFailed'
  | 'cancellationSigned'
  | 'nonceConsumedUnknown'
  | 'mayExecute'
  | 'observedFailure'
  | 'observedSuccess'
  | 'outcomeUnknown';

function groupInstructions(entries: SmartAccountAuthorizationSummary[]) {
  const groups = new Map<string, InstructionGroup>();
  for (const entry of entries) {
    const hash = entry.replacesOperationHash ?? entry.operationHash;
    const group = groups.get(hash) ?? { hash, cancellations: [] };
    if (entry.replacesOperationHash) group.cancellations.push(entry);
    else group.original = entry;
    groups.set(hash, group);
  }
  return [...groups.values()];
}

async function readStatus(entry: SmartAccountAuthorizationSummary) {
  const value = (await controllerEmitter(
    ['wallet', 'getSmartAccountAuthorizationStatus'],
    [entry.operationHash, { preserveRecords: true }]
  )) as SmartAccountAuthorizationObservation;
  if (
    value?.operationHash !== entry.operationHash ||
    !['pending', 'nonce-consumed', 'observed'].includes(value.kind) ||
    typeof value.currentNonce !== 'string' ||
    !QUANTITY.test(value.currentNonce) ||
    typeof value.anchor?.number !== 'string' ||
    !QUANTITY.test(value.anchor.number) ||
    !HASH.test(value.anchor.hash) ||
    (value.kind === 'observed' && typeof value.success !== 'boolean')
  )
    throw Error('Unavailable');
  const nonce = BigInt(entry.operationNonce);
  const currentNonce = BigInt(value.currentNonce);
  if (
    nonce >> BigInt(64) !== currentNonce >> BigInt(64) ||
    (value.kind === 'pending') !== currentNonce <= nonce
  )
    throw Error('Unavailable');
  return value;
}

async function checkGroup(
  entries: SmartAccountAuthorizationSummary[],
  pending: InstructionStatus
): Promise<InstructionStatus> {
  if (
    entries.some((entry) => entry.operationNonce !== entries[0].operationNonce)
  )
    return 'outcomeUnknown';

  const checks = await Promise.allSettled(
    entries.slice(0, MAX_STATUS_READS).map(readStatus)
  );
  const anchors = new Map<string, { hash: string; nonce: string }>();
  let observed: SmartAccountAuthorizationObservation | undefined;
  let unconsumed = false;
  let consumed = false;
  for (const result of checks) {
    if (result.status === 'rejected') return 'outcomeUnknown';
    const value = result.value;
    const hash = value.anchor.hash.toLowerCase();
    const atHeight = anchors.get(value.anchor.number);
    if (
      (atHeight &&
        (atHeight.hash !== hash || atHeight.nonce !== value.currentNonce)) ||
      (observed && value.kind === 'observed')
    )
      return 'outcomeUnknown';
    anchors.set(value.anchor.number, { hash, nonce: value.currentNonce });
    if (value.kind === 'observed') observed = value;
    if (value.kind === 'pending') unconsumed = true;
    else consumed = true;
  }
  if (consumed && unconsumed) return 'outcomeUnknown';
  if (observed?.kind === 'observed') {
    const winner = entries.find(
      ({ operationHash }) => operationHash === observed.operationHash
    );
    if (winner?.replacesOperationHash)
      return observed.success ? 'cancellationConfirmed' : 'cancellationFailed';
    return observed.success ? 'observedSuccess' : 'observedFailure';
  }
  if (entries.length > MAX_STATUS_READS) return 'outcomeUnknown';
  return consumed ? 'nonceConsumedUnknown' : pending;
}

export function Instruction({
  group,
  scope,
}: {
  group: InstructionGroup;
  scope: string;
}) {
  const { t } = useTranslation();
  const { original, cancellations } = group;
  const cancellation = useSmartAccountCancellation(group.hash, group.hash);
  const entries = [...(original ? [original] : []), ...cancellations];
  const { operationNonce } = entries[0];
  const pending = cancellations.length ? 'cancellationSigned' : 'mayExecute';
  const statusScope = JSON.stringify([
    scope,
    ...entries.map((entry) => entry.operationHash),
  ]);
  const current = useRef({ scope: statusScope, pending: false });
  if (current.current.scope !== statusScope)
    current.current = { scope: statusScope, pending: false };
  const [view, setView] = useState<{
    busy: boolean;
    label: InstructionStatus;
    scope: string;
  }>();
  useEffect(() => {
    const owner = current.current;
    return () => {
      owner.pending = false;
    };
  }, [statusScope]);
  const check = async () => {
    const owner = current.current;
    if (owner.pending) return;
    owner.pending = true;
    const navigation = JSON.stringify(getWalletNavigationScope());
    const owns = () =>
      owner.pending &&
      current.current === owner &&
      navigation === JSON.stringify(getWalletNavigationScope());
    setView({ busy: true, label: pending, scope: statusScope });
    const label = await checkGroup(entries, pending).catch(
      () => 'outcomeUnknown' as const
    );
    if (owns()) setView({ busy: false, label, scope: statusScope });
    owner.pending = false;
  };
  const status = view?.scope === statusScope ? view : undefined;
  const label = status?.label ?? pending;
  const canCancel =
    original && (label === pending || label === 'outcomeUnknown');
  const identity = (
    <dl className="my-3 space-y-2 text-xs">
      <div>
        <dt className="text-brand-gray200">
          {t('transactions.smartAuthorizations.operationHash')}
        </dt>
        <dd className="break-all">{group.hash}</dd>
      </div>
      <div>
        <dt className="text-brand-gray200">{t('transactions.sequence')}</dt>
        <dd className="break-all">
          {(
            BigInt(operationNonce) &
            ((BigInt(1) << BigInt(64)) - BigInt(1))
          ).toString()}
        </dd>
      </div>
    </dl>
  );
  return (
    <li
      data-operation-hash={group.hash}
      className="border-b border-dashed border-bkg-deepBlue py-2 text-left"
    >
      <p role="status" className="text-sm font-medium">
        {t(`transactions.smartAuthorizations.${label}`)}
      </p>
      <details className="mb-3 text-xs">
        <summary className="cursor-pointer text-brand-gray200">
          {t('transactions.technicalDetails')}
        </summary>
        {identity}
        <dl className="mt-2 space-y-2">
          <div>
            <dt className="text-brand-gray200">
              {t('transactions.replay.nonce')}
            </dt>
            <dd className="break-all">{operationNonce}</dd>
          </div>
          {cancellations.map((attempt) => (
            <div key={attempt.operationHash}>
              <dt className="text-brand-gray200">
                {t('transactions.replay.operation.cancel')}
              </dt>
              <dd className="break-all">{attempt.operationHash}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={status?.busy || cancellation.busy}
          onClick={() => void check()}
        >
          {status?.busy
            ? t('buttons.loading')
            : t('transactions.smartAuthorizations.checkStatus')}
        </button>
        {canCancel && (
          <button
            type="button"
            className={button}
            disabled={status?.busy || cancellation.busy}
            onClick={() => void cancellation.request()}
          >
            {t('transactions.smartAuthorizations.cancelInstruction')}
          </button>
        )}
      </div>
      {cancellation.content}
    </li>
  );
}

/** Local authenticated history only; chain status is checked on explicit request. */
export function useSmartAccountAuthorizations(autoLoad = false) {
  const { accounts, activeAccount, activeNetwork, isBitcoinBased } =
    useSelector((state: RootState) => state.vault);
  const enabled =
    !isBitcoinBased && activeAccount?.type === KeyringAccountType.SmartAccount;
  const scope = JSON.stringify([
    getWalletNavigationScope(),
    activeAccount,
    activeNetwork.chainId,
    activeNetwork.url,
    accounts?.[activeAccount?.type]?.[activeAccount?.id]
      ?.evmActivityClearedAtByChainId?.[activeNetwork.chainId],
  ]);
  const owner = useRef({
    scope,
    generation: 0,
    pending: false,
    refreshAfterLoad: false,
  });
  if (owner.current.scope !== scope)
    owner.current = {
      scope,
      generation: owner.current.generation + 1,
      pending: false,
      refreshAfterLoad: false,
    };
  const [view, setView] = useState<{
    cursor: string | null;
    entries: SmartAccountAuthorizationSummary[];
    failed?: boolean;
    failedMore?: boolean;
    loading?: boolean;
    scope: string;
  }>();
  useEffect(() => {
    const current = owner.current;
    return () => {
      current.generation++;
      current.pending = false;
    };
  }, [scope]);
  const load = async (mode: 'refresh' | 'more' | 'merge' = 'refresh') => {
    const current = owner.current;
    if (!enabled) return;
    if (current.pending) {
      if (mode === 'merge') current.refreshAfterLoad = true;
      return;
    }
    const more = mode === 'more';
    current.pending = true;
    const generation = ++current.generation;
    const prior = view?.scope === scope ? view.entries : [];
    if (mode !== 'merge')
      setView({ scope, entries: prior, cursor: null, loading: true });
    try {
      const result = await controllerEmitter(
        ['wallet', 'getSmartAccountAuthorizations'],
        [
          {
            maximum: 20,
            ...(more && view?.scope === scope && view.cursor
              ? { beforeHash: view.cursor }
              : {}),
          },
        ]
      );
      if (owner.current !== current || current.generation !== generation)
        return;
      const page = result as {
        entries: SmartAccountAuthorizationSummary[];
        nextCursor: string | null;
      };
      if (
        !Array.isArray(page?.entries) ||
        page.entries.length > 20 ||
        (page.nextCursor !== null && !HASH.test(page.nextCursor)) ||
        page.entries.some(
          (entry) =>
            !HASH.test(entry?.operationHash) ||
            entry.chainId !== String(activeNetwork.chainId) ||
            !QUANTITY.test(entry.operationNonce) ||
            (entry.replacesOperationHash !== undefined &&
              (!HASH.test(entry.replacesOperationHash) ||
                entry.replacesOperationHash === entry.operationHash))
        )
      )
        throw Error('Unavailable');
      setView((latest) => {
        const previous = latest?.scope === scope ? latest : undefined;
        const retained = previous?.entries ?? [];
        const combined = more
          ? [...prior, ...page.entries]
          : [...page.entries, ...(mode === 'merge' ? retained : [])];
        const retainedHashes = new Set(
          retained.map((entry) => entry.operationHash)
        );
        const overlaps =
          page.entries.some((entry) =>
            retainedHashes.has(entry.operationHash)
          ) ||
          (page.nextCursor !== null && retainedHashes.has(page.nextCursor));
        const cursor =
          mode === 'merge' && previous && overlaps
            ? previous.cursor
            : page.nextCursor;
        return {
          scope,
          entries: [
            ...new Map(
              combined.map((entry) => [entry.operationHash, entry])
            ).values(),
          ],
          cursor,
        };
      });
    } catch {
      if (owner.current === current && current.generation === generation)
        setView((latest) => ({
          scope,
          entries: latest?.scope === scope ? latest.entries : prior,
          cursor:
            more && view?.scope === scope
              ? view.cursor
              : latest?.scope === scope
              ? latest.cursor
              : null,
          failedMore: more,
          failed: true,
        }));
    } finally {
      if (owner.current === current && current.generation === generation) {
        current.pending = false;
        if (current.refreshAfterLoad) {
          current.refreshAfterLoad = false;
          void load('merge');
        }
      }
    }
  };
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    if (!enabled || !autoLoad) return;
    void latestLoad.current();
    const refresh = () => void latestLoad.current('merge');
    window.addEventListener('focus', refresh);
    window.addEventListener(SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(
        SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT,
        refresh
      );
    };
  }, [enabled, autoLoad, scope]);
  const shown = enabled && view?.scope === scope ? view : undefined;
  const groups = useMemo(
    () => groupInstructions(shown?.entries ?? []),
    [shown?.entries]
  );
  return {
    scope,
    groups,
    load,
    cursor: shown?.cursor,
    loading: Boolean(enabled && autoLoad && !shown) || Boolean(shown?.loading),
    failed: Boolean(shown?.failed),
    retry: () => load(shown?.failedMore ? 'more' : 'merge'),
  };
}
