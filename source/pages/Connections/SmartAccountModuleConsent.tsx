import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { AddressText, Button, Card, Icon } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import {
  ISmartAccountMetadata,
  KeyringAccountType,
  SmartAccountInstalledModule,
} from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { isHexString } from 'utils/ethersV6Compat';
import { getAddress, isAddress } from 'utils/ethersV6Compat';
import { IEvmTransactionContext } from 'utils/evmTransactionContext';
import {
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
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
  const activeAccountMeta = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeSlip44 = useSelector(
    (state: RootState) => state.vaultGlobal.activeSlip44
  );
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

  const [preflightResult, setPreflight] =
    useState<CustomValidatorPreflightResult | null>(null);
  const [checkedScope, setCheckedScope] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loadingScope, setLoadingScope] = useState<object | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moduleAddress = useMemo(() => {
    const raw = (request.address || '').trim();
    if (!isAddress(raw)) return null;
    return getAddress(raw);
  }, [request.address]);
  const initData = request.initData || '0x';
  const validInitData = isHexString(initData);
  // Review results and acknowledgment belong to one account, endpoint and
  // exact request. In particular, an unsuccessful new check must never reuse
  // a previous request's successful preflight.
  const scopeKey = JSON.stringify([
    account?.id,
    account?.address,
    account?.smartAccount?.chainId,
    activeAccountMeta.id,
    activeAccountMeta.type,
    activeAccount?.address,
    activeSlip44,
    activeNetwork.kind,
    activeNetwork.chainId,
    activeNetwork.url,
    host,
    eventName,
    action,
    moduleAddress,
    initData,
    request.name,
  ]);
  // Returning to the same selection must not revive an older approval callback.
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrentScope = useCallback(
    (candidate: object) =>
      mounted.current && currentScope.current === candidate,
    []
  );
  const loading = loadingScope === scope;
  const [metadataState, setMetadataState] = useState<{
    scopeKey: string;
    value: ISmartAccountMetadata | null;
  }>({ scopeKey, value: account?.smartAccount || null });
  const metadata =
    metadataState.scopeKey === scopeKey
      ? metadataState.value
      : account?.smartAccount || null;
  const preflight = checkedScope === scopeKey ? preflightResult : null;
  const approvalInFlight = useRef(false);
  const submissionConfirmed = useRef(false);

  const isSmartAccount = Boolean(account?.isSmartAccount);
  const smartAccountMatchesNetwork = Boolean(
    account?.isSmartAccount &&
      account.smartAccount?.chainId === activeNetwork.chainId
  );

  const refreshMetadata = useCallback(
    async (expectedContext: IEvmTransactionContext) => {
      if (!account?.isSmartAccount || !isCurrentScope(scope)) return null;
      const hydrated = (await controllerEmitter(
        ['wallet', 'hydrateSmartAccount'],
        [account.id, expectedContext],
        300000
      )) as ISmartAccountMetadata;
      if (!isCurrentScope(scope)) return null;
      setMetadataState({ scopeKey, value: hydrated });
      return hydrated;
    },
    [
      account?.id,
      account?.isSmartAccount,
      controllerEmitter,
      isCurrentScope,
      scope,
      scopeKey,
    ]
  );

  const installedModules = metadata?.installedModules || [];
  const targetModule = installedModules.find((module) =>
    sameAddress(module.address, moduleAddress || undefined)
  ) as SmartAccountInstalledModule | undefined;
  const activeValidator = installedModules.find(
    (module) =>
      module.type === 'validator' &&
      sameAddress(metadata?.auth?.validator, module.address)
  );
  const targetModuleIsValidator = targetModule?.type === 'validator';
  const isActiveValidator = sameAddress(
    metadata?.auth?.validator,
    moduleAddress || undefined
  );
  const activeCompositeValidator = installedModules.find(
    (module) =>
      module.type === 'validator' &&
      module.id === 'composite' &&
      sameAddress(metadata?.auth?.validator, module.address)
  );
  const isActiveCompositeChild =
    activeCompositeValidator?.type === 'validator' &&
    activeCompositeValidator.id === 'composite' &&
    activeCompositeValidator.config.childValidators.some((child) =>
      sameAddress(child, moduleAddress || undefined)
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
    : action === 'uninstall' && (isActiveValidator || isActiveCompositeChild)
    ? t('smartAccountHub.cannotRemoveActiveValidator')
    : null;

  // Hydrate on-chain state and, for installs, run the custom-validator
  // preflight (code exists, reports ERC-7579 validator, not yet installed).
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setCheckedScope(null);
      setPreflight(null);
      setAcknowledged(false);
      setError(null);
      setMetadataState({ scopeKey, value: account?.smartAccount || null });
      setChecking(false);
      if (!smartAccountMatchesNetwork || !moduleAddress) return;
      setChecking(true);
      try {
        if (account.smartAccount?.isDeployed) {
          const hydrated = (await controllerEmitter(
            ['wallet', 'hydrateSmartAccount'],
            [account.id],
            300000
          )) as ISmartAccountMetadata;
          if (!cancelled) setMetadataState({ scopeKey, value: hydrated });
        }
        if (action === 'install') {
          const result = (await controllerEmitter(
            ['wallet', 'preflightSmartAccountCustomValidator'],
            [{ accountId: account.id, address: moduleAddress }],
            60000
          )) as CustomValidatorPreflightResult;
          if (!cancelled) setPreflight(result);
        }
        if (!cancelled) setCheckedScope(scopeKey);
      } catch (err: any) {
        if (!cancelled) {
          setError(
            getSmartAccountActionErrorMessage(
              err,
              t('send.cantCompleteTxs'),
              t('send.insufficientFundsForGas'),
              t('settings.slhDsaLocalSignerMissing')
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
  }, [controllerEmitter, scopeKey, t]);

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
    checkedScope === scopeKey &&
    !submissionConfirmed.current &&
    !approvalInFlight.current &&
    !checking &&
    !loading &&
    (action === 'uninstall'
      ? Boolean(targetModuleIsValidator)
      : Boolean(preflight?.ok) && acknowledged);

  const approve = useCallback(async () => {
    if (
      !canConfirm ||
      approvalInFlight.current ||
      !isCurrentScope(scope) ||
      !account?.address ||
      !moduleAddress ||
      !metadata
    )
      return;
    approvalInFlight.current = true;
    setLoadingScope(scope);
    setError(null);
    let acknowledgedSubmission = false;
    const finishSuccess = (close: boolean) => {
      dispatchBackgroundEvent(`${eventName}.${host}`, {
        action,
        address: moduleAddress,
        success: true,
      });
      if (close && isCurrentScope(scope)) window.close();
    };
    try {
      const sessionGeneration = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      const assertCurrent = () => {
        if (!isCurrentScope(scope))
          throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
      };
      assertCurrent();
      if (
        activeAccountMeta.id !== account.id ||
        activeAccountMeta.type !== KeyringAccountType.SmartAccount ||
        typeof sessionGeneration !== 'number' ||
        !Number.isSafeInteger(sessionGeneration) ||
        sessionGeneration < 0 ||
        typeof activeSlip44 !== 'number'
      )
        throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
      const expectedContext: IEvmTransactionContext = {
        account: {
          address: account.address,
          id: account.id,
          type: KeyringAccountType.SmartAccount,
        },
        chainId: activeNetwork.chainId,
        rpcUrl: activeNetwork.url,
        slip44: activeSlip44,
        sessionGeneration,
      };
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
      if (
        action === 'uninstall' &&
        (isActiveValidator || isActiveCompositeChild)
      ) {
        setError(t('smartAccountHub.cannotRemoveActiveValidator'));
        return;
      }
      if (action === 'install' && !activeValidator?.data) {
        setError(t('smartAccountHub.noActiveValidator'));
        return;
      }
      const authenticatorContexts = getSmartAccountLocalOwnerContexts({
        accounts: accounts as any,
        controllerEmitter: controllerEmitter as any,
      });
      await signAndSubmitSmartAccountExecutions({
        accountAddress: account.address,
        accountId: account.id,
        authenticatorContexts,
        controllerEmitter,
        expectedContext,
        onBeforeSubmit: async () => assertCurrent(),
        onPrepared: assertCurrent,
        executions: [
          {
            data:
              action === 'install'
                ? encodeInstallValidatorModuleCall(moduleAddress, initData)
                : encodeUninstallValidatorModuleCall(moduleAddress),
            target: account.address,
            value: '0x0',
          },
          ...(action === 'install' && activeValidator?.data
            ? [
                {
                  data: encodeRotateValidatorModuleCall(
                    activeValidator.address,
                    activeValidator.data
                  ),
                  target: account.address,
                  value: '0x0',
                },
              ]
            : []),
        ],
        skipRapidPolling: true,
        smartAccount: metadata,
        trackLocalSubmission: true,
        useCachedMetadata: true,
        waitForConfirmation: true,
      });
      acknowledgedSubmission = true;
      submissionConfirmed.current = true;
      // Keep the acknowledged result, but never apply its metadata to another
      // identity or close a replacement view after an account/session change.
      if (!isCurrentScope(scope)) {
        finishSuccess(false);
        return;
      }
      const currentGeneration = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      if (!isCurrentScope(scope) || currentGeneration !== sessionGeneration) {
        finishSuccess(false);
        return;
      }

      // Keep the durable custom-module records in sync with on-chain state.
      if (action === 'install') {
        await controllerEmitter(
          ['wallet', 'addSmartAccountCustomModule'],
          [
            {
              accountId: account.id,
              expectedContext,
              record: {
                address: moduleAddress,
                compositeCompatible: preflight?.compositeCompatible === true,
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
          [{ accountId: account.id, address: moduleAddress, expectedContext }],
          30000
        );
      }

      await refreshMetadata(expectedContext);
      finishSuccess(true);
    } catch (err: any) {
      if (
        acknowledgedSubmission &&
        (!isCurrentScope(scope) ||
          err?.message === 'PALI_TRANSACTION_CONTEXT_CHANGED')
      ) {
        finishSuccess(false);
        return;
      }
      if (!isCurrentScope(scope)) return;
      const wasHandled = handleWalletLockedError(err);
      if (!wasHandled) {
        setError(
          submissionConfirmed.current
            ? t(
                action === 'install'
                  ? 'smartAccountHub.moduleMetadataSaveFailed'
                  : 'smartAccountHub.moduleMetadataRemoveFailed'
              )
            : getSmartAccountActionErrorMessage(
                err,
                t('send.cantCompleteTxs'),
                t('send.insufficientFundsForGas'),
                t('settings.slhDsaLocalSignerMissing')
              )
        );
      }
    } finally {
      approvalInFlight.current = false;
      if (mounted.current)
        setLoadingScope((current) => (current === scope ? null : current));
    }
  }, [
    account?.address,
    account?.id,
    accounts,
    action,
    canConfirm,
    activeValidator?.address,
    activeValidator?.data,
    activeNetwork.chainId,
    activeNetwork.url,
    activeAccountMeta,
    activeSlip44,
    controllerEmitter,
    eventName,
    handleWalletLockedError,
    host,
    initData,
    isCurrentScope,
    isActiveValidator,
    isActiveCompositeChild,
    metadata,
    moduleAddress,
    preflight,
    refreshMetadata,
    request.name,
    scope,
    t,
    targetModule?.id,
    targetModuleIsValidator,
    smartAccountMatchesNetwork,
  ]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="remove-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-brand-gray300 px-6 py-6 text-center">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-brand-graylight">
            {action === 'install'
              ? t('smartAccountHub.dappInstallTitle')
              : t('smartAccountHub.dappUninstallTitle')}
          </h3>
          <div className="flex min-w-0 items-center justify-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple">
              <Icon name="link" className="text-white" size={16} />
            </div>
            <p className="min-w-0 break-words text-lg font-medium text-brand-white [overflow-wrap:anywhere]">
              {host}
            </p>
          </div>
          <p className="mt-3 break-words text-xs text-brand-graylight [overflow-wrap:anywhere]">
            {action === 'install'
              ? t('smartAccountHub.dappInstallPrompt', { host })
              : t('smartAccountHub.dappUninstallPrompt', { host })}
          </p>
        </div>

        <div className="space-y-3 px-6 py-6">
          <div className="space-y-2 rounded-lg bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
            {request.name && (
              <p className="break-words font-medium text-white [overflow-wrap:anywhere]">
                {request.name}
              </p>
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

      <ToastActionFooter className="fixed bottom-0 left-0 right-0 z-50 border-t border-brand-gray300 bg-bkg-3 px-4 py-3 shadow-lg">
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
      </ToastActionFooter>
    </div>
  );
};
