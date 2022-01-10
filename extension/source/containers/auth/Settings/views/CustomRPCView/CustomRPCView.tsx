import React, { useState } from 'react';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Form, Input } from 'antd';
import { SecondaryButton } from 'components/index';
import axios from 'axios';
import { useUtils, useController } from 'hooks/index';
import { EditNetworkView } from '..';

const CustomRPCView = ({
  selectedToEdit
}) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);

  const { alert } = useUtils();
  const controller = useController();

  const onSubmit = async ({ network, blockbookURL }: any) => {
    setLoading(true);

    try {
      const response = await axios.get(`${blockbookURL}/api/v2`);
      const { coin } = response.data.blockbook;

      if (response && coin) {
        if (coin === 'Syscoin' || coin === 'Syscoin Testnet') {
          controller.wallet.account.updateNetworkData({
            id: selectedToEdit ?
              selectedToEdit.id :
              network.toString().toLowerCase(),
            label: network,
            beUrl: blockbookURL
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
  }

  return (
    <>
      {edit ? (
        <EditNetworkView />
      ) : (
        <AuthViewLayout title="CUSTOM RPC">
          <Form
            id="rpc"
            name="rpc"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 8 }}
            initialValues={{
              blockbookURL: selectedToEdit ? selectedToEdit.beUrl : '',
              network: selectedToEdit ? selectedToEdit.label : '',
              chainID: selectedToEdit ? selectedToEdit.chainID : ''
            }}
            onFinish={onSubmit}
            autoComplete="off"
            className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
          >
            <Form.Item
              name="network"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: ''
                },
              ]}
            >
              <Input
                type="text"
                placeholder="Network name"
                className="rounded-full py-2 px-4 w-72 bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus"
              />
            </Form.Item>

            <Form.Item
              name="blockbookURL"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: ''
                },
                () => ({
                  async validator(_, value) {
                    try {
                      const response = await axios.get(`${value}/api/v2`);
                      const { coin } = response.data.blockbook;
                
                      if (response && coin) {
                        if (coin === 'Syscoin' || coin === 'Syscoin Testnet' || !value) {
                          return Promise.resolve();
                        }
                      }
                    } catch (error) {
                      return Promise.reject('');
                    }
                  },
                }),
              ]}
            >
              <Input
                type="text"
                placeholder="Blockbook URL"
                className="rounded-full py-2 px-4 w-72 bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus"
              />
            </Form.Item>

            <Form.Item
              name="chainID"
              hasFeedback
              rules={[
                {
                  required: false,
                  message: ''
                },
              ]}
            >
              <Input
                disabled={true}
                type="text"
                placeholder="Chain ID"
                className={`${true && 'opacity-50 rounded-full py-2 pl-4 w-72 bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus'}`}
              />
            </Form.Item>

            <p className="text-brand-white font-poppins py-4 text-center px-8 text-sm">You can edit this later if you need on network settings menu.</p>

            <div className="absolute bottom-12">
              <SecondaryButton
                type="submit"
                loading={loading}
              >
                Save
              </SecondaryButton>
            </div>
          </Form>
        </AuthViewLayout>
      )}
    </>
  );
};

export default CustomRPCView;