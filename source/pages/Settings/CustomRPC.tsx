import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton } from 'components/index';
import { Switch } from '@headlessui/react';
import { useUtils, useStore } from 'hooks/index';
import { getController } from 'utils/browser';

import { ManageNetwork } from '.';

const CustomRPCView = ({
  selectedToEdit,
  isSyscoinToEdit,
}: {
  isSyscoinToEdit?: boolean;
  selectedToEdit?: any;
}) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(Boolean(isSyscoinToEdit));

  const { alert } = useUtils();
  const { networks } = useStore();
  const controller = getController();

  const networkAlreadyExistsAlert = () => {
    alert.removeAll();
    alert.error('Network already exists.');

    setLoading(false);
  };

  const onSubmit = async (data: {
    chainId: number;
    label: string;
    rpcUrl: string;
    token_contract_address?: string;
  }) => {
    setLoading(true);

    const chain = isSyscoinRpc ? 'syscoin' : 'ethereum';

    if (networks[chain][data.chainId]) {
      alert.removeAll();
      alert.error('Network already exists.');

      setLoading(false);

      return;
    }

    for (const network of Object.values(networks[chain])) {
      if (data.rpcUrl === network.url || data.chainId === network.chainId) {
        networkAlreadyExistsAlert();

        return;
      }
    }

    try {
      await controller.wallet.addCustomRpc({
        ...data,
        isSyscoinRpc,
      });

      setEdit(true);
    } catch (error) {
      console.log('error custom rpc', error);

      alert.removeAll();
      alert.error("Can't add a custom RPC now. Try again later.");
    }

    setLoading(false);
  };

  return (
    <>
      {edit ? (
        <ManageNetwork />
      ) : (
        <Layout title="CUSTOM RPC">
          <Form
            id="rpc"
            name="rpc"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 8 }}
            initialValues={
              selectedToEdit && {
                label: selectedToEdit.label ?? '',
                rpcUrl: selectedToEdit.url ?? '',
                chainId: selectedToEdit.chainId ?? '',
              }
            }
            onFinish={onSubmit}
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
                <p>Ethereum</p>

                <Switch
                  checked={isSyscoinRpc}
                  onChange={() => setIsSyscoinRpc(!isSyscoinRpc)}
                  className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                >
                  <span className="sr-only">Syscoin Network</span>
                  <span
                    className={`${
                      isSyscoinRpc
                        ? 'translate-x-6 bg-brand-royalblue'
                        : 'translate-x-1 bg-brand-deepPink100'
                    } inline-block w-2 h-2 transform rounded-full`}
                  />
                </Switch>

                <p>Syscoin</p>
              </div>
            </Form.Item>

            <Form.Item
              name="label"
              className="md:w-full"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: '',
                },
              ]}
            >
              <Input type="text" placeholder="Label" className="large" />
            </Form.Item>

            <Form.Item
              name="rpcUrl"
              className="md:w-full"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: '',
                },
              ]}
            >
              <Input
                type="text"
                placeholder={`${
                  isSyscoinRpc ? 'Trezor Block Explorer' : 'RPC URL'
                }`}
                className="large"
              />
            </Form.Item>

            <Form.Item
              name="chainId"
              hasFeedback
              className="md:w-full"
              rules={[
                {
                  required: !isSyscoinRpc,
                  message: '',
                },
              ]}
            >
              <Input
                type="text"
                placeholder="Chain ID"
                className={`${isSyscoinRpc ? 'hidden' : 'block'} large`}
              />
            </Form.Item>

            <Form.Item
              hasFeedback
              className="md:w-full"
              name="token_contract_address"
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <Input
                type="text"
                placeholder="Token Contract Address (optional)"
                className={`${isSyscoinRpc ? 'hidden' : 'block'} large`}
              />
            </Form.Item>

            <p className="px-8 py-4 text-center text-brand-white font-poppins text-sm">
              You can edit this later if you need on network settings menu.
            </p>

            <div className="absolute bottom-12 md:static">
              <SecondaryButton type="submit" loading={loading}>
                Save
              </SecondaryButton>
            </div>
          </Form>
        </Layout>
      )}
    </>
  );
};

export default CustomRPCView;
