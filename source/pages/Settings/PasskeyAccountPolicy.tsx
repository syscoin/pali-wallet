import { getAddress } from '@ethersproject/address';
import { AddressZero } from '@ethersproject/constants';
import { Form, Input } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { Card, Icon, NeutralButton } from 'components/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import {
  KeyringAccountType,
  PasskeyBackupStatus,
  PasskeySponsorMode,
} from 'types/network';
import { navigateBack } from 'utils/navigationState';
import {
  bytesToHex,
  getPasskeyAssertion,
  PasskeyContractSponsorMode,
  passkeySmartAccountInterface,
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
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-240px)] flex-col gap-4 overflow-y-auto pb-28 text-left';

const PasskeyAccountPolicy = () => {
  const location = useLocation();
  const { state } = location;
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const [form] = Form.useForm();
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
  const [isDeployed, setIsDeployed] = useState<boolean>(
    Boolean(state?.passkey?.isDeployed)
  );
  const [refreshingStatus, setRefreshingStatus] = useState<boolean>(false);

  const isValidSponsorSigner = (value: string) => {
    try {
      getAddress(value.trim());
      return true;
    } catch {
      return false;
    }
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
  const isSponsorSignerValid =
    !trimmedSponsorSigner || isValidSponsorSigner(trimmedSponsorSigner);
  const isPolicySubmitDisabled =
    loading ||
    !policyHasChanges ||
    (policyMode === PasskeySponsorMode.GasOnly &&
      (!trimmedSponsorUrl || !isSponsorUrlValid)) ||
    (policyMode === PasskeySponsorMode.Required &&
      (!trimmedSponsorUrl ||
        !isValidSponsorServiceUrl(trimmedSponsorUrl) ||
        !trimmedSponsorSigner ||
        !isSponsorSignerValid));
  const hasKnownBackupStatus = Boolean(backupStatus);

  const navigateBackWithUpdatedSponsor = (
    sponsor: {
      mode: PasskeySponsorMode;
      signer?: string;
      url?: string;
      urlHash?: string;
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

  useEffect(() => {
    let cancelled = false;

    if (state?.id === null || state?.id === undefined || !state?.passkey) {
      return undefined;
    }

    controllerEmitter(
      ['wallet', 'getPasskeyDeploymentStatus'],
      [state.id],
      300000
    )
      .then((deployed) => {
        if (!cancelled) {
          setIsDeployed(Boolean(deployed));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsDeployed(Boolean(state?.passkey?.isDeployed));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controllerEmitter, state?.id, state?.passkey]);

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

    try {
      if (!state?.address || !state?.passkey) {
        throw new Error('Passkey account metadata is unavailable');
      }

      const trimmedSponsorUrl = (formValues.sponsorUrl || '').trim();
      const trimmedSponsorSigner = (formValues.sponsorSigner || '').trim();
      let normalizedSigner = '';
      if (trimmedSponsorSigner) {
        normalizedSigner = getAddress(trimmedSponsorSigner);
      }

      const sponsor =
        policyMode === PasskeySponsorMode.Disabled
          ? { mode: PasskeySponsorMode.Disabled }
          : {
              mode: policyMode,
              ...(normalizedSigner ? { signer: normalizedSigner } : {}),
              ...(trimmedSponsorUrl ? { url: trimmedSponsorUrl } : {}),
            };
      const contractSponsorSigner =
        policyMode === PasskeySponsorMode.Disabled
          ? AddressZero
          : normalizedSigner || AddressZero;
      const contractSponsorUrl =
        policyMode === PasskeySponsorMode.Disabled ? '' : trimmedSponsorUrl;
      const data = passkeySmartAccountInterface.encodeFunctionData(
        'setSponsor',
        [
          contractModeByPolicy[policyMode],
          contractSponsorSigner,
          contractSponsorUrl,
        ]
      );

      if (!isDeployed) {
        const updatedSponsor = (await controllerEmitter(
          ['wallet', 'updatePasskeySponsorMetadata'],
          [state.id, sponsor],
          300000
        )) as any;

        alert.success(t('settings.passkeyPolicyUpdated'));
        navigateBackWithUpdatedSponsor(updatedSponsor);
        return;
      }

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [state.id, KeyringAccountType.PasskeySmartAccount],
        300000
      );
      const prepared = (await controllerEmitter(
        ['wallet', 'preparePasskeyExecution'],
        [
          {
            target: state.address,
            value: '0x0',
            data,
          },
        ],
        300000
      )) as any;
      const assertion = await getPasskeyAssertion(
        state.passkey.credentialId,
        prepared.actionHash
      );

      await controllerEmitter(
        ['wallet', 'submitPasskeyExecution'],
        [
          {
            actionHash: prepared.actionHash,
            execution: prepared.execution,
            executions: prepared.executions,
            requiresDeployment: prepared.requiresDeployment,
            proof: {
              authenticatorData: assertion.authenticatorData,
              clientDataJSON: assertion.clientDataJSON,
              challengeOffset: assertion.challengeOffset,
              originOffset: assertion.originOffset,
              r: assertion.r,
              s: assertion.s,
              typeOffset: assertion.typeOffset,
            },
            waitForConfirmation: true,
          },
        ],
        300000
      );
      const updatedSponsor = (await controllerEmitter(
        ['wallet', 'updatePasskeySponsorMetadata'],
        [state.id, sponsor],
        300000
      )) as any;

      alert.success(t('settings.passkeyPolicyUpdated'));
      navigateBackWithUpdatedSponsor(updatedSponsor);
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('send.cantCompleteTxs'));
      }
    } finally {
      setLoading(false);
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

          {isDeployed && (
            <div className="px-1">
              <Card type="info">
                <p className="text-brand-yellowInfo text-sm font-normal text-left">
                  {t('settings.passkeyPolicyOnchainNotice')}
                </p>
              </Card>
            </div>
          )}

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
                disabled={loading || refreshingStatus}
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
                disabled={loading}
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
                        return Promise.reject(
                          new Error(t('settings.sponsorServiceUrlRequired'))
                        );
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
                  disabled={loading}
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
                        if (isValidSponsorSigner(trimmedValue)) {
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
                    disabled={loading}
                    placeholder={t('settings.sponsorSignerAddress')}
                    className="custom-input-normal passkey-input relative"
                    onChange={(event) => setSponsorSigner(event.target.value)}
                  />
                </Form.Item>
              )}
            </div>
          )}

          {policyMode === PasskeySponsorMode.Required && (
            <div className="px-1">
              <Card type="info">
                <p className="text-brand-yellowInfo text-sm font-normal text-left">
                  {t('settings.passkeyPolicyRequiredWarning')}
                </p>
              </Card>
            </div>
          )}
        </div>

        <div className="w-full px-4 absolute bottom-12 md:static">
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
