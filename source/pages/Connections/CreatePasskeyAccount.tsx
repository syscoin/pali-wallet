import { getAddress } from '@ethersproject/address';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DropdownArrowSvg, Icon } from 'components/Icon/Icon';
import { Card, PrimaryButton, SecondaryButton } from 'components/index';
import { useController } from 'hooks/useController';
import { useQueryData } from 'hooks/useQuery';
import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { logError } from 'utils/logger';
import {
  bytesToHex,
  createPasskeyCredential,
  getDiscoverablePasskeyAssertion,
} from 'utils/passkey';
import { isValidSponsorServiceUrl } from 'utils/passkey/sponsorUrl';

const decodeDappText = (value?: unknown) => {
  if (typeof value !== 'string') {
    return '';
  }
  if (typeof document === 'undefined') {
    return value.trim();
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value.trim();
};

export const CreatePasskeyAccount = () => {
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { eventName, host, label, sponsor } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [useSeparatePasskey, setUseSeparatePasskey] = useState(false);
  const displayHost = host || t('connections.dappFallback');
  const requestedLabel =
    label || t('connections.passkeyDefaultLabel', { host: displayHost });
  const sponsorMode = sponsor?.mode || 'disabled';
  const hasSponsorPolicy = sponsorMode !== 'disabled';
  const isSponsorRequired = sponsorMode === 'required';
  const trimmedSponsorUrl = hasSponsorPolicy
    ? decodeDappText(sponsor?.url)
    : '';
  const trimmedSponsorSigner = hasSponsorPolicy
    ? decodeDappText(sponsor?.signer)
    : '';
  const policyText = hasSponsorPolicy
    ? decodeDappText(sponsor?.policyText)
    : '';
  const policyDescription =
    policyText ||
    t('connections.createPasskeyAccountDescription', {
      host: displayHost,
    });
  const isSponsorUrlValid =
    !trimmedSponsorUrl || isValidSponsorServiceUrl(trimmedSponsorUrl);
  const isSponsorSignerValid = (() => {
    if (!trimmedSponsorSigner) {
      return false;
    }
    try {
      getAddress(trimmedSponsorSigner);
      return true;
    } catch {
      return false;
    }
  })();
  const sponsorSignerError =
    isSponsorRequired && !trimmedSponsorSigner
      ? t('settings.sponsorSignerRequired')
      : trimmedSponsorSigner && !isSponsorSignerValid
      ? t('settings.invalidSponsorSignerAddress')
      : '';
  const sponsorUrlError =
    trimmedSponsorUrl && !isSponsorUrlValid
      ? t('settings.invalidSponsorUrl')
      : '';
  const isCreateDisabled =
    loading || Boolean(sponsorUrlError || sponsorSignerError);
  const hasSponsorDetails =
    hasSponsorPolicy && Boolean(trimmedSponsorUrl || trimmedSponsorSigner);
  const sponsorLabel =
    sponsorMode === 'gasOnly'
      ? t('connections.sponsorGasOnly')
      : isSponsorRequired
      ? t('connections.sponsorRequired')
      : t('connections.sponsorDisabled');

  const reject = () => {
    window.close();
  };

  const isPasskeyRecoveryMismatchError = (error: any) => {
    const errorMessage = error?.message || String(error);
    return /Passkey sponsor signer does not match/i.test(errorMessage);
  };

  const approve = async () => {
    setLoading(true);
    setRecoveryMessage('');

    try {
      if (trimmedSponsorUrl && !isValidSponsorServiceUrl(trimmedSponsorUrl)) {
        throw new Error('Invalid sponsor service URL');
      }
      const preparedSponsor = sponsor ? { ...sponsor } : undefined;
      if (preparedSponsor) {
        if (trimmedSponsorUrl) {
          preparedSponsor.url = trimmedSponsorUrl;
        } else {
          delete preparedSponsor.url;
        }
        if (trimmedSponsorSigner) {
          preparedSponsor.signer = trimmedSponsorSigner;
        } else {
          delete preparedSponsor.signer;
        }
        if (policyText) {
          preparedSponsor.policyText = policyText;
        } else {
          delete preparedSponsor.policyText;
        }
        if (!hasSponsorPolicy) {
          delete preparedSponsor.policyText;
          delete preparedSponsor.signer;
          delete preparedSponsor.url;
          delete preparedSponsor.urlHash;
        }
      }
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
      if (!credential && !useSeparatePasskey) {
        let assertion: any = null;
        try {
          const challenge = crypto.getRandomValues(new Uint8Array(32));
          assertion = await getDiscoverablePasskeyAssertion(
            bytesToHex(challenge)
          );
        } catch {
          assertion = null;
        }

        if (assertion) {
          let recoveredAccount: any = null;
          try {
            recoveredAccount = (await controllerEmitter(
              ['wallet', 'recoverPasskeySmartAccountForCreate'],
              [
                {
                  backupStatus: assertion.backupStatus,
                  credentialId: assertion.credentialId,
                  credentialIdHash: assertion.credentialIdHash,
                  label: requestedLabel,
                  sponsor: preparedSponsor,
                },
              ],
              300000
            )) as any;
          } catch (error) {
            if (!isPasskeyRecoveryMismatchError(error)) {
              throw error;
            }
            setRecoveryMessage(t('connections.passkeyRecoveryMismatch'));
            return;
          }

          if (recoveredAccount) {
            await controllerEmitter(
              ['dapp', 'changeAccount'],
              [
                host,
                recoveredAccount.id,
                KeyringAccountType.PasskeySmartAccount,
              ]
            );

            dispatchBackgroundEvent(`${eventName}.${host}`, {
              address: recoveredAccount.address,
              metadata: recoveredAccount.passkey,
            });
            window.close();
            return;
          }

          credential = null;
        }
      }

      if (!credential) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const passkeyName = useSeparatePasskey
          ? requestedLabel
          : t('settings.paliWalletPasskey');
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
            label: requestedLabel,
            passkeyName: requestedLabel,
            publicKey: {
              originHash: credentialPublicKey.originHash,
              originLength: credentialPublicKey.originLength,
              rpIdHash: credentialPublicKey.rpIdHash,
              x: credentialPublicKey.x,
              y: credentialPublicKey.y,
            },
            sponsor: preparedSponsor,
          },
        ],
        300000
      )) as any;
      const account = (await controllerEmitter(
        ['wallet', 'createPasskeySmartAccount'],
        [
          {
            address: prepared.address,
            label: requestedLabel,
            metadata: prepared.metadata,
          },
        ]
      )) as any;

      await controllerEmitter(
        ['dapp', 'changeAccount'],
        [host, account.id, KeyringAccountType.PasskeySmartAccount]
      );

      dispatchBackgroundEvent(`${eventName}.${host}`, {
        address: account.address,
        metadata: account.passkey,
      });
      window.close();
    } catch (error) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        logError('Passkey account creation failed', 'UI', error);
        window.close();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        <div className="text-center px-6 py-6 border-b border-brand-gray300">
          <h3 className="text-xs text-brand-graylight uppercase tracking-wider mb-2">
            {t('connections.createPasskeyAccountTitle')}
          </h3>
          <div className="flex items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
              <Icon name="link" className="text-white" size={16} />
            </div>
            <p className="text-lg font-medium text-brand-white">
              {displayHost}
            </p>
          </div>
          <p className="text-xs text-brand-graylight mt-3">
            {policyDescription}
          </p>
        </div>

        <div className="px-6 py-6 space-y-3">
          <div>
            <p className="text-sm font-medium text-brand-white">
              {requestedLabel}
            </p>
            <p className="mt-2 text-xs text-brand-graylight">
              {t('connections.sponsorPolicy', { policy: sponsorLabel })}
            </p>
          </div>
          {isSponsorRequired && (
            <Card type="info">
              <p className="text-brand-yellowInfo text-sm font-normal text-left">
                {t('connections.sponsorRequiredWarning')}
              </p>
            </Card>
          )}
          {sponsorMode !== 'disabled' && (
            <p className="text-xs text-brand-yellowInfo">
              {t('settings.passkeyPolicyLocked')}
            </p>
          )}
          {(sponsorUrlError || sponsorSignerError) && (
            <Card type="error">
              <div className="space-y-1 text-sm font-normal text-left">
                {sponsorUrlError && <p>{sponsorUrlError}</p>}
                {sponsorSignerError && <p>{sponsorSignerError}</p>}
              </div>
            </Card>
          )}
          {recoveryMessage && (
            <Card type="info">
              <p className="text-brand-yellowInfo text-sm font-normal text-left">
                {recoveryMessage}
              </p>
            </Card>
          )}

          {hasSponsorDetails && (
            <>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-alpha-whiteAlpha300 p-3 text-left text-xs hover:bg-brand-blue500 hover:bg-opacity-20"
                disabled={loading}
                onClick={() => setShowDetails(!showDetails)}
              >
                <span className="font-medium text-white">
                  {t('settings.customizeAccountPolicy')}
                </span>
                <DropdownArrowSvg
                  isOpen={showDetails}
                  className="text-brand-blue500"
                />
              </button>

              {showDetails && (
                <div className="space-y-3 rounded-md bg-bkg-2 border border-alpha-whiteAlpha300 p-3 text-xs">
                  {trimmedSponsorUrl && (
                    <div>
                      <p className="uppercase tracking-wider text-[10px] text-brand-graylight">
                        {t('settings.sponsorServiceUrl')}
                      </p>
                      <p className="mt-1 break-all text-brand-white">
                        {trimmedSponsorUrl}
                      </p>
                    </div>
                  )}
                  {trimmedSponsorSigner && (
                    <div>
                      <p className="uppercase tracking-wider text-[10px] text-brand-graylight">
                        {t('settings.sponsorSignerAddress')}
                      </p>
                      <p
                        className={`mt-1 break-all ${
                          isSponsorSignerValid
                            ? 'text-brand-white'
                            : 'text-brand-red'
                        }`}
                      >
                        {isSponsorSignerValid
                          ? getAddress(trimmedSponsorSigner)
                          : trimmedSponsorSigner}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-alpha-whiteAlpha300 p-3 text-left text-xs hover:bg-brand-blue500 hover:bg-opacity-20"
            disabled={loading}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span className="font-medium text-white">
              {t('generalMenu.advanced')}
            </span>
            <DropdownArrowSvg
              isOpen={showAdvanced}
              className="text-brand-blue500"
            />
          </button>

          {showAdvanced && (
            <label className="flex items-start gap-2 text-xs text-brand-graylight">
              <input
                type="checkbox"
                className="mt-1"
                checked={useSeparatePasskey}
                disabled={loading}
                onChange={(event) =>
                  setUseSeparatePasskey(event.target.checked)
                }
              />
              <span>
                <span className="flex items-center gap-2 font-medium text-white">
                  {t('settings.useSeparatePasskey')}
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-brand-graylight text-[10px]"
                    title={t('settings.useSeparatePasskeyDescription')}
                  >
                    ?
                  </span>
                </span>
                <span className="mt-1 block">
                  {useSeparatePasskey
                    ? t('settings.useSeparatePasskeyDescription')
                    : ''}
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="pb-20"></div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <div className="flex gap-3 justify-center">
          <SecondaryButton type="button" onClick={reject} disabled={loading}>
            {t('buttons.cancel')}
          </SecondaryButton>
          <PrimaryButton
            type="button"
            disabled={isCreateDisabled}
            loading={loading}
            onClick={approve}
          >
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};
