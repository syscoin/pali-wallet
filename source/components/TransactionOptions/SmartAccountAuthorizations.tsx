import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { controllerEmitter } from '../../scripts/Background/controllers/controllerEmitter';
import { KeyringAccountType } from '../../types/network';
import { getWalletNavigationScope } from '../../utils/navigationState';

import { useSmartAccountCancellation } from './useSmartAccountCancellation';
import type { RootState } from '../../state/store';
import type { SmartAccountAuthorizationObservation } from '../../utils/smartAccount/authorizationStatus';
import type { SmartAccountAuthorizationSummary } from '../../wallet/smartAccountAuthorization';

const HASH = /^0x[\da-f]{64}$/i;
const button =
  'rounded-lg border border-bkg-white200 px-3 py-2 text-sm text-brand-white hover:bg-alpha-whiteAlpha50 disabled:opacity-60';
function Instruction({
  entry,
  scope,
}: {
  entry: SmartAccountAuthorizationSummary;
  scope: string;
}) {
  const { t } = useTranslation();
  const cancellation = useSmartAccountCancellation(
    entry.operationHash,
    entry.operationHash
  );
  const [status, setStatus] = useState<SmartAccountAuthorizationObservation>();
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const current = useRef({ generation: 0 });
  useEffect(
    () => () => {
      current.current.generation++;
    },
    [scope]
  );
  const check = async () => {
    if (busy) return;
    const navigation = JSON.stringify(getWalletNavigationScope());
    const generation = ++current.current.generation;
    const owns = () =>
      generation === current.current.generation &&
      navigation === JSON.stringify(getWalletNavigationScope());
    setBusy(true);
    setFailed(false);
    try {
      const value = await controllerEmitter(
        ['wallet', 'getSmartAccountAuthorizationStatus'],
        [entry.operationHash]
      );
      if (!owns()) return;
      const observation = value as SmartAccountAuthorizationObservation;
      if (
        observation?.operationHash !== entry.operationHash ||
        !['pending', 'nonce-consumed', 'observed'].includes(observation.kind)
      )
        throw Error('Unavailable');
      setStatus(observation);
    } catch {
      if (owns()) setFailed(true);
    } finally {
      if (owns()) setBusy(false);
    }
  };
  const label =
    status?.kind === 'observed'
      ? status.success
        ? 'observedSuccess'
        : 'observedFailure'
      : status?.kind === 'nonce-consumed'
      ? 'nonceConsumedUnknown'
      : 'mayExecute';
  return (
    <li className="rounded-card bg-bkg-2 p-3 text-left">
      <p className="text-sm font-medium">
        {entry.replacesOperationHash
          ? t('transactions.replay.operation.cancel')
          : t('transactions.smartAuthorizations.title')}
      </p>
      <p role="status" className="mt-1 text-xs text-brand-gray200">
        {t(`transactions.smartAuthorizations.${label}`)}
      </p>
      <p className="mt-1 text-xs text-brand-gray200">
        {new Date(entry.createdAt).toLocaleString()}
      </p>
      <dl className="my-3 space-y-2 text-xs">
        <div>
          <dt className="text-brand-gray200">
            {t('transactions.smartAuthorizations.operationHash')}
          </dt>
          <dd className="break-all">{entry.operationHash}</dd>
        </div>
        <div>
          <dt className="text-brand-gray200">
            {t('transactions.replay.nonce')}
          </dt>
          <dd className="break-all">{entry.operationNonce}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={busy || cancellation.busy}
          onClick={() => void check()}
        >
          {busy
            ? t('buttons.loading')
            : t('transactions.smartAuthorizations.checkStatus')}
        </button>
        {!entry.replacesOperationHash &&
          (!status || status.kind === 'pending') && (
            <button
              type="button"
              className={button}
              disabled={busy || cancellation.busy}
              onClick={() => void cancellation.request()}
            >
              {t('transactions.smartAuthorizations.cancelInstruction')}
            </button>
          )}
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-warning-error">
          {t('transactions.smartAuthorizations.unavailable')}
        </p>
      )}
      {cancellation.content}
    </li>
  );
}

/** Local authenticated history only; chain status is checked on explicit request. */
export function SmartAccountAuthorizations() {
  const { t } = useTranslation();
  const { activeAccount, activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const enabled =
    !isBitcoinBased && activeAccount.type === KeyringAccountType.SmartAccount;
  const scope = JSON.stringify([
    getWalletNavigationScope(),
    activeAccount,
    activeNetwork.chainId,
    activeNetwork.url,
  ]);
  const owner = useRef({ scope, generation: 0, pending: false });
  if (owner.current.scope !== scope)
    owner.current = {
      scope,
      generation: owner.current.generation + 1,
      pending: false,
    };
  const [view, setView] = useState<{
    cursor: string | null;
    entries: SmartAccountAuthorizationSummary[];
    failed?: boolean;
    loading?: boolean;
    scope: string;
  }>();
  useEffect(
    () => () => {
      owner.current.generation++;
    },
    [scope]
  );
  const load = async (more = false) => {
    const current = owner.current;
    if (!enabled || current.pending) return;
    current.pending = true;
    const generation = ++current.generation;
    const prior = view?.scope === scope ? view.entries : [];
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
            !/^(0|[1-9]\d{0,77})$/.test(entry.operationNonce)
        )
      )
        throw Error('Unavailable');
      const entries = [
        ...new Map(
          [...(more ? prior : []), ...page.entries].map((entry) => [
            entry.operationHash,
            entry,
          ])
        ).values(),
      ];
      setView({ scope, entries, cursor: page.nextCursor });
    } catch {
      if (owner.current === current && current.generation === generation)
        setView({
          scope,
          entries: prior,
          cursor: more && view?.scope === scope ? view.cursor : null,
          failed: true,
        });
    } finally {
      if (owner.current === current && current.generation === generation)
        current.pending = false;
    }
  };
  if (!enabled) return null;
  const shown = view?.scope === scope ? view : undefined;
  return (
    <details
      key={scope}
      className="rounded-card border border-bkg-white200 p-3 text-brand-white"
      onToggle={(event) => {
        if (event.currentTarget.open && !shown) void load();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {t('transactions.smartAuthorizations.title')}
      </summary>
      {shown?.loading && (
        <p role="status" className="mt-3 text-sm">
          {t('buttons.loading')}
        </p>
      )}
      {shown?.failed && (
        <p role="alert" className="mt-3 text-sm text-warning-error">
          {t('transactions.smartAuthorizations.unavailable')}
        </p>
      )}
      {shown && !shown.loading && !shown.failed && !shown.entries.length && (
        <p className="mt-3 text-sm text-brand-gray200">
          {t('transactions.smartAuthorizations.empty')}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {shown?.entries.map((entry) => (
          <Instruction key={entry.operationHash} entry={entry} scope={scope} />
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={button}
          disabled={Boolean(shown?.loading)}
          onClick={() => void load()}
        >
          {t('mobile.infrastructure.refresh')}
        </button>
        {shown?.cursor && (
          <button
            type="button"
            className={button}
            disabled={Boolean(shown.loading)}
            onClick={() => void load(true)}
          >
            {t('buttons.loadMore')}
          </button>
        )}
      </div>
    </details>
  );
}
