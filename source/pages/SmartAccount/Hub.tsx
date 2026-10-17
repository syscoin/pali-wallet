import { CubeIcon } from '@heroicons/react/outline';
import { Form, Input } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  AddressText,
  Button,
  CenterPanel,
  ConfirmationModal,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
  Icon,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from 'types/network';
import { isHexString } from 'utils/ethersV6Compat';
import { getAddress, isAddress } from 'utils/ethersV6Compat';
import { IEvmTransactionContext } from 'utils/evmTransactionContext';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  encodeCompositeValidatorInitData,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  getAvailablePaliModules,
  getPaliModuleAddress,
  getSmartAccountLocalOwnerContexts,
  isPaliSignableValidator,
  listCompositeChildCandidates,
  signAndSubmitSmartAccountExecutions,
} from 'utils/smartAccount';
import type { CustomValidatorPreflightResult } from 'utils/smartAccount';
import { getSmartAccountActionErrorMessage } from 'utils/smartAccountErrors';

import CompositeApprovalDialog from './CompositeApprovalDialog';
import SmartAccountEntry from './SmartAccountEntry';

// ---------------------------------------------------------------------------
// Smart Account hub: the 2-click home for everything smart-account.
//  - sign-in method (active validator) + manage link into the policy flows
//  - installed module list (uninstall where safe)
//  - module marketplace (builtin set-up links + bring-your-own validator)
//  - composite policy builder over installed validators
//  - recovery + infrastructure shortcuts
// Deep flows (passkey creation, guardian recovery, validator switching) stay
// on the proven SmartAccountPolicy page; the hub links into it.
// ---------------------------------------------------------------------------

const moduleDisplayName = (
  module: SmartAccountValidatorModule | { config?: any; id: string },
  t: (key: string) => string
): string => {
  switch (module.id) {
    case 'p256-webauthn':
      return t('settings.passkeyAuthenticator');
    case 'ecdsa':
      return t('settings.ecdsaAuthenticator');
    case 'slh-dsa':
      return t('settings.slhDsaAuthenticator');
    case 'composite':
      return t('settings.compositeAuthenticator');
    case 'guardian-recovery':
      return t('settings.smartAccountGuardianRecoveryTitle');
    case 'custom':
      return (module as any).config?.name || t('smartAccountHub.customModule');
    default:
      return (module as any).config?.name || module.id;
  }
};

type CustomInstallState = {
  acknowledged: boolean;
  address: string;
  initData: string;
  name: string;
  preflight: CustomValidatorPreflightResult | null;
  step: 'form' | 'review';
};

const INITIAL_CUSTOM_INSTALL: CustomInstallState = {
  acknowledged: false,
  address: '',
  initData: '0x',
  name: '',
  preflight: null,
  step: 'form',
};

type HubScope = {
  generation: number;
  key: string;
  nativeLocation: string;
  navigationScope: string;
};
type ApprovalScope = HubScope & { expectedContext: IEvmTransactionContext };

const buildCustomValidatorInstallExecutions = ({
  accountAddress,
  activeValidatorAddress,
  activeValidatorData,
  customInitData,
  customValidatorAddress,
}: {
  accountAddress: string;
  activeValidatorAddress: string;
  activeValidatorData: string;
  customInitData: string;
  customValidatorAddress: string;
}) => [
  {
    data: encodeInstallValidatorModuleCall(
      customValidatorAddress,
      customInitData
    ),
    target: accountAddress,
    value: '0x0',
  },
  {
    data: encodeRotateValidatorModuleCall(
      activeValidatorAddress,
      activeValidatorData
    ),
    target: accountAddress,
    value: '0x0',
  },
];

const SmartAccountHub = () => {
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const location = useLocation();
  const { controllerEmitter, isUnlocked, isLoading, connectionUnavailable } =
    useController();
  const account = useSelector(selectActiveAccount);
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccountMeta = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeSlip44 = useSelector(
    (state: RootState) => state.vaultGlobal?.activeSlip44
  );
  const navigationScope = JSON.stringify(getWalletNavigationScope());
  const scopeKey = JSON.stringify([
    navigationScope,
    activeAccountMeta.type,
    activeAccountMeta.id,
    account?.address,
    activeNetwork.chainId,
    activeNetwork.url,
    activeSlip44,
    location.pathname,
    location.search,
    location.hash,
    location.key,
    isUnlocked,
    isLoading,
    connectionUnavailable,
  ]);
  const lifetime = useRef({
    generation: 0,
    key: scopeKey,
    nativeLocation: window.location.href,
  });
  if (lifetime.current.key !== scopeKey)
    lifetime.current = {
      key: scopeKey,
      generation: lifetime.current.generation + 1,
      nativeLocation: window.location.href,
    };
  const mounted = useRef(true);
  const trusted = useRef(false);
  trusted.current = Boolean(isUnlocked && !isLoading && !connectionUnavailable);
  const compositeScope = useRef<ApprovalScope>();
  const compositeOpenGeneration = useRef(0);
  const compositeSaveJob = useRef<object>();
  const customScope = useRef<ApprovalScope>();
  const customOpenGeneration = useRef(0);
  const customJob = useRef<object>();
  const uninstallScope = useRef<ApprovalScope>();
  const uninstallOpenGeneration = useRef(0);
  const uninstallJob = useRef<object>();
  const captureScope = useCallback(
    (): HubScope => ({
      ...lifetime.current,
      navigationScope: JSON.stringify(getWalletNavigationScope()),
    }),
    []
  );
  const isCurrentScope = useCallback(
    (scope: HubScope) =>
      mounted.current &&
      trusted.current &&
      scope.generation === lifetime.current.generation &&
      scope.key === lifetime.current.key &&
      scope.nativeLocation === window.location.href &&
      scope.navigationScope === JSON.stringify(getWalletNavigationScope()),
    []
  );
  const assertCurrentScope = useCallback(
    (scope: HubScope) => {
      if (!isCurrentScope(scope))
        throw Object.assign(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
          transactionNotBroadcast: true,
        });
    },
    [isCurrentScope]
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifetime.current.generation += 1;
    };
  }, []);

  const [metadata, setMetadata] = useState<ISmartAccountMetadata | null>(
    account?.smartAccount || null
  );
  const [busyKey, setBusyKey] = useState('');
  const [customInstall, setCustomInstall] = useState<CustomInstallState | null>(
    null
  );
  const [compositeBuilder, setCompositeBuilder] = useState<{
    children: string[];
    threshold: number;
  } | null>(null);
  const [confirmUninstall, setConfirmUninstall] =
    useState<SmartAccountValidatorModule | null>(null);

  const isSmartAccount = Boolean(account?.isSmartAccount);
  const smartAccountAddress = account?.address;

  const refreshMetadata = useCallback(async () => {
    // An old action can invoke its captured refresh callback after selection
    // changes; do not capture the new scope for that callback's old account.
    if (!account?.isSmartAccount || lifetime.current.key !== scopeKey)
      return null;
    const scope = captureScope();
    const hydrated = (await controllerEmitter(
      ['wallet', 'hydrateSmartAccount'],
      [account.id],
      300000
    )) as ISmartAccountMetadata;
    if (!isCurrentScope(scope)) return null;
    setMetadata(hydrated);
    return hydrated;
  }, [
    account?.id,
    account?.isSmartAccount,
    controllerEmitter,
    captureScope,
    isCurrentScope,
    scopeKey,
  ]);

  useEffect(() => {
    compositeOpenGeneration.current += 1;
    compositeScope.current = undefined;
    compositeSaveJob.current = undefined;
    customOpenGeneration.current += 1;
    customScope.current = undefined;
    customJob.current = undefined;
    uninstallOpenGeneration.current += 1;
    uninstallScope.current = undefined;
    uninstallJob.current = undefined;
    setCompositeBuilder(null);
    setCustomInstall(null);
    setConfirmUninstall(null);
    setBusyKey((key) =>
      key.startsWith('composite:') ||
      key.startsWith('custom:') ||
      key.startsWith('uninstall:')
        ? ''
        : key
    );
    setMetadata(account?.smartAccount || null);
    if (
      trusted.current &&
      account?.isSmartAccount &&
      account?.smartAccount?.isDeployed
    ) {
      refreshMetadata().catch(() => undefined);
    }
  }, [scopeKey]);

  const installedModules = metadata?.installedModules || [];
  const installedValidators = installedModules.filter(
    (module): module is SmartAccountValidatorModule =>
      module.type === 'validator'
  );
  const activeValidatorAddress = metadata?.auth?.validator?.toLowerCase();
  const activeValidator = installedValidators.find(
    (module) => module.address.toLowerCase() === activeValidatorAddress
  );
  const compositeChildren = new Set(
    installedValidators
      .filter((module) => module.id === 'composite')
      .flatMap((module) =>
        module.id === 'composite'
          ? module.config.childValidators.map((child) => child.toLowerCase())
          : []
      )
  );

  const marketplaceModules = useMemo(
    () =>
      getAvailablePaliModules(activeNetwork.chainId).filter(
        (module) => module.supported
      ),
    [activeNetwork.chainId]
  );

  const goToPolicyPage = useCallback(() => {
    navigate('/settings/account/smart-account-policy');
  }, [navigate]);

  const getLocalOwnerContexts = useCallback(
    () =>
      getSmartAccountLocalOwnerContexts({
        accounts: accounts as any,
        controllerEmitter: controllerEmitter as any,
      }),
    [accounts, controllerEmitter]
  );

  const readApprovalScope = useCallback(
    async (scope: HubScope): Promise<ApprovalScope> => {
      assertCurrentScope(scope);
      if (!account?.address || lifetime.current.key !== scopeKey)
        throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
      const sessionGeneration = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      assertCurrentScope(scope);
      if (
        typeof sessionGeneration !== 'number' ||
        !Number.isSafeInteger(sessionGeneration) ||
        sessionGeneration < 0
      )
        throw new Error('Invalid wallet session');
      return {
        ...scope,
        expectedContext: {
          account: {
            address: account.address,
            id: activeAccountMeta.id,
            type: activeAccountMeta.type,
          },
          chainId: activeNetwork.chainId,
          rpcUrl: activeNetwork.url,
          slip44: activeSlip44,
          sessionGeneration,
        },
      };
    },
    [
      account?.address,
      activeAccountMeta,
      activeNetwork.chainId,
      activeNetwork.url,
      activeSlip44,
      assertCurrentScope,
      controllerEmitter,
      scopeKey,
    ]
  );

  const assertApprovalSession = useCallback(
    async (scope: ApprovalScope) => {
      assertCurrentScope(scope);
      const generation = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      assertCurrentScope(scope);
      if (generation !== scope.expectedContext.sessionGeneration)
        throw Object.assign(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
          transactionNotBroadcast: true,
        });
    },
    [assertCurrentScope, controllerEmitter]
  );

  const submitExecutions = useCallback(
    async (
      executions: Array<{ data: string; target: string; value: string }>,
      scope?: ApprovalScope
    ) => {
      if (!account?.isSmartAccount || !metadata) return;
      if (scope) assertCurrentScope(scope);
      const response = await signAndSubmitSmartAccountExecutions({
        accountAddress: account.address,
        accountId: account.id,
        authenticatorContexts: getLocalOwnerContexts(),
        controllerEmitter,
        executions,
        ...(scope
          ? {
              expectedContext: scope.expectedContext,
              onPrepared: () => assertCurrentScope(scope),
              onBeforeSubmit: async () => assertCurrentScope(scope),
              trackLocalSubmission: true,
            }
          : {}),
        skipRapidPolling: true,
        smartAccount: metadata,
        useCachedMetadata: true,
        waitForConfirmation: true,
      });
      // The transaction acknowledgement remains authoritative after a switch.
      // A late read or UI update must not apply to the newly selected account.
      if (!scope) await refreshMetadata();
      else if (isCurrentScope(scope))
        await refreshMetadata().catch(() => undefined);
      return response;
    },
    [
      account?.id,
      account?.isSmartAccount,
      controllerEmitter,
      getLocalOwnerContexts,
      assertCurrentScope,
      isCurrentScope,
      metadata,
      refreshMetadata,
    ]
  );

  const closeUninstall = useCallback(() => {
    if (uninstallJob.current) return;
    uninstallOpenGeneration.current++;
    uninstallScope.current = undefined;
    setConfirmUninstall(null);
  }, []);

  const openUninstall = useCallback(
    async (module: SmartAccountValidatorModule) => {
      if (busyKey || lifetime.current.key !== scopeKey) return;
      const scope = captureScope();
      if (!isCurrentScope(scope)) return;
      const opening = ++uninstallOpenGeneration.current;
      try {
        const approval = await readApprovalScope(scope);
        if (
          !isCurrentScope(scope) ||
          opening !== uninstallOpenGeneration.current
        )
          return;
        uninstallScope.current = approval;
        setConfirmUninstall(module);
      } catch (error) {
        if (
          isCurrentScope(scope) &&
          opening === uninstallOpenGeneration.current
        )
          alert.error(
            getSmartAccountActionErrorMessage(
              error,
              t('send.cantCompleteTxs'),
              t('send.insufficientFundsForGas'),
              t('settings.slhDsaLocalSignerMissing')
            )
          );
      }
    },
    [
      alert,
      busyKey,
      captureScope,
      isCurrentScope,
      readApprovalScope,
      scopeKey,
      t,
    ]
  );

  const handleUninstall = useCallback(
    async (module: SmartAccountValidatorModule) => {
      const scope = uninstallScope.current;
      if (
        !account?.address ||
        !scope ||
        uninstallJob.current ||
        !isCurrentScope(scope) ||
        module !== confirmUninstall
      )
        return;
      const job = {};
      uninstallJob.current = job;
      setBusyKey(`uninstall:${module.address}`);
      let acknowledged = false;
      const finishAcknowledged = (warning = false) => {
        if (uninstallScope.current !== scope) return;
        if (isCurrentScope(scope)) {
          alert.success(t('smartAccountHub.moduleUninstalled'));
          if (warning)
            alert.error(t('smartAccountHub.moduleMetadataRemoveFailed'));
        }
        uninstallScope.current = undefined;
        setConfirmUninstall(null);
      };
      try {
        await assertApprovalSession(scope);
        await submitExecutions(
          [
            {
              data: encodeUninstallValidatorModuleCall(module.address),
              target: account.address,
              value: '0x0',
            },
          ],
          scope
        );
        acknowledged = true;
        if (!isCurrentScope(scope) || uninstallScope.current !== scope) {
          finishAcknowledged();
          return;
        }
        if (module.id === 'custom') {
          const generation = await controllerEmitter(
            ['wallet', 'getWalletSessionGeneration'],
            []
          );
          if (
            !isCurrentScope(scope) ||
            uninstallScope.current !== scope ||
            generation !== scope.expectedContext.sessionGeneration
          ) {
            finishAcknowledged(true);
            return;
          }
          await controllerEmitter(
            ['wallet', 'removeSmartAccountCustomModule'],
            [
              {
                accountId: account.id,
                address: module.address,
                expectedContext: scope.expectedContext,
              },
            ],
            30000
          );
          if (!isCurrentScope(scope) || uninstallScope.current !== scope)
            return;
          await refreshMetadata();
        }
        finishAcknowledged();
      } catch (error) {
        if (acknowledged) finishAcknowledged(true);
        else if (isCurrentScope(scope) && uninstallScope.current === scope)
          alert.error(
            getSmartAccountActionErrorMessage(
              error,
              t('send.cantCompleteTxs'),
              t('send.insufficientFundsForGas'),
              t('settings.slhDsaLocalSignerMissing')
            )
          );
      } finally {
        if (uninstallJob.current === job) {
          uninstallJob.current = undefined;
          setBusyKey('');
        }
      }
    },
    [
      account?.address,
      account?.id,
      alert,
      assertApprovalSession,
      confirmUninstall,
      controllerEmitter,
      isCurrentScope,
      refreshMetadata,
      submitExecutions,
      t,
    ]
  );

  const closeCustomInstall = useCallback(() => {
    if (customJob.current) return;
    customOpenGeneration.current += 1;
    customScope.current = undefined;
    setCustomInstall(null);
  }, []);

  const openCustomInstall = useCallback(async () => {
    if (
      busyKey ||
      !account?.address ||
      !metadata?.isDeployed ||
      lifetime.current.key !== scopeKey
    )
      return;
    const scope = captureScope();
    if (!isCurrentScope(scope)) return;
    const opening = ++customOpenGeneration.current;
    try {
      const approval = await readApprovalScope(scope);
      if (!isCurrentScope(scope) || opening !== customOpenGeneration.current)
        return;
      customScope.current = approval;
      setCustomInstall({ ...INITIAL_CUSTOM_INSTALL });
    } catch (error) {
      if (isCurrentScope(scope) && opening === customOpenGeneration.current)
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas'),
            t('settings.slhDsaLocalSignerMissing')
          )
        );
    }
  }, [
    account?.address,
    alert,
    busyKey,
    captureScope,
    isCurrentScope,
    metadata?.isDeployed,
    readApprovalScope,
    scopeKey,
    t,
  ]);

  const runCustomPreflight = useCallback(async () => {
    const scope = customScope.current;
    if (
      !customInstall ||
      !Number.isSafeInteger(account?.id) ||
      !scope ||
      customJob.current ||
      !isCurrentScope(scope)
    )
      return;
    const draft = customInstall;
    const address = customInstall.address.trim();
    if (!isAddress(address)) {
      alert.error(t('smartAccountHub.invalidModuleAddress'));
      return;
    }
    if (customInstall.initData && !isHexString(customInstall.initData)) {
      alert.error(t('smartAccountHub.invalidInitData'));
      return;
    }
    const job = {};
    customJob.current = job;
    setBusyKey('custom:preflight');
    try {
      await assertApprovalSession(scope);
      const preflight = (await controllerEmitter(
        ['wallet', 'preflightSmartAccountCustomValidator'],
        [{ accountId: account.id, address }],
        60000
      )) as CustomValidatorPreflightResult;
      await assertApprovalSession(scope);
      if (customJob.current !== job) return;
      setCustomInstall((state) =>
        state === draft
          ? {
              ...state,
              acknowledged: false,
              preflight,
              step: preflight.ok ? 'review' : 'form',
            }
          : state
      );
      if (!preflight.ok) {
        const reason = preflight.failures[0];
        alert.error(
          reason === 'already-installed'
            ? t('smartAccountHub.preflightAlreadyInstalled')
            : reason === 'no-contract-code'
            ? t('smartAccountHub.preflightNoCode')
            : t('smartAccountHub.preflightNotValidator')
        );
      }
    } catch (error) {
      if (isCurrentScope(scope) && customScope.current === scope)
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas'),
            t('settings.slhDsaLocalSignerMissing')
          )
        );
    } finally {
      if (customJob.current === job) {
        customJob.current = undefined;
        setBusyKey('');
      }
    }
  }, [
    account?.id,
    alert,
    assertApprovalSession,
    controllerEmitter,
    customInstall,
    isCurrentScope,
    t,
  ]);

  const handleCustomInstall = useCallback(async () => {
    const scope = customScope.current;
    if (
      !customInstall ||
      !account?.address ||
      !customInstall.acknowledged ||
      !customInstall.preflight?.ok ||
      customInstall.step !== 'review' ||
      !scope ||
      customJob.current ||
      !isCurrentScope(scope)
    ) {
      return;
    }
    if (!activeValidator?.data) {
      alert.error(t('smartAccountHub.noActiveValidator'));
      return;
    }
    const job = {};
    customJob.current = job;
    setBusyKey('custom:install');
    let acknowledged = false;
    const finishAcknowledged = (warning = false) => {
      if (customScope.current !== scope) return;
      if (isCurrentScope(scope)) {
        alert.success(t('smartAccountHub.moduleInstalled'));
        if (warning) alert.error(t('smartAccountHub.moduleMetadataSaveFailed'));
      }
      customScope.current = undefined;
      setCustomInstall(null);
    };
    try {
      await assertApprovalSession(scope);
      const address = getAddress(customInstall.address.trim());
      const initData = customInstall.initData || '0x';
      await submitExecutions(
        buildCustomValidatorInstallExecutions({
          accountAddress: account.address,
          activeValidatorAddress: activeValidator.address,
          activeValidatorData: activeValidator.data,
          customInitData: initData,
          customValidatorAddress: address,
        }),
        scope
      );
      acknowledged = true;
      // A published result remains acknowledged, but must not write a custom
      // record into a different account/session or close its new dialog.
      if (!isCurrentScope(scope) || customScope.current !== scope) {
        finishAcknowledged();
        return;
      }
      const generation = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      if (
        !isCurrentScope(scope) ||
        customScope.current !== scope ||
        generation !== scope.expectedContext.sessionGeneration
      ) {
        finishAcknowledged(true);
        return;
      }
      await controllerEmitter(
        ['wallet', 'addSmartAccountCustomModule'],
        [
          {
            accountId: account.id,
            expectedContext: scope.expectedContext,
            record: {
              address,
              compositeCompatible:
                customInstall.preflight?.compositeCompatible === true,
              initData,
              moduleType: 1,
              name:
                customInstall.name.trim() || t('smartAccountHub.customModule'),
            },
          },
        ],
        30000
      );
      if (!isCurrentScope(scope) || customScope.current !== scope) return;
      await refreshMetadata();
      if (!isCurrentScope(scope) || customScope.current !== scope) return;
      finishAcknowledged();
    } catch (error) {
      if (acknowledged) finishAcknowledged(true);
      else if (isCurrentScope(scope) && customScope.current === scope) {
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas'),
            t('settings.slhDsaLocalSignerMissing')
          )
        );
      }
    } finally {
      if (customJob.current === job) {
        customJob.current = undefined;
        setBusyKey('');
      }
    }
  }, [
    account?.address,
    account?.id,
    alert,
    activeValidator,
    assertApprovalSession,
    controllerEmitter,
    customInstall,
    isCurrentScope,
    refreshMetadata,
    submitExecutions,
    t,
  ]);

  const compositeCandidates = metadata
    ? listCompositeChildCandidates(metadata)
    : [];
  const installedComposite = installedValidators.find(
    (module) => module.id === 'composite'
  );

  const closeCompositeBuilder = useCallback(() => {
    if (compositeSaveJob.current) return;
    compositeOpenGeneration.current += 1;
    compositeScope.current = undefined;
    setCompositeBuilder(null);
  }, []);

  const openCompositeBuilder = useCallback(async () => {
    if (busyKey || !account?.address || !metadata?.isDeployed) return;
    const scope = captureScope();
    if (!isCurrentScope(scope)) return;
    const opening = ++compositeOpenGeneration.current;
    try {
      const approval = await readApprovalScope(scope);
      if (!isCurrentScope(scope) || opening !== compositeOpenGeneration.current)
        return;
      compositeScope.current = approval;
      setCompositeBuilder({
        children:
          installedComposite?.id === 'composite'
            ? [...installedComposite.config.childValidators]
            : [],
        threshold:
          installedComposite?.id === 'composite'
            ? installedComposite.config.threshold
            : 1,
      });
    } catch (error) {
      if (isCurrentScope(scope) && opening === compositeOpenGeneration.current)
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas'),
            t('settings.slhDsaLocalSignerMissing')
          )
        );
    }
  }, [
    account?.address,
    alert,
    busyKey,
    captureScope,
    installedComposite,
    isCurrentScope,
    metadata?.isDeployed,
    readApprovalScope,
    t,
  ]);

  const handleCompositeSave = useCallback(async () => {
    const scope = compositeScope.current;
    if (
      !compositeBuilder ||
      !account?.address ||
      !metadata ||
      !scope ||
      compositeSaveJob.current ||
      !isCurrentScope(scope)
    )
      return;
    const { children, threshold } = compositeBuilder;
    let normalizedChildren: string[];
    try {
      normalizedChildren = children.map(getAddress);
    } catch {
      alert.error(t('smartAccountHub.compositeInvalid'));
      return;
    }
    if (
      normalizedChildren.length === 0 ||
      !Number.isSafeInteger(threshold) ||
      threshold < 1 ||
      threshold > normalizedChildren.length ||
      new Set(normalizedChildren).size !== normalizedChildren.length ||
      normalizedChildren.some(
        (child) =>
          child === '0x0000000000000000000000000000000000000000' ||
          !compositeCandidates.some(
            (candidate) =>
              candidate.address.toLowerCase() === child.toLowerCase()
          )
      )
    ) {
      alert.error(t('smartAccountHub.compositeInvalid'));
      return;
    }
    // Lockout guard: the composite must keep at least one Pali-signable
    // child below threshold reach (i.e. signable children >= threshold).
    const signableChildren = normalizedChildren.filter((child) => {
      const childModule = installedValidators.find(
        (module) => module.address.toLowerCase() === child.toLowerCase()
      );
      return (
        childModule &&
        isPaliSignableValidator(childModule, metadata) &&
        childModule.id !== 'composite'
      );
    });
    if (signableChildren.length < threshold) {
      alert.error(t('smartAccountHub.compositeLockout'));
      return;
    }

    const compositeAddress = marketplaceModules.find(
      (module) => module.id === 'composite'
    );
    if (!compositeAddress) {
      alert.error(t('smartAccountHub.compositeUnavailable'));
      return;
    }
    const job = {};
    compositeSaveJob.current = job;
    setBusyKey('composite:save');
    try {
      assertCurrentScope(scope);
      const sessionGeneration = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      assertCurrentScope(scope);
      if (
        typeof sessionGeneration !== 'number' ||
        sessionGeneration !== scope.expectedContext.sessionGeneration
      )
        throw Object.assign(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
          transactionNotBroadcast: true,
        });
      const initData = encodeCompositeValidatorInitData(
        normalizedChildren,
        threshold
      );
      const moduleAddress = installedComposite?.address;
      if (moduleAddress) {
        const isActive = moduleAddress.toLowerCase() === activeValidatorAddress;
        await submitExecutions(
          [
            {
              data: isActive
                ? encodeRotateValidatorModuleCall(moduleAddress, initData)
                : encodeUninstallValidatorModuleCall(moduleAddress),
              target: account.address,
              value: '0x0',
            },
            ...(!isActive
              ? [
                  {
                    data: encodeInstallValidatorModuleCall(
                      moduleAddress,
                      initData
                    ),
                    target: account.address,
                    value: '0x0',
                  },
                ]
              : []),
          ],
          scope
        );
      } else {
        // Fresh install: resolve the builtin composite module address.
        await submitExecutions(
          [
            {
              data: encodeInstallValidatorModuleCall(
                getPaliModuleAddress(activeNetwork.chainId, 'composite'),
                initData
              ),
              target: account.address,
              value: '0x0',
            },
          ],
          scope
        );
      }
      if (isCurrentScope(scope)) {
        alert.success(t('smartAccountHub.compositeSaved'));
        compositeScope.current = undefined;
        setCompositeBuilder(null);
      }
    } catch (error) {
      if (isCurrentScope(scope))
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas'),
            t('settings.slhDsaLocalSignerMissing')
          )
        );
    } finally {
      if (compositeSaveJob.current === job) {
        compositeSaveJob.current = undefined;
        setBusyKey('');
      }
    }
  }, [
    account?.address,
    activeNetwork.chainId,
    activeValidatorAddress,
    alert,
    assertCurrentScope,
    compositeBuilder,
    compositeCandidates,
    controllerEmitter,
    installedComposite?.address,
    installedValidators,
    marketplaceModules,
    metadata,
    isCurrentScope,
    submitExecutions,
    t,
  ]);

  if (!isSmartAccount) {
    return <SmartAccountEntry />;
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-8 text-brand-white">
      <SmartAccountEntry pickerOnly />
      {/* Identity */}
      <div className="rounded-card bg-bkg-2 p-4 flex flex-col gap-1 text-left">
        <span className="text-xs text-brand-gray200">
          {t('smartAccountHub.accountAddress')}
        </span>
        {smartAccountAddress && (
          <AddressText value={smartAccountAddress} preset="medium" />
        )}
        {!metadata?.isDeployed && (
          <span className="text-xs text-warning-error">
            {t('smartAccountHub.notDeployed')}
          </span>
        )}
      </div>

      {/* Sign-in method */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">
            {t('smartAccountHub.signInMethod')}
          </h2>
          <button
            type="button"
            className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline"
            onClick={goToPolicyPage}
          >
            {t('smartAccountHub.manage')}
          </button>
        </div>
        <div className="rounded-card bg-bkg-2 p-3 flex items-center justify-between">
          <div className="flex flex-col text-left">
            <span className="text-sm">
              {activeValidator
                ? moduleDisplayName(activeValidator, t)
                : t('smartAccountHub.noActiveValidator')}
            </span>
            {activeValidator && (
              <AddressText
                value={activeValidator.address}
                preset="short"
                copyable={false}
                className="text-xs text-brand-gray200"
              />
            )}
          </div>
          {activeValidator && (
            <span className="text-[10px] px-2 py-0.5 rounded-pill bg-brand-royalblue text-white">
              {t('smartAccountHub.active')}
            </span>
          )}
        </div>
      </section>

      {/* Installed modules */}
      <section>
        <h2 className="text-sm font-medium mb-2">
          {t('smartAccountHub.installedModules')}
        </h2>
        <ul className="flex flex-col gap-2">
          {installedModules.length === 0 && (
            <li className="text-xs text-brand-gray200">
              {t('smartAccountHub.noModules')}
            </li>
          )}
          {installedModules.map((module) => {
            const isValidator = module.type === 'validator';
            const isActive =
              isValidator &&
              module.address.toLowerCase() === activeValidatorAddress;
            const isCompositeChild = compositeChildren.has(
              module.address.toLowerCase()
            );
            const uninstallBlocked =
              !isValidator || isActive || isCompositeChild;
            return (
              <li
                key={`${module.id}:${module.address}`}
                className="rounded-card bg-bkg-2 p-3 flex items-center justify-between"
              >
                <div className="flex min-w-0 flex-1 flex-col break-words text-left">
                  <span className="text-sm flex flex-wrap items-center gap-2">
                    {moduleDisplayName(module, t)}
                    {module.id === 'custom' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-pill bg-warning-error bg-opacity-30 text-warning-error">
                        {t('smartAccountHub.customBadge')}
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-pill bg-brand-royalblue text-white">
                        {t('smartAccountHub.active')}
                      </span>
                    )}
                  </span>
                  <AddressText
                    value={module.address}
                    preset="short"
                    copyable={false}
                    className="text-xs text-brand-gray200"
                  />
                </div>
                {module.id === 'guardian-recovery' ? (
                  <button
                    type="button"
                    className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline"
                    onClick={goToPolicyPage}
                  >
                    {t('smartAccountHub.manage')}
                  </button>
                ) : (
                  module.type === 'validator' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        uninstallBlocked ||
                        busyKey === `uninstall:${module.address}`
                      }
                      loading={busyKey === `uninstall:${module.address}`}
                      onClick={() =>
                        openUninstall(module as SmartAccountValidatorModule)
                      }
                    >
                      {t('smartAccountHub.uninstall')}
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Marketplace */}
      <section>
        <h2 className="text-sm font-medium mb-2">
          {t('smartAccountHub.addModules')}
        </h2>
        <ul className="flex flex-col gap-2">
          {marketplaceModules
            .filter((module) => module.id !== 'composite')
            .map((module) => {
              const installed = installedModules.some(
                (candidate) => candidate.id === module.id
              );
              return (
                <li
                  key={module.id}
                  className="rounded-card bg-bkg-2 p-3 flex items-center justify-between"
                >
                  <div className="flex min-w-0 flex-1 flex-col break-words text-left">
                    <span className="text-sm">{module.displayName}</span>
                    <span className="text-xs text-brand-gray200">
                      {module.capability === 'p256-precompile'
                        ? t('settings.p256ModuleHint')
                        : module.id === 'guardian-recovery'
                        ? t('settings.smartAccountGuardianRecoveryDescription')
                        : module.id === 'slh-dsa'
                        ? t('settings.slhDsaModuleHint')
                        : t('settings.genericModuleHint')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline disabled:text-brand-gray300"
                    disabled={installed}
                    onClick={goToPolicyPage}
                  >
                    {installed
                      ? t('smartAccountHub.installed')
                      : t('smartAccountHub.setUp')}
                  </button>
                </li>
              );
            })}

          {/* Composite builder */}
          <li className="rounded-card bg-bkg-2 p-3 flex items-center justify-between">
            <div className="flex min-w-0 flex-1 flex-col break-words text-left">
              <span className="text-sm">
                {t('settings.compositeAuthenticator')}
              </span>
              <span className="text-xs text-brand-gray200">
                {t('smartAccountHub.compositeHint')}
              </span>
            </div>
            <button
              type="button"
              className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline disabled:text-brand-gray300"
              disabled={
                compositeCandidates.length < 2 ||
                !metadata?.isDeployed ||
                Boolean(busyKey)
              }
              onClick={openCompositeBuilder}
            >
              {installedComposite
                ? t('smartAccountHub.edit')
                : t('smartAccountHub.setUp')}
            </button>
          </li>

          {/* Bring your own validator */}
          <li className="rounded-card border border-dashed border-brand-whiteAlpaBlue p-3 flex items-center justify-between">
            <div className="flex min-w-0 flex-1 flex-col break-words text-left">
              <span className="text-sm">
                {t('smartAccountHub.customModule')}
              </span>
              <span className="text-xs text-brand-gray200">
                {t('smartAccountHub.customModuleHint')}
              </span>
            </div>
            <button
              type="button"
              className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline disabled:text-brand-gray300"
              disabled={!metadata?.isDeployed || Boolean(busyKey)}
              onClick={openCustomInstall}
            >
              {t('smartAccountHub.install')}
            </button>
          </li>
        </ul>
      </section>

      {/* Shortcuts */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          className="rounded-card bg-bkg-2 p-3 flex items-center justify-between text-left"
          onClick={goToPolicyPage}
        >
          <span className="text-sm">
            {t('settings.smartAccountGuardianRecoveryTitle')}
          </span>
          <Icon name="arrowright" isSvg size={16} />
        </button>
        <button
          type="button"
          className="rounded-card bg-bkg-2 p-3 flex items-center justify-between text-left"
          onClick={() => navigate('/settings/advanced')}
        >
          <span className="text-sm">{t('smartAccountHub.infrastructure')}</span>
          <Icon name="arrowright" isSvg size={16} />
        </button>
      </section>

      {/* Uninstall confirmation */}
      <ConfirmationModal
        show={Boolean(confirmUninstall)}
        title={t('smartAccountHub.uninstallTitle')}
        description={t('smartAccountHub.uninstallDescription')}
        buttonText={t('smartAccountHub.uninstall')}
        onClick={() => confirmUninstall && handleUninstall(confirmUninstall)}
        onClose={closeUninstall}
        isButtonLoading={busyKey.startsWith('uninstall:')}
      />

      {/* BYO validator dialog */}
      {customInstall && (
        <DialogPrimitive show onClose={closeCustomInstall}>
          <CenterPanel padded={false} scroll={false} className="flex flex-col">
            <DialogHeader
              title={t('smartAccountHub.customModule')}
              icon={<CubeIcon className="h-6 w-6" aria-hidden="true" />}
              onClose={closeCustomInstall}
              disabled={Boolean(busyKey)}
            />
            <DialogBody>
              {customInstall.step === 'form' ? (
                <Form layout="vertical" className="text-left">
                  <Form.Item
                    label={t('smartAccountHub.moduleName')}
                    htmlFor="custom-validator-name"
                  >
                    <Input
                      id="custom-validator-name"
                      disabled={Boolean(busyKey)}
                      value={customInstall.name}
                      onChange={(event) =>
                        !customJob.current &&
                        setCustomInstall((state) =>
                          state ? { ...state, name: event.target.value } : state
                        )
                      }
                      placeholder="My validator"
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('smartAccountHub.moduleAddress')}
                    htmlFor="custom-validator-address"
                  >
                    <Input
                      id="custom-validator-address"
                      disabled={Boolean(busyKey)}
                      value={customInstall.address}
                      onChange={(event) =>
                        !customJob.current &&
                        setCustomInstall((state) =>
                          state
                            ? {
                                ...state,
                                address: event.target.value.trim(),
                                preflight: null,
                                acknowledged: false,
                              }
                            : state
                        )
                      }
                      placeholder="0x..."
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('smartAccountHub.moduleInitData')}
                    htmlFor="custom-validator-init-data"
                  >
                    <Input
                      id="custom-validator-init-data"
                      disabled={Boolean(busyKey)}
                      value={customInstall.initData}
                      onChange={(event) =>
                        !customJob.current &&
                        setCustomInstall((state) =>
                          state
                            ? {
                                ...state,
                                initData: event.target.value.trim(),
                                preflight: null,
                                acknowledged: false,
                              }
                            : state
                        )
                      }
                      placeholder="0x"
                    />
                  </Form.Item>
                </Form>
              ) : (
                <div className="text-left flex flex-col gap-3">
                  <p className="text-xs text-brand-gray200">
                    {t('smartAccountHub.preflightPassed')}
                  </p>
                  <div className="rounded-card bg-warning-error bg-opacity-10 border border-warning-error p-3 text-xs text-left">
                    {t('smartAccountHub.customRisk')}
                  </div>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      className="custom-checkbox mt-0.5"
                      checked={customInstall.acknowledged}
                      disabled={Boolean(busyKey)}
                      onChange={(event) =>
                        !customJob.current &&
                        setCustomInstall((state) =>
                          state
                            ? { ...state, acknowledged: event.target.checked }
                            : state
                        )
                      }
                    />
                    <span>{t('smartAccountHub.customRiskAck')}</span>
                  </label>
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogActions>
                <DialogActionButton
                  type="button"
                  tone="secondary"
                  disabled={Boolean(busyKey)}
                  onClick={() => {
                    if (customJob.current) return;
                    if (customInstall.step === 'form') closeCustomInstall();
                    else
                      setCustomInstall((state) =>
                        state
                          ? {
                              ...state,
                              step: 'form',
                              preflight: null,
                              acknowledged: false,
                            }
                          : state
                      );
                  }}
                >
                  {t('buttons.cancel')}
                </DialogActionButton>
                <DialogActionButton
                  type="button"
                  disabled={
                    Boolean(busyKey) ||
                    (customInstall.step === 'review' &&
                      !customInstall.acknowledged)
                  }
                  loading={busyKey.startsWith('custom:')}
                  onClick={
                    customInstall.step === 'form'
                      ? runCustomPreflight
                      : handleCustomInstall
                  }
                >
                  {customInstall.step === 'form'
                    ? t('smartAccountHub.checkModule')
                    : t('smartAccountHub.install')}
                </DialogActionButton>
              </DialogActions>
            </DialogFooter>
          </CenterPanel>
        </DialogPrimitive>
      )}

      {/* Composite builder dialog */}
      {compositeBuilder && (
        <CompositeApprovalDialog
          candidates={compositeCandidates}
          value={compositeBuilder}
          saving={busyKey === 'composite:save'}
          onChange={(value) => {
            if (
              !compositeSaveJob.current &&
              compositeScope.current &&
              isCurrentScope(compositeScope.current)
            )
              setCompositeBuilder(value);
          }}
          onClose={closeCompositeBuilder}
          onSave={handleCompositeSave}
        />
      )}
    </div>
  );
};

export default SmartAccountHub;
