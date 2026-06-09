import { defaultAbiCoder } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { Form, Input } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { LoadingSvg } from 'components/Icon/Icon';
import { ConfirmationModal, Icon, NeutralButton } from 'components/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ISmartAccountMetadata, KeyringAccountType } from 'types/network';
import {
  bytesToHex,
  createPasskeyCredential,
  toP256WebAuthnRecoveryTarget,
} from 'utils/passkey';
import {
  buildP256WebAuthnAuthenticator,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
  encodeInstallValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  ERC7579_MODULE_TYPE_EXECUTOR,
  ERC7579_MODULE_TYPE_VALIDATOR,
  getAvailablePaliModules,
  getConfiguredAuthenticatorAddress,
  paliGuardianRecoveryModuleInterface,
  paliSmartAccountInterface,
  signAndSubmitSmartAccountExecutions,
} from 'utils/smartAccount';
import type {
  PaliRecoveryTarget,
  PaliSmartAccountAuthenticatorSetup,
  SmartAccountAuthenticatorRuntimeContexts,
} from 'utils/smartAccount';

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;
const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';

const stringifyError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

const getErrorText = (error: unknown, depth = 0): string => {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    try {
      return [error, getErrorText(JSON.parse(error), depth + 1)]
        .filter(Boolean)
        .join(' ');
    } catch {
      return error;
    }
  }
  if (typeof error !== 'object') {
    return String(error);
  }

  const errorRecord = error as Record<string, unknown>;
  const directParts = [
    errorRecord.message,
    errorRecord.reason,
    errorRecord.code,
    errorRecord.data,
    errorRecord.error,
    errorRecord.body,
    errorRecord.response,
    errorRecord.info,
    errorRecord.transaction,
    errorRecord.tx,
  ];
  const ownPropertyParts = Object.getOwnPropertyNames(error)
    .filter((key) => key !== 'stack')
    .map((key) => errorRecord[key]);
  const parts = [
    ...directParts,
    ...ownPropertyParts,
    stringifyError(error),
  ].flatMap((value) => {
    if (!value) {
      return [];
    }
    if (typeof value === 'string') {
      try {
        return [value, getErrorText(JSON.parse(value), depth + 1)];
      } catch {
        return [value];
      }
    }
    return [getErrorText(value, depth + 1)];
  });

  return parts.filter(Boolean).join(' ');
};

const getEntryPointFailedOpReason = (error: unknown): string => {
  const message = getErrorText(error);
  const match = message.match(/0x220266b6[0-9a-fA-F]*/);
  if (!match) {
    return '';
  }

  try {
    const [, reason] = defaultAbiCoder.decode(
      ['uint256', 'string'],
      `0x${match[0].slice(10)}`
    );
    return String(reason);
  } catch {
    return '';
  }
};

const isSmartAccountPrefundError = (error: unknown) => {
  const message = getErrorText(error);
  const normalized = message.toLowerCase();
  const failedOpReason = getEntryPointFailedOpReason(error).toLowerCase();

  return (
    message.includes('AA21') ||
    normalized.includes("didn't pay prefund") ||
    normalized.includes(AA21_PREFUND_REASON_HEX) ||
    failedOpReason.includes('aa21') ||
    failedOpReason.includes("didn't pay prefund") ||
    failedOpReason.includes('did not pay prefund') ||
    failedOpReason.includes('prefund')
  );
};

const isNativeGasError = (error: unknown) => {
  const message = getErrorText(error);
  const normalized = message.toLowerCase();

  return (
    message.includes('OutOfNativeResourcesDuringValidation') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient balance') ||
    message.includes('PALI_NATIVE_GAS_REQUIRED') ||
    normalized.includes('not enough native') ||
    normalized.includes('gas required exceeds allowance')
  );
};

const isGuardianRecoveryNotReadyError = (error: unknown) =>
  getErrorText(error).includes('0x201b632a') ||
  getErrorText(error).includes('PALI_GUARDIAN_RECOVERY_NOT_READY');

const isSmartAccountSignatureError = (error: unknown) => {
  const message = getErrorText(error);
  const failedOpReason = getEntryPointFailedOpReason(error);
  return (
    failedOpReason.includes('AA24') ||
    message.includes('AA24') ||
    message.includes('PALI_SMART_ACCOUNT_SIGNATURE_ERROR')
  );
};

const isRawRpcRevertMessage = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('"jsonrpc"') ||
    normalized.includes('execution reverted') ||
    normalized.includes('0x220266b6') ||
    normalized.includes('"data":"0x') ||
    normalized.includes('data: 0x')
  );
};

const getSmartAccountActionErrorMessage = (
  error: unknown,
  fallback: string,
  gasMessage: string
) => {
  if (isSmartAccountPrefundError(error) || isNativeGasError(error)) {
    return gasMessage;
  }

  const message = (error as any)?.message;
  return message && !isRawRpcRevertMessage(message) ? message : fallback;
};

const moduleDisplayKey = (id: string) => {
  switch (id) {
    case 'p256-webauthn':
      return 'settings.passkeyAuthenticator';
    case 'ecdsa':
      return 'settings.ecdsaAuthenticator';
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
  return 'settings.genericModuleHint';
};

type RecoveryAuthenticatorId = 'ecdsa' | 'p256-webauthn';
type InstalledModule = NonNullable<
  ISmartAccountMetadata['installedModules']
>[number];

type GuardianRecoveryStatus = {
  delay: string;
  exists: boolean;
  guardianCount: string;
  guardians: string[];
  moduleAddress: string;
  threshold: number | string;
} | null;

type GuardianReplacementCredential = {
  authenticator: PaliSmartAccountAuthenticatorSetup;
  backupStatus?: string;
  credentialId?: string;
  credentialIdHash?: string;
  kind: RecoveryAuthenticatorId;
  recoveryOperation?: {
    executionCalldata: string;
    mode: string;
    readyAt: number;
    recoveryModule?: string;
    salt: string;
  };
};

const guardianReplacementAuthenticatorKey = (account: string) =>
  `pali-smart-account-recovery-replacement:${account.toLowerCase()}`;

const SmartAccountPolicy = () => {
  const location = useLocation();
  const routeState = location.state as any;
  const { t } = useTranslation();
  const { alert, useCopyClipboard } = useUtils();
  const [, copy] = useCopyClipboard();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { accounts, activeAccount, activeNetwork } = useSelector(
    (state: RootState) => state.vault
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
  const [metadata, setMetadata] = useState<ISmartAccountMetadata | null>(
    account?.smartAccount || null
  );
  const [loading, setLoading] = useState(false);
  const [moduleActionKey, setModuleActionKey] = useState('');
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [guardianStep, setGuardianStep] = useState('');
  const [guardianStatus, setGuardianStatus] =
    useState<GuardianRecoveryStatus>(null);
  const [guardianStatusLoading, setGuardianStatusLoading] = useState(false);
  const [guardianReplacementCredential, setGuardianReplacementCredential] =
    useState<GuardianReplacementCredential | null>(null);
  const [
    guardianReplacementStorageVersion,
    setGuardianReplacementStorageVersion,
  ] = useState(0);
  const [replacementAuthenticator, setReplacementAuthenticator] =
    useState<RecoveryAuthenticatorId>('p256-webauthn');
  const [replacementEcdsaOwner, setReplacementEcdsaOwner] = useState('');
  const [guardianAddress, setGuardianAddress] = useState('');
  const [guardianDelaySeconds, setGuardianDelaySeconds] = useState(86400);
  const [isGuardianRecoveryScreenOpen, setIsGuardianRecoveryScreenOpen] =
    useState(false);
  const [
    isGuardianPolicyUpdateConfirmOpen,
    setIsGuardianPolicyUpdateConfirmOpen,
  ] = useState(false);
  const [modulePendingUninstall, setModulePendingUninstall] =
    useState<InstalledModule | null>(null);
  const modules = getAvailablePaliModules(activeNetwork.chainId);
  const installedModuleIds = new Set(
    metadata?.installedModules?.map((module) => module.id) || []
  );
  const isUndeployedSmartAccount =
    Boolean(account?.isSmartAccount && metadata) && !metadata?.isDeployed;
  const installedGuardianRecovery = metadata?.installedModules?.find(
    (module) => module.id === 'guardian-recovery' && module.type === 'executor'
  );
  const hasGuardianRecovery = Boolean(installedGuardianRecovery);
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
  const displayedGuardianAddress =
    guardianStatus?.guardians?.[0] ||
    installedGuardianRecovery?.config.guardians?.[0] ||
    smartAccountAddress;
  const storedGuardianReplacement = useMemo(() => {
    if (!smartAccountAddress) return null;
    const stored = localStorage.getItem(
      guardianReplacementAuthenticatorKey(smartAccountAddress)
    );
    if (!stored) return null;
    try {
      return JSON.parse(stored) as GuardianReplacementCredential;
    } catch {
      return null;
    }
  }, [
    smartAccountAddress,
    guardianReplacementCredential,
    guardianReplacementStorageVersion,
  ]);
  const activeGuardianReplacement =
    guardianReplacementCredential || storedGuardianReplacement;
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
    Boolean(activeGuardianReplacement?.recoveryOperation?.readyAt) &&
    Number(activeGuardianReplacement?.recoveryOperation?.readyAt) <=
      Math.floor(Date.now() / 1000);
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
  const guardianActionLoading =
    loading || guardianLoading || guardianStatusLoading;
  const validatorModules =
    metadata?.installedModules?.filter(
      (module) => module.type === 'validator'
    ) || [];
  const isReplacementAuthenticatorReady =
    replacementAuthenticator === 'p256-webauthn' ||
    Boolean(normalizedReplacementEcdsaOwner);
  const isStartGuardianRecoveryDisabled =
    guardianActionLoading ||
    !guardianPolicyReady ||
    !isReplacementAuthenticatorReady ||
    Boolean(activeGuardianReplacement?.recoveryOperation);
  const isFinalizeGuardianRecoveryDisabled =
    guardianActionLoading ||
    !activeGuardianReplacement?.recoveryOperation ||
    !guardianRecoveryReady;
  const hasPendingGuardianRecovery = Boolean(
    activeGuardianReplacement?.recoveryOperation
  );
  const pendingUninstallIsGuardianRecovery =
    modulePendingUninstall?.id === 'guardian-recovery';
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
    setGuardianReplacementCredential(credential);
    if (smartAccountAddress) {
      localStorage.setItem(
        guardianReplacementAuthenticatorKey(smartAccountAddress),
        JSON.stringify(credential)
      );
    }
    setGuardianReplacementStorageVersion((version) => version + 1);
  };

  const clearGuardianReplacementCredential = () => {
    if (smartAccountAddress) {
      localStorage.removeItem(
        guardianReplacementAuthenticatorKey(smartAccountAddress)
      );
    }
    setGuardianReplacementCredential(null);
    setGuardianReplacementStorageVersion((version) => version + 1);
  };

  const refreshMetadata = async () => {
    if (!account?.isSmartAccount) {
      return null;
    }
    const hydrated = (await controllerEmitter(
      ['wallet', 'hydrateSmartAccount'],
      [account.id],
      300000
    )) as ISmartAccountMetadata;
    setMetadata(hydrated);
    return hydrated;
  };

  useEffect(() => {
    const cachedMetadata = account?.smartAccount || null;
    setMetadata(cachedMetadata);
    if (
      account?.isSmartAccount &&
      cachedMetadata?.isDeployed &&
      !cachedMetadata.installedModules?.length
    ) {
      refreshMetadata().catch(() => undefined);
    }
  }, [account?.address, account?.id]);

  useEffect(() => {
    let cancelled = false;
    setGuardianStatus(null);
    if (
      !account?.isSmartAccount ||
      !smartAccountAddress ||
      !hasGuardianRecovery
    ) {
      return () => {
        cancelled = true;
      };
    }

    setGuardianStatusLoading(true);
    controllerEmitter(
      ['wallet', 'getSmartAccountGuardianRecoveryStatus'],
      [{ account: smartAccountAddress }],
      300000
    )
      .then((status) => {
        if (!cancelled) {
          setGuardianStatus(status as GuardianRecoveryStatus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuardianStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGuardianStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    account?.isSmartAccount,
    controllerEmitter,
    hasGuardianRecovery,
    smartAccountAddress,
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
    setGuardianDelaySeconds(86400);
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

  const getLocalOwnerContexts =
    (): SmartAccountAuthenticatorRuntimeContexts => {
      const ownerTypes = [
        KeyringAccountType.HDAccount,
        KeyringAccountType.Imported,
        KeyringAccountType.Ledger,
        KeyringAccountType.Trezor,
      ];
      const localOwners = ownerTypes.flatMap((type) =>
        Object.entries(accounts[type] || {}).flatMap(
          ([id, walletAccount]: [string, any]) => {
            try {
              return [
                {
                  address: getAddress(walletAccount.address),
                  id: Number(id),
                  type,
                },
              ];
            } catch {
              return [];
            }
          }
        )
      );

      return {
        ecdsa: {
          localOwners,
          signActionHash: ({ actionHash, owner }) =>
            controllerEmitter(
              ['wallet', 'ethSignWithAccount'],
              [[owner.address, actionHash], { id: owner.id, type: owner.type }],
              owner.type === KeyringAccountType.Ledger ||
                owner.type === KeyringAccountType.Trezor
                ? 300000
                : 10000
            ) as Promise<string>,
        },
      };
    };

  const submitModuleExecutions = async (
    executions: Array<{ data: string; target: string; value: string }>,
    options: {
      refreshAfterSubmit?: boolean;
      useCachedMetadata?: boolean;
      waitForConfirmation?: boolean;
    } = {}
  ) => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const submit = (
      smartAccount: ISmartAccountMetadata,
      useCachedMetadata?: boolean
    ) =>
      signAndSubmitSmartAccountExecutions({
        accountId: account.id,
        authenticatorContexts: getLocalOwnerContexts(),
        controllerEmitter,
        executions,
        skipRapidPolling: true,
        smartAccount,
        useCachedMetadata,
        waitForConfirmation: options.waitForConfirmation,
      });

    try {
      await submit(metadata, options.useCachedMetadata);
    } catch (error) {
      if (!isSmartAccountSignatureError(error)) {
        throw error;
      }
      const hydrated = await refreshMetadata();
      if (!hydrated) {
        throw error;
      }
      try {
        await submit(hydrated, true);
      } catch (retryError) {
        if (isSmartAccountSignatureError(retryError)) {
          throw new Error('PALI_SMART_ACCOUNT_SIGNATURE_ERROR');
        }
        throw retryError;
      }
    }
    if (options.refreshAfterSubmit !== false) {
      await refreshMetadata();
    }
  };

  const replaceActiveValidator = async (
    authenticator: ReturnType<typeof buildP256WebAuthnAuthenticator>
  ) => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    const activeValidator = metadata.installedModules?.find(
      (module) =>
        module.type === 'validator' &&
        metadata.auth?.validator?.toLowerCase() === module.address.toLowerCase()
    );
    if (!activeValidator || activeValidator.type !== 'validator') {
      throw new Error(t('settings.noActiveAuthenticator'));
    }

    const sameValidatorModule =
      activeValidator.address.toLowerCase() ===
      authenticator.auth.validator.toLowerCase();
    const installExecution = {
      data: encodeInstallValidatorModuleCall(
        authenticator.auth.validator,
        authenticator.auth.data
      ),
      target: account.address,
      value: '0x0',
    };
    const uninstallExecution = {
      data: encodeUninstallValidatorModuleCall(activeValidator.address),
      target: account.address,
      value: '0x0',
    };

    await signAndSubmitSmartAccountExecutions({
      accountId: account.id,
      authenticatorContexts: getLocalOwnerContexts(),
      controllerEmitter,
      executions: sameValidatorModule
        ? [uninstallExecution, installExecution]
        : [installExecution],
      smartAccount: metadata,
      skipRapidPolling: true,
      useCachedMetadata: true,
      waitForConfirmation: true,
    });
    const updatedMetadata = (await controllerEmitter(
      ['wallet', 'switchSmartAccountValidator'],
      [{ accountId: account.id, validator: authenticator.auth.validator }],
      300000
    )) as ISmartAccountMetadata;
    setMetadata(updatedMetadata);
  };

  const assertSmartAccountHasAuthenticatorGas = async () => {
    if (!account?.isSmartAccount) {
      return;
    }

    const gasStatus = (await controllerEmitter(
      ['wallet', 'getSmartAccountNativeGasStatus'],
      [{ accountId: account.id }],
      300000
    )) as { hasNativeGas: boolean };

    if (!gasStatus.hasNativeGas) {
      throw new Error('PALI_NATIVE_GAS_REQUIRED');
    }
  };

  const registerSmartAccount = async () => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    setLoading(true);
    try {
      await controllerEmitter(
        ['wallet', 'registerSmartAccountOnChain'],
        [{ accountId: account.id }],
        300000
      );
      await refreshMetadata();
      alert.success(t('settings.smartAccountRegistered'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas')
          )
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const setupPasskeyAuthenticator = async () => {
    if (!account?.isSmartAccount || !metadata) {
      return;
    }
    setLoading(true);
    setModuleActionKey('p256-webauthn:use');
    try {
      await assertSmartAccountHasAuthenticatorGas();
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const passkeyName = t('settings.paliWalletPasskeyForAccount', {
        address: shortAddress(account.address),
        index: metadata.descriptor?.accountIndex ?? account.id,
      });
      const credential = await createPasskeyCredential({
        accountName: passkeyName,
        challengeHex: bytesToHex(challenge),
        userDisplayName: passkeyName,
      });
      const authenticator = buildP256WebAuthnAuthenticator({
        chainId: activeNetwork.chainId,
        config: {
          backupStatus: credential.backupStatus,
          credentialId: credential.credentialId,
          credentialIdHash: credential.credentialIdHash,
          passkeyName,
          publicKey: {
            originHash: credential.originHash,
            originLength: credential.originLength,
            rpIdHash: credential.rpIdHash,
            x: credential.x,
            y: credential.y,
          },
        },
      });
      await replaceActiveValidator(authenticator);
      alert.success(t('settings.smartAccountAuthenticatorConfigured'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        const message =
          isSmartAccountPrefundError(error) || isNativeGasError(error)
            ? t('settings.smartAccountNeedsGasForAuthenticatorUpdate')
            : getSmartAccountActionErrorMessage(
                error,
                t('send.cantCompleteTxs'),
                t('send.insufficientFundsForGas')
              );
        alert.error(message);
      }
    } finally {
      setModuleActionKey('');
      setLoading(false);
    }
  };

  const setupPaliWalletAuthenticator = async () => {
    if (!account?.isSmartAccount || !metadata || !walletManagementAddress) {
      return;
    }
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
      const data = encodeEcdsaValidatorInitData([walletManagementAddress], 1);
      await submitModuleExecutions(
        [
          {
            data: encodeInstallValidatorModuleCall(ecdsaValidator, data),
            target: account.address,
            value: '0x0',
          },
        ],
        {
          refreshAfterSubmit: false,
          useCachedMetadata: true,
          waitForConfirmation: true,
        }
      );

      const updatedMetadata = (await controllerEmitter(
        ['wallet', 'switchSmartAccountValidator'],
        [{ accountId: account.id, validator: ecdsaValidator }],
        300000
      )) as ISmartAccountMetadata;
      setMetadata(updatedMetadata);
      alert.success(t('settings.smartAccountAuthenticatorConfigured'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas')
          )
        );
      }
    } finally {
      setModuleActionKey('');
      setLoading(false);
    }
  };

  const requestUninstallModule = (module: InstalledModule) => {
    setModulePendingUninstall(module);
  };

  const confirmUninstallModule = async () => {
    const module = modulePendingUninstall;
    if (!module) {
      return;
    }
    setModulePendingUninstall(null);
    await uninstallModule(module);
  };

  const uninstallModule = async (module: InstalledModule) => {
    if (!metadata) {
      return;
    }
    if (
      module.type === 'validator' &&
      (validatorModules.length <= 1 ||
        metadata.auth?.validator?.toLowerCase() ===
          module.address.toLowerCase())
    ) {
      alert.error(t('settings.smartAccountCannotRemoveActiveValidator'));
      return;
    }
    setLoading(true);
    setModuleActionKey(`${module.id}:uninstall`);
    try {
      await submitModuleExecutions(
        [
          {
            data: paliSmartAccountInterface.encodeFunctionData(
              'uninstallModule',
              [
                module.type === 'validator'
                  ? ERC7579_MODULE_TYPE_VALIDATOR
                  : ERC7579_MODULE_TYPE_EXECUTOR,
                module.address,
                '0x',
              ]
            ),
            target: account.address,
            value: '0x0',
          },
        ],
        {
          useCachedMetadata: true,
          waitForConfirmation: true,
        }
      );
      alert.success(t('settings.smartAccountModuleRemoved'));
      if (module.id === 'guardian-recovery' && smartAccountAddress) {
        clearGuardianReplacementCredential();
        setGuardianStatus(null);
        setGuardianAddress('');
        setGuardianDelaySeconds(86400);
      }
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas')
          )
        );
      }
    } finally {
      setModuleActionKey('');
      setLoading(false);
    }
  };

  const installGuardianRecovery = async () => {
    setIsGuardianPolicyUpdateConfirmOpen(false);
    if (!metadata || !normalizedGuardianAddress) {
      alert.error(t('settings.invalidSmartAccountGuardianAddress'));
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
      setGuardianStatus((currentStatus) =>
        currentStatus
          ? {
              ...currentStatus,
              delay: String(guardianDelaySeconds),
              exists: true,
              guardianCount: '1',
              guardians: [normalizedGuardianAddress],
              moduleAddress: getAddress(guardianRecoveryModule),
              threshold: 1,
            }
          : {
              delay: String(guardianDelaySeconds),
              exists: true,
              guardianCount: '1',
              guardians: [normalizedGuardianAddress],
              moduleAddress: getAddress(guardianRecoveryModule),
              threshold: 1,
            }
      );
      alert.success(
        hasGuardianRecovery
          ? t('settings.smartAccountGuardianRecoveryPolicyUpdated')
          : t('settings.smartAccountGuardianRecoveryConnected')
      );
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        try {
          await refreshMetadata();
        } catch {
          // Keep the original action error as the user-facing result.
        }
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
      setModuleActionKey('');
      setLoading(false);
    }
  };

  const requestGuardianPolicyUpdate = () => {
    if (hasGuardianRecovery && hasPendingGuardianRecovery) {
      setIsGuardianPolicyUpdateConfirmOpen(true);
      return;
    }

    installGuardianRecovery();
  };

  const switchValidator = async (
    module: NonNullable<ISmartAccountMetadata['installedModules']>[number]
  ) => {
    if (!account?.isSmartAccount || module.type !== 'validator') {
      return;
    }
    setLoading(true);
    setModuleActionKey(`${module.id}:use`);
    try {
      const updatedMetadata = (await controllerEmitter(
        ['wallet', 'switchSmartAccountValidator'],
        [{ accountId: account.id, validator: module.address }],
        300000
      )) as ISmartAccountMetadata;
      setMetadata(updatedMetadata);
      alert.success(t('settings.smartAccountValidatorSelected'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas')
          )
        );
      }
    } finally {
      setModuleActionKey('');
      setLoading(false);
    }
  };

  const startGuardianRecovery = async () => {
    if (!smartAccountAddress || !guardianPolicyReady) {
      alert.error(t('settings.smartAccountGuardianRecoveryNotConnected'));
      return;
    }
    const guardian = getAddress(
      guardianStatus?.guardians?.[0] ||
        installedGuardianRecovery?.config.guardians?.[0] ||
        ''
    );
    setGuardianLoading(true);
    try {
      setGuardianStep(
        t('settings.smartAccountGuardianRecoveryStepAuthenticator')
      );
      let target: PaliRecoveryTarget;
      let replacementCredential: GuardianReplacementCredential;

      if (replacementAuthenticator === 'p256-webauthn') {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const replacementAuthenticatorName = t(
          'settings.smartAccountRecoveryReplacementName',
          { account: shortAddress(smartAccountAddress) }
        );
        const newCredential = await createPasskeyCredential({
          accountName: replacementAuthenticatorName,
          challengeHex: bytesToHex(challenge),
          userDisplayName: replacementAuthenticatorName,
        });
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
          credentialIdHash: newCredential.credentialIdHash,
          ...publicKey,
        });
        replacementCredential = {
          authenticator,
          backupStatus: newCredential.backupStatus,
          credentialId: newCredential.credentialId,
          credentialIdHash: newCredential.credentialIdHash,
          kind: replacementAuthenticator,
        };
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

      setGuardianStep(
        replacementAuthenticator === 'ecdsa'
          ? t('settings.smartAccountGuardianRecoveryStepAuthenticatorProof')
          : t('settings.smartAccountGuardianRecoveryStepSubmit')
      );
      const recoveryResponse = (await controllerEmitter(
        ['wallet', 'submitSmartAccountGuardianStartRecovery'],
        [{ account: smartAccountAddress, guardian, target }],
        300000
      )) as any;
      const delaySeconds = Number(
        guardianStatus?.delay ||
          installedGuardianRecovery?.config.delaySeconds ||
          0
      );
      const recoveryOperation = recoveryResponse?.operation
        ? {
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
      alert.success(t('settings.smartAccountGuardianRecoveryStarted'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        clearGuardianReplacementCredential();
        const errorMessage = getSmartAccountActionErrorMessage(
          error,
          t('settings.smartAccountGuardianRecoveryStartFailed'),
          t('settings.smartAccountGuardianRecoveryGuardianNeedsGas')
        );

        alert.error(errorMessage);
      }
    } finally {
      setGuardianLoading(false);
      setGuardianStep('');
    }
  };

  const finalizeGuardianRecovery = async () => {
    if (!smartAccountAddress || !activeGuardianReplacement?.recoveryOperation) {
      alert.error(t('settings.smartAccountGuardianRecoveryFinalizeFailed'));
      return;
    }
    setGuardianLoading(true);
    try {
      setGuardianStep(t('settings.smartAccountGuardianRecoveryStepFinalize'));
      const recoveryOperation = activeGuardianReplacement.recoveryOperation;
      if (activeAccount.type === KeyringAccountType.SmartAccount) {
        const payerAccount = accounts[KeyringAccountType.SmartAccount]?.[
          activeAccount.id
        ] as any;
        const recoveryModule =
          recoveryOperation.recoveryModule ||
          guardianStatus?.moduleAddress ||
          installedGuardianRecovery?.address;
        if (!payerAccount?.smartAccount || !recoveryModule) {
          throw new Error(
            t('settings.smartAccountGuardianRecoveryFinalizeFailed')
          );
        }
        await signAndSubmitSmartAccountExecutions({
          accountId: activeAccount.id,
          authenticatorContexts: getLocalOwnerContexts(),
          controllerEmitter,
          executions: [
            {
              data: paliGuardianRecoveryModuleInterface.encodeFunctionData(
                'executeRecovery',
                [
                  smartAccountAddress,
                  recoveryOperation.salt,
                  recoveryOperation.mode,
                  recoveryOperation.executionCalldata,
                ]
              ),
              target: recoveryModule,
              value: '0x0',
            },
          ],
          smartAccount: payerAccount.smartAccount,
          skipRapidPolling: true,
          waitForConfirmation: true,
        });
      } else {
        await controllerEmitter(
          ['wallet', 'finalizeSmartAccountGuardianRecovery'],
          [
            {
              account: smartAccountAddress,
              ...recoveryOperation,
            },
          ],
          300000
        );
      }
      clearGuardianReplacementCredential();
      setIsGuardianRecoveryScreenOpen(false);
      const recoveredValidator = getConfiguredAuthenticatorAddress(
        activeNetwork.chainId,
        activeGuardianReplacement.authenticator.id
      );
      if (recoveredValidator && account?.id !== undefined) {
        try {
          const updatedMetadata = (await controllerEmitter(
            ['wallet', 'switchSmartAccountValidator'],
            [{ accountId: account.id, validator: recoveredValidator }],
            300000
          )) as ISmartAccountMetadata;
          setMetadata(updatedMetadata);
        } catch {
          await refreshMetadata();
        }
      } else {
        await refreshMetadata();
      }
      alert.success(t('settings.smartAccountGuardianRecoveryFinalized'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        const errorMessage = isGuardianRecoveryNotReadyError(error)
          ? activeGuardianReplacement.recoveryOperation.readyAt * 1000 <=
            Date.now()
            ? t('settings.smartAccountGuardianRecoveryNetworkCatchingUp')
            : t('settings.smartAccountGuardianRecoveryReadyAt', {
                time: new Date(
                  activeGuardianReplacement.recoveryOperation.readyAt * 1000
                ).toLocaleString(),
              })
          : getSmartAccountActionErrorMessage(
              error,
              t('settings.smartAccountGuardianRecoveryFinalizeFailed'),
              t('send.insufficientFundsForGas')
            );

        alert.error(errorMessage);
      }
    } finally {
      setGuardianLoading(false);
      setGuardianStep('');
    }
  };

  const activeModuleKey = moduleDisplayKey(
    metadata?.auth?.module || metadata?.auth?.scheme || ''
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
  const uninstallModuleConfirmDescription =
    pendingUninstallIsGuardianRecovery && hasPendingGuardianRecovery
      ? t('settings.smartAccountGuardianRecoveryUninstallPendingWarning')
      : pendingUninstallIsGuardianRecovery
      ? t('settings.smartAccountGuardianRecoveryUninstallWarning')
      : t('settings.smartAccountUninstallModuleConfirmDescription');
  const guardianPolicyUpdateConfirmDescription = hasPendingGuardianRecovery
    ? t('settings.smartAccountGuardianRecoveryUpdatePendingWarning')
    : t('settings.smartAccountGuardianRecoveryPolicyUpdateConfirmDescription');
  const copyAddress = (address: string) => {
    copy(address);
    alert.info(t('home.addressCopied'));
  };

  if (
    isGuardianRecoveryScreenOpen &&
    hasGuardianRecovery &&
    !isUndeployedSmartAccount
  ) {
    return (
      <div className="remove-scrollbar flex h-full w-full flex-col items-center overflow-y-auto px-4 pb-24 text-left">
        <div className="flex w-full max-w-[352px] flex-col gap-4">
          <button
            type="button"
            className="self-start rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={guardianActionLoading}
            onClick={() => setIsGuardianRecoveryScreenOpen(false)}
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
              <span className="font-semibold text-white">
                {hasPendingGuardianRecovery
                  ? t('settings.smartAccountGuardianRecoveryPending')
                  : t('settings.smartAccountGuardianRecoveryConnectedStatus')}
              </span>
              <button
                type="button"
                className="min-w-0 truncate text-right transition-colors duration-200 hover:text-brand-royalblue"
                onClick={() => copyAddress(displayedGuardianAddress)}
              >
                {shortAddress(displayedGuardianAddress)}
              </button>
            </div>
            {activeGuardianReplacement?.recoveryOperation?.readyAt && (
              <div className="mt-3 space-y-1 text-brand-yellowInfo">
                <p>
                  {t('settings.smartAccountGuardianRecoveryPendingTarget', {
                    authenticator: replacementAuthenticatorLabel(
                      activeGuardianReplacement.kind
                    ),
                  })}
                </p>
                <p>
                  {t('settings.smartAccountGuardianRecoveryReadyAt', {
                    time: new Date(
                      activeGuardianReplacement.recoveryOperation.readyAt * 1000
                    ).toLocaleString(),
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
                  className="custom-input-normal smartAccount-input relative w-full min-w-0 overflow-hidden rounded-full text-ellipsis"
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
    <div className="remove-scrollbar flex h-full w-full flex-col items-center overflow-y-auto px-4 pb-24 text-left">
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-brand-white">
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
            </div>
          </div>

          {isUndeployedSmartAccount && (
            <div className="mt-4">
              <NeutralButton
                type="button"
                disabled={loading}
                loading={loading}
                onClick={registerSmartAccount}
                fullWidth
              >
                {t('settings.registerSmartAccount')}
              </NeutralButton>
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
                const cannotRemoveValidator =
                  installedModule?.type === 'validator' &&
                  (isActiveValidator || validatorModules.length <= 1);
                const canInstallPasskey =
                  module.id === 'p256-webauthn' &&
                  module.supported &&
                  !installed;
                const canInstallPaliWallet =
                  module.id === 'ecdsa' &&
                  module.supported &&
                  !installed &&
                  Boolean(walletManagementAddress);
                const canManageGuardianRecovery =
                  module.id === 'guardian-recovery' && module.supported;
                const canSwitchValidator =
                  installedModule?.type === 'validator' && !isActiveValidator;
                const canUninstallModule =
                  Boolean(installedModule) && !cannotRemoveValidator;
                const paliWalletOwnerAddress =
                  installedModule?.type === 'validator' &&
                  installedModule.id === 'ecdsa'
                    ? installedModule.config.owners[0] || ''
                    : '';
                const hasAction =
                  canInstallPaliWallet ||
                  canInstallPasskey ||
                  canManageGuardianRecovery ||
                  canSwitchValidator ||
                  canUninstallModule;
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
                      <div className="flex items-start justify-between gap-3">
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
                      {canInstallPasskey && (
                        <button
                          type="button"
                          className="flex items-center justify-center gap-2 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={loading}
                          onClick={setupPasskeyAuthenticator}
                        >
                          {moduleActionKey === `${module.id}:use` && (
                            <LoadingSvg className="h-4 w-4 animate-spin" />
                          )}
                          {t('settings.useSmartAccountValidator')}
                        </button>
                      )}
                      {canInstallPaliWallet && (
                        <button
                          type="button"
                          className="flex items-center justify-center gap-2 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={loading}
                          onClick={setupPaliWalletAuthenticator}
                        >
                          {moduleActionKey === `${module.id}:use` && (
                            <LoadingSvg className="h-4 w-4 animate-spin" />
                          )}
                          {t('settings.useSmartAccountValidator')}
                        </button>
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
                              className="custom-input-normal smartAccount-input relative w-full min-w-0 overflow-hidden rounded-full text-ellipsis"
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
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              {
                                label: '10 min',
                                value: 600,
                              },
                              {
                                label: t(
                                  'settings.smartAccountGuardianRecoveryDelayThreeDays'
                                ),
                                value: 259200,
                              },
                              {
                                label: t(
                                  'settings.smartAccountGuardianRecoveryDelaySevenDays'
                                ),
                                value: 604800,
                              },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`rounded-full border px-2 py-2 text-[11px] font-medium transition-all duration-200 ${
                                  guardianDelaySeconds === option.value
                                    ? 'border-brand-blue500 bg-brand-blue500 bg-opacity-20 text-brand-blue100'
                                    : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 text-white'
                                }`}
                                disabled={loading}
                                onClick={() =>
                                  setGuardianDelaySeconds(option.value)
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="flex items-center justify-center gap-2 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              loading ||
                              !normalizedGuardianAddress ||
                              (installed && !guardianPolicyChanged)
                            }
                            onClick={requestGuardianPolicyUpdate}
                          >
                            {moduleActionKey === 'guardian-recovery:update' && (
                              <LoadingSvg className="h-4 w-4 animate-spin" />
                            )}
                            <span>
                              {installed
                                ? t(
                                    'settings.smartAccountGuardianRecoveryUpdate'
                                  )
                                : t(
                                    'settings.smartAccountGuardianRecoveryConnect'
                                  )}
                            </span>
                          </button>
                          {installed && (
                            <div className="rounded-2xl bg-alpha-whiteAlpha100 p-3 text-xs text-brand-graylight">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-white">
                                  {hasPendingGuardianRecovery
                                    ? t(
                                        'settings.smartAccountGuardianRecoveryPending'
                                      )
                                    : t(
                                        'settings.smartAccountGuardianRecoveryConnectedStatus'
                                      )}
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
                              {activeGuardianReplacement?.recoveryOperation
                                ?.readyAt && (
                                <p className="mt-2 text-brand-yellowInfo">
                                  {t(
                                    'settings.smartAccountGuardianRecoveryReadyAt',
                                    {
                                      time: new Date(
                                        activeGuardianReplacement
                                          .recoveryOperation.readyAt * 1000
                                      ).toLocaleString(),
                                    }
                                  )}
                                </p>
                              )}
                              <button
                                type="button"
                                className="mt-3 w-full rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={guardianActionLoading}
                                onClick={() =>
                                  setIsGuardianRecoveryScreenOpen(true)
                                }
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
                        </div>
                      )}
                      {installedModule && (
                        <div className="flex flex-wrap gap-2">
                          {canSwitchValidator && (
                            <button
                              type="button"
                              className="flex items-center justify-center gap-2 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={loading}
                              onClick={() => switchValidator(installedModule)}
                            >
                              {moduleActionKey === `${module.id}:use` && (
                                <LoadingSvg className="h-4 w-4 animate-spin" />
                              )}
                              {t('settings.useSmartAccountValidator')}
                            </button>
                          )}
                          {canUninstallModule && (
                            <button
                              type="button"
                              className="flex items-center justify-center gap-2 rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={loading}
                              onClick={() =>
                                requestUninstallModule(installedModule)
                              }
                            >
                              {moduleActionKey === `${module.id}:uninstall` && (
                                <LoadingSvg className="h-4 w-4 animate-spin" />
                              )}
                              {t('settings.uninstallModule')}
                            </button>
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
        show={Boolean(modulePendingUninstall)}
        title={t('settings.smartAccountUninstallModuleConfirmTitle')}
        description={uninstallModuleConfirmDescription}
        buttonText={t('settings.uninstallModule')}
        isButtonLoading={loading}
        onClick={confirmUninstallModule}
        onClose={() => setModulePendingUninstall(null)}
      />
      <ConfirmationModal
        show={isGuardianPolicyUpdateConfirmOpen}
        title={t('settings.smartAccountGuardianRecoveryUpdateConfirmTitle')}
        description={guardianPolicyUpdateConfirmDescription}
        buttonText={t('settings.smartAccountGuardianRecoveryUpdate')}
        isButtonLoading={loading}
        onClick={installGuardianRecovery}
        onClose={() => setIsGuardianPolicyUpdateConfirmOpen(false)}
      />
    </div>
  );
};

export default SmartAccountPolicy;
