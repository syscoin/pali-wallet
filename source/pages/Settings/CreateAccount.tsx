import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import { NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { navigateBack } from 'utils/navigationState';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
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
          </div>
        </Form>
      )}
    </>
  );
};

export default CreateAccount;
