import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { Button } from 'components/Button';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { PRIVACY_CHAIN_ID, PRIVACY_POOLS } from 'utils/privacy/registry';
import type { PrivacyPoolId } from 'utils/privacy/types';

import PrivateNotes from './PrivateNotes';
import { usePrivacyIndex } from './usePrivacyIndex';

function PoolData({
  poolId,
  canPrepare,
}: {
  canPrepare: boolean;
  poolId: PrivacyPoolId;
}) {
  const { t } = useTranslation();
  const { action, initialLoading, run, status, unavailable } =
    usePrivacyIndex(poolId);
  const running = ['syncing', 'verifying'].includes(status.phase);
  const phase = unavailable ? 'unavailable' : status.phase;
  const statusText = initialLoading
    ? t('privacy.checking')
    : t(`privacy.${phase}`);
  const primaryLabel =
    unavailable || status.phase === 'error'
      ? t('privacy.retry')
      : status.phase === 'paused'
      ? t('privacy.resume')
      : status.phase === 'ready'
      ? t('privacy.refresh')
      : t('privacy.prepare');
  const hasProgress =
    running &&
    status.completed !== undefined &&
    status.total !== undefined &&
    status.total > 0;
  const percentage = hasProgress
    ? Math.min(100, Math.floor((status.completed! / status.total!) * 100))
    : undefined;
  const hasSavedData = status.verifiedAt !== undefined;

  return (
    <section aria-labelledby="privacy-pool-data-title" className="space-y-4">
      <h2
        id="privacy-pool-data-title"
        className="text-sm font-medium text-white"
      >
        {t('privacy.poolData')}
      </h2>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="rounded-xl border border-alpha-whiteAlpha300 bg-bkg-4 p-4 text-sm text-white space-y-3"
      >
        <p>{statusText}</p>
        {running && !unavailable && (
          <div
            role="progressbar"
            aria-label={statusText}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            className="h-1.5 overflow-hidden rounded-full bg-alpha-whiteAlpha300"
          >
            <div
              className="h-full rounded-full bg-brand-royalblue"
              style={{
                width: percentage === undefined ? '25%' : `${percentage}%`,
              }}
            />
          </div>
        )}
        {hasProgress && !unavailable && (
          <p className="text-xs text-brand-gray200">
            {t('privacy.progress', {
              completed: status.completed,
              total: status.total,
            })}
          </p>
        )}
        {hasSavedData && (
          <div className="text-xs text-brand-gray200 space-y-1">
            {status.leafCount !== undefined && (
              <p>{t('privacy.savedDeposits', { count: status.leafCount })}</p>
            )}
            {status.blockNumber !== undefined && (
              <p>{t('privacy.verifiedBlock', { block: status.blockNumber })}</p>
            )}
          </div>
        )}
      </div>
      {!canPrepare && (
        <p className="text-xs text-brand-gray200">
          {t('privacy.networkRequired')}
        </p>
      )}
      {(!running || unavailable) && (
        <Button
          type="button"
          variant="primary"
          fullWidth
          disabled={!canPrepare || initialLoading || Boolean(action)}
          loading={action === 'start'}
          onClick={() => canPrepare && run('start')}
        >
          {primaryLabel}
        </Button>
      )}
      {(running || hasSavedData || status.phase !== 'idle') &&
        !initialLoading && (
          <div className="flex flex-wrap items-center justify-center gap-4">
            {(running ||
              status.phase === 'ready' ||
              status.phase === 'error') && (
              <button
                type="button"
                className="text-xs text-brand-gray200 underline rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
                disabled={Boolean(action)}
                onClick={() => run('pause')}
              >
                {t('privacy.pause')}
              </button>
            )}
            <button
              type="button"
              className="text-xs text-brand-gray200 underline rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
              disabled={Boolean(action)}
              onClick={() => run('clear')}
            >
              {t('privacy.clear')}
            </button>
          </div>
        )}
    </section>
  );
}

export default function Privacy() {
  const { t } = useTranslation();
  const [poolId, setPoolId] = useState<PrivacyPoolId>(PRIVACY_POOLS[0].id);
  const { network, isBitcoinBased, changing } = useSelector(
    (state: RootState) => ({
      network: state.vault.activeNetwork,
      isBitcoinBased: state.vault.isBitcoinBased,
      changing: ['switching', 'connecting'].includes(
        state.vaultGlobal.networkStatus
      ),
    }),
    shallowEqual
  );
  const canPrepare =
    !isBitcoinBased &&
    network.kind === INetworkType.Ethereum &&
    network.chainId === PRIVACY_CHAIN_ID &&
    !changing;
  const viewKey = JSON.stringify([
    poolId,
    network.kind,
    network.chainId,
    network.url,
    isBitcoinBased,
    changing,
  ]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium text-white">
          {t('privacy.prepare')}
        </h1>
        <p className="text-sm text-brand-gray200">{t('privacy.description')}</p>
        <p className="text-xs text-brand-gray200">{t('privacy.scopeNotice')}</p>
      </div>
      <div className="space-y-2">
        <label htmlFor="privacy-pool" className="block text-sm text-white">
          {t('privacy.poolLabel')}
        </label>
        <select
          id="privacy-pool"
          value={poolId}
          onChange={(event) => setPoolId(event.target.value as PrivacyPoolId)}
          className="w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue"
        >
          {PRIVACY_POOLS.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.amount} ETH
            </option>
          ))}
        </select>
        <p className="text-xs text-brand-gray200">{t('privacy.networkName')}</p>
      </div>
      <PoolData key={viewKey} poolId={poolId} canPrepare={canPrepare} />
      <p className="text-xs text-brand-gray200">
        {t('privacy.publicDataOnly')}
      </p>
      <PrivateNotes />
    </div>
  );
}
