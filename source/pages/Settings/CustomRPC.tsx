import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import React, { useState } from 'react';

import { INetwork } from '@pollum-io/sysweb3-utils';

import { Layout, SecondaryButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { ICustomRpcParams } from 'types/transactions';
import { getController } from 'utils/browser';

import { ManageNetwork } from '.';

const CustomRPCView = ({
  selectedToEdit,
  isSyscoinToEdit,
}: {
  isSyscoinToEdit?: boolean;
  selectedToEdit?: INetwork;
}) => {
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(Boolean(isSyscoinToEdit));

  const { alert } = useUtils();
  const controller = getController();

  const onSubmit = async (data: ICustomRpcParams) => {
    setLoading(true);

    const customRpc = {
      ...data,
      isSyscoinRpc,
    };

    try {
      if (!selectedToEdit) {
        await controller.wallet.addCustomRpc(customRpc);

        alert.success('RPC successfully added.');

        return;
      }

      await controller.wallet.editCustomRpc(customRpc, selectedToEdit);

      setEdit(true);

      alert.success('RPC successfully edited.');
    } catch (error: any) {
      alert.removeAll();
      alert.error(error.message);
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
            validateMessages={{ default: '' }}
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
              name="tokenContractAddress"
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
