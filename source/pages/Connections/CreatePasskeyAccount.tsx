import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PrimaryButton, SecondaryButton } from 'components/index';
import { useController } from 'hooks/useController';
import { useQueryData } from 'hooks/useQuery';
import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { logError } from 'utils/logger';
import { bytesToHex, createPasskeyCredential } from 'utils/passkey';

export const CreatePasskeyAccount = () => {
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { eventName, host, label, sponsor } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [useSeparatePasskey, setUseSeparatePasskey] = useState(false);
  const displayHost = host || t('connections.dappFallback');
  const requestedLabel =
    label || t('connections.passkeyDefaultLabel', { host: displayHost });
  const sponsorMode = sponsor?.mode || 'disabled';
  const isSponsorRequired = sponsorMode === 'required';
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

    try {
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
            sponsor,
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

        <div className="p-4 rounded-lg bg-brand-blue600">
          <p className="text-sm font-medium">{requestedLabel}</p>
          <p className="mt-2 text-xs text-brand-graylight">
            {t('connections.sponsorPolicy', { policy: sponsorLabel })}
          </p>
          {sponsor?.url && (
            <p className="mt-1 text-xs text-brand-graylight">
              {t('connections.sponsorUrl', { url: sponsor.url })}
            </p>
          )}
          {sponsor?.signer && (
            <p className="mt-1 break-all text-xs text-brand-graylight">
              {t('connections.sponsorSigner', { signer: sponsor.signer })}
            </p>
          )}
          {sponsor?.policyText && (
            <p className="mt-3 text-xs text-brand-graylight">
              {sponsor.policyText}
            </p>
          )}
          {isSponsorRequired && (
            <p className="mt-3 text-xs text-warning-error">
              {t('connections.sponsorRequiredWarning')}
            </p>
          )}
          <p className="mt-3 text-xs text-warning-error">
            {t('settings.passkeyPolicyLocked')}
          </p>
          <label className="mt-4 flex items-start gap-2 text-xs text-brand-graylight">
            <input
              type="checkbox"
              className="mt-1"
              checked={useSeparatePasskey}
              disabled={loading}
              onChange={(event) => setUseSeparatePasskey(event.target.checked)}
            />
            <span>
              <span className="block font-medium text-white">
                {t('settings.useSeparatePasskey')}
              </span>
              <span>{t('settings.useSeparatePasskeyDescription')}</span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex gap-3">
        <SecondaryButton type="button" fullWidth onClick={reject}>
          {t('buttons.cancel')}
        </SecondaryButton>
        <PrimaryButton
          type="button"
          fullWidth
          loading={loading}
          onClick={approve}
        >
          {t('buttons.create')}
        </PrimaryButton>
      </div>
    </div>
  );
};
