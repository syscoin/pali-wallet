import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { Card, Icon, NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { navigateBack } from 'utils/navigationState';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [accountName, setAccountName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const { t } = useTranslation();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isSmartAccountSupported = activeNetwork.kind === INetworkType.Ethereum;

  const onSubmit = async ({ label }: { label?: string }) => {
    setLoading(true);
    setError('');

    try {
      const { address: newAddress } = (await controllerEmitter(
        ['wallet', 'createAccount'],
        [label]
      )) as any;

      setAddress(newAddress);
      setLoading(false);
    } catch (caughtError: any) {
      setLoading(false);

      // Check if this is a wallet locked error and handle redirect
      const wasHandled = handleWalletLockedError(caughtError);
      if (!wasHandled) {
        setError(caughtError?.message || t('send.cantCompleteTxs'));
        // If not a wallet locked error, just log it since the original component
        // didn't have explicit error handling UI for create account failures
        console.error('Error creating account:', caughtError);
      }
    }
  };

  const createSmartAccount = async () => {
    setLoading(true);
    setError('');

    try {
      const account = (await controllerEmitter(
        ['wallet', 'createSmartAccount'],
        [{ label: accountName || undefined }],
        300000
      )) as any;

      setAddress(account.address);
    } catch (caughtError: any) {
      const wasHandled = handleWalletLockedError(caughtError);
      if (!wasHandled) {
        const message =
          caughtError?.message || t('settings.smartAccountCreateFailed');
        setError(
          message.includes('CREATE2') || message.includes('smart account')
            ? t('settings.smartAccountCreateFailed')
            : message
        );
        console.error('Error creating smart account:', caughtError);
      }
    } finally {
      setLoading(false);
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

          {error && (
            <Card type="error">
              <p className="text-left text-sm font-normal">{error}</p>
            </Card>
          )}

          {isSmartAccountSupported && (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg bg-alpha-whiteAlpha100 px-4 py-4 text-left hover:bg-brand-blue500 hover:bg-opacity-20"
              disabled={loading}
              onClick={createSmartAccount}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Icon
                  name="Lock"
                  isSvg
                  size={30}
                  className="shrink-0 opacity-90"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">
                    {t('settings.createSmartAccount')}
                  </span>
                  <span className="mt-1 block text-xs text-brand-graylight">
                    {t('settings.createSmartAccountDescription')}
                  </span>
                </span>
              </span>
              <span className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-alpha-whiteAlpha100">
                <Icon
                  name="arrowright"
                  isSvg
                  size={18}
                  className="opacity-90"
                />
              </span>
            </button>
          )}

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
          </div>
        </Form>
      )}
    </>
  );
};

export default CreateAccount;
