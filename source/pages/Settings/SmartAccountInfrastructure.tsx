import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button, Card } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

export type InfrastructureStatus = {
  chainId: number;
  contracts: Array<{ deployed: boolean; displayName: string; id: string }>;
  create2Deployer: { deployed: boolean };
  pending?: { contractId: string; transactionHash?: string };
  ready: boolean;
};

export const isInfrastructureStatus = (
  value: any,
  chainId: number
): value is InfrastructureStatus =>
  value?.chainId === chainId &&
  typeof value?.ready === 'boolean' &&
  typeof value?.create2Deployer?.deployed === 'boolean' &&
  Array.isArray(value.contracts) &&
  value.contracts.length > 0 &&
  value.contracts.every(
    (contract: any) =>
      typeof contract?.id === 'string' &&
      typeof contract?.displayName === 'string' &&
      typeof contract?.deployed === 'boolean'
  );

const InfrastructurePanel = ({
  chainId,
  canDeploy,
}: {
  canDeploy: boolean;
  chainId: number;
}) => {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const [status, setStatus] = useState<InfrastructureStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [reading, setReading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [slowDeployment, setSlowDeployment] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const pendingRead = useRef<Promise<void>>();
  const pendingDeploy = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback((): Promise<void> => {
    if (pendingRead.current) return pendingRead.current;
    setReading(true);
    const request = controllerEmitter(
      ['wallet', 'getSmartAccountInfrastructureStatus'],
      [true],
      20000,
      false
    )
      .then((result) => {
        if (!isInfrastructureStatus(result, chainId)) {
          throw new Error('Invalid infrastructure status');
        }
        if (mounted.current) {
          setStatus(result);
          setUnavailable(false);
        }
      })
      .catch(() => {
        if (mounted.current) setUnavailable(true);
      })
      .finally(() => {
        pendingRead.current = undefined;
        if (mounted.current) setReading(false);
      });
    pendingRead.current = request;
    return request;
  }, [chainId, controllerEmitter]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      clearTimeout(pollTimer.current);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (reading) return;
    pollTimer.current = setTimeout(
      () => void refresh(),
      deploying || status?.pending || unavailable ? 5000 : 30000
    );
    return () => clearTimeout(pollTimer.current);
  }, [deploying, reading, refresh, status, unavailable]);

  useEffect(() => {
    setSlow(false);
    if (!reading) return;
    const timer = setTimeout(() => setSlow(true), 1200);
    return () => clearTimeout(timer);
  }, [reading]);

  useEffect(() => {
    setSlowDeployment(false);
    if (!deploying) return;
    const timer = setTimeout(() => setSlowDeployment(true), 1200);
    return () => clearTimeout(timer);
  }, [deploying]);

  const deploy = async () => {
    if (
      pendingDeploy.current ||
      !canDeploy ||
      unavailable ||
      !status ||
      status.pending
    ) {
      return;
    }
    pendingDeploy.current = true;
    setDeploying(true);
    setMessage('');
    try {
      await controllerEmitter(
        ['wallet', 'deploySmartAccountInfrastructure'],
        [],
        120000,
        false
      );
    } catch (error: any) {
      if (mounted.current) {
        const errorText = String(error?.message || error || '').toLowerCase();
        const insufficientGas =
          /insufficient (?:funds|balance)|lack ?of ?fund/.test(errorText) ||
          (errorText.includes('maxfee') && errorText.includes('fund'));
        setMessage(
          insufficientGas
            ? t('settings.smartAccountInfrastructureInsufficientGas')
            : t('settings.smartAccountInfrastructureCheckBeforeRetry')
        );
      }
    } finally {
      try {
        if (mounted.current) {
          // An earlier probe may predate the last submitted transaction.
          await pendingRead.current;
          if (mounted.current) await refresh();
        }
      } finally {
        pendingDeploy.current = false;
        if (mounted.current) setDeploying(false);
      }
    }
  };

  const current = unavailable ? null : status;
  const missing = current?.contracts.filter((contract) => !contract.deployed);
  return (
    <div className="mx-auto mb-5 flex w-full max-w-[352px] text-left">
      <Card type={current?.ready ? 'success' : 'info'}>
        <div className="flex w-full flex-col gap-2 text-sm">
          <p className="font-semibold text-brand-white">
            {t('settings.smartAccountInfrastructure')}
          </p>
          <div role="status" aria-live="polite" className="text-xs leading-4">
            {!current ? (
              <p>
                {unavailable || slow
                  ? t('settings.smartAccountInfrastructureCheckingSlow')
                  : t('buttons.loading')}
              </p>
            ) : (
              <>
                <p>
                  {current.ready
                    ? t('settings.smartAccountInfrastructureReady')
                    : t('settings.smartAccountInfrastructureMissingAdvanced')}
                </p>
                {!current.create2Deployer.deployed && (
                  <p>{t('settings.smartAccountCreate2Missing')}</p>
                )}
                {Boolean(missing?.length) && (
                  <p>
                    {t('settings.smartAccountInfrastructureMissingCount', {
                      count: missing?.length,
                    })}
                  </p>
                )}
              </>
            )}
            {(current?.pending || slowDeployment) && (
              <p>{t('settings.smartAccountInfrastructurePending')}</p>
            )}
            {message && <p>{message}</p>}
          </div>
          <Button
            variant="neutral"
            type="button"
            disabled={reading}
            onClick={() => void refresh()}
          >
            {t('settings.smartAccountInfrastructureCheckStatus')}
          </Button>
          {current?.create2Deployer.deployed && Boolean(missing?.length) && (
            <Button
              variant="neutral"
              type="button"
              disabled={!canDeploy || deploying || Boolean(current.pending)}
              onClick={() => void deploy()}
            >
              {deploying
                ? t('buttons.loading')
                : t('settings.deploySmartAccountInfrastructure')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};

export const SmartAccountInfrastructure = () => {
  const { activeNetwork, activeAccount, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const { networkStatus, isSwitchingAccount } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const { isUnlocked, connectionUnavailable } = useController();
  if (isBitcoinBased) return null;
  return (
    <InfrastructurePanel
      key={`${activeNetwork.chainId}:${activeNetwork.url}:${activeAccount.type}:${activeAccount.id}`}
      chainId={activeNetwork.chainId}
      canDeploy={
        isUnlocked &&
        !connectionUnavailable &&
        !isSwitchingAccount &&
        networkStatus !== 'switching' &&
        networkStatus !== 'connecting'
      }
    />
  );
};
