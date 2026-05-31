import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import { NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { navigateBack } from 'utils/navigationState';
import { bytesToHex, createPasskeyCredential } from 'utils/passkey';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [passkeyLoading, setPasskeyLoading] = useState<boolean>(false);
  const [accountName, setAccountName] = useState<string>('');
  const { t } = useTranslation();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();

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

  const createPasskeyAccount = async () => {
    setPasskeyLoading(true);

    try {
      const label = accountName || t('settings.passkeyAccount');
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const deploymentSalt = bytesToHex(
        crypto.getRandomValues(new Uint8Array(32))
      );
      const credential = await createPasskeyCredential({
        accountName: label,
        challengeHex: bytesToHex(challenge),
        userDisplayName: label,
      });
      const prepared = (await controllerEmitter(
        ['wallet', 'preparePasskeySmartAccount'],
        [
          {
            credentialId: credential.credentialId,
            credentialIdHash: credential.credentialIdHash,
            deploymentSalt,
            label,
            passkeyName: label,
            publicKey: {
              originHash: credential.originHash,
              originLength: credential.originLength,
              rpIdHash: credential.rpIdHash,
              x: credential.x,
              y: credential.y,
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

            <div className="mt-4 rounded-lg border border-dashed border-brand-blue500/50 p-4 text-left">
              <p className="mb-2 text-sm font-medium text-white">
                {t('settings.createPasskeyAccount')}
              </p>
              <p className="mb-4 text-xs text-brand-graylight">
                {t('settings.createPasskeyAccountDescription')}
              </p>
              <NeutralButton
                type="button"
                disabled={passkeyLoading || loading}
                loading={passkeyLoading}
                onClick={createPasskeyAccount}
                fullWidth
              >
                {t('settings.createPasskeyAccount')}
              </NeutralButton>
            </div>
          </div>
        </Form>
      )}
    </>
  );
};

export default CreateAccount;
