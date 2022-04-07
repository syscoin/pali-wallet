import * as React from 'react';
import { useState, useEffect, Fragment, FC, useCallback } from 'react';
import { usePrice, useStore, useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import { Menu, Transition } from '@headlessui/react';
import { SecondaryButton, Tooltip, Icon } from 'components/index';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { formatUrl, isNFT, getAssetBalance } from 'utils/index';
import { getController } from 'utils/browser';

export const SendEth: FC = () => {
  const controller = getController();

  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [recommend, setRecommend] = useState(0.00001);

  const { alert, navigate } = useUtils();
  const { activeNetwork, fiat, activeAccount } = useStore();
  const [form] = Form.useForm();
  const { getFiatAmount } = usePrice();

  const handleGetGasFee = useCallback(async () => {
    const recommendFee = await controller.wallet.account.getRecommendFee();

    setRecommend(recommendFee);

    form.setFieldsValue({ fee: recommendFee });
  }, [controller.wallet.account, form]);

  useEffect(() => {
    handleGetGasFee();

    form.setFieldsValue({
      verify: true,
      ZDAG: false,
    });
  }, [form, handleGetGasFee]);

  const hasAccountAssets = activeAccount && activeAccount.assets;

  const handleSelectedAsset = (item: number) => {
    if (activeAccount?.assets) {
      const getAsset = Object.values(activeAccount?.assets).find(
        (asset: any) => asset.assetGuid === item
      );

      if (getAsset) {
        setSelectedAsset(getAsset);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const nextStep = () => {
    try {
      navigate('/send/confirm');
    } catch (error) {
      alert.removeAll();
      alert.error('An internal error has occurred.');
    }
  };

  return (
    <>
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
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
      >
        <Form.Item
          name="receiver"
          className="md:w-full md:max-w-md"
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
                  controller.wallet.utils.isValidEthereumAddress(
                    value,
                    activeNetwork
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
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
          />
        </Form.Item>

        <div className="flex items-center justify-center md:w-full md:max-w-md">
          {hasAccountAssets && (
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
                  disabled={!hasAccountAssets}
                  className="inline-flex justify-start px-4 py-3 w-72 text-left text-white text-sm font-medium bg-fields-input-primary hover:bg-opacity-30 border border-fields-input-border focus:border-fields-input-borderfocus rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
                >
                  {selectedAsset?.symbol
                    ? formatUrl(String(selectedAsset?.symbol), 2)
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
                  {hasAccountAssets && (
                    <Menu.Items className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-lg shadow-2xl overflow-auto origin-top-right">
                      {activeAccount &&
                        Object.values(activeAccount.assets).map((item: any) => (
                          <Menu.Item>
                            <button
                              onClick={() =>
                                handleSelectedAsset(item.assetGuid)
                              }
                              className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                            >
                              <p>{item.symbol}</p>
                              <small>
                                {isNFT(item.assetGuid) ? 'NFT' : 'SPT'}
                              </small>
                            </button>
                          </Menu.Item>
                        ))}
                    </Menu.Items>
                  )}
                </Transition>
              </Menu>
            </Form.Item>
          )}
        </div>

        <Form.Item
          name="amount"
          className="md:w-full md:max-w-md"
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
                  : Number(activeAccount?.balances.ethereum);

                if (value > balance) {
                  return Promise.reject();
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <Input
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
            type="number"
            placeholder="Amount"
          />
        </Form.Item>

        <div className="flex gap-x-0.5 items-center justify-center mx-2 md:w-full md:max-w-md">
          <Form.Item
            name="recommend"
            className="py-1.5 w-12 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Tooltip content="Use recommended transaction fee.">
              <div onClick={handleGetGasFee}>
                <Icon
                  wrapperClassname="w-6 ml-3 mb-1"
                  name="verified"
                  className="text-gray-200 cursor-pointer"
                />
              </div>
            </Tooltip>
          </Form.Item>

          <Form.Item
            name="gas"
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
              className="pl-4 pr-8 py-3 w-60 text-sm bg-fields-input-primary border border-fields-input-border rounded-r-full outline-none md:w-full"
              id="gas-input"
              type="number"
              placeholder="Transaction fee"
              value={recommend}
            />
          </Form.Item>
        </div>

        <p className="flex flex-col items-center justify-center p-0 max-w-xs text-center text-brand-royalblue sm:w-full md:my-4">
          <span className="text-xs">
            {`With current network conditions we recommend a fee of ${recommend} ETH`}
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
    </>
  );
};
