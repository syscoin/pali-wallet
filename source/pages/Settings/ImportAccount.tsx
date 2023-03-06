import { Menu } from '@headlessui/react';
import { Input, Form } from 'antd';
import { useForm } from 'antd/es/form/Form';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Layout, Icon, DefaultModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { validatePrivateKeyValue } from 'utils/validatePrivateKey';

const ImportAccountView = () => {
  const controller = getController();
  const { navigate, alert } = useUtils();
  const [form] = useForm();
  const { importAccountFromPrivateKey } = controller.wallet;

  //* States
  const [isAccountImported, setIsAccountImported] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const { accounts, activeAccount: activeAccountId } = useSelector(
    (state: RootState) => state.vault
  );

  const activeAccount = accounts[activeAccountId];

  const isUnlocked =
    controller.wallet.isUnlocked() && activeAccount.address !== '';

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

  //* Effects
  useEffect(() => {
    if (
      !isUnlocked &&
      !Object.values(accounts).length &&
      !accounts[activeAccountId]
    )
      return;

    controller.refresh(true);
  }, [isUnlocked, activeAccountId]);

  if (!activeAccount) return null;

  return (
    <Layout title="IMPORT ACCOUNT">
      <DefaultModal
        show={isAccountImported}
        onClose={() => navigate('/home')}
        title="Account imported successfully"
      />

      <p className="mb-2 text-left text-white text-sm md:max-w-full">
        Imported accounts will not be associated with your originally created
        Pali account Secret Recovery Phrase.
      </p>

      <p className="mb-2 mt-5 text-left text-white text-sm md:max-w-full">
        Select Type
      </p>

      <div className="flex flex-col gap-y-5 items-center justify-center">
        <Menu as="div" className="relative inline-block text-left">
          <Menu.Button className="inline-flex justify-center py-2 w-80 text-white text-sm font-medium bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full">
            <p>Private Key</p>

            <Icon
              name="select-down"
              className="text-brand-royalblue"
              wrapperClassname="w-8 absolute right-20 bottom-3"
            />
          </Menu.Button>
        </Menu>

        <div className="flex flex-col items-center justify-center text-center">
          <Form
            validateMessages={{ default: '' }}
            className="flex flex-col gap-5 items-center justify-center text-center md:w-full"
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
                className="input-small relative"
                placeholder="Label (optional)"
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
                className="input-small relative"
                placeholder="Your Private Key"
                id="account-name-input"
              />
            </Form.Item>

            <NeutralButton
              type="button"
              loading={isImporting}
              onClick={handleImportAccount}
            >
              Import
            </NeutralButton>
          </Form>
        </div>
      </div>
    </Layout>
  );
};

export default ImportAccountView;
