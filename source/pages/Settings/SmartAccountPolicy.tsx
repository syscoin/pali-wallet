import { getAddress } from '@ethersproject/address';
import { Form, Input } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { LoadingSvg } from 'components/Icon/Icon';
import { Button, ConfirmationModal, Icon } from 'components/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import {
  IPasskeyCredentialProfile,
  ISmartAccountMetadata,
  KeyringAccountType,
} from 'types/network';
import {
  bytesToHex,
  clearPasskeyAccountRecords,
  createPasskeyCredential,
  derivePasskeyUserHandle,
  getPasskeyAccountRecords,
  passkeyRegistrationToProfile,
  setActivePasskeyRecord,
  setPendingPasskeyRecord,
  signalAcceptedPasskeyCredentials,
  signalUnknownPasskeyCredential,
  signP256WebAuthnActionHash,
  toP256WebAuthnRecoveryTarget,
} from 'utils/passkey';
import {
  buildP256WebAuthnAuthenticator,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  ERC7579_MODULE_TYPE_EXECUTOR,
  encodeSmartAccountAuthenticatorSignature,
  getAvailablePaliModules,
  getConfiguredAuthenticatorAddress,
  paliSmartAccountInterface,
  signAndSubmitSmartAccountExecutions,
  signSmartAccountActionHash,
} from 'utils/smartAccount';
import type {
  PaliRecoveryTarget,
  PaliSmartAccountAuthenticatorSetup,
  SmartAccountAuthenticatorBuildResult,
  SmartAccountAuthenticatorRuntimeContexts,
} from 'utils/smartAccount';
import {
  getSmartAccountActionErrorMessage,
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
  userHandle?: string;
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
  const [isPasskeyRecreateConfirmOpen, setIsPasskeyRecreateConfirmOpen] =
    useState(false);
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
    authenticator: SmartAccountAuthenticatorBuildResult
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

    const targetValidator = metadata.installedModules?.find(
      (module) =>
        module.type === 'validator' &&
        module.address.toLowerCase() ===
          authenticator.auth.validator.toLowerCase()
    );
    const sameValidatorModule =
      activeValidator.address.toLowerCase() ===
      authenticator.auth.validator.toLowerCase();
    // An already-installed validator module must be re-keyed via the account's
    // atomic rotateValidator (a plain uninstall of the active validator is
    // rejected by the account, and installing an installed module reverts).
    // Rotation also makes the module the active validator.
    const installExecution = {
      data: targetValidator
        ? encodeRotateValidatorModuleCall(
            authenticator.auth.validator,
            authenticator.auth.data
          )
        : encodeInstallValidatorModuleCall(
            authenticator.auth.validator,
            authenticator.auth.data
          ),
      target: account.address,
      value: '0x0',
    };
    const uninstallActiveExecution = {
      data: encodeUninstallValidatorModuleCall(activeValidator.address),
      target: account.address,
      value: '0x0',
    };
    const executions = [
      installExecution,
      ...(!sameValidatorModule ? [uninstallActiveExecution] : []),
    ];

    await signAndSubmitSmartAccountExecutions({
      accountId: account.id,
      authenticatorContexts: getLocalOwnerContexts(),
      controllerEmitter,
      executions,
      smartAccount: metadata,
      skipRapidPolling: true,
      useCachedMetadata: true,
      waitForConfirmation: true,
    });
    const hydrated = await refreshMetadata();
    if (hydrated) {
      setMetadata(hydrated);
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

  // Resolves a previously linked passkey for this account, preferring the
  // local registry (pending first: it marks a created-but-not-yet-on-chain
  // credential from an interrupted attempt) and falling back to the hydrated
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
    setLoading(true);
    setModuleActionKey('p256-webauthn:use');
    try {
      await assertSmartAccountHasAuthenticatorGas();
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
          setIsPasskeyRecreateConfirmOpen(true);
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
        await replaceActiveValidator(
          buildPasskeyAuthenticator(reusedProfile, passkeyName)
        );
        setActivePasskeyRecord(account.address, reusedProfile);
        if (reusedProfile.userHandle) {
          await signalAcceptedPasskeyCredentials({
            credentialIds: [reusedProfile.credentialId],
            userHandle: reusedProfile.userHandle,
          });
        }
        alert.success(t('settings.smartAccountAuthenticatorConfigured'));
        return;
      }

      const previousProfile = options.forceCreateNew
        ? resolveExistingPasskeyProfile()
        : null;
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      // Deterministic user handle: a re-created passkey for this account
      // replaces the stale credential-manager entry instead of stacking a new
      // one. Safe here because this action is only offered while the passkey
      // validator is NOT active, so no prior passkey is needed for signing.
      const userId = await derivePasskeyUserHandle(account.address);
      const credential = await createPasskeyCredential({
        accountName: passkeyName,
        challengeHex: bytesToHex(challenge),
        userDisplayName: passkeyName,
        userId,
      });
      const profile = passkeyRegistrationToProfile(credential, passkeyName);
      // Persist before the on-chain step: if the rotation fails, the retry
      // reuses this credential instead of creating yet another passkey.
      setPendingPasskeyRecord(account.address, profile);
      await replaceActiveValidator(
        buildPasskeyAuthenticator(profile, passkeyName)
      );
      setActivePasskeyRecord(account.address, profile);
      if (
        previousProfile?.credentialId &&
        previousProfile.credentialId !== profile.credentialId
      ) {
        await signalUnknownPasskeyCredential(previousProfile.credentialId);
      }
      if (profile.userHandle) {
        await signalAcceptedPasskeyCredentials({
          credentialIds: [profile.credentialId],
          userHandle: profile.userHandle,
        });
      }
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
      await replaceActiveValidator({
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
      });
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
        const replacementAuthenticatorName = t(
          'settings.smartAccountRecoveryReplacementName',
          { account: shortAddress(smartAccountAddress) }
        );
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
            if (storedConfig.credentialId) {
              await signalUnknownPasskeyCredential(storedConfig.credentialId);
            }
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
            credentialIdHash: verifiedConfig.credentialIdHash,
            ...verifiedConfig.publicKey,
          });
          replacementCredential = verifiedReplacement;
        } else {
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

      setGuardianStep(
        replacementAuthenticator === 'ecdsa'
          ? t('settings.smartAccountGuardianRecoveryStepAuthenticatorProof')
          : t('settings.smartAccountGuardianRecoveryStepSubmit')
      );
      const preparedRecovery = (await controllerEmitter(
        ['wallet', 'prepareSmartAccountGuardianStartRecovery'],
        [{ account: smartAccountAddress, guardian, target }],
        300000
      )) as any;
      const approval =
        preparedRecovery.approval ||
        (preparedRecovery.smartGuardian
          ? {
              guardian,
              signature: encodeSmartAccountAuthenticatorSignature(
                await signSmartAccountActionHash({
                  actionHash: preparedRecovery.operation.hash,
                  authenticatorContexts: getLocalOwnerContexts(),
                  smartAccount: preparedRecovery.smartGuardian,
                })
              ),
            }
          : null);
      if (!approval) {
        throw new Error(t('settings.smartAccountGuardianRecoveryStartFailed'));
      }
      const recoveryResponse = (await controllerEmitter(
        ['wallet', 'submitPreparedSmartAccountGuardianStartRecovery'],
        [
          {
            account: smartAccountAddress,
            approval,
            gasPayer: preparedRecovery.gasPayer,
            guardian,
            operation: preparedRecovery.operation,
          },
        ],
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
        // Keep the stored replacement credential: it has no recovery
        // operation attached yet, so it does not block the UI, and a retry
        // reuses the already-created passkey instead of minting another.
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
      // The replaced validator's passkey (if any) is now obsolete: signal the
      // credential manager to drop it and update the local registry to the
      // replacement credential so future rotations reuse the right passkey.
      const previousRecords = getPasskeyAccountRecords(smartAccountAddress);
      const previousCredentialId = previousRecords.active?.credentialId;
      if (
        previousCredentialId &&
        previousCredentialId !== activeGuardianReplacement.credentialId
      ) {
        await signalUnknownPasskeyCredential(previousCredentialId);
      }
      if (
        activeGuardianReplacement.kind === 'p256-webauthn' &&
        activeGuardianReplacement.authenticator.id === 'p256-webauthn' &&
        activeGuardianReplacement.credentialId &&
        activeGuardianReplacement.credentialIdHash
      ) {
        setActivePasskeyRecord(smartAccountAddress, {
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
      } else {
        clearPasskeyAccountRecords(smartAccountAddress);
      }
      clearGuardianReplacementCredential();
      setIsGuardianRecoveryScreenOpen(false);
      await refreshMetadata();
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
                const canManageGuardianRecovery =
                  module.id === 'guardian-recovery' && module.supported;
                const paliWalletOwnerAddress =
                  installedModule?.type === 'validator' &&
                  installedModule.id === 'ecdsa'
                    ? installedModule.config.owners[0] || ''
                    : '';
                const hasAction =
                  canInstallPaliWallet ||
                  canInstallPasskey ||
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
                          onClick={() => setupPasskeyAuthenticator()}
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
    </div>
  );
};

export default SmartAccountPolicy;
