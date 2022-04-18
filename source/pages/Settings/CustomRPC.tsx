import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton } from 'components/index';
import { Switch } from '@headlessui/react';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

import { ManageNetwork } from '.';

const CustomRPCView = ({ selectedToEdit }: { selectedToEdit?: any }) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);
  const [isSyscoinChain, setIsSyscoinChain] = useState(true);

  const { alert } = useUtils();
  const controller = getController();

  const onSubmit = async ({ rpcUrl, label, currency, chainId }: any) => {
    setLoading(true);

    const network = {
      chainId,
      url: rpcUrl,
      label,
      default: false,
      currency,
      isTestnet: true,
    };

    try {
      await controller.wallet.addCustomRpc(network);

      setEdit(true);
    } catch (error) {
      alert.removeAll();
      alert.error("Can't add a custom RPC now. Try again later.");
    }
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
            initialValues={{
              blockbookURL: selectedToEdit ? selectedToEdit.url : '',
              network: selectedToEdit ? selectedToEdit.label : '',
              chainID: selectedToEdit ? selectedToEdit.chainId : null,
            }}
            onFinish={onSubmit}
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
                <p>Ethereum</p>
                <Switch
                  checked={isSyscoinChain}
                  onChange={() => setIsSyscoinChain(!isSyscoinChain)}
                  className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                >
                  <span className="sr-only">Syscoin Network</span>
                  <span
                    className={`${
                      isSyscoinChain
                        ? 'translate-x-6 bg-brand-royalblue'
                        : 'translate-x-1 bg-brand-deepPink100'
                    } inline-block w-2 h-2 transform rounded-full`}
                  />
                </Switch>

                <p>Syscoin</p>
              </div>
            </Form.Item>
            <Form.Item
              name="name"
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
                placeholder="Name"
                className="px-4 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              />
            </Form.Item>

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
                placeholder="Label (optional)"
                className="px-4 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              />
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
                placeholder="RPC URL"
                className="px-4 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              />
            </Form.Item>

            <div className="flex gap-x-0.5 items-center justify-center w-72 md:w-full">
              <Form.Item
                name="chainId"
                className="flex-1 w-32 text-center bg-fields-input-primary rounded-l-full md:w-full"
                rules={[
                  {
                    required: false,
                    message: '',
                  },
                ]}
              >
                <Input
                  type="text"
                  placeholder="Chain ID"
                  className="p-3 w-full text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full outline-none md:w-full"
                />
              </Form.Item>

              <Form.Item
                name="currency"
                className="flex-1 w-32 text-center bg-fields-input-primary rounded-r-full"
                rules={[
                  {
                    required: false,
                    message: '',
                  },
                ]}
              >
                <Input
                  type="text"
                  placeholder="Currency"
                  className="p-3 w-full text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-r-full outline-none md:w-full"
                />
              </Form.Item>
            </div>

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
