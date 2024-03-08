import { Input, Form } from 'antd';
import { useForm } from 'antd/es/form/Form';
import { t } from 'i18next';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { Layout, NeutralButton } from 'components/index';
import { ImportedWalletSuccessfully } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';
import { validatePrivateKeyValue } from 'utils/validatePrivateKey';

const ImportAccountView = () => {
  const controller = getController();
  const { navigate, alert } = useUtils();
  const [form] = useForm();
  const { importAccountFromPrivateKey } = controller.wallet;

  //* States
  const [isAccountImported, setIsAccountImported] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );

  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  if (!activeAccount) throw new Error('No account');

  const handleImportAccount = async () => {
    setIsImporting(true);
    if (form.getFieldValue('privKey')) {
      try {
        const account = await importAccountFromPrivateKey(
          form.getFieldValue('privKey'),
          form.getFieldValue('label')
        );

        if (account) setIsAccountImported(true);

        setIsImporting(false);
      } catch (error) {
        alert.removeAll();
        alert.error(String(error.message));
        setIsImporting(false);
      }
    }
  };

  return (
    <Layout title={t('header.importAccount').toUpperCase()}>
      <ImportedWalletSuccessfully
        show={isAccountImported}
        onClose={() => navigate('/home')}
        title={t('settings.accountImported')}
      />

      <p className="mb-8 text-left text-white text-sm">
        {t('settings.importAccountsWont')}
      </p>

      <div className="flex flex-col items-center justify-center">
        <div className="flex flex-col items-center justify-center text-center">
          <Form
            validateMessages={{ default: '' }}
            className="flex flex-col gap-2 text-center md:w-full mb-10"
            name="newaccount"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 16 }}
            autoComplete="off"
            form={form}
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
                placeholder={`${t('settings.label')} (${t(
                  'settings.optional'
                )})`}
                id="account-name-input"
              />
            </Form.Item>
            <Form.Item
              name="privKey"
              className="md:w-full"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: '',
                },
                () => ({
                  async validator(_, value) {
                    if (validatePrivateKeyValue(value)) {
                      return Promise.resolve();
                    }
                    return Promise.reject();
                  },
                }),
              ]}
            >
              <Input
                type="text"
                className="custom-input-normal relative"
                placeholder={t('settings.yourPrivateKey')}
                id="account-name-input"
              />
            </Form.Item>

            <div className="w-full relative bottom-[-14rem] right-[0%] md:static">
              <NeutralButton
                type="button"
                loading={isImporting}
                onClick={handleImportAccount}
                fullWidth={true}
              >
                {t('buttons.import')}
              </NeutralButton>
            </div>
          </Form>
        </div>
      </div>
    </Layout>
  );
};

export default ImportAccountView;
