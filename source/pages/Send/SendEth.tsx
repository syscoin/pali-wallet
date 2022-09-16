import { Menu, Transition } from '@headlessui/react';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Form, Input } from 'antd';
import { uniqueId } from 'lodash';
import * as React from 'react';
import { useState, useEffect, Fragment, useCallback } from 'react';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import { SecondaryButton, Tooltip, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate, getAssetBalance } from 'utils/index';

import { EditGasFee } from './EditGasFee';

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
  const [recommendedGasPrice, setRecommendedGasPrice] = useState(0);
  const [recommendedGasLimit, setRecommendedGasLimit] = useState(0);
  const [feeValue, setFeeValue] = useState(0);
  const [editGas, setEditGas] = useState(false);
  const [form] = Form.useForm();

  const getRecomendedFees = useCallback(async () => {
    const { getGasLimit, getRecommendedGasPrice } =
      controller.wallet.account.eth.tx;

    const gasPrice = await getRecommendedGasPrice(true);
    const gasLimit = await getGasLimit(form.getFieldValue('receiver'));

    setRecommendedGasPrice(Number(gasPrice.gwei));
    setRecommendedGasLimit(Number(gasLimit));
    setFeeValue(Number(gasPrice.gwei) * Number(gasLimit));

    form.setFieldsValue({
      baseFee: recommendedGasPrice,
      gasLimit,
      gasPrice: gasPrice.gwei,
    });
  }, [controller.wallet.account]);

  useEffect(() => {
    getRecomendedFees();
  }, [getRecomendedFees, form.getFieldValue('receiver')]);

  const hasAccountAssets = activeAccount && activeAccount.assets.length > 0;

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

  const nextStep = ({ receiver, amount, gasPrice, gasLimit }: any) => {
    try {
      navigate('/send/confirm', {
        state: {
          tx: {
            sender: activeAccount.address,
            receivingAddress: receiver,
            amount,
            gasPrice,
            gasLimit,
            fee: String(feeValue),
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
    <>
      {editGas ? (
        <EditGasFee
          setGasFee={setRecommendedGasPrice}
          setEdit={setEditGas}
          form={form}
          setFee={setFeeValue}
        />
      ) : (
        <div className="mt-4">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Balance
            </span>

            {selectedAsset
              ? getAssetBalance(selectedAsset, activeAccount, false)
              : `${activeAccount.balances.ethereum} ${activeNetwork.currency}`}
          </p>

          <Form
            validateMessages={{ default: '' }}
            form={form}
            id="send-form"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 8 }}
            initialValues={{
              baseFee: recommendedGasPrice,
              gasLimit: recommendedGasLimit,
              gasPrice: recommendedGasPrice,
            }}
            onFinish={nextStep}
            autoComplete="off"
            className="standard flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
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
                    if (!value || isValidEthereumAddress(value)) {
                      return Promise.resolve();
                    }

                    return Promise.reject();
                  },
                }),
              ]}
            >
              <Input type="text" placeholder="Receiver" className="large" />
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
                  <Menu>
                    <div className="relative inline-block text-left">
                      <Menu.Button
                        disabled={!hasAccountAssets}
                        className="inline-flex justify-center py-3 w-20 text-white text-sm font-medium bg-fields-input-primary hover:bg-opacity-30 border border-fields-input-border focus:border-fields-input-borderfocus rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
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
                            className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-lg shadow-2xl overflow-auto origin-top-right"
                          >
                            <Menu.Item>
                              <button
                                onClick={() => handleSelectedAsset('-1')}
                                className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                              >
                                <p>
                                  {truncate(String(activeNetwork.currency), 2)}
                                </p>
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
                                          handleSelectedAsset(item.id)
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
              )}

              <div className="flex flex-col">
                <div className="flex w-full">
                  <label className="flex-1 mr-4 text-xs" htmlFor="gasPrice">
                    Gas Price
                  </label>
                  <label className="flex-1 mr-6 text-xs" htmlFor="gasLimit">
                    Gas Limit
                  </label>
                </div>

                <div
                  className={`${
                    hasAccountAssets ? 'w-48 ml-4' : 'w-72'
                  } flex gap-x-0.5 items-center justify-center md:w-full`}
                >
                  <Form.Item
                    name="gasPrice"
                    className="flex-1 w-32 text-center bg-fields-input-primary rounded-l-full md:w-full"
                    rules={[
                      {
                        required: false,
                        message: '',
                      },
                    ]}
                  >
                    <Input
                      type="text"
                      placeholder="Gas Price (GWEI)"
                      className="p-3 w-full text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full outline-none md:w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="gasLimit"
                    className="flex-1 w-32 text-center bg-fields-input-primary rounded-r-full"
                    rules={[
                      {
                        required: false,
                        message: '',
                      },
                    ]}
                  >
                    <Input
                      type="text"
                      placeholder="Gas Limit"
                      className="p-3 w-full text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-r-full outline-none md:w-full"
                    />
                  </Form.Item>
                </div>
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
                      ? selectedAsset.balance
                      : Number(activeAccount?.balances.ethereum);

                    if (value <= balance) {
                      return Promise.resolve();
                    }

                    return Promise.reject();
                  },
                }),
              ]}
            >
              <Input className="large" type="number" placeholder="Amount" />
            </Form.Item>

            <div className="flex gap-x-0.5 items-center justify-center mx-2 md:w-full md:max-w-md">
              <Form.Item
                name="edit"
                className="w-12 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full opacity-70 cursor-pointer"
                rules={[
                  {
                    required: false,
                    message: '',
                  },
                ]}
              >
                <Tooltip content="Click to edit fee">
                  <div onClick={() => setEditGas(true)}>
                    <Icon
                      wrapperClassname="w-6 ml-3 mt-1 h-10"
                      name="edit"
                      className="text-brand-royalbluemedium cursor-pointer"
                    />
                  </div>
                </Tooltip>
              </Form.Item>

              <Form.Item
                name="baseFee"
                className="md:w-full"
                hasFeedback
                rules={[
                  {
                    required: true,
                    message: '',
                  },
                ]}
              >
                <Tooltip content="Recommended network base fee">
                  <Input
                    disabled
                    className="block pl-4 pr-8 py-3 w-60 text-brand-white text-sm bg-fields-input-primary border border-fields-input-border rounded-r-full outline-none opacity-50 cursor-not-allowed md:w-full"
                    id="baseFee-input"
                    type="number"
                    placeholder="Base fee"
                    value={recommendedGasPrice}
                  />
                </Tooltip>
              </Form.Item>
            </div>

            <p className="flex flex-col items-center justify-center p-0 max-w-xs text-center text-brand-royalblue sm:w-full md:my-4">
              <span className="text-xs">Amount + fee</span>

              <span className="mt-0.5 text-brand-white font-rubik text-xs">
                {'≈ '}
              </span>
            </p>

            <SecondaryButton type="submit" id="next-btn">
              Next
            </SecondaryButton>
          </Form>
        </div>
      )}
    </>
  );
};
