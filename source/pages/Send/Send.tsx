import * as React from 'react';
import { useState, useEffect, Fragment, FC, useCallback } from 'react';
import {
  useController,
  usePrice,
  useStore,
  useUtils,
  useAccount,
  useTransaction,
  useFormat,
} from 'hooks/index';
import { Form, Input } from 'antd';
import { Switch, Menu, Transition } from '@headlessui/react';
import { Layout, SecondaryButton, Tooltip, Icon } from 'components/index';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Assets } from 'types/transactions';
import { log } from 'utils/index';

interface ISend {
  initAddress?: string;
}
export const Send: FC<ISend> = () => {
  const getFiatAmount = usePrice();
  const controller = useController();

  const { alert, navigate, isNFT } = useUtils();
  const { getAssetBalance } = useTransaction();
  const { activeAccount } = useAccount();
  const { activeNetwork, fiat } = useStore();
  const { formatURL } = useFormat();
  const [verifyAddress, setVerifyAddress] = useState<boolean>(true);
  const [ZDAG, setZDAG] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<Assets | null>(null);
  const [recommend, setRecommend] = useState(0.00001);
  const [form] = Form.useForm();

  const handleGetFee = useCallback(async () => {
    const recommendFee = await controller.wallet.account.getRecommendFee();

    setRecommend(recommendFee);

    form.setFieldsValue({ fee: recommendFee });
  }, [controller.wallet.account, form]);

  useEffect(() => {
    handleGetFee();

    form.setFieldsValue({
      verify: true,
      ZDAG: false,
    });
  }, [form, handleGetFee]);

  const handleSelectedAsset = (item: number) => {
    if (activeAccount?.assets) {
      const getAsset = activeAccount?.assets.find(
        (asset: Assets) => asset.assetGuid === item
      );

      if (getAsset) {
        setSelectedAsset(getAsset);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const verifyOnChange = (value: any) => {
    setVerifyAddress(value);

    form.setFieldsValue({ verify: value });
  };

  const ZDAGOnChange = (value: any) => {
    setZDAG(value);

    form.setFieldsValue({ ZDAG: value });
  };

  const nextStep = (data: any) => {
    const { receiver, amount, fee } = data;

    try {
      controller.wallet.account.updateTemporaryTransaction({
        tx: {
          fromAddress: activeAccount?.address.main,
          toAddress: receiver,
          amount,
          fee,
          token: selectedAsset || null,
          isToken: !!selectedAsset,
          rbf: !ZDAG,
        },
        type: 'sendAsset',
      });

      navigate('/send/confirm');
    } catch (error) {
      alert.removeAll();
      alert.error('An internal error has occurred.');
    }
  };

  useEffect(() => {
    log(`assets: ${activeAccount?.assets}`);
  }, []);

  const disabledFee = activeNetwork === 'main' || activeNetwork === 'testnet';

  const SendForm = () => (
    <div className="mt-4">
      <p className="flex flex-col items-center justify-center text-center font-rubik">
        <span className="text-brand-royalblue font-poppins font-thin">
          Balance
        </span>

        {getAssetBalance(selectedAsset, activeAccount)}
      </p>

      <Form
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{
          verify: true,
          ZDAG: false,
          fee: recommend,
        }}
        onFinish={nextStep}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center"
      >
        <Form.Item
          name="receiver"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                if (
                  !value ||
                  controller.wallet.account.isValidSYSAddress(
                    value,
                    activeNetwork,
                    verifyAddress
                  )
                ) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder="Receiver"
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none"
          />
        </Form.Item>

        <div className="flex items-center justify-center">
          <Form.Item
            name="asset"
            className=""
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Menu as="div" className="relative inline-block text-left">
              <Menu.Button
                disabled={activeAccount?.assets.length === 0}
                className="inline-flex justify-center px-4 py-3 w-full text-white text-sm font-medium bg-fields-input-primary hover:bg-opacity-30 border border-fields-input-border focus:border-fields-input-borderfocus rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
              >
                {selectedAsset?.symbol
                  ? formatURL(String(selectedAsset?.symbol), 2)
                  : 'SYS'}
                <ChevronDoubleDownIcon
                  className="text-violet-200 hover:text-violet-100 -mr-1 ml-2 w-5 h-5"
                  aria-hidden="true"
                />
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                {activeAccount?.assets && activeAccount?.assets.length > 0 && (
                  <Menu.Items className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-lg shadow-2xl overflow-auto origin-top-right">
                    <Menu.Item>
                      <button
                        onClick={() => handleSelectedAsset(-1)}
                        className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                      >
                        <p>SYS</p>

                        <small>Native</small>
                      </button>
                    </Menu.Item>

                    {activeAccount?.assets.map((item) => (
                      <Menu.Item key={item.assetGuid}>
                        <button
                          onClick={() => handleSelectedAsset(item.assetGuid)}
                          className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                        >
                          <p>{item.symbol}</p>
                          <small>{isNFT(item.assetGuid) ? 'NFT' : 'SPT'}</small>
                        </button>
                      </Menu.Item>
                    ))}
                  </Menu.Items>
                )}
              </Transition>
            </Menu>
          </Form.Item>

          <div className="flex gap-x-0.5 items-center justify-center mx-2 w-48">
            <Form.Item
              id="verify-address-switch"
              name="verify"
              className="flex-1 w-32 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full"
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <Tooltip
                childrenClassName="text-brand-white h-4"
                content="Pali verifies your address to check if it is a valid SYS address. It's useful disable this verification if you want to send to specific type of addresses, like legacy. Only disable this verification if you are fully aware of what you are doing."
              >
                <p className="text-10px">Verify address</p>
              </Tooltip>

              <Switch
                checked={verifyAddress}
                onChange={verifyOnChange}
                className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
              >
                <span className="sr-only">Verify address</span>
                <span
                  className={`${
                    verifyAddress
                      ? 'translate-x-6 bg-warning-success'
                      : 'translate-x-1'
                  } inline-block w-2 h-2 transform bg-warning-error rounded-full`}
                />
              </Switch>
            </Form.Item>

            <Form.Item
              name="ZDAG"
              className="flex-1 w-32 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-r-full"
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <Tooltip
                childrenClassName="text-brand-white h-4"
                content="Disable this option for Replace-by-fee (RBF) and enable for Z-DAG, a exclusive Syscoin feature. Z-DAG enables faster transactions but should not be used for high amounts."
              >
                <p className="text-10px">Z-DAG</p>
              </Tooltip>
              <Switch
                checked={ZDAG}
                onChange={ZDAGOnChange}
                className="relative inline-flex items-center w-9 h-4 bg-transparent border border-brand-royalblue rounded-full"
              >
                <span className="sr-only">Z-DAG</span>
                <span
                  className={`${
                    ZDAG
                      ? 'bg-warning-success translate-x-6'
                      : 'bg-warning-error translate-x-1'
                  } inline-block w-2 h-2 transform rounded-full`}
                  id="z-dag-switch"
                />
              </Switch>
            </Form.Item>
          </div>
        </div>

        <Form.Item
          name="amount"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                const balance = selectedAsset
                  ? selectedAsset.balance / 10 ** selectedAsset.decimals
                  : Number(activeAccount?.balance);

                if (value > balance) {
                  return Promise.reject();
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <Input
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none"
            type="number"
            placeholder="Amount"
          />
        </Form.Item>

        <div className="flex gap-x-0.5 items-center justify-center mx-2">
          <Form.Item
            name="recommend"
            className={`${
              disabledFee && 'opacity-50 cursor-not-allowed'
            } bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus w-12 py-1.5 rounded-l-full text-center`}
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Tooltip
              content={`${
                disabledFee
                  ? 'Use recommended fee. Disabled for SYS networks because the fee used in transactions is always the recommended for current SYS network conditions.'
                  : 'Click to use the recommended fee'
              }`}
            >
              <div onClick={handleGetFee}>
                <Icon
                  wrapperClassname="w-6 ml-3 mb-1"
                  name="verified"
                  className={`${
                    disabledFee
                      ? 'cursor-not-allowed text-button-disabled'
                      : 'text-warning-success'
                  }`}
                />
              </div>
            </Tooltip>
          </Form.Item>

          <Form.Item
            name="fee"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
            ]}
          >
            <Tooltip content={disabledFee ? 'Fee network' : ''}>
              <Input
                disabled={disabledFee}
                className={`${
                  disabledFee &&
                  'opacity-50 cursor-not-allowed text-button-disabled'
                } border border-fields-input-border bg-fields-input-primary rounded-r-full w-60 outline-none py-3 pr-8 pl-4 text-sm`}
                id="fee-input"
                type="number"
                placeholder="Fee network"
                value={recommend}
              />
            </Tooltip>
          </Form.Item>
        </div>

        <p className="flex flex-col items-center justify-center mx-14 p-0 text-center text-brand-royalblue">
          <span className="text-xs">
            {`With current network conditions we recommend a fee of
            ${recommend} SYS`}
          </span>

          <span className="mt-0.5 text-brand-white font-rubik text-xs">
            {'≈ '}
            {selectedAsset
              ? getFiatAmount(
                  Number(recommend) + Number(recommend),
                  6,
                  String(fiat.current)
                )
              : getFiatAmount(Number(recommend), 6, String(fiat.current))}
          </span>
        </p>

        <SecondaryButton type="submit" id="next-btn">
          Next
        </SecondaryButton>
      </Form>
    </div>
  );
  return (
    <Layout title="SEND SYS" id="sendSYS-title">
      <SendForm />
    </Layout>
  );
};
