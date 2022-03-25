import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton } from 'components/index';
import axios from 'axios';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/index';

import { EditNetwork } from '.';

const CustomRPCView = ({ selectedToEdit }: { selectedToEdit?: any }) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);

  const { alert } = useUtils();
  const controller = getController();

  const onSubmit = async ({ network, blockbookURL }: any) => {
    setLoading(true);

    try {
      const response = await axios.get(`${blockbookURL}/api/v2`);
      const { coin } = response.data.blockbook;

      if (response && coin) {
        if (coin === 'Syscoin' || coin === 'Syscoin Testnet') {
          controller.wallet.account.updateNetworkData({
            id: selectedToEdit
              ? selectedToEdit.id
              : network.toString().toLowerCase(),
            chainId: 57,
            label: network,
            beUrl: blockbookURL,
            type: 'syscoin',
          });

          setLoading(false);
          setEdit(true);

          return;
        }

        throw new Error('Invalid blockbook URL.');
      }
    } catch (error) {
      alert.removeAll();
      alert.error('Invalid blockbook URL.');

      setLoading(false);
    }
  };

  return (
    <>
      {edit ? (
        <EditNetwork />
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
              chainID: selectedToEdit ? selectedToEdit.chainID : '',
            }}
            onFinish={onSubmit}
            autoComplete="off"
            className="flex flex-col gap-4 items-center justify-center mt-8 text-center"
          >
            <Form.Item
              name="network"
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
                placeholder="Network name"
                className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              />
            </Form.Item>

            <Form.Item
              name="blockbookURL"
              className="md:w-full"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: '',
                },
                () => ({
                  async validator(_, value) {
                    try {
                      const result = await controller.wallet.validateRPC(value);

                      if (result) {
                        return await Promise.resolve();
                      }
                    } catch (error) {
                      return Promise.reject();
                    }
                  },
                }),
              ]}
            >
              <Input
                type="text"
                placeholder="Blockbook URL"
                className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              />
            </Form.Item>

            <Form.Item
              name="chainID"
              className="md:w-full"
              hasFeedback
              rules={[
                {
                  required: false,
                  message: '',
                },
                ({ getFieldValue }) => ({
                  async validator(_, value) {
                    try {
                      const rpcURL = getFieldValue('blockbookURL');

                      const result = await controller.wallet.validateRPC(
                        rpcURL,
                        value
                      );

                      if (result) {
                        return await Promise.resolve();
                      }
                    } catch (error) {
                      return Promise.reject();
                    }
                  },
                }),
              ]}
            >
              <Input
                type="text"
                placeholder="Chain ID"
                className={`${
                  true &&
                  'opacity-50 rounded-full py-2 pl-4 w-72 md:w-full bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus md:max-w-md'
                }`}
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
