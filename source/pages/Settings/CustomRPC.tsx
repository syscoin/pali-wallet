import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton } from 'components/index';
import axios from 'axios';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';
import { validateEthRpc } from '@pollum-io/sysweb3-network';

import { ManageNetwork } from '.';

const CustomRPCView = ({ selectedToEdit }: { selectedToEdit?: any }) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);

  const { alert } = useUtils();
  const controller = getController();

  const onSubmit = async ({ chainId, blockbookURL }: any) => {
    setLoading(true);

    try {
      validateEthRpc(blockbookURL, chainId);
      // const response = await axios.get(`${blockbookURL}/api/v2`);
      // const { coin } = response.data.blockbook;
      // const { chain } = response.data.backend;

      // if (response && coin) {
      //   controller.wallet.account.updateNetworkData({
      //     id: selectedToEdit
      //       ? selectedToEdit.id
      //       : coin.toString().toLowerCase(),
      //     label: `${network.toString().toLowerCase()} ${chain
      //       .toString()
      //       .toLowerCase()}`,
      //     beUrl: blockbookURL,
      //   });

      //   setLoading(false);
      //   setEdit(true);

      //   return;
      // }
    } catch (error) {
      alert.removeAll();
      alert.error('Invalid blockbook URL.');

      setLoading(false);
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
              chainID: selectedToEdit ? selectedToEdit.chainID : -1,
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
                      const response = await axios.get(`${value}/api/v2`);
                      const { coin } = response.data.blockbook;

                      if (response && coin) {
                        if (
                          coin === 'Syscoin' ||
                          coin === 'Syscoin Testnet' ||
                          !value
                        ) {
                          return await Promise.resolve();
                        }
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
