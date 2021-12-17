import React, { useEffect, useState } from 'react';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Form, Input } from 'antd';
import { Button } from 'components/Button';
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

  useEffect(() => {
    console.log(selectedToEdit, 'selected')
  }, [selectedToEdit]);

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
      alert.error('Invalid blockbook URL.', { timeout: 2000 });

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
            id="send"
            name="send"
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
                className="ant-input ant-input rounded-full py-3 pl-4 w-72 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
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
              ]}
            >
              <Input
                type="text"
                placeholder="Blockbook URL"
                className="ant-input ant-input rounded-full py-3 pl-4 w-72 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
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
                className={`${true ? 'ant-input rounded-full py-3 pl-4 w-72 bg-brand-navydarker bg-opacity-60 border border-brand-gray100 cursor-not-allowed text-sm' : 'ant-input ant-input rounded-full py-3 pl-4 w-72 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none'}`}
              />
            </Form.Item>

            <p className="text-brand-white font-poppins py-4 text-center px-8 text-sm">You can edit this later if you need on network settings menu.</p>

            <Button
              type="submit"
              className="bg-brand-navydarker"
              classNameBorder="absolute bottom-12"
              loading={loading}
            >
              Save
            </Button>
          </Form>
        </AuthViewLayout>
      )}
    </>
  );
};

export default CustomRPCView;