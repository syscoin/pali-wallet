import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import { Layout, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { ICustomRpcParams } from 'types/transactions';
import { getController } from 'utils/browser';

const CustomRPCView = () => {
  const { state }: { state: any } = useLocation();

  const isSyscoinSelected = state && state.chain && state.chain === 'syscoin';
  const [loading, setLoading] = useState(false);
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(Boolean(isSyscoinSelected));

  const { alert, navigate } = useUtils();
  const controller = getController();

  const [form] = useForm();

  const populateForm = (field: string, value: number | string) => {
    if (!form.getFieldValue(field)) form.setFieldsValue({ [field]: value });
  };

  const onSubmit = async (data: ICustomRpcParams) => {
    setLoading(true);

    const customRpc = {
      ...data,
      isSyscoinRpc,
    };

    try {
      if (!state) {
        await controller.wallet.addCustomRpc(customRpc);

        alert.success('RPC successfully added.');

        setLoading(false);

        navigate('/settings/networks/edit');

        return;
      }

      await controller.wallet.editCustomRpc(customRpc, state.selected);

      alert.success('RPC successfully edited.');

      setLoading(false);

      navigate('/settings/networks/edit');
    } catch (error: any) {
      alert.removeAll();
      alert.error(error.message);

      setLoading(false);
    }
  };

  const initialValues = {
    label: (state && state.selected && state.selected.label) ?? '',
    url: (state && state.selected && state.selected.url) ?? '',
    chainId: (state && state.selected && state.selected.chainId) ?? '',
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
              async validator(_, value) {
                if (isSyscoinRpc) {
                  const { valid, coin } = await validateSysRpc(value);

                  if (valid || !value) {
                    populateForm('label', String(coin));

                    return Promise.resolve();
                  }

                  return Promise.reject();
                }

                const { valid, details } = await validateEthRpc(value);

                setIsUrlValid(valid);

                if (valid || !value) {
                  populateForm('label', String(details.name));
                  populateForm('chainId', String(details.chainId));

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
            disabled={!form.getFieldValue('url') || isUrlValid}
            placeholder="Chain ID"
            className={`${isSyscoinRpc ? 'hidden' : 'relative'} input-small`}
          />
        </Form.Item>

        <Form.Item
          hasFeedback
          className="md:w-full"
          name="apiUrl"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            placeholder="API URL (optional)"
            className={`${isSyscoinRpc ? 'hidden' : 'relative'} input-small`}
          />
        </Form.Item>

        <p className="px-8 py-4 text-center text-brand-royalblue font-poppins text-xs">
          You can edit this later if you need on network settings menu.
        </p>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={loading}>
            Save
          </NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default CustomRPCView;
