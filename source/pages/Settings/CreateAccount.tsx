import { Form, Input } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { PasskeyBackupStatus, PasskeySponsorMode } from 'types/network';
import { navigateBack } from 'utils/navigationState';
import {
  bytesToHex,
  createPasskeyCredential,
  getDiscoverablePasskeyAssertion,
} from 'utils/passkey';
import { PASSKEY_FACTORY_ADDRESSES } from 'utils/passkey/contracts';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [passkeyLoading, setPasskeyLoading] = useState<boolean>(false);
  const [passkeyRecoveryLoading, setPasskeyRecoveryLoading] =
    useState<boolean>(false);
  const [sharedPasskeyExists, setSharedPasskeyExists] =
    useState<boolean>(false);
  const [sharedPasskeyBackupStatus, setSharedPasskeyBackupStatus] = useState<
    PasskeyBackupStatus | undefined
  >();
  const [showPolicyOptions, setShowPolicyOptions] = useState<boolean>(false);
  const [recoverySponsorUrl, setRecoverySponsorUrl] = useState<string>('');
  const [sponsorPolicyText, setSponsorPolicyText] = useState<string>('');
  const [sponsorSigner, setSponsorSigner] = useState<string>('');
  const [sponsorUrl, setSponsorUrl] = useState<string>('');
  const [policyMode, setPolicyMode] = useState<PasskeySponsorMode>(
    PasskeySponsorMode.Disabled
  );
  const [useSeparatePasskey, setUseSeparatePasskey] = useState<boolean>(false);
  const [accountName, setAccountName] = useState<string>('');
  const { t } = useTranslation();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { alert } = useUtils();
  const navigate = useNavigate();
  const location = useLocation();
  const activeNetwork = useSelector(
    ({ vault }: RootState) => vault.activeNetwork
  );
  const isPasskeySupported = Boolean(
    PASSKEY_FACTORY_ADDRESSES[activeNetwork.chainId]
  );
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

  useEffect(() => {
    if (!isPasskeySupported) return;

    let cancelled = false;
    controllerEmitter(['wallet', 'getPasskeyCredentialProfile'])
      .then((profile) => {
        if (!cancelled) {
          setSharedPasskeyExists(Boolean(profile));
          setSharedPasskeyBackupStatus((profile as any)?.backupStatus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSharedPasskeyExists(false);
          setSharedPasskeyBackupStatus(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controllerEmitter, isPasskeySupported]);

  const onSubmit = async ({ label }: { label?: string }) => {
    setLoading(true);

    try {
      const { address: newAddress } = (await controllerEmitter(
        ['wallet', 'createAccount'],
        [label]
      )) as any;

      setAddress(newAddress);
      setLoading(false);
    } catch (error) {
      setLoading(false);

      // Check if this is a wallet locked error and handle redirect
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        // If not a wallet locked error, just log it since the original component
        // didn't have explicit error handling UI for create account failures
        console.error('Error creating account:', error);
      }
    }
  };

  const recoverPasskeyAccounts = async () => {
    setPasskeyRecoveryLoading(true);

    try {
      await controllerEmitter(['wallet', 'assertPasskeySmartAccountSupported']);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await getDiscoverablePasskeyAssertion(
        bytesToHex(challenge)
      );
      const result = (await controllerEmitter(
        ['wallet', 'recoverPasskeySmartAccounts'],
        [
          {
            credentialId: assertion.credentialId,
            credentialIdHash: assertion.credentialIdHash,
            sponsorUrls: recoverySponsorUrl.trim()
              ? [recoverySponsorUrl.trim()]
              : [],
          },
        ],
        300000
      )) as any;

      if (result.recovered > 0) {
        const firstAccount = result.accounts?.[0];
        const profile = (await controllerEmitter([
          'wallet',
          'getPasskeyCredentialProfile',
        ])) as any;
        setAccountName(firstAccount?.label || t('settings.passkeyAccount'));
        setAddress(firstAccount?.address || '');
        setSharedPasskeyExists(true);
        setSharedPasskeyBackupStatus(profile?.backupStatus);
        alert.success(
          t('settings.passkeyAccountsRecovered', {
            count: result.recovered,
          })
        );
      } else {
        alert.error(t('settings.noPasskeyAccountsRecovered'));
      }
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('settings.failedToRecoverPasskey'));
      }
    } finally {
      setPasskeyRecoveryLoading(false);
    }
  };

  const createPasskeyAccount = async () => {
    setPasskeyLoading(true);

    try {
      if (policyMode === PasskeySponsorMode.GasOnly && !sponsorUrl.trim()) {
        alert.error(t('settings.sponsorUrlRequired'));
        return;
      }
      if (policyMode === PasskeySponsorMode.Required && !sponsorSigner.trim()) {
        alert.error(t('settings.sponsorSignerRequired'));
        return;
      }

      const label = accountName || t('settings.passkeyAccount');
      const deploymentSalt = bytesToHex(
        crypto.getRandomValues(new Uint8Array(32))
      );
      await controllerEmitter(['wallet', 'assertPasskeySmartAccountSupported']);
      let credential = useSeparatePasskey
        ? null
        : ((await controllerEmitter([
            'wallet',
            'getPasskeyCredentialProfile',
          ])) as any);
      if (!credential) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const passkeyName = useSeparatePasskey
          ? label
          : t('settings.passkeyAccount');
        const newCredential = await createPasskeyCredential({
          accountName: passkeyName,
          challengeHex: bytesToHex(challenge),
          userDisplayName: passkeyName,
        });
        const profile = {
          credentialId: newCredential.credentialId,
          credentialIdHash: newCredential.credentialIdHash,
          backupStatus: newCredential.backupStatus,
          passkeyName,
          publicKey: {
            originHash: newCredential.originHash,
            originLength: newCredential.originLength,
            rpIdHash: newCredential.rpIdHash,
            x: newCredential.x,
            y: newCredential.y,
          },
        };
        credential = useSeparatePasskey
          ? profile
          : await controllerEmitter(
              ['wallet', 'savePasskeyCredentialProfile'],
              [profile]
            );
        if (!useSeparatePasskey) {
          setSharedPasskeyExists(true);
          setSharedPasskeyBackupStatus(profile.backupStatus);
        }
      }
      const credentialPublicKey = credential.publicKey || credential;
      const prepared = (await controllerEmitter(
        ['wallet', 'preparePasskeySmartAccount'],
        [
          {
            credentialId: credential.credentialId,
            credentialIdHash: credential.credentialIdHash,
            backupStatus: credential.backupStatus,
            deploymentSalt,
            label,
            passkeyName: label,
            publicKey: {
              originHash: credentialPublicKey.originHash,
              originLength: credentialPublicKey.originLength,
              rpIdHash: credentialPublicKey.rpIdHash,
              x: credentialPublicKey.x,
              y: credentialPublicKey.y,
            },
            sponsor:
              policyMode === PasskeySponsorMode.Disabled
                ? undefined
                : {
                    mode: policyMode,
                    ...(sponsorPolicyText.trim()
                      ? { policyText: sponsorPolicyText.trim() }
                      : {}),
                    ...(sponsorSigner.trim()
                      ? { signer: sponsorSigner.trim() }
                      : {}),
                    ...(sponsorUrl.trim() ? { url: sponsorUrl.trim() } : {}),
                  },
          },
        ]
      )) as any;

      const { address: newAddress } = (await controllerEmitter(
        ['wallet', 'createPasskeySmartAccount'],
        [
          {
            address: prepared.address,
            label,
            metadata: prepared.metadata,
          },
        ]
      )) as any;

      setAccountName(label);
      setAddress(newAddress);
    } catch (error) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        console.error('Error creating passkey account:', error);
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <>
      {address ? (
        <CreatedAccountSuccessfully
          show={address !== ''}
          onClose={() => {
            setAddress('');
            navigateBack(navigate, location);
          }}
          title={t('settings.yourNewAccount')}
          phraseOne={`${accountName}`}
          phraseTwo={`${address}`}
        />
      ) : (
        <Form
          validateMessages={{ default: '' }}
          className="flex flex-col gap-8 items-center justify-center text-center md:w-full"
          name="newaccount"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
          onFinish={onSubmit}
        >
          <Form.Item
            name="label"
            className="md:w-full"
            hasFeedback
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Input
              type="text"
              className="custom-input-normal relative"
              placeholder={`${t('settings.nameYourNewAccount')} (${t(
                'settings.optional'
              )})`}
              onChange={(e) => setAccountName(e.target.value)}
              id="account-name-input"
            />
          </Form.Item>

          <div className="w-full px-4 absolute bottom-12 md:static">
            <NeutralButton
              type="submit"
              disabled={loading}
              loading={loading}
              id="create-btn"
              fullWidth
            >
              {t('buttons.create')}
            </NeutralButton>

            {isPasskeySupported && (
              <div className="mt-4 rounded-lg border border-dashed border-brand-blue500/50 p-4 text-left">
                <p className="mb-2 text-sm font-medium text-white">
                  {t('settings.createPasskeyAccount')}
                </p>
                <p className="mb-4 text-xs text-brand-graylight">
                  {t('settings.createPasskeyAccountDescription')}
                </p>
                <div className="mb-3 rounded-md bg-alpha-whiteAlpha100 p-3 text-xs text-brand-graylight">
                  <p className="font-medium text-white">
                    {sharedPasskeyExists
                      ? t('settings.sharedPasskeyReady')
                      : t('settings.sharedPasskeyWillBeCreated')}
                  </p>
                  {sharedPasskeyExists && (
                    <p className="mt-1 font-medium text-white">
                      {t(
                        `settings.passkeyBackupStatus.${
                          sharedPasskeyBackupStatus ||
                          PasskeyBackupStatus.Unavailable
                        }`
                      )}
                    </p>
                  )}
                  <p className="mt-1">
                    {t('settings.recoverPasskeyAccountsDescription')}
                  </p>
                </div>
                <div className="mb-3 rounded-md bg-alpha-whiteAlpha100 p-3 text-xs text-brand-graylight">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">
                        {policyCopy[policyMode].title}
                      </p>
                      <p className="mt-1">
                        {policyCopy[policyMode].description}
                      </p>
                      <p className="mt-2 text-warning-error">
                        {t('settings.passkeyPolicyLocked')}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-brand-blue500"
                      disabled={
                        passkeyLoading || passkeyRecoveryLoading || loading
                      }
                      onClick={() => setShowPolicyOptions(!showPolicyOptions)}
                    >
                      {showPolicyOptions
                        ? t('settings.hideAccountPolicy')
                        : t('settings.customizeAccountPolicy')}
                    </button>
                  </div>

                  {showPolicyOptions && (
                    <div className="mt-3 space-y-3">
                      {[
                        PasskeySponsorMode.Disabled,
                        PasskeySponsorMode.GasOnly,
                        PasskeySponsorMode.Required,
                      ].map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`w-full rounded-md border p-3 text-left ${
                            policyMode === mode
                              ? 'border-brand-blue500 bg-brand-blue600'
                              : 'border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100'
                          }`}
                          disabled={
                            passkeyLoading || passkeyRecoveryLoading || loading
                          }
                          onClick={() => setPolicyMode(mode)}
                        >
                          <span className="block font-medium text-white">
                            {policyCopy[mode].title}
                          </span>
                          <span className="mt-1 block">
                            {policyCopy[mode].description}
                          </span>
                        </button>
                      ))}

                      {policyMode !== PasskeySponsorMode.Disabled && (
                        <div className="space-y-3">
                          <Input
                            className="custom-input-normal"
                            placeholder={t('settings.sponsorServiceUrl')}
                            value={sponsorUrl}
                            onChange={(event) =>
                              setSponsorUrl(event.target.value)
                            }
                          />
                          {policyMode === PasskeySponsorMode.Required && (
                            <Input
                              className="custom-input-normal"
                              placeholder={t('settings.sponsorSignerAddress')}
                              value={sponsorSigner}
                              onChange={(event) =>
                                setSponsorSigner(event.target.value)
                              }
                            />
                          )}
                          <Input
                            className="custom-input-normal"
                            placeholder={t('settings.sponsorPolicyText')}
                            value={sponsorPolicyText}
                            onChange={(event) =>
                              setSponsorPolicyText(event.target.value)
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <label className="mb-3 flex items-start gap-2 text-xs text-brand-graylight">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={useSeparatePasskey}
                    disabled={
                      passkeyLoading || passkeyRecoveryLoading || loading
                    }
                    onChange={(event) =>
                      setUseSeparatePasskey(event.target.checked)
                    }
                  />
                  <span>
                    <span className="block font-medium text-white">
                      {t('settings.useSeparatePasskey')}
                    </span>
                    <span>{t('settings.useSeparatePasskeyDescription')}</span>
                  </span>
                </label>
                <NeutralButton
                  type="button"
                  disabled={passkeyLoading || passkeyRecoveryLoading || loading}
                  loading={passkeyLoading}
                  onClick={createPasskeyAccount}
                  fullWidth
                >
                  {t('settings.createPasskeyAccount')}
                </NeutralButton>
                <div className="mt-3">
                  <Input
                    className="custom-input-normal mb-3"
                    disabled={
                      passkeyLoading || passkeyRecoveryLoading || loading
                    }
                    placeholder={t('settings.sponsorServiceUrl')}
                    value={recoverySponsorUrl}
                    onChange={(event) =>
                      setRecoverySponsorUrl(event.target.value)
                    }
                  />
                  <NeutralButton
                    type="button"
                    disabled={
                      passkeyLoading || passkeyRecoveryLoading || loading
                    }
                    loading={passkeyRecoveryLoading}
                    onClick={recoverPasskeyAccounts}
                    fullWidth
                  >
                    {t('settings.recoverPasskeyAccounts')}
                  </NeutralButton>
                </div>
              </div>
            )}
          </div>
        </Form>
      )}
    </>
  );
};

export default CreateAccount;
