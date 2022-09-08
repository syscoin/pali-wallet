import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useEffect } from 'react';
import { useState, FC } from 'react';
import { useSelector } from 'react-redux';

import { validateEthRpc } from '@pollum-io/sysweb3-network';

import { Layout } from 'components/index';
import { RootState } from 'state/store';

import { CustomToken } from './CustomToken';
import { ImportToken } from './ImportToken';
import { SyscoinImportToken } from './SyscoinImport';

export const AddToken: FC = () => {
  const [form] = Form.useForm();

  const [importCustom, setImportCustom] = useState(false);
  const [isTestnet, setIsTestnet] = useState(false);

  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const setTestnet = async () => {
    const { chain } = await validateEthRpc(activeNetwork.url);

    setIsTestnet(chain === 'testnet');
  };

  useEffect(() => {
    setTestnet();
  }, [activeNetwork]);

  return (
    <Layout title="IMPORT TOKEN">
      {isBitcoinBased ? (
        <SyscoinImportToken />
      ) : (
        <>
          {!isTestnet ? (
            <>
              <Form
                form={form}
                validateMessages={{ default: '' }}
                id="token"
                name="token"
                labelCol={{ span: 8 }}
                wrapperCol={{ span: 8 }}
                autoComplete="off"
                className="standard flex flex-col gap-2 items-center justify-center text-center"
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
                    <p>Search</p>

                    <Switch
                      checked={importCustom}
                      onChange={() => setImportCustom(!importCustom)}
                      className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                    >
                      <span className="sr-only">Search or custom token</span>
                      <span
                        className={`${
                          importCustom
                            ? 'translate-x-6 bg-brand-royalblue'
                            : 'translate-x-1 bg-brand-deepPink100'
                        } inline-block w-2 h-2 transform rounded-full`}
                      />
                    </Switch>

                    <p>Custom token</p>
                  </div>
                </Form.Item>
              </Form>
              {importCustom ? <CustomToken /> : <ImportToken />}
            </>
          ) : (
            <CustomToken />
          )}
        </>
      )}
    </Layout>
  );
};
