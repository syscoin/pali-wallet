import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import { Layout, NeutralButton, Tooltip } from 'components/index';
import { useUtils } from 'hooks/index';
import { ICustomRpcParams } from 'types/transactions';
import { getController } from 'utils/browser';

const CustomRPCView = () => {
  const { state }: { state: any } = useLocation();

  const isSyscoinSelected = state && state.chain && state.chain === 'syscoin';
  const [loading, setLoading] = useState(false);
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [urlFieldValue, setUrlFieldValue] = useState('');
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
    symbol: (state && state.selected && state.selected.currency) ?? '',
    explorer: (state && state.selected && state.selected.explorer) ?? '',
  };

  const canDisableInputWhenEdit = state ? state.isDefault : false;

  const canDisableDecimalsInput = Boolean(
    !form.getFieldValue('url') ||
      isUrlValid ||
      (state && state.selected && state.selected.chainId)
  );

  useEffect(() => {
    const fieldErrors = form.getFieldError('url');
    if (urlFieldValue && fieldErrors.length > 0) {
      alert.removeAll();
      alert.error('Invalid RPC URL. Try again.');
    }
  }, [urlFieldValue]);

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
            <Tooltip
              content={
                !!state ? 'Cant change type of network while editing' : ''
              }
            >
              <Switch
                checked={isSyscoinRpc}
                onChange={() => setIsSyscoinRpc(!isSyscoinRpc)}
                className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                disabled={!!state}
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
            </Tooltip>

            <p className="text-brand-deepPink100 text-xs">Syscoin</p>
          </div>
        </Form.Item>

        <Form.Item
          name="label"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: !isSyscoinRpc,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            disabled={canDisableInputWhenEdit}
            placeholder={`Label ${isSyscoinRpc ? '(optional)' : ''}`}
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
                setUrlFieldValue(value);
                if (isSyscoinRpc) {
                  const trezorIoRegExp = /trezor\.io/;
                  if (trezorIoRegExp.test(value)) {
                    console.error(
                      "trezor.io has a rate limit for simultaneous requests, so we can't use it for now"
                    );
                    alert.error(
                      "trezor.io has a rate limit for simultaneous requests, so we can't use it for now"
                    );
                    return Promise.reject();
                  }
                  const { valid, coin } = await validateSysRpc(value);

                  if (valid || !value) {
                    populateForm('label', String(coin));

                    return Promise.resolve();
                  }

                  return Promise.reject();
                }

                const { valid, details, hexChainId } = await validateEthRpc(
                  value,
                  false
                ); //Cooldown doesn't matter on network edition

                setIsUrlValid(valid);

                if ((valid && details) || !value) {
                  populateForm('label', String(details.name));
                  populateForm('chainId', String(details.chainId));

                  return Promise.resolve();
                } else if (valid || !value) {
                  populateForm('chainId', String(parseInt(hexChainId, 16)));
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={`${isSyscoinRpc ? 'Explorer' : 'RPC URL'}`}
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
            disabled={canDisableDecimalsInput}
            placeholder="Chain ID"
            className={`${isSyscoinRpc ? 'hidden' : 'relative'} input-small`}
          />
        </Form.Item>

        <Form.Item
          name="symbol"
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
            placeholder="Symbol"
            className={`${
              isSyscoinRpc ? 'hidden' : 'block'
            } input-small relative`}
          />
        </Form.Item>

        <Form.Item
          hasFeedback
          className="md:w-full"
          name="explorer"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            disabled={canDisableInputWhenEdit}
            placeholder="Explorer"
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
