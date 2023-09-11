import { Switch, Menu, Transition } from '@headlessui/react';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Form, Input } from 'antd';
import { uniqueId } from 'lodash';
import * as React from 'react';
import { useState, useEffect, Fragment, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

//todo: update with the new function
import { isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { Tooltip, Fee, NeutralButton, Layout } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { IPriceState } from 'state/price/types';
import { RootState } from 'state/store';
import { ITokenSysProps } from 'types/tokens';
import { getController } from 'utils/browser';
import { truncate, isNFT, getAssetBalance, formatCurrency } from 'utils/index';

export const SendSys = () => {
  const { getFiatAmount } = usePrice();
  const controller = getController();
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);
  const [verifyAddress, setVerifyAddress] = useState<boolean>(true);
  const [ZDAG, setZDAG] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<ITokenSysProps | null>(
    null
  );
  const [recommendedFee, setRecommendedFee] = useState(0.00001);
  const [form] = Form.useForm();

  const handleGetFee = useCallback(async () => {
    const getRecommendedFee =
      await controller.wallet.syscoinTransaction.getRecommendedFee(
        activeNetwork.url
      );

    setRecommendedFee(getRecommendedFee || Number(0.00001));

    form.setFieldsValue({ fee: getRecommendedFee || Number(0.00001) });
  }, [controller.wallet.account, form]);

  useEffect(() => {
    handleGetFee();

    form.setFieldsValue({
      verify: true,
      ZDAG: false,
      fee: recommendedFee,
    });
  }, [form, handleGetFee]);

  const assets = activeAccount.assets.syscoin
    ? Object.values(activeAccount.assets.syscoin)
    : [];

  const assetDecimals =
    selectedAsset && selectedAsset?.decimals ? selectedAsset.decimals : 8;

  const formattedAssetBalance =
    selectedAsset &&
    truncate(
      formatCurrency(
        String(+selectedAsset.balance / 10 ** assetDecimals),
        selectedAsset.decimals
      ),
      14
    );

  const balance = selectedAsset
    ? +formattedAssetBalance
    : Number(activeAccount?.balances.syscoin);

  const handleSelectedAsset = (item: number) => {
    if (assets) {
      const getAsset = assets.find((asset: any) => asset.assetGuid === item);

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

  const nextStep = ({ receiver, amount, fee }: any) => {
    try {
      navigate('/send/confirm', {
        state: {
          tx: {
            sender: activeAccount.address,
            receivingAddress: receiver,
            amount: Number(amount),
            fee,
            token: selectedAsset
              ? { symbol: selectedAsset.symbol, guid: selectedAsset.assetGuid }
              : null,
            isToken: !!selectedAsset,
            rbf: !ZDAG,
          },
        },
      });
    } catch (error) {
      alert.removeAll();
      alert.error(t('send.internalError'));
    }
  };

  const fiatValueToShow = useMemo(() => {
    const valueToUse = selectedAsset
      ? Number(recommendedFee) + Number(recommendedFee)
      : Number(recommendedFee);

    const getAmount = getFiatAmount(
      valueToUse,
      6,
      String(fiat.asset).toUpperCase()
    );

    return getAmount;
  }, [selectedAsset, recommendedFee]);

  return (
    <Layout
      title={`${t('send.send')} ${activeNetwork.currency?.toUpperCase()}`}
    >
      <div>
        <p className="flex flex-col items-center justify-center text-center font-rubik">
          <span className="text-brand-royalblue font-poppins font-thin">
            {t('send.balance')}
          </span>

          {selectedAsset
            ? getAssetBalance(selectedAsset, activeAccount, true)
            : `${activeAccount.balances.syscoin} ${activeNetwork.currency}`}
        </p>

        <Form
          validateMessages={{ default: '' }}
          form={form}
          id="send-form"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
          initialValues={{
            verify: true,
            ZDAG: false,
            fee: recommendedFee,
          }}
          onFinish={nextStep}
          autoComplete="off"
          className="flex flex-col gap-2 items-center justify-center mt-1 text-center md:w-full"
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
                    isValidSYSAddress(
                      value,
                      activeNetwork.chainId,
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
              placeholder={t('send.receiver')}
              className="sender-input"
            />
          </Form.Item>

          <div className="flex items-center justify-center w-full md:max-w-md">
            {
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
                    <Menu.Button className="inline-flex justify-center py-3 w-28 text-white text-sm font-medium bg-fields-input-primary hover:bg-opacity-30 border border-fields-input-border focus:border-fields-input-borderfocus rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
                      {truncate(
                        String(
                          selectedAsset?.symbol
                            ? selectedAsset?.symbol
                            : activeNetwork.currency
                        ),
                        4
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
                      {
                        <Menu.Items
                          as="div"
                          className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-bkg-3 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right"
                        >
                          <Menu.Item>
                            <button
                              onClick={() => handleSelectedAsset(-1)}
                              className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                            >
                              <p>SYS</p>
                              <small>{t('send.native')}</small>
                            </button>
                          </Menu.Item>

                          {activeAccount.assets.syscoin.length > 0
                            ? activeAccount.assets.syscoin.map((item: any) => (
                                <>
                                  {item?.assetGuid ? (
                                    <Menu.Item as="div" key={uniqueId()}>
                                      <Menu.Item>
                                        <button
                                          onClick={() => {
                                            if (activeAccount.isTrezorWallet) {
                                              alert.removeAll();
                                              alert.error(
                                                'Cannot send custom token with Trezor Account.'
                                              );
                                              return;
                                            }
                                            handleSelectedAsset(item.assetGuid);
                                          }}
                                          className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                        >
                                          <p>{item?.symbol}</p>

                                          <small>
                                            {isNFT(item.assetGuid)
                                              ? 'NFT'
                                              : 'SPT'}
                                          </small>
                                        </button>
                                      </Menu.Item>
                                    </Menu.Item>
                                  ) : null}
                                </>
                              ))
                            : null}
                        </Menu.Items>
                      }
                    </Transition>
                  </div>
                </Menu>
              </Form.Item>
            }

            <div className="flex gap-x-0.5 items-center justify-center w-full">
              <Form.Item
                id="verify-address-switch"
                name="verify"
                className="flex-1 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full md:w-full"
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
                  <p className={`text-10px cursor-default text-brand-white`}>
                    {t('send.verifyAddress')}
                  </p>
                </Tooltip>

                <Switch
                  checked={verifyAddress}
                  onChange={verifyOnChange}
                  className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                >
                  <span className="sr-only">{t('send.verifyAddress')}</span>
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
                className="flex-1 text-center bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-r-full"
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
                  <p className={`text-10px cursor-default text-brand-white`}>
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

          <div className="flex w-80 md:w-96">
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
                  validator(_, value) {
                    if (value <= balance) {
                      return Promise.resolve();
                    }

                    return Promise.reject();
                  },
                }),
              ]}
            >
              <Input
                className="mixed-right-border-input"
                type="number"
                placeholder={t('send.amount')}
              />
            </Form.Item>
            <span
              className="disabled inline-flex items-center px-5 bg-fields-input-primary border-2 border-fields-input-primary rounded-r-full cursor-pointer"
              onClick={() =>
                form.setFieldValue('amount', balance - 1.01 * recommendedFee)
              }
            >
              Max
            </span>
          </div>

          <Fee disabled={true} recommend={recommendedFee} form={form} />

          <p className="flex flex-col items-center justify-center p-0 max-w-xs text-center text-brand-royalblue sm:w-full md:my-4">
            <span className="text-xs">
              {`With current network conditions we recommendedFee a fee of ${recommendedFee} SYS`}
            </span>

            <span className="mt-0.5 text-brand-white font-rubik text-xs">
              {'≈ '}
              {fiatValueToShow}
            </span>
          </p>

          <div className="absolute bottom-12 md:static md:mt-3">
            <NeutralButton type="submit">{t('buttons.next')}</NeutralButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
