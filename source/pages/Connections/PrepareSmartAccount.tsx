import { getAddress } from '@ethersproject/address';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { DropdownArrowSvg } from 'components/Icon/Icon';
import { Card, Icon, PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  IKeyringAccountState,
  KeyringAccountType,
  SmartAccountValidatorModule,
} from 'types/network';
import type { IPasskeyCredentialProfile } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  bytesToHex,
  clearPendingCreationPasskey,
  createPasskeyCredential,
  getPendingCreationPasskey,
  passkeyRegistrationToProfile,
  setActivePasskeyRecord,
  setPendingCreationPasskey,
  signalAcceptedPasskeyCredentials,
  signalUnknownPasskeyCredential,
  signP256WebAuthnActionHash,
} from 'utils/passkey';
import { encodeP256WebAuthnAuthData } from 'utils/passkey/account';
import {
  encodeEcdsaValidatorInitData,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  getPaliModuleAddress,
  PaliSmartAccountAuthenticatorSetup,
  signAndSubmitSmartAccountExecutions,
} from 'utils/smartAccount';

type PrepareSmartAccountRequest = {
  authenticator?:
    | PaliSmartAccountAuthenticatorSetup
    | { config?: any; id?: string };
  initialAuthenticator?:
    | PaliSmartAccountAuthenticatorSetup
    | { config?: any; id?: string };
  label?: string;
  policy?: {
    authenticator?:
      | PaliSmartAccountAuthenticatorSetup
      | { config?: any; id?: string };
  };
};

type PreparedAuthenticator = {
  auth: {
    data: string;
    module: SmartAccountValidatorModule['id'];
    validator: string;
  };
  module: SmartAccountValidatorModule;
  // Set when a wallet-managed passkey backs the authenticator; used to promote
  // the pending credential record once the account is fully set up.
  passkeyProfile?: IPasskeyCredentialProfile;
};

const displayNameForAuthenticator = (
  id: string | undefined,
  t: (key: string) => string
) => {
  switch (id) {
    case 'p256-webauthn':
      return t('settings.passkeyAuthenticator');
    case 'ecdsa':
      return t('settings.ecdsaAuthenticator');
    case 'composite':
      return t('settings.compositeAuthenticator');
    default:
      return id || t('settings.passkeyAuthenticator');
  }
};

const getRequestedAuthenticator = (
  request: PrepareSmartAccountRequest
): { config?: any; id: string } =>
  (request.authenticator ||
    request.initialAuthenticator ||
    request.policy?.authenticator || { id: 'p256-webauthn' }) as {
    config?: any;
    id: string;
  };

const hasP256Config = (config: any) =>
  Boolean(
    config?.credentialIdHash && config?.publicKey?.x && config?.publicKey?.y
  );

const sameAddress = (left?: string, right?: string) => {
  try {
    return Boolean(left && right && getAddress(left) === getAddress(right));
  } catch {
    return false;
  }
};

const isNativeGasRequiredError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes(
    'PALI_NATIVE_GAS_REQUIRED'
  );

const localAccountCandidates = (
  accounts: RootState['vault']['accounts']
): Array<{
  account: IKeyringAccountState;
  id: number;
  type: KeyringAccountType;
}> =>
  [
    KeyringAccountType.HDAccount,
    KeyringAccountType.Imported,
    KeyringAccountType.Ledger,
    KeyringAccountType.Trezor,
  ].flatMap((type) =>
    Object.values(accounts[type] || {}).map((account: any) => ({
      account,
      id: account.id,
      type,
    }))
  );

// Resolves the wallet-managed passkey for a new smart account. A credential
// minted by a previous interrupted attempt is recorded in the pending-creation
// slot; it is reused (after proving the user still holds it) instead of
// minting a duplicate passkey on every retry.
const resolveWalletCreationPasskey = async (
  label: string
): Promise<IPasskeyCredentialProfile> => {
  const pending = getPendingCreationPasskey();
  if (pending?.profile?.credentialId && pending.profile.passkeyName === label) {
    try {
      const possession = await signP256WebAuthnActionHash({
        actionHash: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        credentialId: pending.profile.credentialId,
        expectedCredentialIdHash: pending.profile.credentialIdHash,
        expectedPublicKey: pending.profile.publicKey,
      });
      return {
        ...pending.profile,
        ...(possession.backupStatus
          ? { backupStatus: possession.backupStatus }
          : {}),
      };
    } catch {
      // The pending credential is gone or the user declined to reuse it:
      // best-effort cleanup, then fall through to creating a fresh one.
      await signalUnknownPasskeyCredential(pending.profile.credentialId);
      clearPendingCreationPasskey();
    }
  } else if (pending?.profile?.credentialId) {
    // Orphan from a different creation flow: drop it from the credential
    // manager so it does not linger as a confusing stale entry.
    await signalUnknownPasskeyCredential(pending.profile.credentialId);
    clearPendingCreationPasskey();
  }

  const credential = await createPasskeyCredential({
    accountName: label,
    challengeHex: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    userDisplayName: label,
  });
  const profile = passkeyRegistrationToProfile(credential, label);
  // Persist before any on-chain step so a failed flow retries with the same
  // credential instead of orphaning it and minting another.
  setPendingCreationPasskey(profile);
  return profile;
};

const normalizeP256Authenticator = async ({
  chainId,
  label,
  requested,
}: {
  chainId: number;
  label: string;
  requested: { config?: any; id: string };
}): Promise<PreparedAuthenticator> => {
  const config = hasP256Config(requested.config) ? requested.config : null;
  const passkeyProfile = config
    ? undefined
    : await resolveWalletCreationPasskey(label);
  const resolvedConfig = config || {
    backupStatus: passkeyProfile?.backupStatus,
    credentialId: passkeyProfile?.credentialId,
    credentialIdHash: passkeyProfile?.credentialIdHash,
    passkeyName: label,
    publicKey: passkeyProfile?.publicKey,
  };
  const validator = getPaliModuleAddress(chainId, 'p256-webauthn');
  const data = encodeP256WebAuthnAuthData({
    ...resolvedConfig.publicKey,
    credentialIdHash: resolvedConfig.credentialIdHash,
  });

  return {
    auth: {
      data,
      module: 'p256-webauthn',
      validator,
    },
    module: {
      address: getAddress(validator),
      config: resolvedConfig,
      data,
      id: 'p256-webauthn',
      type: 'validator',
    },
    passkeyProfile,
  };
};

const normalizeEcdsaAuthenticator = ({
  chainId,
  requested,
}: {
  chainId: number;
  requested: { config?: any; id: string };
}): PreparedAuthenticator | undefined => {
  const owners = requested.config?.owners;
  if (!Array.isArray(owners) || owners.length === 0) {
    return undefined;
  }

  const normalizedOwners = owners.map((owner: string) => getAddress(owner));
  const threshold = requested.config?.threshold ?? 1;
  const validator = getPaliModuleAddress(chainId, 'ecdsa');
  const data = encodeEcdsaValidatorInitData(normalizedOwners, threshold);

  return {
    auth: {
      data,
      module: 'ecdsa',
      validator,
    },
    module: {
      address: getAddress(validator),
      config: {
        owners: normalizedOwners,
        threshold,
      },
      data,
      id: 'ecdsa',
      type: 'validator',
    },
  };
};

export const PrepareSmartAccount = () => {
  const { t } = useTranslation();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const queryData = useQueryData() as {
    eventName?: string;
    host?: string;
    request?: PrepareSmartAccountRequest;
  };
  const { accounts, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const [loading, setLoading] = useState(false);
  const [creationStep, setCreationStep] = useState<
    'credential' | 'deploying' | 'idle' | 'installing' | 'saving'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [externalEcdsaAcknowledged, setExternalEcdsaAcknowledged] =
    useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const host = queryData.host || '';
  const eventName = queryData.eventName || 'wallet_prepareSmartAccount';
  const request = queryData.request || {};
  const label = request.label || `${host || 'Pali'} Smart Account`;
  const requestedAuthenticator = useMemo(
    () => getRequestedAuthenticator(request),
    [request]
  );
  const authenticatorLabel = displayNameForAuthenticator(
    requestedAuthenticator.id,
    t
  );
  const createsWalletPasskey =
    requestedAuthenticator.id === 'p256-webauthn' &&
    !hasP256Config(requestedAuthenticator.config);
  const externalEcdsaOwners = useMemo(() => {
    if (requestedAuthenticator.id !== 'ecdsa') {
      return [];
    }
    const owners = requestedAuthenticator.config?.owners;
    if (!Array.isArray(owners)) {
      return [];
    }

    return owners
      .map((owner: string) => {
        try {
          return getAddress(owner);
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .filter(
        (owner: string) =>
          !localAccountCandidates(accounts).some(({ account }) =>
            sameAddress(account.address, owner)
          )
      );
  }, [accounts, requestedAuthenticator]);
  const hasExternalEcdsaOwners = externalEcdsaOwners.length > 0;

  const findLocalOwner = useCallback(
    (address: string) =>
      localAccountCandidates(accounts).find(({ account }) =>
        sameAddress(account.address, address)
      ),
    [accounts]
  );

  const replaceRequestedValidator = useCallback(
    async ({
      account,
      bootstrapMetadata,
      requested,
    }: {
      account: IKeyringAccountState;
      bootstrapMetadata: any;
      requested: PreparedAuthenticator;
    }) => {
      const bootstrapValidator = bootstrapMetadata.installedModules?.find(
        (module: SmartAccountValidatorModule) => module.id === 'ecdsa'
      ) as Extract<SmartAccountValidatorModule, { id: 'ecdsa' }> | undefined;
      const bootstrapOwner = bootstrapValidator?.config.owners[0];
      const localOwner = bootstrapOwner
        ? findLocalOwner(bootstrapOwner)
        : undefined;
      if (!bootstrapValidator || !bootstrapOwner || !localOwner) {
        throw new Error(t('connections.smartAccountLocalOwnerRequired'));
      }

      const replacesSameValidatorModule = sameAddress(
        bootstrapValidator.address,
        requested.auth.validator
      );
      // Re-keying the bootstrap validator module must go through the account's
      // atomic rotateValidator: a plain uninstall of the active validator is
      // rejected by the account, and installing an installed module reverts.
      const rotateExecution = {
        data: encodeRotateValidatorModuleCall(
          requested.auth.validator,
          requested.auth.data
        ),
        target: account.address,
        value: '0x0',
      };
      const installExecution = {
        data: encodeInstallValidatorModuleCall(
          requested.auth.validator,
          requested.auth.data
        ),
        target: account.address,
        value: '0x0',
      };
      const uninstallBootstrapExecution = {
        data: encodeUninstallValidatorModuleCall(bootstrapValidator.address),
        target: account.address,
        value: '0x0',
      };

      await signAndSubmitSmartAccountExecutions({
        authenticatorContexts: {
          ecdsa: {
            localOwners: [
              {
                address: getAddress(localOwner.account.address),
                id: localOwner.id,
                type: localOwner.type,
              },
            ],
            signActionHash: ({ actionHash, owner }) =>
              controllerEmitter(
                ['wallet', 'ethSignWithAccount'],
                [
                  [owner.address, actionHash],
                  { id: owner.id, type: owner.type },
                ],
                300000
              ) as Promise<string>,
          },
        },
        controllerEmitter,
        executions: replacesSameValidatorModule
          ? [rotateExecution]
          : [installExecution, uninstallBootstrapExecution],
        skipRapidPolling: true,
        smartAccount: bootstrapMetadata,
        waitForConfirmation: true,
      });
    },
    [controllerEmitter, findLocalOwner, t]
  );

  const approve = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setCreationStep('credential');

      if (requestedAuthenticator.id === 'composite') {
        throw new Error(t('connections.smartAccountCompositeUnsupported'));
      }

      const requested =
        requestedAuthenticator.id === 'p256-webauthn'
          ? await normalizeP256Authenticator({
              chainId: activeNetwork.chainId,
              label,
              requested: requestedAuthenticator,
            })
          : requestedAuthenticator.id === 'ecdsa'
          ? normalizeEcdsaAuthenticator({
              chainId: activeNetwork.chainId,
              requested: requestedAuthenticator,
            })
          : undefined;

      if (hasExternalEcdsaOwners && !externalEcdsaAcknowledged) {
        throw new Error(
          t('connections.prepareSmartAccountExternalEcdsaRequired')
        );
      }

      setCreationStep('deploying');
      const account = (await controllerEmitter(
        ['wallet', 'createSmartAccount'],
        [{ label }],
        300000
      )) as IKeyringAccountState;
      const bootstrapMetadata = account.smartAccount;
      if (!bootstrapMetadata) {
        throw new Error(t('connections.smartAccountPrepareFailed'));
      }

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [account.id, KeyringAccountType.SmartAccount, true]
      );

      if (!requested) {
        await controllerEmitter(
          ['dapp', 'connect'],
          [
            {
              accountId: account.id,
              accountType: KeyringAccountType.SmartAccount,
              chain: 'ethereum',
              chainId: activeNetwork.chainId,
              date: Date.now(),
              host,
            },
          ]
        );

        dispatchBackgroundEvent(`${eventName}.${host}`, {
          address: account.address,
          chainId: `0x${activeNetwork.chainId.toString(16)}`,
        });
        window.close();
        return;
      }

      await controllerEmitter(
        ['wallet', 'registerSmartAccountOnChain'],
        [{ accountId: account.id }],
        300000
      );
      const gasStatus = (await controllerEmitter(
        ['wallet', 'getSmartAccountNativeGasStatus'],
        [{ accountId: account.id }],
        300000
      )) as { hasNativeGas: boolean };
      if (!gasStatus.hasNativeGas) {
        throw new Error('PALI_NATIVE_GAS_REQUIRED');
      }

      setCreationStep('installing');
      await replaceRequestedValidator({
        account,
        bootstrapMetadata,
        requested,
      });
      setCreationStep('saving');
      await controllerEmitter(
        ['wallet', 'hydrateSmartAccount'],
        [account.id],
        300000
      );
      if (requested.passkeyProfile) {
        // The passkey is live on-chain: promote the pending credential to the
        // account's durable record so future rotations reuse it, and let the
        // credential manager prune anything else under this user handle.
        setActivePasskeyRecord(account.address, requested.passkeyProfile);
        clearPendingCreationPasskey();
        if (requested.passkeyProfile.userHandle) {
          await signalAcceptedPasskeyCredentials({
            credentialIds: [requested.passkeyProfile.credentialId],
            userHandle: requested.passkeyProfile.userHandle,
          });
        }
      }
      await controllerEmitter(
        ['dapp', 'connect'],
        [
          {
            accountId: account.id,
            accountType: KeyringAccountType.SmartAccount,
            chain: 'ethereum',
            chainId: activeNetwork.chainId,
            date: Date.now(),
            host,
          },
        ]
      );

      dispatchBackgroundEvent(`${eventName}.${host}`, {
        address: account.address,
        chainId: `0x${activeNetwork.chainId.toString(16)}`,
        installedValidator: requested.auth.validator,
      });
      window.close();
    } catch (err: any) {
      const wasHandled = handleWalletLockedError(err);
      if (!wasHandled) {
        setError(
          isNativeGasRequiredError(err)
            ? t('send.insufficientFundsForGas')
            : err?.message || t('connections.smartAccountPrepareFailed')
        );
      }
    } finally {
      setLoading(false);
      setCreationStep('idle');
    }
  }, [
    activeNetwork.chainId,
    controllerEmitter,
    eventName,
    externalEcdsaAcknowledged,
    handleWalletLockedError,
    hasExternalEcdsaOwners,
    host,
    label,
    replaceRequestedValidator,
    requestedAuthenticator,
    t,
  ]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="remove-scrollbar flex-1 overflow-y-auto">
        <div className="border-b border-brand-gray300 px-6 py-6 text-center">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-brand-graylight">
            {t('connections.prepareSmartAccountTitle')}
          </h3>
          <div className="flex items-center justify-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple">
              <Icon name="link" className="text-white" size={16} />
            </div>
            <p className="text-lg font-medium text-brand-white">{host}</p>
          </div>
          <p className="mt-3 text-xs text-brand-graylight">
            {t('connections.prepareSmartAccountDescription')}
          </p>
        </div>

        <div className="space-y-3 px-6 py-6">
          <div className="rounded-lg bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
            <p className="font-medium text-white">{label}</p>
            <p className="mt-1">
              {t('connections.prepareSmartAccountNetwork', {
                chainId: activeNetwork.chainId,
              })}
            </p>
            <p className="mt-1">
              {t('connections.prepareSmartAccountAuthenticator', {
                authenticator: authenticatorLabel,
              })}
            </p>
          </div>

          {requestedAuthenticator.id !== 'ecdsa' && (
            <Card type="info">
              <p className="text-left text-sm font-normal text-brand-yellowInfo">
                {t('connections.prepareSmartAccountInstallHint')}
              </p>
            </Card>
          )}

          {createsWalletPasskey && (
            <Card type="info">
              <p className="text-left text-sm font-normal text-brand-yellowInfo">
                {t('connections.prepareSmartAccountPasskeyHint')}
              </p>
            </Card>
          )}

          {hasExternalEcdsaOwners && (
            <Card type="info">
              <div className="space-y-3 text-left text-sm font-normal text-brand-yellowInfo">
                <p>
                  {t('connections.prepareSmartAccountExternalEcdsaWarning')}
                </p>
                <div className="space-y-1 break-all text-xs text-brand-graylight">
                  {externalEcdsaOwners.map((owner) => (
                    <p key={owner}>{owner}</p>
                  ))}
                </div>
                <label className="flex items-start gap-2 text-xs text-brand-white">
                  <input
                    type="checkbox"
                    checked={externalEcdsaAcknowledged}
                    disabled={loading}
                    onChange={(event) =>
                      setExternalEcdsaAcknowledged(event.target.checked)
                    }
                  />
                  <span>
                    {t('connections.prepareSmartAccountExternalEcdsaConfirm')}
                  </span>
                </label>
              </div>
            </Card>
          )}

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-alpha-whiteAlpha300 p-3 text-left text-xs hover:bg-brand-blue500 hover:bg-opacity-20"
            disabled={loading}
            onClick={() => setShowDetails(!showDetails)}
          >
            <span className="font-medium text-white">
              {showDetails
                ? t('settings.hideDetails')
                : t('settings.showDetails')}
            </span>
            <DropdownArrowSvg
              isOpen={showDetails}
              className="text-brand-blue500"
            />
          </button>

          {showDetails && (
            <div className="space-y-2 rounded-md border border-alpha-whiteAlpha300 bg-bkg-2 p-3 text-xs text-brand-graylight">
              <p>{t('connections.prepareSmartAccountDetailsKnownSigner')}</p>
              <p>{t('connections.prepareSmartAccountDetailsPasskey')}</p>
            </div>
          )}

          {error && (
            <Card type="error">
              <p className="text-left text-sm font-normal">{error}</p>
            </Card>
          )}
        </div>

        <div className="pb-32" />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-brand-gray300 bg-bkg-3 px-4 py-3 shadow-lg">
        {creationStep !== 'idle' && (
          <div className="mb-3">
            <Card type="info">
              <p className="text-left text-sm font-normal text-brand-yellowInfo">
                {creationStep === 'credential'
                  ? t('connections.prepareSmartAccountStepCredential')
                  : creationStep === 'deploying'
                  ? t('connections.prepareSmartAccountStepDeploying')
                  : creationStep === 'installing'
                  ? t('connections.prepareSmartAccountStepInstalling')
                  : t('connections.prepareSmartAccountStepSaving')}
              </p>
            </Card>
          </div>
        )}
        <div className="flex justify-center gap-3">
          <SecondaryButton
            type="button"
            onClick={() => window.close()}
            disabled={loading}
          >
            {t('buttons.cancel')}
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={approve}
            disabled={
              loading || (hasExternalEcdsaOwners && !externalEcdsaAcknowledged)
            }
            loading={loading}
          >
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};
