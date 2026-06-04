import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { DropdownArrowSvg } from 'components/Icon/Icon';
import { Card, Icon, NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { PasskeyBackupStatus } from 'types/network';
import { navigateBack } from 'utils/navigationState';
import {
  bytesToHex,
  createPasskeyCredential,
  getPasskeyAssertion,
} from 'utils/passkey';

type LocationState = {
  initialLabel?: string;
};

type CreationStep =
  | 'idle'
  | 'credential'
  | 'deploying'
  | 'confirming'
  | 'saving';

const scrollAreaClassName =
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto pb-36 text-left';

const disclosureButtonClassName =
  'flex w-full cursor-pointer items-center justify-between rounded-lg bg-alpha-whiteAlpha100 px-4 py-4 text-left hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60';

const Chevron = ({ open }: { open: boolean }) => (
  <DropdownArrowSvg
    isOpen={open}
    className="ml-3 shrink-0 text-brand-blue500"
  />
);

const CreatePasskeyAccount = () => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state || {}) as LocationState;

  const [address, setAddress] = useState<string | undefined>();
  const accountName =
    locationState.initialLabel || t('settings.passkeyAccount');
  const [loading, setLoading] = useState<boolean>(false);
  const [sharedPasskeyExists, setSharedPasskeyExists] =
    useState<boolean>(false);
  const [sharedPasskeyBackupStatus, setSharedPasskeyBackupStatus] = useState<
    PasskeyBackupStatus | undefined
  >();
  const [creationStep, setCreationStep] = useState<CreationStep>('idle');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [useSeparatePasskey, setUseSeparatePasskey] = useState<boolean>(false);

  useEffect(() => {
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
  }, [controllerEmitter]);

  const createPasskeyAccount = async () => {
    setLoading(true);
    setCreationStep('credential');

    try {
      const label = accountName;
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
        if (!useSeparatePasskey) {
          setSharedPasskeyExists(true);
          setSharedPasskeyBackupStatus(profile.backupStatus);
        }
      }

      const credentialPublicKey = credential.publicKey || credential;
      setCreationStep('deploying');
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
          },
        ]
      )) as any;
      let deploymentProof;
      if (prepared.deploymentActionHash) {
        const assertion = await getPasskeyAssertion(
          credential.credentialId,
          prepared.deploymentActionHash
        );
        deploymentProof = {
          authenticatorData: assertion.authenticatorData,
          clientDataJSON: assertion.clientDataJSON,
          challengeOffset: assertion.challengeOffset,
          originOffset: assertion.originOffset,
          r: assertion.r,
          s: assertion.s,
          typeOffset: assertion.typeOffset,
        };
      }

      setCreationStep('confirming');
      const { address: newAddress } = (await controllerEmitter(
        ['wallet', 'createPasskeySmartAccount'],
        [
          {
            address: prepared.address,
            deploymentActionHash: prepared.deploymentActionHash,
            deploymentExecutions: prepared.deploymentExecutions,
            deploymentProof,
            label,
            metadata: prepared.metadata,
          },
        ]
      )) as any;

      setCreationStep('saving');
      setAddress(newAddress);
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('send.cantCompleteTxs'));
      }
    } finally {
      setLoading(false);
      setCreationStep('idle');
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
        <>
          <div className={scrollAreaClassName}>
            <p className="text-left text-white text-sm">
              {t('settings.createPasskeyAccountDescription')}
            </p>

            <div className="rounded-lg bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
              <p className="font-medium text-white">{accountName}</p>
              <p className="mt-1">{t('settings.passkeyAccountNameHint')}</p>
            </div>

            {sharedPasskeyExists && (
              <div className="rounded-lg border border-warning-success bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
                <div className="flex items-start gap-3">
                  <Icon
                    isSvg
                    name="greenCheck"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <div>
                    <p className="font-medium text-white">
                      {t('settings.sharedPasskeyReady')}
                    </p>
                    <p className="mt-1">
                      {t('settings.sharedPasskeyReadyDescription')}
                    </p>
                    {sharedPasskeyBackupStatus && (
                      <span className="mt-3 inline-flex rounded-full bg-brand-blue600 px-3 py-1 text-xs font-medium text-white">
                        {t(
                          `settings.passkeyBackupStatus.${sharedPasskeyBackupStatus}`
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="text-xs text-brand-graylight">
              <button
                type="button"
                className={disclosureButtonClassName}
                disabled={loading}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span>
                  <span className="block text-sm font-medium text-white">
                    {t('generalMenu.advanced')}
                  </span>
                  <span className="mt-1 block">
                    {useSeparatePasskey
                      ? t('settings.useSeparatePasskey')
                      : t('settings.passkeyPolicy.disabled.title')}
                  </span>
                </span>
                <Chevron open={showAdvanced} />
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 rounded-lg bg-alpha-whiteAlpha100 p-4">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-brand-blue500 hover:bg-opacity-20">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                      checked={useSeparatePasskey}
                      disabled={loading}
                      onChange={(event) =>
                        setUseSeparatePasskey(event.target.checked)
                      }
                    />
                    <span className="text-sm">
                      <span className="font-medium text-white">
                        {t('settings.useSeparatePasskey')}
                      </span>
                    </span>
                  </label>
                  {useSeparatePasskey && (
                    <div className="px-1">
                      <Card type="info">
                        <p className="text-brand-yellowInfo text-sm font-normal text-left">
                          {t('settings.useSeparatePasskeyDescription')}
                        </p>
                      </Card>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="w-full px-4 absolute bottom-12 md:static space-y-3">
            {loading && (
              <Card type="info">
                <p className="text-brand-yellowInfo text-sm font-normal text-left">
                  {t(`settings.passkeyCreationStep.${creationStep}`)}
                </p>
              </Card>
            )}
            <NeutralButton
              type="button"
              disabled={loading}
              loading={loading}
              onClick={createPasskeyAccount}
              fullWidth
            >
              {t('settings.createPasskeyAccount')}
            </NeutralButton>
          </div>
        </>
      )}
    </>
  );
};

export default CreatePasskeyAccount;
