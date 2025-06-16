import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React from 'react';
import { useState, FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout } from 'components/index';
import { RootState } from 'state/store';

import { CustomToken } from './CustomToken';
import { ImportToken } from './ImportToken';
import { SyscoinImport } from './SyscoinImport';

export const AddToken: FC = () => {
  const [form] = Form.useForm();

  const { state } = useLocation();

  const [importCustom, setImportCustom] = useState(false);

  const { isBitcoinBased, activeNetwork: network } = useSelector(
    (paliState: RootState) => paliState.vault
  );
  const { t } = useTranslation();

  const searchTokenValidation = Boolean(network.chainId === 1); // Only allow to Ethereum Mainnet chain ID

  const isEditToken = Boolean(state && state.contractAddress);

  const validatedTitle = isEditToken
    ? t('tokens.editToken')
    : t('tokens.importToken');

  return (
    <Layout title={validatedTitle}>
      {isBitcoinBased ? (
        <SyscoinImport />
      ) : (
        <>
          {searchTokenValidation ? (
            <>
              <Form
                form={form}
                validateMessages={{ default: '' }}
                id="token"
                name="token"
                labelCol={{ span: 8 }}
                wrapperCol={{ span: 8 }}
                autoComplete="off"
                className="flex flex-col gap-2 items-center justify-center text-center"
              >
                <Form.Item
                  id="network-switch"
                  name="network-switch"
                  rules={[
                    {
                      required: false,
                      message: '',
                    },
                  ]}
                >
                  <div className="flex gap-x-2 my-4 text-xs">
                    <p className="text-brand-royalblue">{t('tokens.search')}</p>

                    <Switch
                      checked={importCustom}
                      onChange={() => setImportCustom(!importCustom)}
                      className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                    >
                      <span className="sr-only">
                        {t('tokens.searchOrCustomToken')}
                      </span>
                      <span
                        className={`${
                          importCustom
                            ? 'translate-x-6 bg-brand-royalblue'
                            : 'translate-x-1 bg-brand-deepPink100'
                        } inline-block w-2 h-2 transform rounded-full`}
                      />
                    </Switch>

                    <p className="text-brand-deepPink100">
                      {t('tokens.customToken')}
                    </p>
                  </div>
                </Form.Item>
              </Form>
              {importCustom ? (
                <CustomToken isEdit={isEditToken} tokenToEdit={null} />
              ) : (
                <ImportToken />
              )}
            </>
          ) : (
            <CustomToken isEdit={isEditToken} tokenToEdit={state} />
          )}
        </>
      )}
    </Layout>
  );
};
