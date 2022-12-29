import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Layout, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { useRpcChainId } from 'hooks/useRpc';
import { ICustomRpcParams } from 'types/transactions';
import { getController } from 'utils/browser';

const CustomRPCView = () => {
  const { state }: { state: any } = useLocation();

  const isSyscoinSelected = state && state.chain && state.chain === 'syscoin';
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(Boolean(isSyscoinSelected));

  const { alert, navigate } = useUtils();
  const controller = getController();

  const [form] = useForm();

  const { chainId, isLoading } = useRpcChainId({
    isUtxo: isSyscoinRpc,
    rpcUrl: form.getFieldValue('url'),
  });

  useEffect(() => {
    form.setFieldsValue({ chainId });
  }, [chainId, form]);

  useEffect(() => {
    form.resetFields();
  }, [isSyscoinRpc]);

  const onSubmit = async (data: ICustomRpcParams) => {
    const customRpc = {
      ...data,
      isSyscoinRpc,
    };

    if (!state) {
      await controller.wallet.addCustomRpc(customRpc);

      alert.success('RPC successfully added.');

      navigate('/settings/networks/edit');

      return;
    }

    await controller.wallet.editCustomRpc(customRpc, state.selected);

    alert.success('RPC successfully edited.');

    navigate('/settings/networks/edit');
  };

  const initialValues = {
    label: (state && state.selected && state.selected.label) ?? '',
    url: (state && state.selected && state.selected.url) ?? '',
    chainId: '',
  };

  return (
    <Layout title="CUSTOM RPC">
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="rpc"
        name="rpc"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={initialValues}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center"
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
          <div className="flex gap-x-2 mb-4 text-xs">
            <p className="text-brand-royalblue text-xs">Ethereum</p>

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

            <p className="text-brand-deepPink100 text-xs">Syscoin</p>
          </div>
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
            className="input-small relative"
          />
        </Form.Item>

        <Form.Item
          name="url"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                if (!value || chainId) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={`${
              isSyscoinRpc ? 'Trezor Block Explorer' : 'RPC URL'
            }`}
            className="input-small relative"
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
            disabled={!form.getFieldValue('url')}
            placeholder="Chain ID"
            className={`${
              isSyscoinRpc ? 'hidden' : 'block'
            } input-small relative`}
          />
        </Form.Item>

        <p className="px-8 py-4 text-center text-brand-royalblue font-poppins text-xs">
          You can edit this later if you need on network settings menu.
        </p>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={isLoading}>
            Save
          </NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default CustomRPCView;
