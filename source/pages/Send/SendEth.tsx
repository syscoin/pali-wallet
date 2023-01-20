import { Menu, Transition } from '@headlessui/react';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Form, Input } from 'antd';
import { uniqueId } from 'lodash';
import * as React from 'react';
import { useState, useEffect, Fragment } from 'react';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import { Layout, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate, getAssetBalance } from 'utils/index';

export const SendEth = () => {
  const controller = getController();

  const { alert, navigate } = useUtils();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {}, [
    form.getFieldValue('receiver'),
    controller.wallet.account,
  ]);

  const hasAccountAssets =
    activeAccount && activeAccount.assets.ethereum?.length > 0;

  const handleSelectedAsset = (item: string) => {
    if (activeAccount.assets) {
      const getAsset = activeAccount.assets.find(
        (asset: any) => asset.contractAddress === item
      );

      if (getAsset) {
        setSelectedAsset(getAsset);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const nextStep = ({ receiver, amount }: any) => {
    try {
      navigate('/send/confirm', {
        state: {
          tx: {
            sender: activeAccount.address,
            receivingAddress: receiver,
            amount,
            token: selectedAsset
              ? {
                  ...selectedAsset,
                  symbol: selectedAsset.tokenSymbol,
                }
              : null,
          },
        },
      });
    } catch (error) {
      alert.removeAll();
      alert.error('An internal error has occurred.');
    }
  };

  return (
    <Layout title={`SEND ${activeNetwork.currency?.toUpperCase()}`}>
      <div>
        <p className="flex flex-col items-center justify-center text-center font-rubik">
          <span className="text-brand-royalblue font-poppins font-thin">
            Balance
          </span>

          {selectedAsset
            ? getAssetBalance(selectedAsset, activeAccount, false)
            : `${
                activeAccount.balances.ethereum
              } ${activeNetwork.currency?.toUpperCase()}`}
        </p>

        <Form
          validateMessages={{ default: '' }}
          form={form}
          id="send-form"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
          initialValues={{
            amount: 0,
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
                async validator(_, value) {
                  if (isValidEthereumAddress(value)) {
                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input
              id="receiver"
              type="text"
              placeholder="Receiver"
              className="input-medium flex items-center"
            />
          </Form.Item>

          <div className="flex w-80 md:w-96">
            <span
              className={`${
                hasAccountAssets ? 'inline-flex' : 'hidden'
              } items-center px-5 bg-fields-input-primary hover:bg-opacity-30 border border-fields-input-border rounded-l-full`}
            >
              {hasAccountAssets ? (
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
                  <Menu>
                    <div className="relative inline-block text-left">
                      <Menu.Button
                        disabled={!hasAccountAssets}
                        className="inline-flex justify-center py-3 w-full text-white text-sm font-medium"
                      >
                        {truncate(
                          String(
                            selectedAsset?.tokenSymbol
                              ? selectedAsset?.tokenSymbol
                              : activeNetwork.currency
                          ),
                          2
                        )}

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
                          <Menu.Items
                            as="div"
                            className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-bkg-3 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right"
                          >
                            <Menu.Item>
                              <button
                                onClick={() => handleSelectedAsset('-1')}
                                className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                              >
                                <p>MATIC</p>
                                <small>Native</small>
                              </button>
                            </Menu.Item>

                            {hasAccountAssets &&
                              Object.values(activeAccount.assets).map(
                                (item: any) => (
                                  <Menu.Item as="div" key={uniqueId()}>
                                    <Menu.Item>
                                      <button
                                        onClick={() =>
                                          handleSelectedAsset(item.assetGuid)
                                        }
                                        className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                      >
                                        <p>{item.tokenSymbol}</p>
                                        <small>
                                          {item.isNft ? 'NFT' : 'Token'}
                                        </small>
                                      </button>
                                    </Menu.Item>
                                  </Menu.Item>
                                )
                              )}
                          </Menu.Items>
                        )}
                      </Transition>
                    </div>
                  </Menu>
                </Form.Item>
              ) : null}
            </span>

            <Form.Item
              name="amount"
              className="w-full md:max-w-md"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: '',
                },
                () => ({
                  async validator(_, value) {
                    const balance = selectedAsset
                      ? selectedAsset.balance
                      : Number(activeAccount?.balances.ethereum);

                    if (parseFloat(value) <= parseFloat(balance)) {
                      return Promise.resolve();
                    }

                    return Promise.reject();
                  },
                }),
              ]}
            >
              <Input
                id="amount"
                className={`
                  ${
                    hasAccountAssets ? 'mixed-border-input' : 'input-medium'
                  } flex items-center`}
                type="number"
                placeholder="Amount"
              />
            </Form.Item>
          </div>
          <div className="absolute bottom-12 md:static md:mt-3">
            <NeutralButton type="submit">Next</NeutralButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
