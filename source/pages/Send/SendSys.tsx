import * as React from 'react';
import { useState, useEffect, Fragment, FC, useCallback } from 'react';
import { usePrice, useStore, useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import { Switch, Menu, Transition } from '@headlessui/react';
import { SecondaryButton, Tooltip, Icon } from 'components/index';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { formatUrl, isNFT, getAssetBalance } from 'utils/index';
import { getController } from 'utils/browser';

export const SendSys: FC = () => {
  const controller = getController();

  const [ZDAG, setZDAG] = useState<boolean>(false);
  const [verifyAddress, setVerifyAddress] = useState<boolean>(true);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [recommend, setRecommend] = useState(0.00001);

  const { alert, navigate } = useUtils();
  const { activeNetwork, fiat, activeAccount } = useStore();
  const [form] = Form.useForm();
  const { getFiatAmount } = usePrice();

  const handleGetFee = useCallback(async () => {
    const recommendFee = await controller.wallet.account.tx.getRecommendedFee();

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

  const verifyOnChange = (value: any) => {
    setVerifyAddress(value);

    form.setFieldsValue({ verify: value });
  };

  const ZDAGOnChange = (value: any) => {
    setZDAG(value);

    form.setFieldsValue({ ZDAG: value });
  };

  const nextStep = async (data: any) => {
    const { receiver, amount, fee } = data;

    try {
      navigate('/send/confirm', {
        state: {
          tx: {
            amount,
            fee,
            isToken: !!selectedAsset,
            rbf: !ZDAG,
            receivingAddress: receiver,
            sender: activeAccount?.address,
            token: selectedAsset || null,
          },
        },
      });
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
                  controller.wallet.utils.isValidSYSAddress(
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
                  className="inline-flex justify-center py-3 w-20 text-white text-sm font-medium bg-fields-input-primary hover:bg-opacity-30 border border-fields-input-border focus:border-fields-input-borderfocus rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
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
                        activeAccount.assets &&
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

          <div
            className={`${
              hasAccountAssets ? 'w-48 ml-4' : 'w-72'
            } flex gap-x-0.5 items-center justify-center md:w-full`}
          >
            <Form.Item
              id="verify-address-switch"
              name="verify"
              className="flex-1 w-32 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full md:w-full"
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
                <p
                  className={`${
                    !hasAccountAssets && ' absolute top-0 left-8'
                  } text-10px cursor-default`}
                >
                  Verify address
                </p>
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
                <p
                  className={`${
                    !hasAccountAssets && 'absolute top-0 right-14'
                  } text-10px cursor-default`}
                >
                  Z-DAG
                </p>
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
                  : Number(activeAccount?.balances.syscoin);

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
            className="py-1.5 w-12 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full opacity-50 cursor-not-allowed"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Tooltip content="Use recommended fee. Disabled for SYS networks because the fee used in transactions is always the recommended for current SYS network conditions.">
              <div onClick={handleGetFee}>
                <Icon
                  wrapperClassname="w-6 ml-3 mb-1"
                  name="verified"
                  className="text-button-disabled cursor-not-allowed"
                />
              </div>
            </Tooltip>
          </Form.Item>

          <Form.Item
            name="fee"
            className="md:w-full"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
            ]}
          >
            <Tooltip content="Fee network">
              <Input
                disabled
                className="pl-4 pr-8 py-3 w-60 text-button-disabled text-sm bg-fields-input-primary border border-fields-input-border rounded-r-full outline-none opacity-50 cursor-not-allowed md:w-full"
                id="fee-input"
                type="number"
                placeholder="Fee network"
                value={recommend}
              />
            </Tooltip>
          </Form.Item>
        </div>

        <p className="flex flex-col items-center justify-center p-0 max-w-xs text-center text-brand-royalblue sm:w-full md:my-4">
          <span className="text-xs">
            {`With current network conditions we recommend a fee of ${recommend} SYS`}
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
