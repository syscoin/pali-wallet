import { getAddress } from '@ethersproject/address';
import { AddressZero } from '@ethersproject/constants';
import { Form, Input } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Card, Icon, NeutralButton } from 'components/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import {
  KeyringAccountType,
  PasskeyBackupStatus,
  PasskeySponsorMode,
} from 'types/network';
import { navigateBack } from 'utils/navigationState';
import {
  bytesToHex,
  getPasskeyAssertion,
  passkeyAssertionToProof,
  PASSKEY_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS,
  PasskeyContractSponsorMode,
  passkeySmartAccountInterface,
  signAndSubmitPasskeyExecutions,
} from 'utils/passkey';
import { isValidSponsorServiceUrl } from 'utils/passkey/sponsorUrl';

const policyRows = [
  PasskeySponsorMode.Disabled,
  PasskeySponsorMode.GasOnly,
  PasskeySponsorMode.Required,
];

const contractModeByPolicy = {
  [PasskeySponsorMode.Disabled]: PasskeyContractSponsorMode.None,
  [PasskeySponsorMode.GasOnly]: PasskeyContractSponsorMode.GasOnly,
  [PasskeySponsorMode.Required]: PasskeyContractSponsorMode.Required,
};

const scrollAreaClassName =
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-240px)] flex-col gap-4 overflow-y-auto pb-36 text-left';

const configuredShortRecoveryDelaySeconds = Number(
  process.env.PASSKEY_GUARDIAN_SHORT_RECOVERY_DELAY_SECONDS || 0
);
const firstRecoveryDelayOptionSeconds =
  Number.isFinite(configuredShortRecoveryDelaySeconds) &&
  configuredShortRecoveryDelaySeconds > 0
    ? Math.floor(configuredShortRecoveryDelaySeconds)
    : PASSKEY_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS;

const recoveryDelayOptions = [
  {
    labelKey: 'settings.passkeyGuardianRecoveryDelayOneDay',
    seconds: firstRecoveryDelayOptionSeconds,
  },
  {
    labelKey: 'settings.passkeyGuardianRecoveryDelayThreeDays',
    seconds: PASSKEY_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS * 3,
  },
  {
    labelKey: 'settings.passkeyGuardianRecoveryDelaySevenDays',
    seconds: PASSKEY_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS * 7,
  },
];

type PolicyStep = 'idle' | 'preparing' | 'approval' | 'confirming' | 'saving';

type GuardianRecoveryStatus = {
  delay: string;
  exists: boolean;
  guardianCount: string;
  guardians: string[];
  pending: {
    credentialIdHash: string;
    readyAt: string;
    recoveryNonce: string;
  } | null;
  threshold: string;
} | null;

const PasskeyAccountPolicy = () => {
  const location = useLocation();
  const { state } = location;
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const [form] = Form.useForm();
  const accounts = useSelector(
    (rootState: RootState) => rootState.vault.accounts
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [policyMode, setPolicyMode] = useState<PasskeySponsorMode>(
    state?.passkey?.sponsor?.mode || PasskeySponsorMode.Disabled
  );
  const [sponsorUrl, setSponsorUrl] = useState<string>(
    state?.passkey?.sponsor?.url || ''
  );
  const [sponsorSigner, setSponsorSigner] = useState<string>(
    state?.passkey?.sponsor?.signer || ''
  );
  const [backupStatus, setBackupStatus] = useState<
    PasskeyBackupStatus | undefined
  >(state?.passkey?.backupStatus);
  const [policyStep, setPolicyStep] = useState<PolicyStep>('idle');
  const [guardianLoading, setGuardianLoading] = useState<boolean>(false);
  const [guardianStatus, setGuardianStatus] =
    useState<GuardianRecoveryStatus>(null);
  const [recoveryDelay, setRecoveryDelay] = useState<number>(
    recoveryDelayOptions[0].seconds
  );
  const [confirmedRecoveryDelay, setConfirmedRecoveryDelay] = useState<
    number | null
  >(null);
  const [guardianAddress, setGuardianAddress] = useState<string>('');
  const [refreshingStatus, setRefreshingStatus] = useState<boolean>(false);

  const normalizeSponsorSignerInput = (value: string) => {
    try {
      return value.trim() ? getAddress(value.trim()).toLowerCase() : '';
    } catch {
      return '';
    }
  };

  const getWalletAccountByAddress = (value: string) => {
    const normalizedValue = normalizeSponsorSignerInput(value);
    if (!normalizedValue) return null;

    for (const [accountType, accountsByType] of Object.entries(accounts)) {
      for (const account of Object.values(accountsByType || {}) as any[]) {
        try {
          if (
            account?.address &&
            getAddress(account.address).toLowerCase() === normalizedValue
          ) {
            return { account, accountType: accountType as KeyringAccountType };
          }
        } catch {
          // Ignore malformed stored addresses when validating the typed input.
        }
      }
    }

    return null;
  };

  const isSponsorSignerPasskeyAccount = (value: string) =>
    getWalletAccountByAddress(value)?.accountType ===
    KeyringAccountType.PasskeySmartAccount;

  const isLocalSponsorSigner = (value: string) => {
    const normalizedValue = normalizeSponsorSignerInput(value);
    if (!normalizedValue) return false;

    return [
      KeyringAccountType.HDAccount,
      KeyringAccountType.Imported,
      KeyringAccountType.Ledger,
      KeyringAccountType.Trezor,
    ].some((accountType) =>
      Object.values(accounts[accountType] || {}).some(
        (account: any) =>
          account?.address &&
          getAddress(account.address).toLowerCase() === normalizedValue
      )
    );
  };

  const trimmedSponsorUrl = sponsorUrl.trim();
  const trimmedSponsorSigner = sponsorSigner.trim();
  const initialSponsorMode =
    state?.passkey?.sponsor?.mode || PasskeySponsorMode.Disabled;
  const initialSponsorUrl = state?.passkey?.sponsor?.url || '';
  const initialSponsorSigner = state?.passkey?.sponsor?.signer || '';
  const policyHasChanges =
    policyMode !== initialSponsorMode ||
    (policyMode !== PasskeySponsorMode.Disabled &&
      (trimmedSponsorUrl !== initialSponsorUrl ||
        trimmedSponsorSigner !== initialSponsorSigner));
  const isSponsorUrlValid =
    !trimmedSponsorUrl || isValidSponsorServiceUrl(trimmedSponsorUrl);
  const normalizedSponsorSigner =
    normalizeSponsorSignerInput(trimmedSponsorSigner);
  const isSponsorSignerValid = Boolean(trimmedSponsorSigner)
    ? Boolean(normalizedSponsorSigner) &&
      !isSponsorSignerPasskeyAccount(trimmedSponsorSigner)
    : false;
  const sponsorUrlRequired =
    policyMode === PasskeySponsorMode.GasOnly ||
    (policyMode === PasskeySponsorMode.Required &&
      isSponsorSignerValid &&
      !isLocalSponsorSigner(trimmedSponsorSigner));
  const isPolicySubmitDisabled =
    loading ||
    guardianLoading ||
    !policyHasChanges ||
    (sponsorUrlRequired && !trimmedSponsorUrl) ||
    (policyMode === PasskeySponsorMode.Required &&
      (!trimmedSponsorSigner || !isSponsorSignerValid || !isSponsorUrlValid));
  const hasKnownBackupStatus = Boolean(backupStatus);
  const isBusy = loading || guardianLoading || refreshingStatus;
  const guardianConnected = Boolean(guardianStatus?.exists);
  const guardianPending = Boolean(guardianStatus?.pending);
  const hasRecoveryDelayChanges =
    confirmedRecoveryDelay === null || recoveryDelay !== confirmedRecoveryDelay;
  const normalizedGuardianAddress =
    normalizeSponsorSignerInput(guardianAddress);
  const guardianAddressError = (() => {
    if (!guardianAddress.trim()) return '';
    if (!normalizedGuardianAddress) {
      return t('settings.invalidPasskeyGuardianAddress');
    }
    return '';
  })();
  const isGuardianAddressValid =
    Boolean(normalizedGuardianAddress) && !guardianAddressError;
  const guardianAddressValidateStatus = guardianAddress.trim()
    ? guardianAddressError
      ? 'error'
      : 'success'
    : undefined;

  useEffect(() => {
    if (policyMode === PasskeySponsorMode.Required && !trimmedSponsorUrl) {
      form.setFields([{ name: 'sponsorUrl', errors: [] }]);
    }
  }, [form, policyMode, trimmedSponsorUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!state?.address || !state?.passkey?.isDeployed) {
      setGuardianStatus(null);
      setConfirmedRecoveryDelay(null);
      return () => {
        cancelled = true;
      };
    }

    controllerEmitter(
      ['wallet', 'getPasskeyGuardianRecoveryStatus'],
      [{ account: state.address }],
      300000
    )
      .then((status) => {
        if (!cancelled) {
          const nextGuardianStatus = status as GuardianRecoveryStatus;
          setGuardianStatus(nextGuardianStatus);
          if (nextGuardianStatus?.delay) {
            const nextRecoveryDelay = Number(nextGuardianStatus.delay);
            setRecoveryDelay(nextRecoveryDelay);
            setConfirmedRecoveryDelay(nextRecoveryDelay);
          } else {
            setConfirmedRecoveryDelay(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuardianStatus(null);
          setConfirmedRecoveryDelay(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controllerEmitter, state?.address, state?.passkey?.isDeployed]);

  const navigateBackWithUpdatedSponsor = (
    sponsor: {
      mode: PasskeySponsorMode;
      signer?: string;
      url?: string;
    } | null
  ) => {
    const updatedState = {
      ...state,
      passkey: {
        ...state.passkey,
        sponsor,
      },
    };
    const returnContext = state.returnContext
      ? {
          ...state.returnContext,
          state: updatedState,
        }
      : undefined;

    navigateBack(navigate, {
      state: {
        ...state,
        returnContext,
      },
    });
  };

  const policyCopy = {
    [PasskeySponsorMode.Disabled]: {
      title: t('settings.passkeyPolicy.disabled.title'),
      description: t('settings.passkeyPolicy.disabled.description'),
    },
    [PasskeySponsorMode.GasOnly]: {
      title: t('settings.passkeyPolicy.gasOnly.title'),
      description: t('settings.passkeyPolicy.gasOnly.description'),
    },
    [PasskeySponsorMode.Required]: {
      title: t('settings.passkeyPolicy.required.title'),
      description: t('settings.passkeyPolicy.required.description'),
    },
  };

  const savePolicy = async () => {
    let formValues: { sponsorSigner?: string; sponsorUrl?: string };
    try {
      formValues = await form.validateFields();
    } catch {
      return;
    }

    setLoading(true);
    setPolicyStep('preparing');

    try {
      if (!state?.address || !state?.passkey) {
        throw new Error('Passkey account metadata is unavailable');
      }

      const submittedSponsorUrl = (formValues.sponsorUrl || '').trim();
      const submittedSponsorSigner = (formValues.sponsorSigner || '').trim();
      let normalizedSigner = '';
      if (submittedSponsorSigner) {
        normalizedSigner = getAddress(submittedSponsorSigner);
      }

      const sponsor =
        policyMode === PasskeySponsorMode.Disabled
          ? { mode: PasskeySponsorMode.Disabled }
          : {
              mode: policyMode,
              ...(normalizedSigner ? { signer: normalizedSigner } : {}),
              ...(submittedSponsorUrl ? { url: submittedSponsorUrl } : {}),
            };
      const contractSponsorSigner =
        policyMode === PasskeySponsorMode.Disabled
          ? AddressZero
          : normalizedSigner || AddressZero;
      const contractSponsorUrl =
        policyMode === PasskeySponsorMode.Disabled ? '' : submittedSponsorUrl;
      const data = passkeySmartAccountInterface.encodeFunctionData(
        'setSponsor',
        [
          contractModeByPolicy[policyMode],
          contractSponsorSigner,
          contractSponsorUrl,
        ]
      );

      if (!state.passkey.isDeployed) {
        throw new Error(t('settings.passkeyAccountNotOnchain'));
      }
      if (!hasRecoveryDelayChanges) {
        return;
      }

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [state.id, KeyringAccountType.PasskeySmartAccount],
        300000
      );
      const execution = {
        target: state.address,
        value: '0x0',
        data,
      };
      await signAndSubmitPasskeyExecutions({
        confirmedSponsor: sponsor,
        controllerEmitter,
        credentialId: state.passkey.credentialId,
        executions: [execution],
        onAssertionResolved: () => setPolicyStep('confirming'),
        onPrepared: () => setPolicyStep('approval'),
        waitForConfirmation: true,
      });

      setPolicyStep('saving');
      alert.success(t('settings.passkeyPolicyUpdated'));
      navigateBackWithUpdatedSponsor(sponsor);
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('send.cantCompleteTxs'));
      }
    } finally {
      setLoading(false);
      setPolicyStep('idle');
    }
  };

  const refreshPasskeyStatus = async () => {
    setRefreshingStatus(true);

    try {
      if (state?.id === null || state?.id === undefined || !state?.passkey) {
        throw new Error('Passkey account metadata is unavailable');
      }

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const assertion = await getPasskeyAssertion(
        state.passkey.credentialId,
        bytesToHex(challenge)
      );
      const updatedStatus = (await controllerEmitter(
        ['wallet', 'updatePasskeyBackupStatus'],
        [state.id, assertion.backupStatus],
        300000
      )) as PasskeyBackupStatus;

      setBackupStatus(updatedStatus);
      alert.success(t('settings.passkeyStatusUpdated'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('settings.passkeyStatusRefreshFailed'));
      }
    } finally {
      setRefreshingStatus(false);
    }
  };

  const connectGuardianRecovery = async () => {
    setGuardianLoading(true);

    try {
      if (
        state?.id === null ||
        state?.id === undefined ||
        !state?.address ||
        !state?.passkey
      ) {
        throw new Error('Passkey account metadata is unavailable');
      }
      if (!state.passkey.isDeployed) {
        throw new Error(t('settings.passkeyAccountNotOnchain'));
      }
      if (!isGuardianAddressValid || !normalizedGuardianAddress) {
        throw new Error(
          guardianAddressError || t('settings.passkeyGuardianRequired')
        );
      }
      const guardian = getAddress(normalizedGuardianAddress);

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [state.id, KeyringAccountType.PasskeySmartAccount],
        300000
      );
      const prepared = (await controllerEmitter(
        ['wallet', 'preparePasskeyGuardianRegistration'],
        [{ guardian, recoveryDelay, threshold: 1 }],
        300000
      )) as any;
      const assertion = await getPasskeyAssertion(
        state.passkey.credentialId,
        prepared.actionHash
      );
      await controllerEmitter(
        ['wallet', 'submitPasskeyGuardianPolicyTransaction'],
        [
          {
            actionHash: prepared.actionHash,
            execution: prepared.execution,
            executions: prepared.executions,
            proof: passkeyAssertionToProof(assertion),
          },
        ],
        300000
      );
      const status = (await controllerEmitter(
        ['wallet', 'getPasskeyGuardianRecoveryStatus'],
        [{ account: state.address }],
        300000
      )) as GuardianRecoveryStatus;
      setGuardianStatus(status);
      if (status?.delay) {
        const nextRecoveryDelay = Number(status.delay);
        setRecoveryDelay(nextRecoveryDelay);
        setConfirmedRecoveryDelay(nextRecoveryDelay);
      }

      alert.success(t('settings.passkeyGuardianRecoveryConnected'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          error?.message || t('settings.passkeyGuardianRecoveryConnectFailed')
        );
      }
    } finally {
      setGuardianLoading(false);
    }
  };

  const updateGuardianRecoveryPolicy = async () => {
    setGuardianLoading(true);

    try {
      if (
        state?.id === null ||
        state?.id === undefined ||
        !state?.address ||
        !state?.passkey
      ) {
        throw new Error('Passkey account metadata is unavailable');
      }
      if (!state.passkey.isDeployed) {
        throw new Error(t('settings.passkeyAccountNotOnchain'));
      }

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [state.id, KeyringAccountType.PasskeySmartAccount],
        300000
      );
      const prepared = (await controllerEmitter(
        ['wallet', 'preparePasskeyGuardianPolicyUpdate'],
        [{ recoveryDelay }],
        300000
      )) as any;
      const assertion = await getPasskeyAssertion(
        state.passkey.credentialId,
        prepared.actionHash
      );
      await controllerEmitter(
        ['wallet', 'submitPasskeyGuardianPolicyTransaction'],
        [
          {
            actionHash: prepared.actionHash,
            execution: prepared.execution,
            executions: prepared.executions,
            proof: passkeyAssertionToProof(assertion),
          },
        ],
        300000
      );
      const status = (await controllerEmitter(
        ['wallet', 'getPasskeyGuardianRecoveryStatus'],
        [{ account: state.address }],
        300000
      )) as GuardianRecoveryStatus;
      setGuardianStatus(status);
      if (status?.delay) {
        const nextRecoveryDelay = Number(status.delay);
        setRecoveryDelay(nextRecoveryDelay);
        setConfirmedRecoveryDelay(nextRecoveryDelay);
      }

      alert.success(t('settings.passkeyGuardianRecoveryPolicyUpdated'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          error?.message ||
            t('settings.passkeyGuardianRecoveryPolicyUpdateFailed')
        );
      }
    } finally {
      setGuardianLoading(false);
    }
  };

  const disableGuardianRecovery = async () => {
    setGuardianLoading(true);

    try {
      if (
        state?.id === null ||
        state?.id === undefined ||
        !state?.address ||
        !state?.passkey
      ) {
        throw new Error('Passkey account metadata is unavailable');
      }
      if (!state.passkey.isDeployed) {
        throw new Error(t('settings.passkeyAccountNotOnchain'));
      }

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [state.id, KeyringAccountType.PasskeySmartAccount],
        300000
      );
      const prepared = (await controllerEmitter(
        ['wallet', 'preparePasskeyGuardianRemoval'],
        [{}],
        300000
      )) as any;
      const assertion = await getPasskeyAssertion(
        state.passkey.credentialId,
        prepared.actionHash
      );
      await controllerEmitter(
        ['wallet', 'submitPasskeyGuardianPolicyTransaction'],
        [
          {
            actionHash: prepared.actionHash,
            execution: prepared.execution,
            executions: prepared.executions,
            proof: passkeyAssertionToProof(assertion),
          },
        ],
        300000
      );
      const status = (await controllerEmitter(
        ['wallet', 'getPasskeyGuardianRecoveryStatus'],
        [{ account: state.address }],
        300000
      )) as GuardianRecoveryStatus;
      setGuardianStatus(status);

      alert.success(t('settings.passkeyGuardianRecoveryDisabled'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          error?.message || t('settings.passkeyGuardianRecoveryDisableFailed')
        );
      }
    } finally {
      setGuardianLoading(false);
    }
  };

  return (
    <>
      <Form
        form={form}
        component={false}
        initialValues={{
          sponsorUrl,
          sponsorSigner,
        }}
      >
        <div className={scrollAreaClassName}>
          <p className="text-left text-white text-sm">
            {t('settings.passkeyAccountPolicyDescription')}
          </p>

          <div className="px-1">
            <Card type="info">
              <p className="text-brand-yellowInfo text-sm font-normal text-left">
                {t('settings.passkeyPolicyOnchainNotice')}
              </p>
            </Card>
          </div>

          <div
            className={`rounded-lg border bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight ${
              hasKnownBackupStatus
                ? 'border-warning-success'
                : 'border-brand-yellowInfo'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  isSvg={hasKnownBackupStatus}
                  name={hasKnownBackupStatus ? 'greenCheck' : 'warning'}
                  className={`shrink-0 ${
                    hasKnownBackupStatus ? 'h-4 w-4' : 'text-brand-yellowInfo'
                  }`}
                  size={hasKnownBackupStatus ? undefined : 18}
                />
                <p className="font-medium text-white">
                  {t('settings.passkeyStatusTitle')}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-1 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white focus:border-brand-blue100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-brand-blue500 disabled:hover:bg-opacity-20 disabled:hover:text-brand-blue100"
                disabled={isBusy}
                onClick={refreshPasskeyStatus}
              >
                {t('settings.refreshPasskeyStatus')}
              </button>
            </div>
            <div
              className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                hasKnownBackupStatus
                  ? 'bg-brand-blue600 text-white'
                  : 'bg-alpha-whiteAlpha100 text-brand-yellowInfo'
              }`}
            >
              {backupStatus
                ? t(`settings.passkeyBackupStatus.${backupStatus}`)
                : t('settings.passkeyBackupStatus.unavailable')}
            </div>
            <p className="mt-3 leading-5">
              {t('settings.passkeyStatusRefreshDescription')}
            </p>
          </div>

          <div className="rounded-lg border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-white">
                  {t('settings.passkeyGuardianRecoveryTitle')}
                </p>
                <p className="mt-2 leading-5">
                  {t('settings.passkeyGuardianRecoveryDescription')}
                </p>
                <span
                  className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                    guardianConnected
                      ? 'bg-brand-blue600 text-white'
                      : 'bg-alpha-whiteAlpha100 text-brand-yellowInfo'
                  }`}
                >
                  {guardianPending
                    ? t('settings.passkeyGuardianRecoveryPending')
                    : guardianConnected
                    ? t('settings.passkeyGuardianRecoveryConnectedStatus')
                    : t('settings.passkeyGuardianRecoveryNotConnected')}
                </span>
                {guardianPending && guardianStatus?.pending?.readyAt && (
                  <p className="mt-2 leading-5 text-brand-yellowInfo">
                    {t('settings.passkeyGuardianRecoveryReadyAt', {
                      time: new Date(
                        Number(guardianStatus.pending.readyAt) * 1000
                      ).toLocaleString(),
                    })}
                  </p>
                )}
                {guardianConnected && (
                  <p className="mt-2 leading-5">
                    {t('settings.passkeyGuardianRecoveryPolicySummary', {
                      delay:
                        recoveryDelayOptions.find(
                          (option) => option.seconds === recoveryDelay
                        )?.seconds === recoveryDelay
                          ? t(
                              recoveryDelayOptions.find(
                                (option) => option.seconds === recoveryDelay
                              )!.labelKey
                            )
                          : `${Math.round(recoveryDelay / 86400)} days`,
                      guardianCount: guardianStatus?.guardianCount || '1',
                      threshold: guardianStatus?.threshold || '1',
                    })}
                  </p>
                )}
                {!guardianConnected && (
                  <Form.Item
                    className="mb-0 mt-3"
                    hasFeedback
                    help={guardianAddressError}
                    validateStatus={guardianAddressValidateStatus}
                  >
                    <Input
                      type="text"
                      disabled={isBusy}
                      placeholder={t('settings.passkeyGuardianAddress')}
                      className="custom-input-normal passkey-input relative"
                      value={guardianAddress}
                      onChange={(event) =>
                        setGuardianAddress(event.target.value)
                      }
                    />
                  </Form.Item>
                )}
                <div className="mt-3">
                  <p className="mb-2 font-medium text-white">
                    {t('settings.passkeyGuardianRecoveryDelayTitle')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recoveryDelayOptions.map((option) => (
                      <button
                        key={option.seconds}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 ${
                          recoveryDelay === option.seconds
                            ? 'border-brand-blue500 bg-brand-blue600 text-white'
                            : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 text-brand-graylight hover:bg-brand-blue500 hover:bg-opacity-20'
                        }`}
                        disabled={isBusy}
                        onClick={() => setRecoveryDelay(option.seconds)}
                      >
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  className="rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-1 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white focus:border-brand-blue100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-brand-blue500 disabled:hover:bg-opacity-20 disabled:hover:text-brand-blue100"
                  disabled={
                    isBusy ||
                    (guardianConnected && !hasRecoveryDelayChanges) ||
                    (!guardianConnected && !isGuardianAddressValid)
                  }
                  onClick={
                    guardianConnected
                      ? updateGuardianRecoveryPolicy
                      : connectGuardianRecovery
                  }
                >
                  {guardianConnected
                    ? t('settings.passkeyGuardianRecoveryUpdate')
                    : t('settings.passkeyGuardianRecoveryConnect')}
                </button>
                {guardianConnected && (
                  <button
                    type="button"
                    className="rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-1 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    onClick={disableGuardianRecovery}
                  >
                    {t('settings.passkeyGuardianRecoveryDisable')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3 text-xs text-brand-graylight">
            {policyRows.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left hover:bg-brand-blue500 hover:bg-opacity-20 ${
                  policyMode === mode
                    ? 'border-brand-blue500 bg-brand-blue600'
                    : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100'
                }`}
                disabled={isBusy}
                onClick={() => setPolicyMode(mode)}
              >
                <span
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${
                    policyMode === mode
                      ? 'border-white bg-white'
                      : 'border-brand-graylight'
                  }`}
                />
                <span>
                  <span className="block font-medium text-white">
                    {policyCopy[mode].title}
                  </span>
                  <span className="mt-1 block">
                    {policyCopy[mode].description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {policyMode !== PasskeySponsorMode.Disabled && (
            <div className="space-y-3">
              <Form.Item
                name="sponsorUrl"
                className="md:w-full mb-0 px-1"
                hasFeedback
                rules={[
                  () => ({
                    validator(_, value) {
                      const trimmedValue =
                        typeof value === 'string' ? value.trim() : '';
                      if (!trimmedValue) {
                        return sponsorUrlRequired
                          ? Promise.reject(
                              new Error(t('settings.sponsorServiceUrlRequired'))
                            )
                          : Promise.resolve();
                      }
                      if (isValidSponsorServiceUrl(trimmedValue)) {
                        return Promise.resolve();
                      }
                      return Promise.reject(
                        new Error(t('settings.invalidSponsorUrl'))
                      );
                    },
                  }),
                ]}
              >
                <Input
                  type="text"
                  disabled={isBusy}
                  placeholder={t('settings.sponsorServiceUrl')}
                  className="custom-input-normal passkey-input relative"
                  onChange={(event) => setSponsorUrl(event.target.value)}
                />
              </Form.Item>
              {policyMode === PasskeySponsorMode.Required && (
                <Form.Item
                  name="sponsorSigner"
                  className="md:w-full mb-0 px-1"
                  hasFeedback
                  rules={[
                    () => ({
                      validator(_, value) {
                        const trimmedValue =
                          typeof value === 'string' ? value.trim() : '';
                        if (!trimmedValue) {
                          return Promise.reject(
                            new Error(t('settings.sponsorSignerRequired'))
                          );
                        }
                        if (
                          normalizeSponsorSignerInput(trimmedValue) &&
                          !isSponsorSignerPasskeyAccount(trimmedValue)
                        ) {
                          return Promise.resolve();
                        }
                        return Promise.reject(
                          new Error(t('settings.invalidSponsorSignerAddress'))
                        );
                      },
                    }),
                  ]}
                >
                  <Input
                    type="text"
                    disabled={isBusy}
                    placeholder={t('settings.sponsorSignerAddress')}
                    className="custom-input-normal passkey-input relative"
                    onChange={(event) => setSponsorSigner(event.target.value)}
                  />
                </Form.Item>
              )}
            </div>
          )}

          {policyMode === PasskeySponsorMode.Required && !loading && (
            <div className="px-1">
              <Card type="info">
                <p className="text-brand-yellowInfo text-sm font-normal text-left">
                  {t('settings.passkeyPolicyRequiredWarning')}
                </p>
              </Card>
            </div>
          )}
        </div>

        <div className="w-full px-4 absolute bottom-12 md:static space-y-3">
          {(loading || guardianLoading) && (
            <Card type="info">
              <p className="text-brand-yellowInfo text-sm font-normal text-left">
                {guardianLoading
                  ? t('settings.passkeyGuardianRecoveryConnecting')
                  : t(`settings.passkeyPolicyStep.${policyStep}`)}
              </p>
            </Card>
          )}
          <NeutralButton
            type="button"
            fullWidth
            loading={loading}
            disabled={isPolicySubmitDisabled}
            onClick={savePolicy}
          >
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </Form>
    </>
  );
};

export default PasskeyAccountPolicy;
