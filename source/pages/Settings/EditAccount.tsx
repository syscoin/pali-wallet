import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { Layout, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';

const EditAccountView = () => {
  const { state } = useLocation();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const { alert, navigate } = useUtils();
  const controller = getController();

  const [form] = useForm();

  const initialValues = {
    label: state && state.label ? state.label : '',
  };

  const onSubmit = async (data: { label: string }) => {
    setLoading(true);

    try {
      const accountType = state.isImported
        ? KeyringAccountType.Imported
        : state.isTrezorWallet
        ? KeyringAccountType.Trezor
        : state.isLedgerWallet
        ? KeyringAccountType.Ledger
        : KeyringAccountType.HDAccount;

      const accountId = state.id;

      controller.wallet.editAccountLabel(data.label, accountId, accountType);

      alert.success(t('settings.accountLabelEditedSuccessfully'));

      navigate('/home');
    } catch (error) {
      alert.removeAll();
      alert.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title={t('settings.editAccount')}>
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="edit-account"
        name="edit-account"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={initialValues}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center"
      >
        <Form.Item
          name="label"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                if (value && value.length > 0 && value !== state.label) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.accountLabel')}
            className="input-small relative"
          />
        </Form.Item>

        <p className="px-8 py-4 text-center text-brand-royalblue font-poppins text-xs">
          {t('settings.youCanEditAccount')}
        </p>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={loading}>
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default EditAccountView;
