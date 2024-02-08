import { Menu, Transition } from '@headlessui/react';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Form, Input } from 'antd';
import { uniqueId } from 'lodash';
import React, { useEffect } from 'react';
import { useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import { Card, Layout, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';
import { IERC1155Collection, ITokenEthProps } from 'types/tokens';
import { truncate, getAssetBalance } from 'utils/index';

export const SendEth = () => {
  const { alert, navigate } = useUtils();
  const { t } = useTranslation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const {
    accounts,
    activeAccount: activeAccountMeta,
    currentBlock,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [txFees, setTxFees] = useState<{ gasLimit: number; gasPrice: number }>({
    gasLimit: 0,
    gasPrice: 0,
  });
  const [isMessageVisible, setIsMessageVisible] = useState(false);
  const [form] = Form.useForm();
  const { wallet } = getController();

  const hasAccountAssets =
    activeAccount && activeAccount.assets.ethereum?.length > 0;

  const totalMaxNativeTokenValue =
    +activeAccount?.balances.ethereum - txFees.gasLimit * txFees.gasPrice * 3;

  const messageOpacity = isMessageVisible ? 'opacity-100' : 'opacity-0';

  const handleSelectedAsset = (item: string) => {
    if (activeAccount.assets.ethereum?.length > 0) {
      const getAsset = activeAccount.assets.ethereum.find(
        (asset) => asset.contractAddress === item
      );

      if (getAsset) {
        setSelectedAsset(getAsset);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const tokenId = form.getFieldValue('amount');
  const collectionItemSymbol = selectedAsset?.collection?.find(
    (item) => item.tokenId === +tokenId
  )?.tokenSymbol;

  const finalSymbolToNextStep = selectedAsset?.is1155
    ? collectionItemSymbol || selectedAsset?.collectionName
    : selectedAsset?.tokenSymbol;

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
                  symbol: finalSymbolToNextStep,
                }
              : null,
          },
        },
      });
    } catch (error) {
      alert.removeAll();
      alert.error(t('send.internalError"'));
    }
  };

  const finalBalance = () => {
    if (selectedAsset?.is1155 === undefined) {
      const balance = selectedAsset
        ? getAssetBalance(selectedAsset, activeAccount, false)
        : `${
            activeAccount.balances.ethereum
          } ${activeNetwork.currency?.toUpperCase()}`;
      return balance;
    }

    return selectedAsset.collection.map(
      (nft: IERC1155Collection, index: number, arr: IERC1155Collection[]) =>
        `${nft.balance} ${nft.tokenSymbol} ${
          index === arr.length - 1 ? '' : '- '
        }`
    );
  };

  const getLabel = () => {
    if (selectedAsset?.is1155 === undefined) {
      return selectedAsset?.tokenSymbol
        ? selectedAsset?.tokenSymbol.toUpperCase()
        : activeNetwork.currency.toUpperCase();
    }

    return selectedAsset?.collectionName.toUpperCase();
  };

  const getTitle = () => {
    if (selectedAsset?.is1155 === undefined) {
      return `${t('send.send')} ${
        selectedAsset && selectedAsset.tokenSymbol
          ? selectedAsset.tokenSymbol
          : activeNetwork.currency?.toUpperCase()
      }`;
    }
    return `${t('send.send')} NFT`;
  };

  const getFees = async () => {
    try {
      const currentGasPrice =
        +(await wallet.ethereumTransaction.getRecommendedGasPrice()) / 10 ** 9;

      const currentGasLimit =
        parseInt(currentBlock.gasLimit.toString()) / 10 ** 9;

      setTxFees({ gasLimit: currentGasLimit, gasPrice: currentGasPrice });
    } catch (error) {
      alert.removeAll();
      alert.error(t('send.internalError'));
    }
  };

  useEffect(() => {
    getFees();
  }, []);

  useEffect(() => {
    if (isMessageVisible) {
      setTimeout(() => setIsMessageVisible(false), 4000);
    }
  }, [isMessageVisible]);

  return (
    <Layout title={getTitle()}>
      <div>
        <p className="flex flex-col items-center justify-center text-center font-rubik">
          <span className="text-brand-royalblue font-poppins font-thin">
            {t('send.balance')}
          </span>

          {finalBalance()}
        </p>

        <Form
          validateMessages={{ default: '' }}
          form={form}
          id="send-form"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
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
              placeholder={t('send.receiver')}
              className="sender-eth-input flex items-center"
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
                        {truncate(String(getLabel()), 2)}

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
                        {hasAccountAssets ? (
                          <Menu.Items
                            as="div"
                            className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-bkg-3 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right"
                          >
                            <Menu.Item>
                              <button
                                onClick={() => handleSelectedAsset('-1')}
                                className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                              >
                                <p>{activeNetwork.currency.toUpperCase()}</p>
                                <small>{t('send.receiver')}</small>
                              </button>
                            </Menu.Item>

                            {hasAccountAssets &&
                              Object.values(activeAccount.assets.ethereum).map(
                                (item: ITokenEthProps) => (
                                  <div key={uniqueId()}>
                                    {item.chainId === activeNetwork.chainId ? (
                                      <Menu.Item as="div">
                                        <Menu.Item>
                                          <button
                                            onClick={() =>
                                              handleSelectedAsset(
                                                item.contractAddress
                                              )
                                            }
                                            className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                          >
                                            <p>
                                              {item.isNft && item?.is1155
                                                ? item.collectionName
                                                : item.tokenSymbol}
                                            </p>
                                            <small>
                                              {item.isNft ? 'NFT' : 'Token'}
                                            </small>
                                          </button>
                                        </Menu.Item>
                                      </Menu.Item>
                                    ) : null}
                                  </div>
                                )
                              )}
                          </Menu.Items>
                        ) : null}
                      </Transition>
                    </div>
                  </Menu>
                </Form.Item>
              ) : null}
            </span>
            <Form.Item
              name="amount"
              className="w-full"
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

                    if (
                      !selectedAsset &&
                      parseFloat(value) <= parseFloat(balance) &&
                      Number(value) > 0
                    ) {
                      return Promise.resolve();
                    }

                    if (
                      Boolean(
                        selectedAsset &&
                          selectedAsset.isNft &&
                          Number(value) > 0
                      ) ||
                      Boolean(
                        selectedAsset &&
                          !selectedAsset.isNft &&
                          parseFloat(value) <=
                            parseFloat(selectedAsset.balance) &&
                          Number(value) > 0
                      )
                    ) {
                      return Promise.resolve();
                    }

                    return Promise.reject(t('send.insufficientFunds'));
                  },
                }),
              ]}
            >
              <Input
                id="amount"
                className={`
                  ${
                    hasAccountAssets
                      ? 'mixed-double-border-input amount-input'
                      : 'mixed-right-border-input'
                  }`}
                type="number"
                placeholder={`${
                  selectedAsset && selectedAsset?.isNft
                    ? 'Token ID'
                    : t('send.amount')
                }`}
              />
            </Form.Item>
            <span
              className="disabled inline-flex items-center px-5 bg-fields-input-primary border-2 border-fields-input-primary rounded-r-full cursor-pointer"
              onClick={() => {
                setIsMessageVisible(true);
                form.setFieldValue(
                  'amount',
                  selectedAsset
                    ? selectedAsset.balance
                    : totalMaxNativeTokenValue
                );
              }}
            >
              Max
            </span>
          </div>

          <div
            className={`flex flex-col items-center justify-center w-full md:max-w-full mb-6 transition-all duration-500 ${messageOpacity}`}
          >
            <Card type="info" className="border-alert-darkwarning">
              <div>
                <div className="text-xs text-alert-darkwarning font-bold">
                  <p>{t('send.maxMessage')}</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="absolute bottom-12 md:static md:mt-3">
            <NeutralButton type="submit">{t('buttons.next')}</NeutralButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
