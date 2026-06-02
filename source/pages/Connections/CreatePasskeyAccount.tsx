import { getAddress } from '@ethersproject/address';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DropdownArrowSvg } from 'components/Icon/Icon';
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
  const isSponsorRequired = sponsorMode === 'required';
  const trimmedSponsorUrl =
    typeof sponsor?.url === 'string' ? sponsor.url.trim() : '';
  const trimmedSponsorSigner =
    typeof sponsor?.signer === 'string' ? sponsor.signer.trim() : '';
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
  const isCreateDisabled =
    loading ||
    !isSponsorUrlValid ||
    (isSponsorRequired &&
      (!trimmedSponsorUrl || !trimmedSponsorSigner || !isSponsorSignerValid));
  const hasSponsorDetails = Boolean(
    sponsor?.url || sponsor?.signer || sponsor?.policyText
  );
  const sponsorLabel =
    sponsorMode === 'gasOnly'
      ? t('connections.sponsorGasOnly')
      : isSponsorRequired
      ? t('connections.sponsorRequired')
      : t('connections.sponsorDisabled');

  const reject = () => {
    window.close();
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
          const recoveredAccount = (await controllerEmitter(
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

          setRecoveryMessage(t('connections.passkeyRecoveryMismatch'));
          return;
        }
      }

      if (!credential) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const passkeyName = useSeparatePasskey
          ? requestedLabel
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
    <div className="flex flex-col min-h-screen px-6 py-8 text-white bg-bkg-3">
      <div className="flex-1">
        <h1 className="mb-3 text-xl font-semibold">
          {t('connections.createPasskeyAccountTitle')}
        </h1>
        <p className="mb-6 text-sm text-brand-graylight">
          {t('connections.createPasskeyAccountDescription', {
            host: displayHost,
          })}
        </p>

        <div className="space-y-3 rounded-lg bg-brand-blue600 p-4">
          <div>
            <p className="text-sm font-medium">{requestedLabel}</p>
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
                <div className="space-y-2 rounded-md bg-alpha-whiteAlpha100 p-3 text-xs text-brand-graylight">
                  {sponsor?.url && (
                    <p>{t('connections.sponsorUrl', { url: sponsor.url })}</p>
                  )}
                  {sponsor?.signer && (
                    <p className="break-all">
                      {t('connections.sponsorSigner', {
                        signer: sponsor.signer,
                      })}
                    </p>
                  )}
                  {sponsor?.policyText && <p>{sponsor.policyText}</p>}
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
      </div>

      <div className="flex gap-3">
        <SecondaryButton type="button" fullWidth onClick={reject}>
          {t('buttons.cancel')}
        </SecondaryButton>
        <PrimaryButton
          type="button"
          fullWidth
          disabled={isCreateDisabled}
          loading={loading}
          onClick={approve}
        >
          {t('buttons.create')}
        </PrimaryButton>
      </div>
    </div>
  );
};
