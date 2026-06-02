import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { LockIconSvg } from 'components/Icon/Icon';
import { Icon, NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { navigateBack, navigateWithContext } from 'utils/navigationState';
import { PASSKEY_FACTORY_ADDRESSES } from 'utils/passkey/contracts';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [accountName, setAccountName] = useState<string>('');
  const { t } = useTranslation();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isPasskeySupported = Boolean(
    PASSKEY_FACTORY_ADDRESSES[activeNetwork.chainId]
  );

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

  const createPasskeyAccount = () => {
    navigateWithContext(
      navigate,
      '/settings/account/passkey-new',
      { initialLabel: accountName },
      {
        returnRoute: '/settings/account/new',
        returnContext: location.state?.returnContext,
      }
    );
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

          {isPasskeySupported && (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between rounded-lg bg-alpha-whiteAlpha100 px-4 py-4 text-left hover:bg-brand-blue500 hover:bg-opacity-20"
              disabled={loading}
              onClick={createPasskeyAccount}
            >
              <span className="flex min-w-0 items-center gap-3">
                <LockIconSvg className="shrink-0 text-brand-white" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">
                    {t('settings.createPasskeyAccount')}
                  </span>
                  <span className="mt-1 block text-xs text-brand-graylight">
                    {t('settings.createPasskeyAccountDescription')}
                  </span>
                </span>
              </span>
              <Icon name="arrowright" isSvg size={24} className="shrink-0" />
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
