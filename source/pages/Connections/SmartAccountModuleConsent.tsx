import { getAddress, isAddress } from '@ethersproject/address';
import { isHexString } from '@ethersproject/bytes';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { AddressText, Button, Card, Icon } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import {
  ISmartAccountMetadata,
  SmartAccountInstalledModule,
} from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  encodeInstallValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  getSmartAccountLocalOwnerContexts,
  signAndSubmitSmartAccountExecutions,
} from 'utils/smartAccount';
import type { CustomValidatorPreflightResult } from 'utils/smartAccount';
import { getSmartAccountActionErrorMessage } from 'utils/smartAccountErrors';

// ---------------------------------------------------------------------------
// Dapp consent popup for wallet_requestSmartAccountModuleInstall /
// wallet_requestSmartAccountModuleUninstall. The dapp supplies a module
// address (plus optional initData/name for installs); the user reviews
// on-chain preflight results and risk warnings before Pali signs the
// install/uninstall execution with the account's active local signer.
// ---------------------------------------------------------------------------

type ModuleConsentRequest = {
  address?: string;
  initData?: string;
  name?: string;
};

const sameAddress = (a?: string, b?: string): boolean =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export const SmartAccountModuleConsent = () => {
  const { t } = useTranslation();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const queryData = useQueryData() as {
    action?: 'install' | 'uninstall';
    eventName?: string;
    host?: string;
    module?: ModuleConsentRequest;
  };
  const activeAccount = useSelector(selectActiveAccount);
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const dapps = useSelector((state: RootState) => state.dapp.dapps);

  const host = queryData.host || '';

  // The module operation targets the account the dapp is connected to (the
  // one it sees via eth_accounts), falling back to the active account.
  const account = useMemo(() => {
    const dappInfo = dapps[host];
    if (dappInfo) {
      const connected =
        accounts[dappInfo.accountType]?.[dappInfo.accountId] || null;
      if (connected) return connected;
    }
    return activeAccount;
  }, [accounts, activeAccount, dapps, host]);
  const action = queryData.action === 'uninstall' ? 'uninstall' : 'install';
  const eventName =
    queryData.eventName ||
    (action === 'install'
      ? 'wallet_requestSmartAccountModuleInstall'
      : 'wallet_requestSmartAccountModuleUninstall');
  const request = queryData.module || {};

  const [metadata, setMetadata] = useState<ISmartAccountMetadata | null>(
    account?.smartAccount || null
  );
  const [preflight, setPreflight] =
    useState<CustomValidatorPreflightResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moduleAddress = useMemo(() => {
    const raw = (request.address || '').trim();
    if (!isAddress(raw)) return null;
    return getAddress(raw);
  }, [request.address]);
  const initData = request.initData || '0x';
  const validInitData = isHexString(initData);

  const isSmartAccount = Boolean(account?.isSmartAccount);
  const smartAccountMatchesNetwork = Boolean(
    account?.isSmartAccount &&
      account.smartAccount?.chainId === activeNetwork.chainId
  );

  const refreshMetadata = useCallback(async () => {
    if (!account?.isSmartAccount) return null;
    const hydrated = (await controllerEmitter(
      ['wallet', 'hydrateSmartAccount'],
      [account.id],
      300000
    )) as ISmartAccountMetadata;
    setMetadata(hydrated);
    return hydrated;
  }, [account?.id, account?.isSmartAccount, controllerEmitter]);

  const installedModules = metadata?.installedModules || [];
  const targetModule = installedModules.find((module) =>
    sameAddress(module.address, moduleAddress || undefined)
  ) as SmartAccountInstalledModule | undefined;
  const targetModuleIsValidator = targetModule?.type === 'validator';
  const isActiveValidator = sameAddress(
    metadata?.auth?.validator,
    moduleAddress || undefined
  );

  // Static request validation (no chain access needed).
  const staticError = !isSmartAccount
    ? t('smartAccountHub.notSmartAccount')
    : !smartAccountMatchesNetwork
    ? t('smartAccountHub.wrongNetwork', {
        accountChainId: account?.smartAccount?.chainId,
        activeChainId: activeNetwork.chainId,
      })
    : !moduleAddress
    ? t('smartAccountHub.invalidModuleAddress')
    : action === 'install' && !validInitData
    ? t('smartAccountHub.invalidInitData')
    : action === 'uninstall' && metadata && !targetModule
    ? t('smartAccountHub.moduleNotInstalled')
    : action === 'uninstall' && targetModule && !targetModuleIsValidator
    ? t('smartAccountHub.moduleUninstallUnsupported')
    : action === 'uninstall' && isActiveValidator
    ? t('smartAccountHub.cannotRemoveActiveValidator')
    : null;

  // Hydrate on-chain state and, for installs, run the custom-validator
  // preflight (code exists, reports ERC-7579 validator, not yet installed).
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!smartAccountMatchesNetwork || !moduleAddress) return;
      setChecking(true);
      try {
        if (account.smartAccount?.isDeployed) {
          const hydrated = (await controllerEmitter(
            ['wallet', 'hydrateSmartAccount'],
            [account.id],
            300000
          )) as ISmartAccountMetadata;
          if (!cancelled) setMetadata(hydrated);
        }
        if (action === 'install') {
          const result = (await controllerEmitter(
            ['wallet', 'preflightSmartAccountCustomValidator'],
            [{ accountId: account.id, address: moduleAddress }],
            60000
          )) as CustomValidatorPreflightResult;
          if (!cancelled) setPreflight(result);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(
            getSmartAccountActionErrorMessage(
              err,
              t('send.cantCompleteTxs'),
              t('send.insufficientFundsForGas')
            )
          );
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    account?.id,
    account?.smartAccount?.chainId,
    action,
    activeNetwork.chainId,
    controllerEmitter,
    moduleAddress,
    smartAccountMatchesNetwork,
    t,
  ]);

  const preflightFailureMessage = useMemo(() => {
    if (!preflight || preflight.ok) return null;
    const reason = preflight.failures[0];
    return reason === 'already-installed'
      ? t('smartAccountHub.preflightAlreadyInstalled')
      : reason === 'no-contract-code'
      ? t('smartAccountHub.preflightNoCode')
      : t('smartAccountHub.preflightNotValidator');
  }, [preflight, t]);

  const canConfirm =
    !staticError &&
    !checking &&
    !loading &&
    (action === 'uninstall'
      ? Boolean(targetModuleIsValidator)
      : Boolean(preflight?.ok) && acknowledged);

  const approve = useCallback(async () => {
    if (!account?.address || !moduleAddress || !metadata) return;
    setLoading(true);
    setError(null);
    try {
      if (!smartAccountMatchesNetwork) {
        setError(
          t('smartAccountHub.wrongNetwork', {
            accountChainId: account.smartAccount?.chainId,
            activeChainId: activeNetwork.chainId,
          })
        );
        return;
      }
      if (action === 'uninstall' && !targetModuleIsValidator) {
        setError(t('smartAccountHub.moduleUninstallUnsupported'));
        return;
      }
      const authenticatorContexts = getSmartAccountLocalOwnerContexts({
        accounts: accounts as any,
        controllerEmitter: controllerEmitter as any,
      });
      await signAndSubmitSmartAccountExecutions({
        accountId: account.id,
        authenticatorContexts,
        controllerEmitter,
        executions: [
          {
            data:
              action === 'install'
                ? encodeInstallValidatorModuleCall(moduleAddress, initData)
                : encodeUninstallValidatorModuleCall(moduleAddress),
            target: account.address,
            value: '0x0',
          },
        ],
        skipRapidPolling: true,
        smartAccount: metadata,
        useCachedMetadata: true,
        waitForConfirmation: true,
      });

      // Keep the durable custom-module records in sync with on-chain state.
      if (action === 'install') {
        await controllerEmitter(
          ['wallet', 'addSmartAccountCustomModule'],
          [
            {
              accountId: account.id,
              record: {
                address: moduleAddress,
                initData,
                moduleType: 1,
                name:
                  (request.name || '').trim() ||
                  `${host} ${t('smartAccountHub.customModule')}`,
              },
            },
          ],
          30000
        );
      } else if (targetModule?.id === 'custom') {
        await controllerEmitter(
          ['wallet', 'removeSmartAccountCustomModule'],
          [{ accountId: account.id, address: moduleAddress }],
          30000
        );
      }

      await refreshMetadata();

      dispatchBackgroundEvent(`${eventName}.${host}`, {
        action,
        address: moduleAddress,
        success: true,
      });
      window.close();
    } catch (err: any) {
      const wasHandled = handleWalletLockedError(err);
      if (!wasHandled) {
        setError(
          getSmartAccountActionErrorMessage(
            err,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas')
          )
        );
      }
    } finally {
      setLoading(false);
    }
  }, [
    account?.address,
    account?.id,
    accounts,
    action,
    activeNetwork.chainId,
    controllerEmitter,
    eventName,
    handleWalletLockedError,
    host,
    initData,
    metadata,
    moduleAddress,
    refreshMetadata,
    request.name,
    t,
    targetModule?.id,
    targetModuleIsValidator,
    smartAccountMatchesNetwork,
  ]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="remove-scrollbar flex-1 overflow-y-auto">
        <div className="border-b border-brand-gray300 px-6 py-6 text-center">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-brand-graylight">
            {action === 'install'
              ? t('smartAccountHub.dappInstallTitle')
              : t('smartAccountHub.dappUninstallTitle')}
          </h3>
          <div className="flex items-center justify-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple">
              <Icon name="link" className="text-white" size={16} />
            </div>
            <p className="text-lg font-medium text-brand-white">{host}</p>
          </div>
          <p className="mt-3 text-xs text-brand-graylight">
            {action === 'install'
              ? t('smartAccountHub.dappInstallPrompt', { host })
              : t('smartAccountHub.dappUninstallPrompt', { host })}
          </p>
        </div>

        <div className="space-y-3 px-6 py-6">
          <div className="space-y-2 rounded-lg bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
            {request.name && (
              <p className="font-medium text-white">{request.name}</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span>{t('smartAccountHub.moduleAddress')}</span>
              {moduleAddress ? (
                <AddressText value={moduleAddress} preset="medium" />
              ) : (
                <span className="break-all">{request.address || '-'}</span>
              )}
            </div>
            {action === 'install' && initData !== '0x' && (
              <div>
                <p>{t('smartAccountHub.moduleInitData')}</p>
                <p className="mt-1 break-all font-mono text-[10px]">
                  {initData}
                </p>
              </div>
            )}
            <p>
              {t('connections.prepareSmartAccountNetwork', {
                chainId: activeNetwork.chainId,
              })}
            </p>
          </div>

          {staticError && (
            <Card type="error">
              <p className="text-left text-sm font-normal">{staticError}</p>
            </Card>
          )}

          {!staticError && checking && (
            <Card type="info">
              <p className="text-left text-sm font-normal text-brand-yellowInfo">
                {t('smartAccountHub.checkModule')}...
              </p>
            </Card>
          )}

          {!staticError && action === 'install' && preflight?.ok && (
            <Card type="info">
              <p className="text-left text-sm font-normal text-brand-yellowInfo">
                {t('smartAccountHub.preflightPassed')}
              </p>
            </Card>
          )}

          {!staticError && preflightFailureMessage && (
            <Card type="error">
              <p className="text-left text-sm font-normal">
                {preflightFailureMessage}
              </p>
            </Card>
          )}

          {!staticError && action === 'install' && preflight?.ok && (
            <Card type="error">
              <div className="space-y-3 text-left text-sm font-normal">
                <p>{t('smartAccountHub.customRisk')}</p>
                <label className="flex items-start gap-2 text-xs text-brand-white">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={loading}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>{t('smartAccountHub.customRiskAck')}</span>
                </label>
              </div>
            </Card>
          )}

          {!staticError && action === 'uninstall' && targetModule && (
            <Card type="info">
              <p className="text-left text-sm font-normal text-brand-yellowInfo">
                {t('smartAccountHub.uninstallDescription')}
              </p>
            </Card>
          )}

          {error && (
            <Card type="error">
              <p className="text-left text-sm font-normal">{error}</p>
            </Card>
          )}
        </div>

        <div className="pb-32" />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-brand-gray300 bg-bkg-3 px-4 py-3 shadow-lg">
        <div className="flex justify-center gap-3">
          <Button
            variant="secondary"
            type="button"
            onClick={() => window.close()}
            disabled={loading}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={approve}
            disabled={!canConfirm}
            loading={loading}
          >
            {t('buttons.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};
