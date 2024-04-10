import { Switch, Menu, Transition } from '@headlessui/react';
import { Form, Input } from 'antd';
import { toSvg } from 'jdenticon';
import { uniqueId } from 'lodash';
import * as React from 'react';
import { useState, useEffect, Fragment, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

//todo: update with the new function
import { isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { Tooltip, Fee, NeutralButton, Layout, Icon } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { IPriceState } from 'state/price/types';
import { RootState } from 'state/store';
import { ITokenSysProps } from 'types/tokens';
import { getController } from 'utils/browser';
import {
  truncate,
  isNFT,
  getAssetBalance,
  formatCurrency,
  ellipsis,
} from 'utils/index';

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
  const [isLoading, setIsLoading] = useState(false);
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

  const isAccountImported =
    accounts[activeAccountMeta.type][activeAccountMeta.id]?.isImported;

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

  const nextStep = async ({ receiver, amount }: any) => {
    try {
      setIsLoading(true);
      const transactionFee =
        await controller.wallet.syscoinTransaction.getEstimateSysTransactionFee(
          { amount, receivingAddress: receiver }
        );
      setIsLoading(false);
      navigate('/send/confirm', {
        state: {
          tx: {
            sender: activeAccount.address,
            receivingAddress: receiver,
            amount: Number(amount),
            fee: transactionFee,
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

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(
      accounts[activeAccountMeta.type][activeAccountMeta.id]?.xpub,
      50,
      {
        backColor: '#07152B',
        padding: 1,
      }
    );
  }, [accounts[activeAccountMeta.type][activeAccountMeta.id]?.address]);

  return (
    <Layout
      title={`${t('send.send')} ${activeNetwork.currency?.toUpperCase()}`}
    >
      <div>
        <div className="flex flex-col items-center justify-center">
          <div className="add-identicon ml-1 mr-2 my-2" />
          <div className="flex gap-1 justify-center items-center">
            <img src={'/assets/images/paliLogoWhiteSmall.svg'} />
            <div className="flex text-white gap-1 text-xs font-normal w-max">
              <p>
                {accounts[activeAccountMeta.type][activeAccountMeta.id]?.label}
              </p>
              <p>
                {ellipsis(
                  accounts[activeAccountMeta.type][activeAccountMeta.id]
                    ?.address,
                  4,
                  4
                )}
              </p>
            </div>
            {isAccountImported && (
              <div className="text-brand-blue100 text-xs font-medium bg-alpha-whiteAlpha200 py-[2px] px-[6px] rounded-[100px] w-max h-full">
                Imported
              </div>
            )}
          </div>
          <div className="flex gap-1 mt-[6px]">
            <p className="text-brand-gray200 text-xs">Your balance:</p>
            <p className="text-white text-xs font-semibold">
              {selectedAsset
                ? getAssetBalance(selectedAsset, activeAccount, true)
                : `${activeAccount.balances.syscoin} ${activeNetwork.currency}`}
            </p>
          </div>
        </div>

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
          className="flex flex-col gap-2 items-center justify-center mt-6 text-center md:w-full"
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
              className="sender-custom-input"
            />
          </Form.Item>
          <div className="flex gap-2 w-full items-center">
            <div className="flex md:max-w-md">
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
                      <Menu.Button className="inline-flex items-center w-[100px] gap-4  justify-center border border-alpha-whiteAlpha300 px-5 py-[7px]  bg-brand-blue800 hover:bg-opacity-30 rounded-[100px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
                        <p className="w-full uppercase text-white text-xs font-normal">
                          {String(
                            selectedAsset?.symbol
                              ? selectedAsset?.symbol
                              : activeNetwork.currency
                          )}
                        </p>
                        <Icon isSvg name="ArrowDown" />
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
                            className="scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-brand-blue800 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right"
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
                              ? activeAccount.assets.syscoin.map(
                                  (item: any) => (
                                    <>
                                      {item?.assetGuid ? (
                                        <Menu.Item as="div" key={uniqueId()}>
                                          <Menu.Item>
                                            <button
                                              onClick={() => {
                                                if (
                                                  activeAccount.isTrezorWallet ||
                                                  activeAccount.isLedgerWallet
                                                ) {
                                                  alert.removeAll();
                                                  alert.error(
                                                    'Cannot send custom token with Trezor Account.'
                                                  );
                                                  return;
                                                }
                                                handleSelectedAsset(
                                                  item.assetGuid
                                                );
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
                                  )
                                )
                              : null}
                          </Menu.Items>
                        }
                      </Transition>
                    </div>
                  </Menu>
                </Form.Item>
              }
            </div>

            <div className="flex md:w-96 relative">
              <Form.Item
                name="amount"
                className="relative w-full"
                hasFeedback
                rules={[
                  {
                    required: true,
                    message: '',
                  },
                ]}
              >
                <Input
                  name="amount"
                  id="with-max-button"
                  className="value-custom-input"
                  type="number"
                  placeholder={'0.0'}
                />
              </Form.Item>
              <span
                className="z-[9999] left-[6%] bottom-[11px] text-xs px-[6px] absolute inline-flex items-center w-[41px] h-[18px] bg-transparent border border-alpha-whiteAlpha300 rounded-[100px] cursor-pointer"
                onClick={() =>
                  form.setFieldValue('amount', balance - 1.01 * recommendedFee)
                }
              >
                MAX
              </span>
            </div>
          </div>
          <Fee
            disabled={true}
            recommend={recommendedFee}
            form={form}
            fiatValue={fiatValueToShow}
          />

          <div className="flex justify-between w-full">
            <div className="flex items-center gap-2">
              <span className="text-sm font-normal text-white">
                {t('send.verifyAddress')}
              </span>
              <Tooltip
                childrenClassName="text-brand-white h-4"
                content={t('send.paliVerifies')}
              >
                <Icon isSvg name="Info" />
              </Tooltip>
            </div>
            <Form.Item
              id="verify-address-switch"
              name="verify"
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <Switch
                checked={verifyAddress}
                onChange={verifyOnChange}
                className="relative inline-flex items-center w-9 h-4 border border-white rounded-full"
              >
                <span
                  className={`${
                    verifyAddress
                      ? 'bg-brand-green translate-x-6'
                      : 'bg-brand-redDark translate-x-1'
                  } inline-block w-2 h-2 transform rounded-full`}
                />
              </Switch>
            </Form.Item>
          </div>
          <div className="flex justify-between w-full">
            <div className="flex items-center gap-2">
              <span className="text-sm font-normal text-white">Z-DAG</span>
              <Tooltip
                childrenClassName="text-brand-white h-4"
                content={t('send.disableThisOption')}
              >
                <Icon isSvg name="Info" />
              </Tooltip>
            </div>
            <Form.Item
              name="ZDAG"
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <Switch
                checked={ZDAG}
                onChange={ZDAGOnChange}
                className="relative inline-flex items-center w-9 h-4 border border-white rounded-full"
              >
                <span
                  className={`${
                    ZDAG
                      ? 'bg-brand-green translate-x-6'
                      : 'bg-brand-redDark translate-x-1'
                  } inline-block w-2 h-2 transform rounded-full`}
                  id="z-dag-switch"
                />
              </Switch>
            </Form.Item>
          </div>

          <div className="relative mt-14 w-[96%] md:static md:mt-3">
            <NeutralButton type="submit" fullWidth loading={isLoading}>
              {t('buttons.next')}
            </NeutralButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
