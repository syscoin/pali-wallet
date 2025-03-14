import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [accountName, setAccountName] = useState<string>('');

  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const navigate = useNavigate();

  const onSubmit = async ({ label }: { label?: string }) => {
    setLoading(true);

    const { address: newAddress } = (await controllerEmitter(
      ['wallet', 'createAccount'],
      [isBitcoinBased, activeNetwork.chainId, label, false]
    )) as any;

    setAddress(newAddress);
    setLoading(false);
  };

  return (
    <Layout title={t('settings.createAccount')} id="create-account-title">
      {address ? (
        <CreatedAccountSuccessfully
          show={address !== ''}
          onClose={() => {
            setAddress('');
            navigate('/home');
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
              loading={loading}
              disabled={loading}
              id="create-btn"
              fullWidth
            >
              {t('buttons.create')}
            </NeutralButton>
          </div>
        </Form>
      )}
    </Layout>
  );
};

export default CreateAccount;
