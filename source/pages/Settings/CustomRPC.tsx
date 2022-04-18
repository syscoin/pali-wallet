import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton } from 'components/index';
// import axios from 'axios';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

import { ManageNetwork } from '.';

const CustomRPCView = ({ selectedToEdit }: { selectedToEdit?: any }) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);

  const { alert } = useUtils();
  const controller = getController();

  const onSubmit = async ({ rpcUrl, label, currency, chainId, name }: any) => {
    setLoading(true);

    const network = {
      chainId,
      url: rpcUrl,
      label,
      default: false,
      currency,
      isTestnet: true,
    };

    const networksList = await controller.utils.getNetworksList();

    try {
      await controller.wallet.addCustomRpc(network);

      console.log('networks list test', networksList);

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
              blockbookURL: selectedToEdit ? selectedToEdit.beUrl : '',
              network: selectedToEdit ? selectedToEdit.label : '',
              chainID: selectedToEdit ? selectedToEdit.chainID : null,
            }}
            onFinish={onSubmit}
            autoComplete="off"
            className="flex flex-col gap-4 items-center justify-center mt-8 text-center"
          >
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
                className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
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
                className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
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
                className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              />
            </Form.Item>

            <Form.Item
              name="chainId"
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
                placeholder="Chain ID"
                className="pl-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
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
