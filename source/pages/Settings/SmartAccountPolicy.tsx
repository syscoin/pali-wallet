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
import { v4 as uuidv4 } from 'uuid';

import { LoadingSvg } from 'components/Icon/Icon';
import { Button, ConfirmationModal, Icon } from 'components/index';
import { PqOperationStatus, PqSigningOverlay } from 'components/Loading';
import { getControllerStatus } from 'hooks/controllerStatus';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import {
  IPasskeyCredentialProfile,
  ISmartAccountMetadata,
  KeyringAccountType,
  SmartAccountValidatorModule,
} from 'types/network';
import { getAddress } from 'utils/ethersV6Compat';
import { IEvmTransactionContext } from 'utils/evmTransactionContext';
import {
  captureNavigationScroll,
  getWalletNavigationScope,
} from 'utils/navigationState';
import {
  bytesToHex,
  createPasskeyCredential,
  getPasskeyAccountRecords,
  passkeyRegistrationToProfile,
  setActivePasskeyRecord,
  setPendingPasskeyRecord,
  signP256WebAuthnActionHash,
  toP256WebAuthnRecoveryTarget,
} from 'utils/passkey';
import { getSLHDSAKeyId, normalizeSLHDSAPublicKeyField } from 'utils/slhDsa';
import {
  buildP256WebAuthnAuthenticator,
  buildSLHDSAAuthenticator,
  buildSmartAccountValidatorSwitchPlan,
  clearStaleGuardianRecoveryOperation,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
  ERC7579_MODULE_TYPE_EXECUTOR,
  encodeSmartAccountAuthenticatorSignature,
  getAvailablePaliModules,
  getConfiguredAuthenticatorAddress,
  getPaliErc7739PersonalSignHash,
  getSmartAccountLocalOwnerContexts,
  getGuardianRecoveryDelayOptions,
  isGuardianRecoveryDelayAllowed,
  SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS,
  paliSmartAccountInterface,
  signAndSubmitSmartAccountExecutions,
  signSmartAccountActionHash,
} from 'utils/smartAccount';
import type {
  PaliRecoveryTarget,
  PaliSmartAccountAuthenticatorSetup,
  SmartAccountAuthenticatorBuildResult,
  SmartAccountGuardianRecoveryDigestContext,
} from 'utils/smartAccount';
import {
  getGuardianRecoveryOperationId,
  GuardianRecoveryObservation,
} from 'utils/smartAccount/guardianStatus';
import {
  getSmartAccountActionErrorMessage,
  isGuardianRecoveryAlreadyScheduledError,
  isGuardianRecoveryExpiredError,
  isGuardianRecoveryPolicyChangedError,
  isGuardianRecoveryNotReadyError,
  isNativeGasError,
  isSmartAccountPrefundError,
  isSmartAccountSignatureError,
} from 'utils/smartAccountErrors';

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

const moduleDisplayKey = (id: string) => {
  switch (id) {
    case 'p256-webauthn':
      return 'settings.passkeyAuthenticator';
    case 'ecdsa':
      return 'settings.ecdsaAuthenticator';
    case 'slh-dsa':
      return 'settings.slhDsaAuthenticator';
    case 'composite':
      return 'settings.compositeAuthenticator';
    case 'guardian-recovery':
      return 'settings.smartAccountGuardianRecoveryTitle';
    default:
      return '';
  }
};

const moduleHintKey = (id: string, capability?: string) => {
  if (capability === 'p256-precompile') {
    return 'settings.p256ModuleHint';
  }
  if (id === 'guardian-recovery') {
    return 'settings.smartAccountGuardianRecoveryDescription';
  }
  if (id === 'slh-dsa') {
    return 'settings.slhDsaModuleHint';
  }
  return 'settings.genericModuleHint';
};

type RecoveryAuthenticatorId = 'ecdsa' | 'p256-webauthn';
type GuardianRecoveryStatus = GuardianRecoveryObservation | null;

type GuardianReplacementCredential = {
  authenticator: PaliSmartAccountAuthenticatorSetup;
  backupStatus?: string;
  credentialId?: string;
  credentialIdHash?: string;
  kind: RecoveryAuthenticatorId;
  recoveryOperation?: SmartAccountGuardianRecoveryDigestContext & {
    account: string;
    chainId: number;
    executionCalldata: string;
    mode: string;
    readyAt: number;
    recoveryModule?: string;
    salt: string;
  };
  userHandle?: string;
};

type SLHDSASetupStatus = {
  accountId: number;
  canFinalize?: boolean;
  config?: Parameters<typeof buildSLHDSAAuthenticator>[0]['config'];
  error?: string;
  phase?: 'key-derivation' | 'xmss-cache';
  progress?: {
    completed: number;
    level: number;
    total: number;
  };
  startedAt: number;
  status: 'failed' | 'ready' | 'running';
  updatedAt: number;
};

type SLHDSAPreparedSignerRecord = {
  accountId: number;
  config: NonNullable<SLHDSASetupStatus['config']>;
  updatedAt: number;
  version: 1;
};

type PolicyApprovalScope = {
  assertCurrent: () => void;
  expectedContext: IEvmTransactionContext;
};

type GuardianDisablePending = {
  accountAddress: string;
  attemptId?: string;
  chainId: number;
  localRecoverySalt?: string;
  moduleAddress: string;
};

type GuardianDisableConfirmation = GuardianDisablePending & {
  accountLabel: string;
  approval: PolicyApprovalScope;
  networkLabel: string;
  retryUnknown?: boolean;
};

const guardianDisablePendingKey = (account: string, chainId: number) =>
  `pali-smart-account-recovery-disable:${chainId}:${account.toLowerCase()}`;
const GUARDIAN_DISABLE_STORAGE_ERROR = 'PALI_RECOVERY_REMOVAL_STORAGE_FAILED';

const sameGuardianDisableAttempt = (
  first: GuardianDisablePending,
  second: GuardianDisablePending
) =>
  first.attemptId === second.attemptId &&
  first.chainId === second.chainId &&
  first.accountAddress.toLowerCase() === second.accountAddress.toLowerCase() &&
  first.moduleAddress.toLowerCase() === second.moduleAddress.toLowerCase() &&
  first.localRecoverySalt === second.localRecoverySalt;

const readGuardianDisablePending = (
  account: string | undefined,
  chainId: number,
  requireReadable = false
): GuardianDisablePending | null => {
  if (!account) return null;
  try {
    const pending = JSON.parse(
      localStorage.getItem(guardianDisablePendingKey(account, chainId)) ||
        'null'
    );
    if (
      pending?.chainId === chainId &&
      getAddress(pending.accountAddress) === getAddress(account) &&
      getAddress(pending.moduleAddress) &&
      (pending.attemptId === undefined || typeof pending.attemptId === 'string')
    )
      return pending;
    if (pending !== null && requireReadable)
      throw new Error(GUARDIAN_DISABLE_STORAGE_ERROR);
  } catch {
    if (requireReadable) throw new Error(GUARDIAN_DISABLE_STORAGE_ERROR);
    // A malformed local status marker cannot authorize an operation.
  }
  return null;
};

const guardianReplacementAuthenticatorKey = (
  account: string,
  chainId: number
) =>
  `pali-smart-account-recovery-replacement:${chainId}:${account.toLowerCase()}`;

const SmartAccountPolicy = () => {
  const location = useLocation();
  const routeState = location.state as any;
  const { t, i18n } = useTranslation();
  const { alert, navigate, useCopyClipboard } = useUtils();
  const [, copy] = useCopyClipboard();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { accounts, activeAccount, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const activeSlip44 = useSelector(
    (state: RootState) => state.vaultGlobal?.activeSlip44
  );
  const selectedAccountId = Number.isInteger(routeState?.id)
    ? routeState.id
    : activeAccount.id;
  const selectedAccountType =
    routeState?.accountType === KeyringAccountType.SmartAccount ||
    routeState?.isSmartAccount
      ? KeyringAccountType.SmartAccount
      : activeAccount.type;
  const account = accounts[selectedAccountType]?.[selectedAccountId] as any;
  const mountedRef = useRef(true);
  const latestLocationRef = useRef(location);
  const selectedAccountKey = `${selectedAccountType}:${selectedAccountId}:${
    account?.address || ''
  }`;
  const latestSelectedAccountRef = useRef(selectedAccountKey);
  const scopeKey = JSON.stringify(getWalletNavigationScope());
  const controllerStatus = getControllerStatus();
  const controllerReady =
    controllerStatus.isUnlocked &&
    !controllerStatus.isLoading &&
    !controllerStatus.connectionUnavailable;
  const metadataAvailability = useRef({ ready: controllerReady, revision: 0 });
  if (metadataAvailability.current.ready !== controllerReady) {
    metadataAvailability.current = {
      ready: controllerReady,
      revision: metadataAvailability.current.revision + 1,
    };
  }
  const metadataEntryKey = JSON.stringify([
    scopeKey,
    selectedAccountKey,
    location.key,
    metadataAvailability.current.revision,
  ]);
  const guardianObservationScope = JSON.stringify([
    metadataEntryKey,
    activeNetwork.url,
    activeSlip44,
  ]);
  const [metadataEntry, setMetadataEntry] = useState<{
    key: string;
    status: 'pending' | 'ready' | 'failed';
  }>({ key: metadataEntryKey, status: 'pending' });
  const metadataRead = useRef<{ key: string } | null>(null);
  const isEntryMetadataReady =
    !account?.isSmartAccount ||
    (controllerReady &&
      metadataEntry?.key === metadataEntryKey &&
      metadataEntry.status === 'ready');
  latestLocationRef.current = location;
  latestSelectedAccountRef.current = selectedAccountKey;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // An approved operation may finish after leaving this page. Reconcile its
  // credentials, but keep prompts, feedback and navigation in their exact entry.
  // Settled busy-state cleanup may follow a same-route pane change; never clear
  // it while an operation is pending or after its account/scope has changed.
  const createUiGuard = () => {
    const origin = location;
    const originRoute = origin.pathname + origin.search + origin.hash;
    const originAvailability = metadataAvailability.current.revision;
    return (requireTrustedAuth = true) => {
      const current = latestLocationRef.current;
      const status = getControllerStatus();
      const nativeRoute =
        typeof window !== 'undefined' && window.location.hash.startsWith('#/')
          ? window.location.hash.slice(1)
          : undefined;
      const nativeKey =
        typeof window === 'undefined' ? undefined : window.history.state?.key;
      return (
        mountedRef.current &&
        (!requireTrustedAuth ||
          metadataAvailability.current.revision === originAvailability) &&
        (!requireTrustedAuth || current.key === origin.key) &&
        current.pathname + current.search + current.hash === originRoute &&
        latestSelectedAccountRef.current === selectedAccountKey &&
        scopeKey === JSON.stringify(getWalletNavigationScope()) &&
        (!nativeRoute || nativeRoute === originRoute) &&
        (!requireTrustedAuth ||
          typeof nativeKey !== 'string' ||
          typeof origin.key !== 'string' ||
          nativeKey === origin.key) &&
        (!requireTrustedAuth ||
          (status.isUnlocked &&
            !status.isLoading &&
            !status.connectionUnavailable))
      );
    };
  };
  const capturePolicyApproval = async (
    requireSelectedPolicy = true
  ): Promise<PolicyApprovalScope> => {
    const isCurrentUi = createUiGuard();
    const assertCurrent = () => {
      if (!isCurrentUi()) throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
      if (!isEntryMetadataReady)
        throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
      if (
        requireSelectedPolicy &&
        (activeAccount.id !== selectedAccountId ||
          activeAccount.type !== KeyringAccountType.SmartAccount ||
          selectedAccountType !== KeyringAccountType.SmartAccount)
      ) {
        throw new Error(t('settings.selectSmartAccountBeforePolicyChange'));
      }
    };
    assertCurrent();
    const sessionGeneration = await controllerEmitter(
      ['wallet', 'getWalletSessionGeneration'],
      []
    );
    assertCurrent();
    if (
      typeof sessionGeneration !== 'number' ||
      !Number.isSafeInteger(sessionGeneration) ||
      sessionGeneration < 0 ||
      typeof activeSlip44 !== 'number'
    ) {
      throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
    }
    return {
      assertCurrent,
      expectedContext: {
        account: {
          address: accounts[activeAccount.type]?.[activeAccount.id]?.address,
          id: activeAccount.id,
          type: activeAccount.type,
        },
        chainId: activeNetwork.chainId,
        rpcUrl: activeNetwork.url,
        sessionGeneration,
        slip44: activeSlip44,
      },
    };
  };
  const assertApprovalSession = async (approval: PolicyApprovalScope) => {
    approval.assertCurrent();
    const generation = await controllerEmitter(
      ['wallet', 'getWalletSessionGeneration'],
      []
    );
    approval.assertCurrent();
    if (generation !== approval.expectedContext.sessionGeneration) {
      throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
    }
  };
  const [metadata, setMetadata] = useState<ISmartAccountMetadata | null>(
    account?.smartAccount || null
  );
  const [loading, setLoading] = useState(false);
  const [moduleActionKey, setModuleActionKey] = useState('');
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [guardianStep, setGuardianStep] = useState('');
  const [guardianRead, setGuardianRead] = useState<{
    error: boolean;
    scope: string;
    snapshot: GuardianRecoveryStatus;
  }>({ scope: guardianObservationScope, snapshot: null, error: false });
  const setGuardianStatus = useCallback(
    (snapshot: GuardianRecoveryStatus, unavailable = false) =>
      setGuardianRead((previous) => ({
        scope: guardianObservationScope,
        snapshot: unavailable
          ? previous.scope === guardianObservationScope
            ? previous.snapshot
            : null
          : snapshot,
        error: unavailable,
      })),
    [guardianObservationScope]
  );
  const [guardianStatusLoading, setGuardianStatusLoading] = useState(false);
  const [guardianStatusRefresh, setGuardianStatusRefresh] = useState(0);
  const [
    guardianReplacementStorageVersion,
    setGuardianReplacementStorageVersion,
  ] = useState(0);
  const [replacementAuthenticator, setReplacementAuthenticator] =
    useState<RecoveryAuthenticatorId>('p256-webauthn');
  const [replacementEcdsaOwner, setReplacementEcdsaOwner] = useState('');
  const [guardianAddress, setGuardianAddress] = useState('');
  const [guardianDelaySeconds, setGuardianDelaySeconds] = useState(
    SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS
  );
  const guardianDelayOptions = getGuardianRecoveryDelayOptions(
    activeNetwork.chainId
  );
  const guardianDelayAllowed = isGuardianRecoveryDelayAllowed(
    activeNetwork.chainId,
    guardianDelaySeconds
  );
  const [isGuardianRecoveryScreenOpen, setIsGuardianRecoveryScreenOpen] =
    useState(routeState?.smartAccountPolicyView === 'recovery');
  useEffect(() => {
    setIsGuardianRecoveryScreenOpen(
      routeState?.smartAccountPolicyView === 'recovery'
    );
  }, [routeState?.smartAccountPolicyView]);
  const setGuardianRecoveryView = (open: boolean) => {
    setIsGuardianRecoveryScreenOpen(open);
    const policyParentScroll = routeState?.policyParentScroll;
    const policyParentScrollPositions = routeState?.policyParentScrollPositions;
    const parentState = { ...routeState };
    delete parentState.smartAccountPolicyView;
    delete parentState.policyParentScroll;
    delete parentState.policyParentScrollPositions;
    const state = open
      ? {
          ...parentState,
          smartAccountPolicyView: 'recovery',
          policyParentScrollPositions: captureNavigationScroll(),
          scrollPositions: {
            'wallet-layout': 0,
            'smart-account-policy-recovery': 0,
          },
          policyParentScroll:
            typeof document === 'undefined'
              ? 0
              : (
                  document.querySelector(
                    '[data-navigation-scroll="smart-account-policy"]'
                  ) as HTMLElement | null
                )?.scrollTop || 0,
        }
      : {
          ...parentState,
          scrollPositions: {
            ...parentState.scrollPositions,
            ...policyParentScrollPositions,
            'smart-account-policy':
              typeof policyParentScroll === 'number' ? policyParentScroll : 0,
          },
        };
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { ...state, scrollRestorationKey: uuidv4() },
    });
  };
  const [
    isGuardianPolicyUpdateConfirmOpen,
    setIsGuardianPolicyUpdateConfirmOpen,
  ] = useState(false);
  const [guardianDisableConfirmation, setGuardianDisableConfirmation] =
    useState<GuardianDisableConfirmation | null>(null);
  const [guardianDisablePending, setGuardianDisablePending] =
    useState<GuardianDisablePending | null>(() =>
      readGuardianDisablePending(account?.address, activeNetwork.chainId)
    );
  const [guardianDisableRetryReady, setGuardianDisableRetryReady] =
    useState(false);
  const guardianDisableConfirmationRef = useRef(guardianDisableConfirmation);
  guardianDisableConfirmationRef.current = guardianDisableConfirmation;
  const guardianDisablePendingRef = useRef(guardianDisablePending);
  guardianDisablePendingRef.current = guardianDisablePending;
  const guardianDisableInFlight = useRef(false);
  const [isPasskeyRecreateConfirmOpen, setIsPasskeyRecreateConfirmOpen] =
    useState(false);
  const [isSLHDSASetupConfirmOpen, setIsSLHDSASetupConfirmOpen] =
    useState(false);
  const [slhDsaSetupStatus, setSlhDsaSetupStatus] =
    useState<SLHDSASetupStatus | null>(null);
  const [slhDsaSetupIntent, setSlhDsaSetupIntent] = useState<
    'regenerate' | 'use'
  >('use');
  const [isSLHDSASigning, setIsSLHDSASigning] = useState(false);
  const [shouldFinalizeSLHDSASetup, setShouldFinalizeSLHDSASetup] =
    useState(false);
  const [slhDsaActionStartedAt, setSlhDsaActionStartedAt] = useState<
    number | undefined
  >();
  const slhDsaFinalizeRef = useRef(false);
  const slhDsaSetupOwnerRef = useRef('');
  const slhDsaApprovalRef = useRef<PolicyApprovalScope | null>(null);
  const validatorSwitchRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);
  useEffect(() => {
    setLoading(false);
    setModuleActionKey('');
    setGuardianLoading(false);
    setGuardianStep('');
    setIsSLHDSASigning(false);
    setShouldFinalizeSLHDSASetup(false);
    setSlhDsaActionStartedAt(undefined);
    setIsGuardianPolicyUpdateConfirmOpen(false);
    guardianDisableConfirmationRef.current = null;
    setGuardianDisableConfirmation(null);
    const pendingRemoval = readGuardianDisablePending(
      account?.address,
      activeNetwork.chainId
    );
    guardianDisablePendingRef.current = pendingRemoval;
    setGuardianDisablePending(pendingRemoval);
    setGuardianDisableRetryReady(false);
    setIsPasskeyRecreateConfirmOpen(false);
    setIsSLHDSASetupConfirmOpen(false);
    setReplacementEcdsaOwner('');
    slhDsaFinalizeRef.current = false;
    slhDsaSetupOwnerRef.current = '';
    slhDsaApprovalRef.current = null;
    validatorSwitchRef.current = null;
  }, [scopeKey, selectedAccountKey]);
  const modules = getAvailablePaliModules(activeNetwork.chainId);
  const installedModuleIds = new Set(
    metadata?.installedModules?.map((module) => module.id) || []
  );
  const isUndeployedSmartAccount =
    Boolean(account?.isSmartAccount && metadata) && !metadata?.isDeployed;
  const isSLHDSASetupRunning = slhDsaSetupStatus?.status === 'running';
  const slhDsaOperationStartedAt = isSLHDSASetupRunning
    ? slhDsaSetupStatus?.startedAt
    : slhDsaActionStartedAt;
  const slhDsaProgress = isSLHDSASetupRunning
    ? slhDsaSetupStatus?.progress
    : undefined;
  const installedGuardianRecovery = metadata?.installedModules?.find(
    (module) => module.id === 'guardian-recovery' && module.type === 'executor'
  );
  const hasGuardianRecovery = Boolean(installedGuardianRecovery);
  const guardianStatusError =
    guardianRead.scope === guardianObservationScope && guardianRead.error;
  const guardianStatus =
    guardianRead.scope === guardianObservationScope &&
    guardianRead.snapshot &&
    guardianRead.snapshot.chainId === activeNetwork.chainId &&
    guardianRead.snapshot.account?.toLowerCase() ===
      account?.address?.toLowerCase()
      ? guardianRead.snapshot
      : null;
  const configuredGuardianAddress = (() => {
    try {
      const address =
        guardianStatus?.guardians?.[0] ||
        installedGuardianRecovery?.config.guardians?.[0] ||
        '';
      return address ? getAddress(address) : '';
    } catch {
      return '';
    }
  })();
  const configuredGuardianDelaySeconds = Number(
    guardianStatus?.delay || installedGuardianRecovery?.config.delaySeconds || 0
  );
  const smartAccountAddress = account?.address
    ? getAddress(account.address)
    : '';
  const readGuardianStatus = useCallback(
    (params: { knownOperationId?: string } = {}) =>
      controllerEmitter(
        ['wallet', 'getSmartAccountGuardianRecoveryStatus'],
        [{ account: smartAccountAddress, ...params }],
        30000
      ) as Promise<GuardianRecoveryObservation>,
    [controllerEmitter, smartAccountAddress]
  );
  const displayedGuardianAddress =
    guardianStatus?.guardians?.[0] ||
    installedGuardianRecovery?.config.guardians?.[0] ||
    smartAccountAddress;
  const storedGuardianReplacement = useMemo(() => {
    if (!smartAccountAddress) return null;
    const stored = localStorage.getItem(
      guardianReplacementAuthenticatorKey(
        smartAccountAddress,
        activeNetwork.chainId
      )
    );
    if (!stored) return null;
    try {
      return JSON.parse(stored) as GuardianReplacementCredential;
    } catch {
      return null;
    }
  }, [
    smartAccountAddress,
    activeNetwork.chainId,
    guardianReplacementStorageVersion,
  ]);
  const localRecoveryOperation = storedGuardianReplacement?.recoveryOperation;
  const localRecoveryOperationId = (() => {
    try {
      return localRecoveryOperation &&
        getAddress(localRecoveryOperation.account) === smartAccountAddress &&
        localRecoveryOperation.chainId === activeNetwork.chainId
        ? getGuardianRecoveryOperationId(localRecoveryOperation)
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const knownLocalObservation =
    !guardianStatusError &&
    localRecoveryOperationId &&
    guardianStatus?.knownOperation?.operationId === localRecoveryOperationId
      ? guardianStatus.knownOperation
      : null;
  const localRecoveryResolved = Boolean(
    knownLocalObservation &&
      ['executed', 'canceled', 'expired', 'inactive'].includes(
        knownLocalObservation.status
      )
  );
  // Observations affect the displayed/action state only. Never erase a saved
  // replacement credential or unresolved intent as a side effect of a read.
  const activeGuardianReplacement =
    localRecoveryResolved && storedGuardianReplacement
      ? { ...storedGuardianReplacement, recoveryOperation: undefined }
      : storedGuardianReplacement;
  const onChainPending = !guardianStatusError ? guardianStatus?.pending : null;
  const localRecoveryMatches = (() => {
    try {
      return Boolean(
        localRecoveryOperation &&
          localRecoveryOperationId &&
          onChainPending &&
          onChainPending.operationId === localRecoveryOperationId &&
          guardianStatus?.policyEpoch === localRecoveryOperation.policyEpoch &&
          guardianStatus?.account === smartAccountAddress &&
          guardianStatus?.chainId === activeNetwork.chainId &&
          localRecoveryOperation.recoveryModule &&
          getAddress(localRecoveryOperation.recoveryModule) ===
            getAddress(guardianStatus.moduleAddress)
      );
    } catch {
      return false;
    }
  })();
  const externalRecoveryPending = Boolean(
    onChainPending && !localRecoveryMatches
  );
  const pendingReplacementKind = activeGuardianReplacement?.recoveryOperation
    ? activeGuardianReplacement.kind
    : null;
  const pendingPaliWalletRecoveryAddress =
    activeGuardianReplacement?.recoveryOperation &&
    activeGuardianReplacement.authenticator.id === 'ecdsa'
      ? activeGuardianReplacement.authenticator.config.owners[0] || ''
      : '';
  const guardianPolicyReady =
    Boolean(guardianStatus?.exists || hasGuardianRecovery) &&
    Number(
      guardianStatus?.threshold ?? installedGuardianRecovery?.config.threshold
    ) === 1 &&
    Boolean(
      guardianStatus?.guardians?.[0] ||
        installedGuardianRecovery?.config.guardians?.[0]
    );
  const guardianRecoveryReady =
    localRecoveryMatches && onChainPending?.status === 'ready';
  const replacementAuthenticatorLabel = (kind?: RecoveryAuthenticatorId) => {
    switch (kind) {
      case 'ecdsa':
        return t('settings.ecdsaAuthenticator');
      case 'p256-webauthn':
        return t('settings.recoveryAuthenticatorP256WebAuthn');
      default:
        return '';
    }
  };
  const normalizedReplacementEcdsaOwner = (() => {
    try {
      return replacementEcdsaOwner.trim()
        ? getAddress(replacementEcdsaOwner.trim())
        : '';
    } catch {
      return '';
    }
  })();
  const replacementEcdsaOwnerError =
    replacementAuthenticator === 'ecdsa' &&
    replacementEcdsaOwner.trim() &&
    !normalizedReplacementEcdsaOwner
      ? t('settings.invalidAddress')
      : '';
  const replacementEcdsaOwnerValidateStatus =
    replacementAuthenticator === 'ecdsa' && replacementEcdsaOwner.trim()
      ? replacementEcdsaOwnerError
        ? 'error'
        : 'success'
      : undefined;
  const normalizedGuardianAddress = (() => {
    try {
      return guardianAddress.trim() ? getAddress(guardianAddress.trim()) : '';
    } catch {
      return '';
    }
  })();
  const guardianAddressError =
    guardianAddress.trim() && !normalizedGuardianAddress
      ? t('settings.invalidSmartAccountGuardianAddress')
      : '';
  const guardianAddressValidateStatus = guardianAddress.trim()
    ? guardianAddressError
      ? 'error'
      : 'success'
    : undefined;
  const guardianPolicyChanged =
    Boolean(normalizedGuardianAddress) &&
    (!hasGuardianRecovery ||
      configuredGuardianAddress.toLowerCase() !==
        normalizedGuardianAddress.toLowerCase() ||
      configuredGuardianDelaySeconds !== guardianDelaySeconds);
  const activeValidatorModule = metadata?.installedModules?.find(
    (module) =>
      module.type === 'validator' &&
      metadata.auth?.validator?.toLowerCase() === module.address.toLowerCase()
  );
  const isActiveSLHDSAApproval = activeValidatorModule?.id === 'slh-dsa';
  const guardianActionLoading = loading || guardianLoading;
  const isReplacementAuthenticatorReady =
    replacementAuthenticator === 'p256-webauthn' ||
    Boolean(normalizedReplacementEcdsaOwner);
  const isStartGuardianRecoveryDisabled =
    guardianActionLoading ||
    guardianStatusLoading ||
    guardianStatusError ||
    !guardianStatus?.observedBlock ||
    !guardianStatus.exists ||
    Boolean(onChainPending) ||
    Boolean(guardianDisablePending) ||
    !guardianPolicyReady ||
    !isReplacementAuthenticatorReady ||
    Boolean(activeGuardianReplacement?.recoveryOperation);
  const isFinalizeGuardianRecoveryDisabled =
    guardianActionLoading ||
    guardianStatusLoading ||
    Boolean(guardianDisablePending) ||
    !activeGuardianReplacement?.recoveryOperation ||
    !guardianRecoveryReady;
  const hasPendingGuardianRecovery = Boolean(
    onChainPending || activeGuardianReplacement?.recoveryOperation
  );
  const guardianStatusLabel =
    guardianStatusLoading && !guardianStatus?.observedBlock
      ? 'settings.smartAccountGuardianStatusChecking'
      : guardianStatusError || !guardianStatus?.observedBlock
      ? 'settings.smartAccountGuardianStatusUnavailable'
      : onChainPending
      ? 'settings.smartAccountGuardianRecoveryPending'
      : localRecoveryOperation && !localRecoveryResolved
      ? 'settings.smartAccountGuardianLocalUnresolved'
      : guardianStatus.exists
      ? 'settings.smartAccountGuardianRecoveryConnectedStatus'
      : 'settings.smartAccountGuardianRecoveryNotConnected';
  const guardianObservationPanel = (
    <div
      className="space-y-2 text-xs leading-5"
      data-testid="guardian-chain-status"
    >
      {guardianStatusError && guardianStatus?.pending && (
        <p className="text-brand-yellowInfo">
          {t('settings.smartAccountGuardianLastKnownPending')}
        </p>
      )}
      {externalRecoveryPending && (
        <>
          <p className="font-semibold text-brand-yellowInfo">
            {t('settings.smartAccountGuardianExternalPending')}
          </p>
          <p className="break-all text-white">{smartAccountAddress}</p>
          <p>{t('settings.smartAccountGuardianExternalDescription')}</p>
        </>
      )}
      {onChainPending && (
        <>
          <p>
            {t('settings.smartAccountGuardianRecoveryReadyAt', {
              time: new Date(onChainPending.executableAt * 1000).toLocaleString(
                i18n?.resolvedLanguage || i18n?.language
              ),
            })}
          </p>
          <p>
            {t('settings.smartAccountGuardianExpiresAt', {
              time: new Date(onChainPending.expiresAt * 1000).toLocaleString(
                i18n?.resolvedLanguage || i18n?.language
              ),
            })}
          </p>
        </>
      )}
      {localRecoveryResolved && (
        <p>{t('settings.smartAccountGuardianLocalResolved')}</p>
      )}
      {guardianStatus?.observedBlock && (
        <p className="text-brand-graylight">
          {t('settings.smartAccountGuardianObservedAt', {
            time: new Date(
              guardianStatus.observedBlock.timestamp * 1000
            ).toLocaleString(i18n?.resolvedLanguage || i18n?.language),
          })}
        </p>
      )}
      <button
        type="button"
        disabled={guardianStatusLoading}
        onClick={() => setGuardianStatusRefresh((value) => value + 1)}
        className="rounded underline underline-offset-4 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-brand-blue500 disabled:opacity-60"
      >
        {t('settings.smartAccountGuardianRefreshStatus')}
      </button>
    </div>
  );
  const walletManagementAddress = (() => {
    try {
      const address =
        accounts[KeyringAccountType.HDAccount]?.[0]?.address ||
        (activeAccount.type !== KeyringAccountType.SmartAccount
          ? accounts[activeAccount.type]?.[activeAccount.id]?.address
          : '') ||
        Object.values(accounts[KeyringAccountType.HDAccount] || {})[0]
          ?.address ||
        Object.values(accounts[KeyringAccountType.Imported] || {})[0]?.address;

      return address ? getAddress(address) : '';
    } catch {
      return '';
    }
  })();

  const storeGuardianReplacementCredential = (
    credential: GuardianReplacementCredential
  ) => {
    if (smartAccountAddress) {
      localStorage.setItem(
        guardianReplacementAuthenticatorKey(
          smartAccountAddress,
          activeNetwork.chainId
        ),
        JSON.stringify(credential)
      );
    }
    if (createUiGuard()()) {
      setGuardianReplacementStorageVersion((version) => version + 1);
    }
  };

  const clearGuardianReplacementCredential = () => {
    if (smartAccountAddress) {
      localStorage.removeItem(
        guardianReplacementAuthenticatorKey(
          smartAccountAddress,
          activeNetwork.chainId
        )
      );
    }
    if (createUiGuard()()) {
      setGuardianReplacementStorageVersion((version) => version + 1);
    }
  };

  const normalizeSLHDSAConfig = (
    config: Parameters<typeof buildSLHDSAAuthenticator>[0]['config']
  ) => {
    const pkRoot = normalizeSLHDSAPublicKeyField(config.pkRoot);
    const pkSeed = normalizeSLHDSAPublicKeyField(config.pkSeed);

    return {
      ...config,
      keyId: getSLHDSAKeyId({ pkRoot, pkSeed }),
      pkRoot,
      pkSeed,
    };
  };

  const getInstalledSLHDSAValidatorConfig = () => {
    const installedSLHDSAValidator = metadata?.installedModules?.find(
      (module) => module.type === 'validator' && module.id === 'slh-dsa'
    );
    if (installedSLHDSAValidator?.type !== 'validator') {
      return null;
    }
    const config = installedSLHDSAValidator.config as Parameters<
      typeof buildSLHDSAAuthenticator
    >[0]['config'];
    return normalizeSLHDSAConfig(config);
  };

  const getPreparedSLHDSAValidatorConfig = async () => {
    if (!account?.isSmartAccount) {
      return null;
    }
    const prepared = (await controllerEmitter(
      ['wallet', 'getSLHDSAPreparedSmartAccountSigner'],
      [{ accountId: account.id }],
      300000
    )) as SLHDSAPreparedSignerRecord | null;
    return prepared?.config ? normalizeSLHDSAConfig(prepared.config) : null;
  };

  const refreshMetadata = async (
    approval?: PolicyApprovalScope,
    requireCurrentUi = true
  ) => {
    if (!account?.isSmartAccount) {
      return null;
    }
    const isCurrentUi = createUiGuard();
    if (approval && requireCurrentUi) await assertApprovalSession(approval);
    const hydrated = (await controllerEmitter(
      ['wallet', 'hydrateSmartAccount'],
      approval ? [account.id, approval.expectedContext] : [account.id],
      300000
    )) as ISmartAccountMetadata;
    if (isCurrentUi()) setMetadata(hydrated);
    return hydrated;
  };

  useEffect(() => {
    // Background reconciliation is authoritative for the selected account,
    // including an operation that settled after a same-route pane change.
    if (
      latestSelectedAccountRef.current === selectedAccountKey &&
      scopeKey === JSON.stringify(getWalletNavigationScope())
    ) {
      setMetadata(account?.smartAccount || null);
    }
  }, [account?.smartAccount, selectedAccountKey, scopeKey]);

  const loadEntryMetadata = async () => {
    if (!account?.isSmartAccount) return;
    const isCurrentUi = createUiGuard();
    if (!isCurrentUi() || metadataRead.current?.key === metadataEntryKey)
      return;
    const request = { key: metadataEntryKey };
    metadataRead.current = request;
    setMetadataEntry({ key: metadataEntryKey, status: 'pending' });
    try {
      const hydrated = (await controllerEmitter(
        ['wallet', 'hydrateSmartAccount'],
        [account.id],
        300000
      )) as ISmartAccountMetadata;
      if (metadataRead.current !== request || !isCurrentUi()) return;
      if (
        !hydrated ||
        hydrated.chainId !== activeNetwork.chainId ||
        typeof hydrated.isDeployed !== 'boolean'
      )
        throw new Error('Smart account metadata unavailable');
      setMetadata(hydrated);
      setMetadataEntry({ key: metadataEntryKey, status: 'ready' });
    } catch {
      if (metadataRead.current === request && isCurrentUi())
        setMetadataEntry({ key: metadataEntryKey, status: 'failed' });
    } finally {
      if (metadataRead.current === request) metadataRead.current = null;
    }
  };

  useEffect(() => {
    // Recreated accounts and restored caches may contain default deployment
    // and owner data. Verify once per entry, never use it to authorize changes.
    void loadEntryMetadata();
    return () => {
      if (metadataRead.current?.key === metadataEntryKey)
        metadataRead.current = null;
    };
  }, [metadataEntryKey]);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const isCurrentUi = createUiGuard();
    if (!controllerReady || !account?.isSmartAccount) {
      setSlhDsaSetupStatus(null);
      return () => undefined;
    }

    const loadStatus = async () => {
      // A slow worker must not accumulate probes on every interval tick.
      if (cancelled || pending) return;
      pending = true;
      try {
        const status = (await controllerEmitter(
          ['wallet', 'getSLHDSASmartAccountSetupStatus'],
          [{ accountId: account.id }],
          300000
        )) as SLHDSASetupStatus | null;
        if (!cancelled && isCurrentUi()) {
          setSlhDsaSetupStatus(status);
        }
      } catch {
        if (!cancelled && isCurrentUi()) {
          setSlhDsaSetupStatus(null);
        }
      } finally {
        pending = false;
      }
    };

    loadStatus();
    const interval = window.setInterval(loadStatus, 3000);

    return () => {
      cancelled = true;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [
    account?.id,
    account?.isSmartAccount,
    controllerReady,
    controllerEmitter,
    location.key,
    scopeKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const isCurrentUi = createUiGuard();
    setGuardianRead((previous) =>
      previous.scope === guardianObservationScope
        ? previous
        : { scope: guardianObservationScope, snapshot: null, error: false }
    );
    if (
      !controllerReady ||
      !account?.isSmartAccount ||
      !smartAccountAddress ||
      !hasGuardianRecovery
    ) {
      setGuardianStatusLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const refresh = async () => {
      if (
        cancelled ||
        running ||
        document.visibilityState === 'hidden' ||
        !isCurrentUi()
      )
        return;
      running = true;
      setGuardianStatusLoading(true);
      try {
        const status = await readGuardianStatus({
          knownOperationId: localRecoveryOperationId,
        });
        if (!cancelled && isCurrentUi()) {
          setGuardianStatus(status as GuardianRecoveryStatus);
        }
      } catch {
        if (!cancelled && isCurrentUi()) {
          setGuardianStatus(null, true);
        }
      } finally {
        running = false;
        if (!cancelled && isCurrentUi(false)) setGuardianStatusLoading(false);
      }
    };
    void refresh();
    const onVisible = () => void refresh();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [
    account?.isSmartAccount,
    controllerReady,
    controllerEmitter,
    readGuardianStatus,
    setGuardianStatus,
    hasGuardianRecovery,
    guardianStatusRefresh,
    localRecoveryOperationId,
    location.key,
    smartAccountAddress,
    scopeKey,
    guardianObservationScope,
  ]);

  useEffect(() => {
    if (hasGuardianRecovery && configuredGuardianAddress) {
      setGuardianAddress(configuredGuardianAddress);
      if (configuredGuardianDelaySeconds) {
        setGuardianDelaySeconds(configuredGuardianDelaySeconds);
      }
      return;
    }

    setGuardianAddress('');
    setGuardianDelaySeconds(
      SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS
    );
  }, [
    configuredGuardianAddress,
    configuredGuardianDelaySeconds,
    hasGuardianRecovery,
    smartAccountAddress,
  ]);

  useEffect(() => {
    if (!activeGuardianReplacement?.recoveryOperation) {
      return;
    }
    setReplacementAuthenticator(activeGuardianReplacement.kind);
    if (pendingPaliWalletRecoveryAddress) {
      setReplacementEcdsaOwner(getAddress(pendingPaliWalletRecoveryAddress));
    }
  }, [
    activeGuardianReplacement?.recoveryOperation,
    activeGuardianReplacement?.kind,
    pendingPaliWalletRecoveryAddress,
  ]);

  const getLocalOwnerContexts = () =>
    getSmartAccountLocalOwnerContexts({
      accounts,
      controllerEmitter,
    });
  const getLocalSmartAccountIdByAddress = (address: string): number => {
    const normalizedAddress = address.toLowerCase();
    const localSmartAccount = Object.values(
      accounts[KeyringAccountType.SmartAccount] || {}
    ).find(
      (candidate: any) =>
        candidate?.address?.toLowerCase?.() === normalizedAddress
    ) as any;

    if (typeof localSmartAccount?.id !== 'number') {
      throw new Error('Local smart-account guardian was not found');
    }

    return localSmartAccount.id;
  };

  const submitModuleExecutions = async (
    executions: Array<{ data: string; target: string; value: string }>,
    options: {
      approval?: PolicyApprovalScope;
      onBeforeSubmit?: () => void;
      refreshAfterSubmit?: boolean;
      retrySignature?: boolean;
      useCachedMetadata?: boolean;
      waitForConfirmation?: boolean;
    } = {}
  ) => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const isCurrentUi = createUiGuard();
    const approval = options.approval || (await capturePolicyApproval());
    approval.assertCurrent();
    const submit = (
      smartAccount: ISmartAccountMetadata,
      useCachedMetadata?: boolean
    ) =>
      signAndSubmitSmartAccountExecutions({
        accountAddress: account.address,
        accountId: account.id,
        authenticatorContexts: getLocalOwnerContexts(),
        controllerEmitter,
        executions,
        expectedContext: approval.expectedContext,
        onPrepared: approval.assertCurrent,
        onBeforeSubmit: async () => {
          await assertApprovalSession(approval);
          options.onBeforeSubmit?.();
        },
        onAuthenticatorSigningResolved: (authenticatorId) => {
          if (authenticatorId === 'slh-dsa' && isCurrentUi()) {
            setIsSLHDSASigning(false);
          }
        },
        onAuthenticatorSigningStarted: (authenticatorId) => {
          if (authenticatorId === 'slh-dsa' && isCurrentUi()) {
            setIsSLHDSASigning(true);
          }
        },
        skipRapidPolling: true,
        trackLocalSubmission: true,
        smartAccount,
        useCachedMetadata,
        waitForConfirmation: options.waitForConfirmation,
      });

    try {
      let response;
      try {
        response = await submit(metadata, options.useCachedMetadata);
      } catch (error) {
        if (
          options.retrySignature === false ||
          !isSmartAccountSignatureError(error)
        ) {
          throw error;
        }
        const hydrated = await refreshMetadata(approval);
        if (!hydrated) {
          throw error;
        }
        try {
          response = await submit(hydrated, true);
        } catch (retryError) {
          if (isSmartAccountSignatureError(retryError)) {
            throw new Error('PALI_SMART_ACCOUNT_SIGNATURE_ERROR');
          }
          throw retryError;
        }
      }
      if (options.refreshAfterSubmit !== false) {
        // The operation was accepted; stale or unavailable metadata cannot
        // turn that outcome into a retryable signing failure.
        await refreshMetadata(approval, false).catch(() => null);
      }
      return response;
    } finally {
      if (isCurrentUi(false)) setIsSLHDSASigning(false);
    }
  };

  const replaceActiveValidator = async (
    authenticator: SmartAccountAuthenticatorBuildResult,
    approval: PolicyApprovalScope
  ) => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const isCurrentUi = createUiGuard();
    await assertApprovalSession(approval);
    const activeValidator = metadata.installedModules?.find(
      (module) =>
        module.type === 'validator' &&
        metadata.auth?.validator?.toLowerCase() === module.address.toLowerCase()
    );
    if (!activeValidator || activeValidator.type !== 'validator') {
      throw new Error(t('settings.noActiveAuthenticator'));
    }

    const installedValidators =
      (metadata.installedModules?.filter(
        (module): module is SmartAccountValidatorModule =>
          module.type === 'validator'
      ) as SmartAccountValidatorModule[]) || [];
    const plan = buildSmartAccountValidatorSwitchPlan({
      accountAddress: account.address,
      activeValidator,
      installedValidators,
      target: authenticator.auth,
    });

    if (plan.executions.length === 0) {
      return;
    }

    const switchKey = [
      account.address.toLowerCase(),
      plan.targetValidator.toLowerCase(),
      authenticator.auth.data,
    ].join(':');
    if (validatorSwitchRef.current?.key === switchKey) {
      return validatorSwitchRef.current.promise;
    }

    const switchPromise = (async () => {
      await signAndSubmitSmartAccountExecutions({
        accountAddress: account.address,
        accountId: account.id,
        authenticatorContexts: getLocalOwnerContexts(),
        controllerEmitter,
        executions: plan.executions,
        expectedContext: approval.expectedContext,
        onPrepared: approval.assertCurrent,
        onBeforeSubmit: () => assertApprovalSession(approval),
        onAuthenticatorSigningResolved: (authenticatorId) => {
          if (authenticatorId === 'slh-dsa' && isCurrentUi()) {
            setIsSLHDSASigning(false);
          }
        },
        onAuthenticatorSigningStarted: (authenticatorId) => {
          if (authenticatorId === 'slh-dsa' && isCurrentUi()) {
            setIsSLHDSASigning(true);
          }
        },
        smartAccount: metadata,
        skipRapidPolling: true,
        trackLocalSubmission: true,
        useCachedMetadata: true,
        waitForConfirmation: true,
      });
      const hydrated = await refreshMetadata(approval, false).catch(() => null);
      if (hydrated) {
        if (
          hydrated.auth?.validator?.toLowerCase() !==
          plan.targetValidator.toLowerCase()
        ) {
          throw new Error(t('settings.smartAccountAuthenticatorUpdateFailed'));
        }
      }
    })();
    validatorSwitchRef.current = {
      key: switchKey,
      promise: switchPromise,
    };
    try {
      await switchPromise;
    } finally {
      if (validatorSwitchRef.current?.promise === switchPromise) {
        validatorSwitchRef.current = null;
      }
      if (isCurrentUi(false)) setIsSLHDSASigning(false);
    }
  };

  const assertSmartAccountHasAuthenticatorGas = async () => {
    if (!account?.isSmartAccount) {
      return;
    }

    const gasStatus = (await controllerEmitter(
      ['wallet', 'getSmartAccountNativeGasStatus'],
      [{ accountId: account.id }],
      300000
    )) as { hasNativeGas: boolean; hasZkSysGasTankGas?: boolean };

    if (!gasStatus.hasNativeGas && !gasStatus.hasZkSysGasTankGas) {
      throw new Error('PALI_NATIVE_GAS_REQUIRED');
    }
  };

  const registerSmartAccount = async () => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const isCurrentUi = createUiGuard();
    setLoading(true);
    try {
      const approval = await capturePolicyApproval();
      await controllerEmitter(
        ['wallet', 'registerSmartAccountOnChain'],
        [{ accountId: account.id, expectedContext: approval.expectedContext }],
        300000
      );
      await refreshMetadata(approval, false).catch(() => null);
      if (isCurrentUi()) alert.success(t('settings.smartAccountRegistered'));
    } catch (error: any) {
      if (!isCurrentUi()) return;
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
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
      if (isCurrentUi(false)) setLoading(false);
    }
  };

  // Resolves a previously linked passkey for this account, preferring the
  // local registry (pending first: an interrupted attempt may already have
  // installed it on-chain) and falling back to the hydrated
  // on-chain module config (covers wallet reinstall while the p256 module is
  // still installed).
  const resolveExistingPasskeyProfile =
    (): IPasskeyCredentialProfile | null => {
      if (!account?.address) {
        return null;
      }
      const records = getPasskeyAccountRecords(account.address);
      const stored = records.pending?.profile || records.active;
      if (stored?.credentialIdHash && stored?.publicKey?.x) {
        return stored;
      }
      const installedPasskeyModule = metadata?.installedModules?.find(
        (module) => module.type === 'validator' && module.id === 'p256-webauthn'
      );
      if (
        installedPasskeyModule?.type === 'validator' &&
        installedPasskeyModule.id === 'p256-webauthn' &&
        installedPasskeyModule.config?.credentialIdHash &&
        installedPasskeyModule.config?.publicKey?.x
      ) {
        const config = installedPasskeyModule.config;
        return {
          backupStatus: config.backupStatus,
          credentialId: config.credentialId || '',
          credentialIdHash: config.credentialIdHash,
          passkeyName: config.passkeyName || '',
          publicKey: config.publicKey,
        };
      }
      return null;
    };

  const buildPasskeyAuthenticator = (
    profile: IPasskeyCredentialProfile,
    passkeyName: string
  ) =>
    buildP256WebAuthnAuthenticator({
      chainId: activeNetwork.chainId,
      config: {
        backupStatus: profile.backupStatus,
        credentialId: profile.credentialId || undefined,
        credentialIdHash: profile.credentialIdHash,
        passkeyName: profile.passkeyName || passkeyName,
        publicKey: profile.publicKey,
      },
    });

  const setupPasskeyAuthenticator = async (
    options: { forceCreateNew?: boolean } = {}
  ) => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const isCurrentUi = createUiGuard();
    setLoading(true);
    setModuleActionKey('p256-webauthn:use');
    try {
      const approval = await capturePolicyApproval();
      await assertSmartAccountHasAuthenticatorGas();
      await assertApprovalSession(approval);
      const passkeyName = t('settings.paliWalletPasskeyForAccount', {
        address: shortAddress(account.address),
        index: metadata.descriptor?.accountIndex ?? account.id,
      });
      const existingProfile = options.forceCreateNew
        ? null
        : resolveExistingPasskeyProfile();

      if (existingProfile) {
        // Reuse-first: prove the user still holds the previously linked
        // passkey, then rotate to it without creating a duplicate credential.
        let possession: Awaited<
          ReturnType<typeof signP256WebAuthnActionHash>
        > | null = null;
        try {
          possession = await signP256WebAuthnActionHash({
            actionHash: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
            credentialId: existingProfile.credentialId || undefined,
            expectedCredentialIdHash: existingProfile.credentialIdHash,
            expectedPublicKey: existingProfile.publicKey,
          });
        } catch {
          // Verification failed or was cancelled: ask before minting a new
          // passkey so a cancelled prompt never silently creates duplicates.
          if (isCurrentUi()) setIsPasskeyRecreateConfirmOpen(true);
          return;
        }
        const reusedProfile: IPasskeyCredentialProfile = {
          ...existingProfile,
          // The assertion returns the full credential id (and user handle)
          // even when only the hash was known, e.g. when the profile was
          // hydrated from chain after a wallet reinstall.
          credentialId: possession.credentialId,
          ...(possession.backupStatus
            ? { backupStatus: possession.backupStatus }
            : {}),
          ...(possession.userHandle && !existingProfile.userHandle
            ? { userHandle: possession.userHandle }
            : {}),
          passkeyName: existingProfile.passkeyName || passkeyName,
        };
        await assertApprovalSession(approval);
        if (!setPendingPasskeyRecord(account.address, reusedProfile)) {
          throw new Error(t('connections.smartAccountPasskeySaveFailed'));
        }
        await replaceActiveValidator(
          buildPasskeyAuthenticator(reusedProfile, passkeyName),
          approval
        );
        if (!setActivePasskeyRecord(account.address, reusedProfile)) {
          throw new Error(t('connections.smartAccountPasskeySaveFailed'));
        }
        if (isCurrentUi()) {
          alert.success(t('settings.smartAccountAuthenticatorConfigured'));
        }
        return;
      }

      const challenge = crypto.getRandomValues(new Uint8Array(32));
      // A composite validator or another chain may still require the old key.
      // A fresh random user handle preserves it even if this rotation fails.
      const credential = await createPasskeyCredential({
        accountName: passkeyName,
        challengeHex: bytesToHex(challenge),
        userDisplayName: passkeyName,
      });
      const profile = passkeyRegistrationToProfile(credential, passkeyName);
      await assertApprovalSession(approval);
      // Persist before the on-chain step: if the rotation fails, the retry
      // reuses this credential instead of creating yet another passkey.
      if (!setPendingPasskeyRecord(account.address, profile)) {
        throw new Error(t('connections.smartAccountPasskeySaveFailed'));
      }
      await replaceActiveValidator(
        buildPasskeyAuthenticator(profile, passkeyName),
        approval
      );
      if (!setActivePasskeyRecord(account.address, profile)) {
        throw new Error(t('connections.smartAccountPasskeySaveFailed'));
      }
      if (isCurrentUi()) {
        alert.success(t('settings.smartAccountAuthenticatorConfigured'));
      }
    } catch (error: any) {
      if (!isCurrentUi()) return;
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        const message =
          isSmartAccountPrefundError(error) || isNativeGasError(error)
            ? t('settings.smartAccountNeedsGasForAuthenticatorUpdate')
            : getSmartAccountActionErrorMessage(
                error,
                t('send.cantCompleteTxs'),
                t('send.insufficientFundsForGas'),
                t('settings.slhDsaLocalSignerMissing')
              );
        alert.error(message);
      }
    } finally {
      if (isCurrentUi(false)) {
        setModuleActionKey('');
        setLoading(false);
      }
    }
  };

  const setupPaliWalletAuthenticator = async () => {
    if (!account?.isSmartAccount || !metadata || !walletManagementAddress) {
      return;
    }
    const isCurrentUi = createUiGuard();
    const ecdsaValidator = getConfiguredAuthenticatorAddress(
      activeNetwork.chainId,
      'ecdsa'
    );
    if (!ecdsaValidator) {
      return;
    }

    setLoading(true);
    setModuleActionKey('ecdsa:use');
    try {
      const approval = await capturePolicyApproval();
      const data = encodeEcdsaValidatorInitData([walletManagementAddress], 1);
      await replaceActiveValidator(
        {
          auth: {
            data,
            module: 'ecdsa',
            validator: ecdsaValidator,
          },
          metadata: {
            installedModules: [
              {
                address: getAddress(ecdsaValidator),
                config: { owners: [walletManagementAddress], threshold: 1 },
                data,
                id: 'ecdsa',
                type: 'validator',
              },
            ],
          },
        },
        approval
      );
      if (isCurrentUi()) {
        alert.success(t('settings.smartAccountAuthenticatorConfigured'));
      }
    } catch (error: any) {
      if (!isCurrentUi()) return;
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
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
      if (isCurrentUi(false)) {
        setModuleActionKey('');
        setLoading(false);
      }
    }
  };

  const finalizeSLHDSASetup = async (
    config: Parameters<typeof buildSLHDSAAuthenticator>[0]['config'],
    approval: PolicyApprovalScope
  ) => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const isCurrentUi = createUiGuard();
    await assertApprovalSession(approval);

    const activeSLHDSAValidator = metadata.installedModules?.find(
      (module) =>
        module.type === 'validator' &&
        module.id === 'slh-dsa' &&
        metadata.auth?.validator?.toLowerCase() === module.address.toLowerCase()
    );
    if (activeSLHDSAValidator?.type === 'validator') {
      const activeConfig = activeSLHDSAValidator.config as Parameters<
        typeof buildSLHDSAAuthenticator
      >[0]['config'];
      if (
        activeConfig.pkRoot.toLowerCase() !== config.pkRoot.toLowerCase() ||
        activeConfig.pkSeed.toLowerCase() !== config.pkSeed.toLowerCase()
      ) {
        throw new Error(
          'Prepared SLH-DSA key does not match the active validator'
        );
      }
      if (isCurrentUi()) {
        alert.success(t('settings.smartAccountAuthenticatorConfigured'));
      }
      return;
    }

    await replaceActiveValidator(
      buildSLHDSAAuthenticator({
        chainId: activeNetwork.chainId,
        config,
      }),
      approval
    );
    try {
      await assertApprovalSession(approval);
    } catch {
      return;
    }
    await controllerEmitter(
      ['wallet', 'clearSLHDSASmartAccountSetupStatus'],
      [{ accountId: account.id }],
      300000
    );
    if (isCurrentUi()) {
      setSlhDsaSetupStatus(null);
      alert.success(t('settings.smartAccountAuthenticatorConfigured'));
    }
  };

  const setupSLHDSAAuthenticator = async () => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const isCurrentUi = createUiGuard();
    slhDsaSetupOwnerRef.current = `${scopeKey}:${selectedAccountKey}`;

    setIsSLHDSASetupConfirmOpen(false);
    setLoading(true);
    setModuleActionKey('slh-dsa:use');
    setSlhDsaActionStartedAt(Date.now());
    try {
      const approval = await capturePolicyApproval();
      slhDsaApprovalRef.current = approval;
      const forceRegenerate = slhDsaSetupIntent === 'regenerate';
      const isActiveSLHDSAValidator = metadata.installedModules?.some(
        (module) =>
          module.type === 'validator' &&
          module.id === 'slh-dsa' &&
          metadata.auth?.validator?.toLowerCase() ===
            module.address.toLowerCase()
      );
      if (!isActiveSLHDSAValidator) {
        await assertSmartAccountHasAuthenticatorGas();
        await assertApprovalSession(approval);
      }
      const hasLocalSLHDSAState = (
        config: NonNullable<SLHDSASetupStatus['config']>
      ) =>
        controllerEmitter(
          ['wallet', 'hasSLHDSALocalSignerState'],
          [
            {
              keyId: config.keyId,
              pkRoot: config.pkRoot,
              pkSeed: config.pkSeed,
            },
          ],
          300000
        ) as Promise<boolean>;

      const installedSLHDSAConfig = getInstalledSLHDSAValidatorConfig();
      if (!forceRegenerate && installedSLHDSAConfig) {
        if (await hasLocalSLHDSAState(installedSLHDSAConfig)) {
          await assertApprovalSession(approval);
          if (isCurrentUi()) setShouldFinalizeSLHDSASetup(false);
          await finalizeSLHDSASetup(installedSLHDSAConfig, approval);
          return;
        }
      }
      const preparedSLHDSAConfig = await getPreparedSLHDSAValidatorConfig();
      await assertApprovalSession(approval);
      if (
        !forceRegenerate &&
        preparedSLHDSAConfig &&
        (await hasLocalSLHDSAState(preparedSLHDSAConfig))
      ) {
        if (isCurrentUi()) setShouldFinalizeSLHDSASetup(false);
        await finalizeSLHDSASetup(preparedSLHDSAConfig, approval);
        return;
      }

      if (isCurrentUi()) setShouldFinalizeSLHDSASetup(true);
      await assertApprovalSession(approval);
      const status = (await controllerEmitter(
        ['wallet', 'startSLHDSASmartAccountValidatorSetup'],
        [
          {
            accountId: account.id,
            expectedContext: approval.expectedContext,
            force:
              forceRegenerate ||
              Boolean(installedSLHDSAConfig || preparedSLHDSAConfig),
          },
        ],
        300000
      )) as SLHDSASetupStatus;
      if (isCurrentUi()) setSlhDsaSetupStatus(status);
    } catch (error: any) {
      if (!isCurrentUi()) return;
      setShouldFinalizeSLHDSASetup(false);
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        const message =
          isSmartAccountPrefundError(error) || isNativeGasError(error)
            ? t('settings.smartAccountNeedsGasForAuthenticatorUpdate')
            : getSmartAccountActionErrorMessage(
                error,
                t('send.cantCompleteTxs'),
                t('send.insufficientFundsForGas'),
                t('settings.slhDsaLocalSignerMissing')
              );
        alert.error(message);
      }
    } finally {
      if (isCurrentUi(false)) {
        setModuleActionKey('');
        setSlhDsaActionStartedAt(undefined);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (
      slhDsaSetupStatus?.status !== 'ready' ||
      !slhDsaSetupStatus.config ||
      !slhDsaSetupStatus.canFinalize ||
      !shouldFinalizeSLHDSASetup ||
      !slhDsaApprovalRef.current ||
      slhDsaSetupOwnerRef.current !== `${scopeKey}:${selectedAccountKey}` ||
      slhDsaFinalizeRef.current ||
      !account?.isSmartAccount ||
      !metadata
    ) {
      return;
    }

    const isCurrentUi = createUiGuard();
    slhDsaFinalizeRef.current = true;
    setLoading(true);
    setModuleActionKey('slh-dsa:use');
    setSlhDsaActionStartedAt(Date.now());
    finalizeSLHDSASetup(slhDsaSetupStatus.config, slhDsaApprovalRef.current)
      .catch((error: any) => {
        if (!isCurrentUi()) return;
        const wasHandled = handleWalletLockedError(error);
        if (!wasHandled) {
          alert.error(
            getSmartAccountActionErrorMessage(
              error,
              t('send.cantCompleteTxs'),
              t('send.insufficientFundsForGas'),
              t('settings.slhDsaLocalSignerMissing')
            )
          );
        }
      })
      .finally(() => {
        if (isCurrentUi(false)) {
          slhDsaFinalizeRef.current = false;
          slhDsaSetupOwnerRef.current = '';
          slhDsaApprovalRef.current = null;
          setShouldFinalizeSLHDSASetup(false);
          setModuleActionKey('');
          setSlhDsaActionStartedAt(undefined);
          setLoading(false);
        }
      });
  }, [
    shouldFinalizeSLHDSASetup,
    slhDsaSetupStatus?.status,
    slhDsaSetupStatus?.updatedAt,
    metadata,
  ]);

  const installGuardianRecovery = async () => {
    const isCurrentUi = createUiGuard();
    setIsGuardianPolicyUpdateConfirmOpen(false);
    if (!metadata || !normalizedGuardianAddress) {
      alert.error(t('settings.invalidSmartAccountGuardianAddress'));
      return;
    }
    if (!guardianDelayAllowed) {
      alert.error(t('settings.smartAccountGuardianRecoveryChooseDelay'));
      return;
    }
    if (hasGuardianRecovery && !guardianPolicyChanged) {
      return;
    }
    const guardianRecoveryModule = getConfiguredAuthenticatorAddress(
      activeNetwork.chainId,
      'guardian-recovery'
    );
    if (!guardianRecoveryModule) {
      alert.error(t('settings.smartAccountGuardianRecoveryConnectFailed'));
      return;
    }

    setLoading(true);
    setModuleActionKey('guardian-recovery:update');
    try {
      const installExecution = {
        data: paliSmartAccountInterface.encodeFunctionData('installModule', [
          ERC7579_MODULE_TYPE_EXECUTOR,
          guardianRecoveryModule,
          encodeGuardianRecoveryInitData({
            delaySeconds: guardianDelaySeconds,
            expirationSeconds: guardianDelaySeconds * 2,
            guardians: [normalizedGuardianAddress],
            threshold: 1,
          }),
        ]),
        target: account.address,
        value: '0x0',
      };
      const executions =
        hasGuardianRecovery && installedGuardianRecovery
          ? [
              {
                data: paliSmartAccountInterface.encodeFunctionData(
                  'uninstallModule',
                  [
                    ERC7579_MODULE_TYPE_EXECUTOR,
                    installedGuardianRecovery.address,
                    '0x',
                  ]
                ),
                target: account.address,
                value: '0x0',
              },
              installExecution,
            ]
          : [installExecution];

      await submitModuleExecutions(executions, {
        useCachedMetadata: true,
        waitForConfirmation: true,
      });
      if (activeGuardianReplacement?.recoveryOperation) {
        storeGuardianReplacementCredential({
          ...activeGuardianReplacement,
          recoveryOperation: undefined,
        });
      }
      if (!isCurrentUi()) return;
      setGuardianStatus(null);
      setGuardianStatusRefresh((value) => value + 1);
      alert.success(
        hasGuardianRecovery
          ? t('settings.smartAccountGuardianRecoveryPolicyUpdated')
          : t('settings.smartAccountGuardianRecoveryConnected')
      );
    } catch (error: any) {
      if (!isCurrentUi()) return;
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        try {
          await refreshMetadata();
        } catch {
          // Keep the original action error as the user-facing result.
        }
        if (!isCurrentUi()) return;
        const fallbackMessage = hasGuardianRecovery
          ? t('settings.smartAccountGuardianRecoveryPolicyUpdateFailed')
          : t('settings.smartAccountGuardianRecoveryConnectFailed');
        const errorMessage =
          isSmartAccountPrefundError(error) || isNativeGasError(error)
            ? t('settings.smartAccountNeedsGasForPolicyUpdate')
            : fallbackMessage;

        alert.error(errorMessage);
      }
    } finally {
      if (isCurrentUi(false)) {
        setModuleActionKey('');
        setLoading(false);
        setGuardianReplacementStorageVersion((version) => version + 1);
      }
    }
  };

  const requestGuardianPolicyUpdate = () => {
    if (hasGuardianRecovery && hasPendingGuardianRecovery) {
      setIsGuardianPolicyUpdateConfirmOpen(true);
      return;
    }

    installGuardianRecovery();
  };

  const showGuardianDisablePending = (pending: GuardianDisablePending) => {
    if (createUiGuard()()) {
      guardianDisablePendingRef.current = pending;
      setGuardianDisablePending(pending);
    }
  };

  const rememberGuardianDisable = (
    target: GuardianDisablePending,
    requireDurable = false
  ) => {
    const pending: GuardianDisablePending = {
      accountAddress: target.accountAddress,
      ...(target.attemptId ? { attemptId: target.attemptId } : {}),
      chainId: target.chainId,
      localRecoverySalt: target.localRecoverySalt,
      moduleAddress: target.moduleAddress,
    };
    try {
      const key = guardianDisablePendingKey(
        target.accountAddress,
        target.chainId
      );
      const serialized = JSON.stringify(pending);
      localStorage.setItem(key, serialized);
      if (localStorage.getItem(key) !== serialized)
        throw new Error(GUARDIAN_DISABLE_STORAGE_ERROR);
    } catch {
      if (requireDurable) throw new Error(GUARDIAN_DISABLE_STORAGE_ERROR);
    }
    showGuardianDisablePending(pending);
  };

  const clearGuardianDisable = (
    target: GuardianDisablePending,
    clearRecoveryOperation: boolean
  ) => {
    try {
      const storedPending = readGuardianDisablePending(
        target.accountAddress,
        target.chainId,
        true
      );
      if (storedPending && !sameGuardianDisableAttempt(storedPending, target)) {
        showGuardianDisablePending(storedPending);
        return;
      }
      localStorage.removeItem(
        guardianDisablePendingKey(target.accountAddress, target.chainId)
      );
      if (clearRecoveryOperation && target.localRecoverySalt) {
        const key = guardianReplacementAuthenticatorKey(
          target.accountAddress,
          target.chainId
        );
        const stored = JSON.parse(localStorage.getItem(key) || 'null');
        // Never remove a newer recovery or its replacement signing credential.
        if (
          stored?.recoveryOperation?.salt === target.localRecoverySalt &&
          stored.recoveryOperation.account?.toLowerCase() ===
            target.accountAddress.toLowerCase() &&
          stored.recoveryOperation.chainId === target.chainId
        ) {
          localStorage.setItem(
            key,
            JSON.stringify({ ...stored, recoveryOperation: undefined })
          );
        }
      }
    } catch {
      // The chain result is not changed by a local-storage failure.
    }
    if (createUiGuard()()) {
      guardianDisablePendingRef.current = null;
      setGuardianDisablePending(null);
      setGuardianReplacementStorageVersion((version) => version + 1);
    }
  };

  const guardianRemovalConfirmed = (
    target: GuardianDisablePending,
    hydrated: ISmartAccountMetadata | null
  ) =>
    hydrated?.chainId === target.chainId &&
    hydrated?.isDeployed === true &&
    Array.isArray(hydrated.installedModules) &&
    !hydrated.installedModules.some(
      (module) =>
        module.address.toLowerCase() === target.moduleAddress.toLowerCase() ||
        (module.id === 'guardian-recovery' && module.type === 'executor')
    );

  const requestGuardianDisable = async (retryUnknown = false) => {
    const previousPending =
      guardianDisablePendingRef.current ||
      readGuardianDisablePending(account?.address, activeNetwork.chainId);
    if (previousPending && !retryUnknown) {
      guardianDisablePendingRef.current = previousPending;
      setGuardianDisablePending(previousPending);
    }
    if (
      guardianDisableInFlight.current ||
      guardianActionLoading ||
      (previousPending && !(retryUnknown && guardianDisableRetryReady)) ||
      !installedGuardianRecovery
    )
      return;
    guardianDisableInFlight.current = true;
    const isCurrentUi = createUiGuard();
    setLoading(true);
    try {
      const approval = await capturePolicyApproval();
      const hydrated = await refreshMetadata(approval);
      approval.assertCurrent();
      if (
        hydrated?.chainId !== activeNetwork.chainId ||
        hydrated?.isDeployed !== true ||
        !Array.isArray(hydrated.installedModules)
      )
        throw new Error('Smart account metadata unavailable');
      const installed = hydrated?.installedModules?.find(
        (module) =>
          module.id === 'guardian-recovery' && module.type === 'executor'
      );
      if (!installed) {
        if (
          previousPending &&
          guardianRemovalConfirmed(previousPending, hydrated)
        ) {
          clearGuardianDisable(previousPending, true);
        }
        alert.info(t('settings.smartAccountGuardianRecoveryAlreadyDisabled'));
        return;
      }
      const confirmation: GuardianDisableConfirmation = {
        accountAddress: getAddress(account.address),
        attemptId: uuidv4(),
        accountLabel:
          typeof account.label === 'string' && account.label
            ? account.label
            : typeof account.name === 'string' && account.name
            ? account.name
            : t('receive.smartAccount'),
        approval,
        chainId: activeNetwork.chainId,
        localRecoverySalt: activeGuardianReplacement?.recoveryOperation?.salt,
        moduleAddress: getAddress(installed.address),
        networkLabel: activeNetwork.label || '',
        retryUnknown: Boolean(previousPending && retryUnknown),
      };
      guardianDisableConfirmationRef.current = confirmation;
      setGuardianDisableConfirmation(confirmation);
    } catch (error) {
      if (isCurrentUi() && !handleWalletLockedError(error)) {
        alert.error(t('settings.smartAccountGuardianRecoveryDisableFailed'));
      }
    } finally {
      guardianDisableInFlight.current = false;
      if (isCurrentUi(false)) setLoading(false);
    }
  };

  const disableGuardianRecovery = async () => {
    const target = guardianDisableConfirmation;
    const isCurrentUi = createUiGuard();
    if (
      !target ||
      guardianDisableConfirmationRef.current !== target ||
      !isCurrentUi() ||
      guardianDisableInFlight.current ||
      (guardianDisablePendingRef.current && !target.retryUnknown)
    )
      return;
    const recordedPending = readGuardianDisablePending(
      target.accountAddress,
      target.chainId
    );
    if (recordedPending && !target.retryUnknown) {
      guardianDisablePendingRef.current = recordedPending;
      setGuardianDisablePending(recordedPending);
      guardianDisableConfirmationRef.current = null;
      setGuardianDisableConfirmation(null);
      return;
    }
    guardianDisableInFlight.current = true;
    const previousPending = guardianDisablePendingRef.current;
    let otherPending: GuardianDisablePending | null = null;
    setGuardianDisableRetryReady(false);
    let submissionAttempted = false;
    setLoading(true);
    setModuleActionKey('guardian-recovery:disable');
    try {
      await assertApprovalSession(target.approval);
      const current = await refreshMetadata(target.approval);
      target.approval.assertCurrent();
      if (
        current?.chainId !== target.chainId ||
        current?.isDeployed !== true ||
        !current?.installedModules?.some(
          (module) =>
            module.type === 'executor' &&
            module.id === 'guardian-recovery' &&
            module.address.toLowerCase() === target.moduleAddress.toLowerCase()
        )
      ) {
        throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
      }
      await submitModuleExecutions(
        [
          {
            data: paliSmartAccountInterface.encodeFunctionData(
              'uninstallModule',
              [ERC7579_MODULE_TYPE_EXECUTOR, target.moduleAddress, '0x']
            ),
            target: target.accountAddress,
            value: '0x0',
          },
        ],
        {
          approval: target.approval,
          onBeforeSubmit: () => {
            // This synchronous checkpoint follows asynchronous preparation and
            // signing. Do not replace a different window's newer attempt.
            const latest = readGuardianDisablePending(
              target.accountAddress,
              target.chainId,
              true
            );
            if (
              latest &&
              (!previousPending ||
                !sameGuardianDisableAttempt(latest, previousPending))
            ) {
              otherPending = latest;
              showGuardianDisablePending(latest);
              throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
            }
            rememberGuardianDisable(target, true);
            submissionAttempted = true;
          },
          refreshAfterSubmit: false,
          retrySignature: false,
          useCachedMetadata: true,
          waitForConfirmation: true,
        }
      );
      const hydrated = await refreshMetadata(target.approval, false).catch(
        () => null
      );
      if (guardianRemovalConfirmed(target, hydrated)) {
        clearGuardianDisable(target, true);
        if (isCurrentUi()) {
          setGuardianStatus(null);
          alert.success(t('settings.smartAccountGuardianRecoveryDisabled'));
        }
      } else if (isCurrentUi()) {
        alert.info(t('settings.smartAccountGuardianRecoveryDisableUnverified'));
      }
    } catch (error: any) {
      const definitelyNotApplied =
        !submissionAttempted ||
        error?.transactionNotBroadcast === true ||
        error?.code === 4001 ||
        error?.receipt?.status === 0;
      if (otherPending) showGuardianDisablePending(otherPending);
      else if (definitelyNotApplied && !previousPending)
        clearGuardianDisable(target, false);
      else if (definitelyNotApplied && previousPending) {
        try {
          const latest = readGuardianDisablePending(
            target.accountAddress,
            target.chainId,
            true
          );
          if (latest && !sameGuardianDisableAttempt(latest, target))
            showGuardianDisablePending(latest);
          else rememberGuardianDisable(previousPending);
        } catch {
          // Without a readable ownership marker, never overwrite storage.
          showGuardianDisablePending(previousPending);
        }
      }
      // An unknown post-submit result already has its verified durable marker.
      // Rewriting it here could lose a newer observation or fail needlessly.
      if (isCurrentUi() && !handleWalletLockedError(error)) {
        alert.error(
          t(
            error?.message === GUARDIAN_DISABLE_STORAGE_ERROR
              ? 'settings.smartAccountGuardianRecoveryDisableStorageFailed'
              : definitelyNotApplied
              ? 'settings.smartAccountGuardianRecoveryDisableFailed'
              : 'settings.smartAccountGuardianRecoveryDisableUnverified'
          )
        );
      }
    } finally {
      guardianDisableInFlight.current = false;
      if (isCurrentUi(false)) {
        guardianDisableConfirmationRef.current = null;
        setGuardianDisableConfirmation(null);
        setModuleActionKey('');
        setLoading(false);
      }
    }
  };

  const checkGuardianDisable = async () => {
    const target = guardianDisablePending;
    const isCurrentUi = createUiGuard();
    if (
      !target ||
      guardianDisablePendingRef.current !== target ||
      !isCurrentUi() ||
      guardianDisableInFlight.current ||
      guardianActionLoading
    )
      return;
    guardianDisableInFlight.current = true;
    setLoading(true);
    setGuardianDisableRetryReady(false);
    try {
      const hydrated = await refreshMetadata();
      if (!isCurrentUi()) return;
      if (guardianRemovalConfirmed(target, hydrated)) {
        clearGuardianDisable(target, true);
        setGuardianStatus(null);
        alert.success(t('settings.smartAccountGuardianRecoveryDisabled'));
      } else {
        if (
          hydrated?.chainId === target.chainId &&
          hydrated?.isDeployed === true &&
          hydrated.installedModules?.some(
            (module) =>
              module.type === 'executor' &&
              module.id === 'guardian-recovery' &&
              module.address.toLowerCase() ===
                target.moduleAddress.toLowerCase()
          )
        )
          setGuardianDisableRetryReady(true);
        alert.info(t('settings.smartAccountGuardianRecoveryDisableUnverified'));
      }
    } catch {
      if (isCurrentUi())
        alert.info(t('settings.smartAccountGuardianRecoveryDisableUnverified'));
    } finally {
      guardianDisableInFlight.current = false;
      if (isCurrentUi(false)) setLoading(false);
    }
  };

  const startGuardianRecovery = async () => {
    const isCurrentUi = createUiGuard();
    if (!smartAccountAddress || !installedGuardianRecovery) {
      alert.error(t('settings.smartAccountGuardianRecoveryNotConnected'));
      return;
    }
    setGuardianLoading(true);
    let hasFreshObservation = false;
    try {
      // A displayed observation is informational, not authorization. Re-read
      // before creating a replacement key or asking any signer to approve it.
      const current = await readGuardianStatus();
      if (!isCurrentUi()) return;
      const configuredModule = getConfiguredAuthenticatorAddress(
        activeNetwork.chainId,
        'guardian-recovery'
      );
      if (
        !current?.observedBlock ||
        current.chainId !== activeNetwork.chainId ||
        getAddress(current.account) !== smartAccountAddress ||
        !configuredModule ||
        getAddress(current.moduleAddress) !== getAddress(configuredModule) ||
        getAddress(installedGuardianRecovery.address) !==
          getAddress(current.moduleAddress)
      ) {
        throw new Error(t('settings.smartAccountGuardianStatusUnavailable'));
      }
      const guardian =
        current.guardians?.length === 1 ? getAddress(current.guardians[0]) : '';
      const delaySeconds = Number(current.delay);
      if (
        !current.exists ||
        current.threshold !== 1 ||
        !guardian ||
        guardian === '0x0000000000000000000000000000000000000000' ||
        !Number.isSafeInteger(delaySeconds) ||
        delaySeconds <= 0
      ) {
        throw new Error(t('settings.smartAccountGuardianStatusUnavailable'));
      }
      setGuardianStatus(current);
      hasFreshObservation = true;
      if (
        current.pending ||
        current.active?.status === 'pending' ||
        current.active?.status === 'ready'
      ) {
        throw new Error(
          t('settings.smartAccountGuardianRecoveryAlreadyStarted')
        );
      }
      const policyApproval = await capturePolicyApproval(false);
      setGuardianStep(
        t('settings.smartAccountGuardianRecoveryStepAuthenticator')
      );
      let target: PaliRecoveryTarget;
      let replacementCredential: GuardianReplacementCredential;

      if (replacementAuthenticator === 'p256-webauthn') {
        const replacementAuthenticatorName = t(
          'settings.smartAccountRecoveryReplacementName',
          { account: shortAddress(smartAccountAddress) }
        );
        const validator = getConfiguredAuthenticatorAddress(
          activeNetwork.chainId,
          'p256-webauthn'
        );
        if (!validator) {
          throw new Error('P-256/WebAuthn validator is not configured');
        }
        // Idempotent retry: a previous attempt may have minted a replacement
        // passkey and then failed before the recovery was submitted on-chain.
        // Reuse that credential instead of creating another one.
        const storedReplacement =
          activeGuardianReplacement &&
          !activeGuardianReplacement.recoveryOperation &&
          activeGuardianReplacement.kind === 'p256-webauthn' &&
          activeGuardianReplacement.authenticator.id === 'p256-webauthn' &&
          activeGuardianReplacement.authenticator.config?.credentialIdHash &&
          activeGuardianReplacement.authenticator.config?.publicKey?.x
            ? activeGuardianReplacement
            : null;

        // The recovery rotates the account to this key, so prove the user can
        // still sign with the stored replacement before reusing it. If the
        // passkey was deleted in the meantime, discard the record and mint a
        // fresh credential instead of recovering to an unusable key.
        let verifiedReplacement: GuardianReplacementCredential | null = null;
        if (storedReplacement) {
          const storedConfig = storedReplacement.authenticator
            .config as Extract<
            PaliSmartAccountAuthenticatorSetup,
            { id: 'p256-webauthn' }
          >['config'];
          try {
            await signP256WebAuthnActionHash({
              actionHash: bytesToHex(
                crypto.getRandomValues(new Uint8Array(32))
              ),
              credentialId: storedConfig.credentialId || undefined,
              expectedCredentialIdHash: storedConfig.credentialIdHash,
              expectedPublicKey: storedConfig.publicKey,
            });
            verifiedReplacement = storedReplacement;
          } catch {
            // Failed possession is not proof that a previous attempt never
            // installed this credential. Never delete it from the authenticator.
            await assertApprovalSession(policyApproval);
            clearGuardianReplacementCredential();
          }
        }

        if (verifiedReplacement) {
          const verifiedConfig = verifiedReplacement.authenticator
            .config as Extract<
            PaliSmartAccountAuthenticatorSetup,
            { id: 'p256-webauthn' }
          >['config'];
          target = toP256WebAuthnRecoveryTarget({
            validator,
            ...verifiedConfig.publicKey,
          });
          replacementCredential = verifiedReplacement;
        } else {
          await assertApprovalSession(policyApproval);
          const challenge = crypto.getRandomValues(new Uint8Array(32));
          // Intentionally a fresh random user handle: a deterministic handle
          // would overwrite the account's previous passkey in the credential
          // manager before the recovery is finalized, which would lock the
          // user out if the recovery is abandoned and the old passkey was
          // still usable.
          const newCredential = await createPasskeyCredential({
            accountName: replacementAuthenticatorName,
            challengeHex: bytesToHex(challenge),
            userDisplayName: replacementAuthenticatorName,
          });
          await assertApprovalSession(policyApproval);
          const publicKey = {
            originHash: newCredential.originHash,
            originLength: newCredential.originLength,
            rpIdHash: newCredential.rpIdHash,
            x: newCredential.x,
            y: newCredential.y,
          };
          const authenticator: PaliSmartAccountAuthenticatorSetup = {
            id: 'p256-webauthn',
            config: {
              backupStatus: newCredential.backupStatus,
              credentialId: newCredential.credentialId,
              credentialIdHash: newCredential.credentialIdHash,
              passkeyName: replacementAuthenticatorName,
              publicKey,
            },
          };
          target = toP256WebAuthnRecoveryTarget({
            validator,
            ...publicKey,
          });
          replacementCredential = {
            authenticator,
            backupStatus: newCredential.backupStatus,
            credentialId: newCredential.credentialId,
            credentialIdHash: newCredential.credentialIdHash,
            kind: replacementAuthenticator,
            userHandle: newCredential.userHandle,
          };
          // Persist before any on-chain step so a failure below cannot orphan
          // the freshly created passkey.
          storeGuardianReplacementCredential(replacementCredential);
        }
      } else {
        const owner = getAddress(normalizedReplacementEcdsaOwner);
        const threshold = 1;
        const validator = getConfiguredAuthenticatorAddress(
          activeNetwork.chainId,
          'ecdsa'
        );
        const data = encodeEcdsaValidatorInitData([owner], threshold);
        const authenticator: PaliSmartAccountAuthenticatorSetup = {
          id: 'ecdsa',
          config: { owners: [owner], threshold },
        };
        target = { auth: { data, module: 'ecdsa', validator } };
        replacementCredential = {
          authenticator,
          kind: replacementAuthenticator,
        };
      }

      if (isCurrentUi()) {
        setGuardianStep(
          replacementAuthenticator === 'ecdsa'
            ? t('settings.smartAccountGuardianRecoveryStepAuthenticatorProof')
            : t('settings.smartAccountGuardianRecoveryStepSubmit')
        );
      }
      await assertApprovalSession(policyApproval);
      const preparedRecovery = (await controllerEmitter(
        ['wallet', 'prepareSmartAccountGuardianStartRecovery'],
        [
          {
            account: smartAccountAddress,
            guardian,
            target,
            expectedContext: policyApproval.expectedContext,
          },
        ],
        300000
      )) as any;
      await assertApprovalSession(policyApproval);
      if (!preparedRecovery.approval && preparedRecovery.smartGuardian) {
        await controllerEmitter(
          ['wallet', 'validateSmartAccountGuardianRecoveryOperation'],
          [
            {
              account: smartAccountAddress,
              operation: preparedRecovery.operation,
            },
          ]
        );
      }
      await assertApprovalSession(policyApproval);
      const approval =
        preparedRecovery.approval ||
        (preparedRecovery.smartGuardian
          ? {
              guardian,
              signature: encodeSmartAccountAuthenticatorSignature(
                await signSmartAccountActionHash({
                  accountId: getLocalSmartAccountIdByAddress(guardian),
                  executionContextId: preparedRecovery.executionContextId,
                  actionHash: getPaliErc7739PersonalSignHash({
                    accountAddress: guardian,
                    chainId: preparedRecovery.operation.chainId,
                    hash: preparedRecovery.operation.hash,
                  }),
                  authenticatorContexts: getLocalOwnerContexts(),
                  smartAccount: preparedRecovery.smartGuardian,
                })
              ),
            }
          : null);
      if (!approval) {
        throw new Error(t('settings.smartAccountGuardianRecoveryStartFailed'));
      }
      await assertApprovalSession(policyApproval);
      const recoveryResponse = (await controllerEmitter(
        ['wallet', 'submitPreparedSmartAccountGuardianStartRecovery'],
        [
          {
            account: smartAccountAddress,
            executionContextId: preparedRecovery.executionContextId,
            expectedContext: policyApproval.expectedContext,
            approval,
            gasPayer: preparedRecovery.gasPayer,
            guardian,
            operation: preparedRecovery.operation,
          },
        ],
        300000
      )) as any;
      const recoveryOperation = recoveryResponse?.operation
        ? {
            account: recoveryResponse.operation.account,
            chainId: recoveryResponse.operation.chainId,
            policyEpoch: recoveryResponse.operation.policyEpoch,
            executionCalldata: recoveryResponse.operation.executionCalldata,
            mode: recoveryResponse.operation.mode,
            readyAt: Math.floor(Date.now() / 1000) + delaySeconds,
            recoveryModule: recoveryResponse.operation.recoveryModule,
            salt: recoveryResponse.operation.salt,
          }
        : undefined;
      const credentialWithOperation = {
        ...replacementCredential,
        recoveryOperation,
      };
      storeGuardianReplacementCredential(credentialWithOperation);
      if (isCurrentUi()) {
        alert.success(t('settings.smartAccountGuardianRecoveryStarted'));
      }
    } catch (error: any) {
      if (!isCurrentUi()) return;
      if (!hasFreshObservation) {
        setGuardianStatus(null, true);
      }
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        // Keep the stored replacement credential: it has no recovery
        // operation attached yet, so it does not block the UI, and a retry
        // reuses the already-created passkey instead of minting another.
        const errorMessage =
          error?.message === 'Local smart-account guardian was not found'
            ? t('settings.localSmartAccountGuardianMissing')
            : error?.message === 'P-256/WebAuthn validator is not configured'
            ? t('settings.recoveryValidatorNotConfigured')
            : isGuardianRecoveryAlreadyScheduledError(error)
            ? t('settings.smartAccountGuardianRecoveryAlreadyStarted')
            : getSmartAccountActionErrorMessage(
                error,
                t('settings.smartAccountGuardianRecoveryStartFailed'),
                t('settings.smartAccountGuardianRecoveryGuardianNeedsGas'),
                t('settings.slhDsaLocalSignerMissing')
              );

        alert.error(errorMessage);
      }
    } finally {
      if (isCurrentUi(false)) {
        setGuardianLoading(false);
        setGuardianStep('');
        setGuardianReplacementStorageVersion((version) => version + 1);
      }
    }
  };

  const finalizeGuardianRecovery = async () => {
    const isCurrentUi = createUiGuard();
    if (!smartAccountAddress || !activeGuardianReplacement?.recoveryOperation) {
      alert.error(t('settings.smartAccountGuardianRecoveryFinalizeFailed'));
      return;
    }
    setGuardianLoading(true);
    try {
      const recoveryOperation = activeGuardianReplacement.recoveryOperation;
      const operationId = getGuardianRecoveryOperationId(recoveryOperation);
      const current = await readGuardianStatus({
        knownOperationId: operationId,
      });
      if (!isCurrentUi()) return;
      setGuardianStatus(current);
      if (
        !current?.pending ||
        current.pending.status !== 'ready' ||
        current.pending.operationId !== operationId ||
        current.policyEpoch !== recoveryOperation.policyEpoch ||
        current.account !== smartAccountAddress ||
        current.chainId !== activeNetwork.chainId ||
        !recoveryOperation.recoveryModule ||
        getAddress(current.moduleAddress) !==
          getAddress(recoveryOperation.recoveryModule)
      ) {
        throw new Error(t('settings.smartAccountGuardianStatusUnavailable'));
      }
      const approval = await capturePolicyApproval(false);
      setGuardianStep(t('settings.smartAccountGuardianRecoveryStepFinalize'));
      if (
        getAddress(recoveryOperation.account) !== smartAccountAddress ||
        recoveryOperation.chainId !== activeNetwork.chainId
      ) {
        throw new Error(
          'Recovery intent belongs to a different account or network'
        );
      }
      await controllerEmitter(
        ['wallet', 'finalizeSmartAccountGuardianRecovery'],
        [
          {
            ...recoveryOperation,
            account: smartAccountAddress,
            expectedContext: approval.expectedContext,
          },
        ],
        300000
      );
      // Preserve previous credentials: other chains or composite policies can
      // still reference them even after this account's recovery is finalized.
      if (
        activeGuardianReplacement.kind === 'p256-webauthn' &&
        activeGuardianReplacement.authenticator.id === 'p256-webauthn' &&
        activeGuardianReplacement.credentialId &&
        activeGuardianReplacement.credentialIdHash
      ) {
        const saved = setActivePasskeyRecord(smartAccountAddress, {
          backupStatus: activeGuardianReplacement.backupStatus as
            | IPasskeyCredentialProfile['backupStatus']
            | undefined,
          credentialId: activeGuardianReplacement.credentialId,
          credentialIdHash: activeGuardianReplacement.credentialIdHash,
          passkeyName:
            activeGuardianReplacement.authenticator.config.passkeyName || '',
          publicKey: activeGuardianReplacement.authenticator.config.publicKey,
          userHandle: activeGuardianReplacement.userHandle,
        });
        if (!saved) {
          throw new Error(t('connections.smartAccountPasskeySaveFailed'));
        }
      }
      clearGuardianReplacementCredential();
      await refreshMetadata(approval, false).catch(() => null);
      if (!isCurrentUi()) return;
      alert.success(t('settings.smartAccountGuardianRecoveryFinalized'));
      setGuardianRecoveryView(false);
    } catch (error: any) {
      if (!isCurrentUi()) {
        // These records describe an on-chain recovery, so reconcile the
        // originating account even when its Settings entry has departed.
        if (isGuardianRecoveryPolicyChangedError(error)) {
          storeGuardianReplacementCredential(
            clearStaleGuardianRecoveryOperation(
              activeGuardianReplacement,
              error
            )
          );
        } else if (isGuardianRecoveryExpiredError(error)) {
          storeGuardianReplacementCredential({
            ...activeGuardianReplacement,
            recoveryOperation: undefined,
          });
        }
        return;
      }
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        if (isGuardianRecoveryPolicyChangedError(error)) {
          storeGuardianReplacementCredential(
            clearStaleGuardianRecoveryOperation(
              activeGuardianReplacement,
              error
            )
          );
          alert.error(t('settings.smartAccountGuardianRecoveryPolicyUpdated'));
          return;
        }
        if (isGuardianRecoveryExpiredError(error)) {
          // The scheduled operation expired on-chain and can never be
          // executed. Drop it from local state (keeping the replacement
          // credential so a retry reuses the already-created passkey) so
          // the user can start a fresh recovery.
          storeGuardianReplacementCredential({
            ...activeGuardianReplacement,
            recoveryOperation: undefined,
          });
          alert.error(t('settings.smartAccountGuardianRecoveryExpired'));
          return;
        }
        const errorMessage =
          error?.message ===
          'Recovery intent belongs to a different account or network'
            ? t('transactions.psbtSigningContextChanged')
            : isGuardianRecoveryNotReadyError(error)
            ? activeGuardianReplacement.recoveryOperation.readyAt * 1000 <=
              Date.now()
              ? t('settings.smartAccountGuardianRecoveryNetworkCatchingUp')
              : t('settings.smartAccountGuardianRecoveryReadyAt', {
                  time: new Date(
                    activeGuardianReplacement.recoveryOperation.readyAt * 1000
                  ).toLocaleString(i18n?.resolvedLanguage || i18n?.language),
                })
            : getSmartAccountActionErrorMessage(
                error,
                t('settings.smartAccountGuardianRecoveryFinalizeFailed'),
                t('send.insufficientFundsForGas'),
                t('settings.slhDsaLocalSignerMissing')
              );

        alert.error(errorMessage);
      }
    } finally {
      if (isCurrentUi(false)) {
        setGuardianLoading(false);
        setGuardianStep('');
        setGuardianReplacementStorageVersion((version) => version + 1);
      }
    }
  };

  const activeModuleKey = moduleDisplayKey(
    metadata?.auth?.module || metadata?.auth?.scheme || ''
  );
  const renderModuleAction = (
    onClick: () => void,
    disabled: boolean,
    busy: boolean,
    children: React.ReactNode
  ) => (
    <button
      type="button"
      className="flex items-center justify-center gap-2 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
    >
      {busy && <LoadingSvg className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
  const activeModuleLabel =
    metadata?.auth && activeModuleKey
      ? t(activeModuleKey)
      : t('settings.noActiveAuthenticator');
  const activePaliWalletOwnerAddress = (() => {
    const activeModuleId = metadata?.auth?.module || metadata?.auth?.scheme;
    if (activeModuleId !== 'ecdsa') {
      return '';
    }
    const activePaliWalletModule = metadata.installedModules?.find(
      (module) => module.type === 'validator' && module.id === 'ecdsa'
    );
    return activePaliWalletModule?.config.owners[0] || '';
  })();
  const guardianPolicyUpdateConfirmDescription = hasPendingGuardianRecovery
    ? t('settings.smartAccountGuardianRecoveryUpdatePendingWarning')
    : t('settings.smartAccountGuardianRecoveryPolicyUpdateConfirmDescription');
  const copyAddress = async (address: string) => {
    try {
      await copy(address);
      alert.info(t('home.addressCopied'));
    } catch {
      alert.error(t('transactions.copyFailed'));
    }
  };
  const guardianDisableControls = guardianDisablePending ? (
    <div className="rounded-2xl border border-brand-yellowInfo p-3 text-xs leading-5 text-brand-yellowInfo">
      <p role="status">
        {t('settings.smartAccountGuardianRecoveryDisableUnverified')}
      </p>
      {renderModuleAction(
        checkGuardianDisable,
        guardianActionLoading,
        loading,
        t('settings.smartAccountGuardianRecoveryCheckRemoval')
      )}
      {guardianDisableRetryReady &&
        renderModuleAction(
          () => requestGuardianDisable(true),
          guardianActionLoading,
          false,
          t('settings.smartAccountGuardianRecoveryRetryRemoval')
        )}
    </div>
  ) : hasGuardianRecovery ? (
    renderModuleAction(
      () => requestGuardianDisable(),
      guardianActionLoading,
      moduleActionKey === 'guardian-recovery:disable',
      <>
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 text-brand-yellowInfo"
        >
          <Icon name="warning" size={14} />
        </span>
        <span>{t('settings.smartAccountGuardianRecoveryDisable')}</span>
      </>
    )
  ) : null;
  const guardianDisableDialog = (
    <ConfirmationModal
      show={Boolean(guardianDisableConfirmation)}
      title={t('settings.smartAccountGuardianRecoveryDisableConfirmTitle')}
      buttonText={t(
        'settings.smartAccountGuardianRecoveryDisableConfirmButton'
      )}
      isButtonLoading={loading}
      onClick={disableGuardianRecovery}
      onClose={() => {
        if (!guardianDisableInFlight.current) {
          guardianDisableConfirmationRef.current = null;
          setGuardianDisableConfirmation(null);
        }
      }}
    >
      {guardianDisableConfirmation && (
        <>
          <dl className="min-w-0 space-y-1 rounded-2xl bg-alpha-whiteAlpha100 p-2 text-left text-xs">
            <div className="min-w-0">
              <dt
                className="truncate text-brand-graylight"
                title={guardianDisableConfirmation.accountLabel}
              >
                {guardianDisableConfirmation.accountLabel}
              </dt>
              <dd className="mt-1 break-all font-mono text-white">
                {guardianDisableConfirmation.accountAddress}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="sr-only">{t('nftDetails.network')}</dt>
              <dd className="mt-1 break-words text-white">
                {guardianDisableConfirmation.networkLabel
                  ? `${guardianDisableConfirmation.networkLabel} (${guardianDisableConfirmation.chainId})`
                  : guardianDisableConfirmation.chainId}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-4 text-brand-yellowInfo">
            {t('settings.smartAccountGuardianRecoveryInvalidatesPending')}
          </p>
          <p className="mt-4">
            {t(
              'settings.smartAccountGuardianRecoveryDisableConfirmDescription'
            )}
            {guardianDisableConfirmation.retryUnknown
              ? ` ${t('settings.smartAccountGuardianRecoveryRetryWarning')}`
              : ''}
          </p>
        </>
      )}
    </ConfirmationModal>
  );

  if (!isEntryMetadataReady) {
    const failed =
      metadataEntry?.key === metadataEntryKey &&
      metadataEntry.status === 'failed';
    return (
      <div className="flex h-full w-full flex-col items-center gap-4 px-4 py-6 text-center">
        <p className="text-lg font-semibold text-brand-white">
          {t('settings.smartAccountAccountPolicy')}
        </p>
        <p
          role={failed ? 'alert' : 'status'}
          className="text-sm text-brand-graylight"
        >
          {t(
            failed
              ? 'settings.smartAccountMetadataLoadFailed'
              : 'buttons.loading'
          )}
        </p>
        {failed && (
          <Button onClick={loadEntryMetadata}>
            {t('settings.smartAccountMetadataRetry')}
          </Button>
        )}
      </div>
    );
  }

  if (
    isGuardianRecoveryScreenOpen &&
    hasGuardianRecovery &&
    !isUndeployedSmartAccount
  ) {
    return (
      <div
        data-navigation-scroll="smart-account-policy-recovery"
        className="remove-scrollbar flex h-full w-full flex-col items-center overflow-y-auto px-4 pb-24 text-left"
      >
        {guardianDisableDialog}
        <PqSigningOverlay
          expectedSeconds={60}
          show={isSLHDSASigning}
          subtitle={t('settings.slhDsaSigningOverlayDescription')}
          title={t('settings.slhDsaSigningInProgress')}
          warningSeconds={90}
        />
        <div className="flex w-full max-w-[352px] flex-col gap-4">
          {guardianDisableControls}
          <button
            type="button"
            className="self-start rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={guardianActionLoading}
            onClick={() => setGuardianRecoveryView(false)}
          >
            {t('settings.smartAccountGuardianRecoveryBack')}
          </button>

          <div>
            <p className="text-lg font-semibold text-brand-white">
              {t('settings.smartAccountGuardianRecoveryLostTitle')}
            </p>
            <p className="mt-1 text-xs leading-5 text-brand-graylight">
              {t('settings.smartAccountGuardianRecoveryLostDescription')}
            </p>
          </div>

          <div className="rounded-2xl border border-brand-blue500 bg-brand-blue500 bg-opacity-10 p-4 text-xs text-brand-graylight">
            <div className="flex items-center justify-between gap-3">
              <span
                role={guardianStatusError ? 'alert' : 'status'}
                className="font-semibold text-white"
              >
                {t(guardianStatusLabel)}
              </span>
              <button
                type="button"
                className="min-w-0 truncate text-right transition-colors duration-200 hover:text-brand-royalblue"
                onClick={() => copyAddress(displayedGuardianAddress)}
              >
                {shortAddress(displayedGuardianAddress)}
              </button>
            </div>
            {guardianObservationPanel}
            {activeGuardianReplacement?.recoveryOperation?.readyAt &&
              localRecoveryMatches && (
                <div className="mt-3 space-y-1 text-brand-yellowInfo">
                  <p>
                    {t('settings.smartAccountGuardianRecoveryPendingTarget', {
                      authenticator: replacementAuthenticatorLabel(
                        activeGuardianReplacement.kind
                      ),
                    })}
                  </p>
                </div>
              )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className={`w-full rounded-2xl border p-4 text-left ${
                (pendingReplacementKind || replacementAuthenticator) ===
                'p256-webauthn'
                  ? 'border-brand-royalblue bg-brand-blue500 bg-opacity-20'
                  : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100'
              }`}
              disabled={guardianActionLoading || hasPendingGuardianRecovery}
              onClick={() => setReplacementAuthenticator('p256-webauthn')}
            >
              <span className="block font-medium text-white">
                {t('settings.recoveryAuthenticatorP256WebAuthn')}
              </span>
              <span className="mt-1 block text-xs leading-5 text-brand-graylight">
                {t('settings.recoveryAuthenticatorP256WebAuthnDescription')}
              </span>
            </button>
            <button
              type="button"
              className={`w-full rounded-2xl border p-4 text-left ${
                (pendingReplacementKind || replacementAuthenticator) === 'ecdsa'
                  ? 'border-brand-royalblue bg-brand-blue500 bg-opacity-20'
                  : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100'
              }`}
              disabled={guardianActionLoading || hasPendingGuardianRecovery}
              onClick={() => setReplacementAuthenticator('ecdsa')}
            >
              <span className="block font-medium text-white">
                {t('settings.ecdsaAuthenticator')}
              </span>
              <span className="mt-1 block text-xs leading-5 text-brand-graylight">
                {t('settings.recoveryAuthenticatorEcdsaDescription')}
              </span>
            </button>
            {(pendingReplacementKind || replacementAuthenticator) ===
              'ecdsa' && (
              <Form.Item
                className="mb-0"
                hasFeedback
                help={replacementEcdsaOwnerError}
                validateStatus={replacementEcdsaOwnerValidateStatus}
              >
                <Input
                  type="text"
                  className="custom-input-normal smartAccount-input relative w-full min-w-0 overflow-hidden text-ellipsis"
                  disabled={guardianActionLoading || hasPendingGuardianRecovery}
                  placeholder={t('settings.recoveryAuthenticatorEcdsaOwner')}
                  value={
                    pendingPaliWalletRecoveryAddress || replacementEcdsaOwner
                  }
                  onChange={(event) =>
                    setReplacementEcdsaOwner(event.target.value)
                  }
                />
              </Form.Item>
            )}
          </div>

          {guardianStep && (
            <p className="text-xs text-brand-yellowInfo">{guardianStep}</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isStartGuardianRecoveryDisabled}
              onClick={startGuardianRecovery}
            >
              {t('settings.smartAccountGuardianRecoveryStart')}
            </button>
            <button
              type="button"
              className="rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isFinalizeGuardianRecoveryDisabled}
              onClick={finalizeGuardianRecovery}
            >
              {t('settings.smartAccountGuardianRecoveryFinalize')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-navigation-scroll="smart-account-policy"
      className="remove-scrollbar flex h-full w-full flex-col items-center overflow-y-auto px-4 pb-24 text-left"
    >
      <PqSigningOverlay
        expectedSeconds={60}
        show={isSLHDSASigning}
        subtitle={t('settings.slhDsaSigningOverlayDescription')}
        title={t('settings.slhDsaSigningInProgress')}
        warningSeconds={90}
      />
      <div className="flex w-full max-w-[352px] flex-col gap-4">
        <div>
          <p className="text-lg font-semibold text-brand-white">
            {t('settings.smartAccountAccountPolicy')}
          </p>
          <p className="mt-1 text-xs leading-5 text-brand-graylight">
            {t('settings.smartAccountModulesHint')}
          </p>
        </div>

        <div className="rounded-2xl bg-alpha-whiteAlpha100 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue500 bg-opacity-20">
              <Icon
                name={isUndeployedSmartAccount ? 'warning' : 'check'}
                size={20}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-semibold text-brand-white">
                  {isUndeployedSmartAccount
                    ? t('settings.registerSmartAccount')
                    : t('settings.smartAccountCurrentApprovalMethod')}
                </p>
                <span className="shrink-0 rounded-full bg-brand-blue500 bg-opacity-20 px-2 py-1 text-[10px] font-semibold text-brand-blue100">
                  {isUndeployedSmartAccount
                    ? t('settings.smartAccountInfrastructureNotReadyStatus')
                    : t('settings.smartAccountInfrastructureReadyStatus')}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-brand-graylight">
                {isUndeployedSmartAccount
                  ? t('settings.smartAccountUndeployedNotice')
                  : t('settings.smartAccountCurrentApprovalMethodHint')}
              </p>
              {!isUndeployedSmartAccount && (
                <div className="mt-3 flex max-w-full flex-wrap items-center gap-2 rounded-full bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-semibold text-brand-white">
                  <span>{activeModuleLabel}</span>
                  {activePaliWalletOwnerAddress && (
                    <button
                      type="button"
                      className="min-w-0 truncate text-brand-graylight transition-colors duration-200 hover:text-brand-royalblue"
                      title={activePaliWalletOwnerAddress}
                      onClick={() => copyAddress(activePaliWalletOwnerAddress)}
                    >
                      {shortAddress(activePaliWalletOwnerAddress)}
                    </button>
                  )}
                </div>
              )}
              {!isUndeployedSmartAccount && isActiveSLHDSAApproval && (
                <div className="mt-3 space-y-3">
                  <PqOperationStatus
                    expectedSeconds={180}
                    progressLabel={
                      slhDsaProgress
                        ? t('settings.xmssProgressLevel', {
                            level: slhDsaProgress.level,
                          })
                        : undefined
                    }
                    progressPercent={
                      slhDsaProgress
                        ? (slhDsaProgress.completed / slhDsaProgress.total) *
                          100
                        : undefined
                    }
                    show={
                      moduleActionKey === 'slh-dsa:use' || isSLHDSASetupRunning
                    }
                    startedAt={slhDsaOperationStartedAt}
                    title={t('settings.slhDsaSetupInProgress')}
                    warningSeconds={360}
                  />
                  {slhDsaSetupStatus?.status === 'failed' &&
                    slhDsaSetupStatus.error && (
                      <p className="text-xs leading-5 text-warning-error">
                        {slhDsaSetupStatus.error}
                      </p>
                    )}
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={loading || isSLHDSASetupRunning}
                    onClick={() => {
                      setSlhDsaSetupIntent('regenerate');
                      setIsSLHDSASetupConfirmOpen(true);
                    }}
                  >
                    {(moduleActionKey === 'slh-dsa:use' ||
                      isSLHDSASetupRunning) && (
                      <LoadingSvg className="h-4 w-4 animate-spin" />
                    )}
                    {t('settings.slhDsaRegenerateLocalSigner')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {isUndeployedSmartAccount && (
            <div className="mt-4">
              <Button
                variant="neutral"
                className="text-sm text-brand-royalblue"
                type="button"
                disabled={loading}
                loading={loading}
                onClick={registerSmartAccount}
                fullWidth
              >
                {t('settings.registerSmartAccount')}
              </Button>
            </div>
          )}
        </div>

        {!isUndeployedSmartAccount && (
          <div>
            <p className="mb-2 text-sm font-semibold text-brand-white">
              {t('settings.smartAccountModules')}
            </p>
            <div className="flex flex-col gap-3">
              {modules.map((module) => {
                const installedModule = metadata?.installedModules?.find(
                  (candidate) => candidate.id === module.id
                );
                const installed =
                  Boolean(installedModule) || installedModuleIds.has(module.id);
                const isActiveValidator =
                  installedModule?.type === 'validator' &&
                  metadata?.auth?.validator?.toLowerCase() ===
                    installedModule.address.toLowerCase();
                const canInstallPasskey =
                  module.id === 'p256-webauthn' &&
                  module.supported &&
                  !isActiveValidator;
                const canInstallPaliWallet =
                  module.id === 'ecdsa' &&
                  module.supported &&
                  !isActiveValidator &&
                  Boolean(walletManagementAddress);
                const canInstallSLHDSA =
                  module.id === 'slh-dsa' &&
                  module.supported &&
                  !isActiveValidator;
                const isCurrentSLHDSASetupRunning =
                  module.id === 'slh-dsa' && isSLHDSASetupRunning;
                const canManageGuardianRecovery =
                  module.id === 'guardian-recovery' &&
                  (module.supported || Boolean(installedModule));
                const paliWalletOwnerAddress =
                  installedModule?.type === 'validator' &&
                  installedModule.id === 'ecdsa'
                    ? installedModule.config.owners[0] || ''
                    : '';
                const hasAction =
                  canInstallPaliWallet ||
                  canInstallPasskey ||
                  canInstallSLHDSA ||
                  canManageGuardianRecovery;
                if (isActiveValidator || !hasAction) {
                  return null;
                }

                return (
                  <div
                    key={module.id}
                    className={`rounded-2xl border p-4 ${
                      installed
                        ? 'border-brand-blue500 bg-brand-blue500 bg-opacity-10'
                        : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100'
                    }`}
                  >
                    <div className="space-y-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-brand-white">
                            {t(moduleDisplayKey(module.id)) ||
                              module.displayName}
                          </p>
                          {paliWalletOwnerAddress && (
                            <button
                              type="button"
                              className="mt-1 max-w-full truncate text-xs text-brand-graylight transition-colors duration-200 hover:text-brand-royalblue"
                              title={paliWalletOwnerAddress}
                              onClick={() =>
                                copyAddress(paliWalletOwnerAddress)
                              }
                            >
                              {shortAddress(paliWalletOwnerAddress)}
                            </button>
                          )}
                          <p className="mt-1 text-xs leading-5 text-brand-graylight">
                            {t(moduleHintKey(module.id, module.capability))}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-alpha-whiteAlpha100 px-2 py-1 text-[10px] font-semibold text-brand-graylight">
                          {installed
                            ? isActiveValidator
                              ? t('settings.activeSmartAccountValidator')
                              : t('settings.installed')
                            : module.supported
                            ? t('settings.supported')
                            : t('settings.unavailable')}
                        </span>
                      </div>
                      {canInstallPasskey &&
                        renderModuleAction(
                          () => setupPasskeyAuthenticator(),
                          loading,
                          moduleActionKey === `${module.id}:use`,
                          t('settings.useSmartAccountValidator')
                        )}
                      {canInstallPaliWallet &&
                        renderModuleAction(
                          setupPaliWalletAuthenticator,
                          loading,
                          moduleActionKey === `${module.id}:use`,
                          t('settings.useSmartAccountValidator')
                        )}
                      {canInstallSLHDSA && (
                        <div className="space-y-3">
                          <PqOperationStatus
                            expectedSeconds={360}
                            progressLabel={
                              slhDsaProgress
                                ? t('settings.xmssProgressLevel', {
                                    level: slhDsaProgress.level,
                                  })
                                : undefined
                            }
                            progressPercent={
                              slhDsaProgress
                                ? (slhDsaProgress.completed /
                                    slhDsaProgress.total) *
                                  100
                                : undefined
                            }
                            show={
                              moduleActionKey === `${module.id}:use` ||
                              isCurrentSLHDSASetupRunning
                            }
                            startedAt={slhDsaOperationStartedAt}
                            title={t('settings.slhDsaSetupInProgress')}
                            warningSeconds={540}
                          />
                          {module.id === 'slh-dsa' &&
                            slhDsaSetupStatus?.status === 'failed' &&
                            slhDsaSetupStatus.error && (
                              <p className="text-xs leading-5 text-warning-error">
                                {slhDsaSetupStatus.error}
                              </p>
                            )}
                          {renderModuleAction(
                            () => {
                              setSlhDsaSetupIntent('use');
                              setIsSLHDSASetupConfirmOpen(true);
                            },
                            loading || isCurrentSLHDSASetupRunning,
                            moduleActionKey === `${module.id}:use` ||
                              isCurrentSLHDSASetupRunning,
                            t('settings.useSmartAccountValidator')
                          )}
                        </div>
                      )}
                      {canManageGuardianRecovery && (
                        <div className="w-full min-w-0 space-y-3 overflow-hidden">
                          <Form.Item
                            className="mb-0 w-full min-w-0"
                            hasFeedback
                            help={guardianAddressError}
                            validateStatus={guardianAddressValidateStatus}
                          >
                            <Input
                              type="text"
                              className="custom-input-normal smartAccount-input relative w-full min-w-0 overflow-hidden text-ellipsis"
                              disabled={loading}
                              placeholder={t(
                                'settings.smartAccountGuardianAddress'
                              )}
                              value={guardianAddress}
                              onChange={(event) =>
                                setGuardianAddress(event.target.value)
                              }
                            />
                          </Form.Item>
                          <div
                            className={`grid gap-2 ${
                              guardianDelayOptions.length === 3
                                ? 'grid-cols-3'
                                : 'grid-cols-2'
                            }`}
                          >
                            {guardianDelayOptions.map((delaySeconds) => (
                              <button
                                key={delaySeconds}
                                type="button"
                                className={`rounded-full border px-2 py-2 text-[11px] font-medium transition-all duration-200 ${
                                  guardianDelaySeconds === delaySeconds
                                    ? 'border-brand-blue500 bg-brand-blue500 bg-opacity-20 text-brand-blue100'
                                    : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 text-white'
                                }`}
                                disabled={loading}
                                onClick={() =>
                                  setGuardianDelaySeconds(delaySeconds)
                                }
                              >
                                {t(
                                  delaySeconds === 600
                                    ? 'settings.smartAccountGuardianRecoveryDelayTestnet'
                                    : delaySeconds === 259200
                                    ? 'settings.smartAccountGuardianRecoveryDelayThreeDays'
                                    : 'settings.smartAccountGuardianRecoveryDelaySevenDays'
                                )}
                              </button>
                            ))}
                          </div>
                          {!guardianDelayAllowed && (
                            <p className="text-xs leading-5 text-brand-yellowInfo">
                              {t(
                                'settings.smartAccountGuardianRecoveryChooseDelay'
                              )}
                            </p>
                          )}
                          {renderModuleAction(
                            requestGuardianPolicyUpdate,
                            loading ||
                              Boolean(guardianDisablePending) ||
                              !guardianDelayAllowed ||
                              !normalizedGuardianAddress ||
                              (installed && !guardianPolicyChanged),
                            moduleActionKey === 'guardian-recovery:update',
                            <span>
                              {installed
                                ? t(
                                    'settings.smartAccountGuardianRecoveryUpdate'
                                  )
                                : t(
                                    'settings.smartAccountGuardianRecoveryConnect'
                                  )}
                            </span>
                          )}
                          {guardianDisableControls}
                          {installed && (
                            <div className="rounded-2xl bg-alpha-whiteAlpha100 p-3 text-xs text-brand-graylight">
                              <div className="flex items-center justify-between gap-3">
                                <span
                                  role={
                                    guardianStatusError ? 'alert' : 'status'
                                  }
                                  className="font-semibold text-white"
                                >
                                  {t(guardianStatusLabel)}
                                </span>
                                <button
                                  type="button"
                                  className="min-w-0 truncate text-right transition-colors duration-200 hover:text-brand-royalblue"
                                  onClick={() =>
                                    copyAddress(displayedGuardianAddress)
                                  }
                                >
                                  {shortAddress(displayedGuardianAddress)}
                                </button>
                              </div>
                              {guardianObservationPanel}
                              <button
                                type="button"
                                className="mt-3 w-full rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={guardianActionLoading}
                                onClick={() => setGuardianRecoveryView(true)}
                              >
                                {hasPendingGuardianRecovery
                                  ? t(
                                      'settings.smartAccountGuardianRecoveryContinue'
                                    )
                                  : t(
                                      'settings.smartAccountGuardianRecoveryShowOptions'
                                    )}
                              </button>
                            </div>
                          )}
                          {installed && (
                            <div className="rounded-2xl border border-alpha-whiteAlpha300 p-3">
                              <p className="text-xs leading-5 text-brand-graylight">
                                {t(
                                  'settings.smartAccountRecoveryEmailAlertsDescription'
                                )}
                              </p>
                              <a
                                href="https://sysnode.info/account#recovery-alerts"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex max-w-full items-center gap-2 rounded text-xs font-semibold text-brand-blue100 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue500"
                              >
                                {t('settings.smartAccountRecoveryEmailAlerts')}
                                <span aria-hidden="true">↗</span>
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <ConfirmationModal
        show={isGuardianPolicyUpdateConfirmOpen}
        title={t('settings.smartAccountGuardianRecoveryUpdateConfirmTitle')}
        description={guardianPolicyUpdateConfirmDescription}
        buttonText={t('settings.smartAccountGuardianRecoveryUpdate')}
        isButtonLoading={loading}
        onClick={installGuardianRecovery}
        onClose={() => setIsGuardianPolicyUpdateConfirmOpen(false)}
      />
      {guardianDisableDialog}
      <ConfirmationModal
        show={isPasskeyRecreateConfirmOpen}
        title={t('settings.smartAccountPasskeyRecreateConfirmTitle')}
        description={t(
          'settings.smartAccountPasskeyRecreateConfirmDescription'
        )}
        buttonText={t('settings.smartAccountPasskeyRecreateConfirmButton')}
        isButtonLoading={loading}
        onClick={() => {
          setIsPasskeyRecreateConfirmOpen(false);
          setupPasskeyAuthenticator({ forceCreateNew: true });
        }}
        onClose={() => setIsPasskeyRecreateConfirmOpen(false)}
      />
      <ConfirmationModal
        show={isSLHDSASetupConfirmOpen}
        title={t('settings.slhDsaAuthenticator')}
        description={t(
          slhDsaSetupIntent === 'regenerate'
            ? 'settings.slhDsaRegenerateConfirmDescription'
            : 'settings.slhDsaSetupConfirmDescription'
        )}
        buttonText={t('settings.useSmartAccountValidator')}
        isButtonLoading={loading}
        onClick={setupSLHDSAAuthenticator}
        onClose={() => setIsSLHDSASetupConfirmOpen(false)}
      />
    </div>
  );
};

export default SmartAccountPolicy;
