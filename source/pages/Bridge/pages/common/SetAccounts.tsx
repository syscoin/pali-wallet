import { Disclosure } from '@headlessui/react';
import { Form } from 'antd';
import { toSvg } from 'jdenticon';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import { useBridge } from '../../context';
import arrow from 'assets/images/arrow.png';
import { Card, Layout, Button, Icon } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { IPaliAccount } from 'state/vault/types';
import { ellipsis } from 'utils/index';

export const SetAccount: React.FC = () => {
  const { t } = useTranslation();
  const { handleStepChange } = useBridge();
  const {
    accounts,
    activeAccount: activeAccountMeta,
    currentBlock,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  const [txFees, setTxFees] = useState<{ gasLimit: number; gasPrice: number }>({
    gasLimit: 0,
    gasPrice: 0,
  });
  const [isMessageVisible, setIsMessageVisible] = useState(false);
  const [inputValue, setInputValue] = useState({ address: '', amount: 0 });
  const [isValidAddress, setIsValidAddress] = useState(null);
  const [isValidAmount, setIsValidAmount] = useState(null);
  const { controllerEmitter } = useController();
  const [form] = Form.useForm();

  const hasAccountAssets =
    activeAccount && activeAccount.assets.ethereum?.length > 0;
  const totalMaxNativeTokenValue =
    +activeAccount?.balances.ethereum - txFees.gasLimit * txFees.gasPrice * 3;
  const messageOpacity = isMessageVisible ? 'opacity-100' : 'opacity-0';

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputValue((prevState) => ({ ...prevState, [name]: value }));

    if (name === 'address' && value.trim() !== '') {
      const validAddress = isValidEthereumAddress(value);
      setIsValidAddress(validAddress);
    } else if (name === 'amount') {
      const validAmount =
        value <= Number(activeAccount?.balances.ethereum) && value > 0;
      setIsValidAmount(validAmount);
    } else {
      setIsValidAddress(null);
    }
  };

  const nextStep = () => {
    handleStepChange('next');
  };

  const getFees = async () => {
    try {
      const currentGasPrice =
        +(await controllerEmitter([
          'wallet',
          'ethereumTransaction',
          'getRecommendedGasPrice',
        ])) /
        10 ** 9;
      if (currentBlock) {
        const currentGasLimit =
          parseInt(currentBlock.gasLimit.toString()) / 10 ** 9;

        setTxFees({ gasLimit: currentGasLimit, gasPrice: currentGasPrice });
      }
    } catch (error) {
      console.log({ error });
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

  const renderAccountItem = (
    currentAccount: IPaliAccount,
    index: number,
    arr: IPaliAccount[]
  ) => {
    const hasOnlyOneAccount = arr.length === 1;
    const isLastItem = index === arr.length - 1;
    const isFirstItem = index === 0;

    const roundedClasses = hasOnlyOneAccount
      ? 'rounded-lg'
      : isFirstItem
      ? 'rounded-tl-lg rounded-tr-lg border-b border-dashed border-gray-600'
      : isLastItem
      ? 'rounded-bl-lg rounded-br-lg'
      : 'border-b border-dashed border-gray-600';

    const itemClasses = `
    backface-visibility-hidden ${roundedClasses} flex flex-row items-center justify-between p-2 w-full text-white text-sm font-medium active:bg-opacity-40 bg-brand-blue500 focus:outline-none cursor-pointer transform transition duration-300
  `;

    return (
      <li key={index} className={itemClasses}>
        <div className="flex gap-2">
          <span className="text-left">{currentAccount.label}</span>
          <span className="text-right">{currentAccount.balances.syscoin}</span>
        </div>
        <span className="ml-auto text-right">
          {ellipsis(currentAccount.address, 10)}
        </span>
      </li>
    );
  };

  return (
    <Layout title={t('bridge.bridgeTitle')}>
      <div>
        <div className="flex flex-col items-center justify-center w-full">
          <div className="w-40 bg-white bg-opacity-10 px-4 py-2 flex justify-evenly rounded-xl">
            <p className="text-brand-pink200 text-base">UTXO</p>
            <Icon name="ArrowLeft" isSvg className="rotate-180 opacity-50" />
            <p className="text-brand-blue200 text-base">EVM</p>
          </div>
        </div>

        <Form
          validateMessages={{ default: '' }}
          form={form}
          id="send-form"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
          onFinish={nextStep}
          autoComplete="off"
          className="flex flex-col gap-4 items-center justify-center mt-4 text-center w-full"
        >
          <Form.Item
            name="receiver"
            className="w-full"
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
            <div className="relative w-full flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="w-full flex justify-between">
                  <p className="text-base">From</p>
                  <p className="text-base">Syscoin Mainnet</p>
                </div>
                <Disclosure>
                  {({ open }) => (
                    <div className="relative w-full">
                      <Disclosure.Button className="flex items-center justify-start w-full text-base cursor-pointer transition-all duration-200">
                        <div className="custom-autolock-input !w-full flex justify-between !py-3 !px-2">
                          <div className="flex w-full justify-between px-2">
                            <div className="flex gap-2">
                              <span className="text-left">
                                {activeAccount.label}
                              </span>
                              <span className="text-right">
                                {activeAccount.balances.syscoin} SYS
                              </span>
                            </div>
                            <span className="ml-auto text-right">
                              {ellipsis(activeAccount.address, 10)}
                            </span>
                          </div>
                          <img
                            src={arrow}
                            className={`flex items-center ${
                              open ? 'transform rotate-180' : ''
                            } text-brand-white`}
                            id="network-settings-btn"
                          />
                        </div>
                      </Disclosure.Button>

                      <Disclosure.Panel className="h-max pb-2 pt-0.5 text-sm absolute w-full">
                        {Object.values(accounts[activeAccountMeta.type]).map(
                          renderAccountItem
                        )}
                      </Disclosure.Panel>
                    </div>
                  )}
                </Disclosure>
              </div>

              <div className="flex flex-col gap-2">
                <div className="w-full flex justify-between">
                  <p className="text-base">To</p>
                  <p className="text-base">Syscoin NEVM</p>
                </div>
                <Disclosure>
                  {({ open }) => (
                    <div className="relative w-full">
                      <Disclosure.Button className="flex items-center justify-start w-full text-base cursor-pointer transition-all duration-200">
                        <div className="custom-autolock-input !w-full flex justify-between !py-3 !px-2">
                          <div className="flex w-full justify-between px-2">
                            <div className="flex gap-2">
                              <span className="text-left">
                                {activeAccount.label}
                              </span>
                              <span className="text-right">
                                {activeAccount.balances.syscoin} SYS
                              </span>
                            </div>
                            <span className="ml-auto text-right">
                              {ellipsis(activeAccount.address, 10)}
                            </span>
                          </div>
                          <img
                            src={arrow}
                            className={`flex items-center ${
                              open ? 'transform rotate-180' : ''
                            } text-brand-white`}
                            id="network-settings-btn"
                          />
                        </div>
                      </Disclosure.Button>

                      <Disclosure.Panel className="h-max pb-2 pt-0.5 text-sm absolute w-full">
                        {Object.values(accounts[activeAccountMeta.type]).map(
                          renderAccountItem
                        )}
                      </Disclosure.Panel>
                    </div>
                  )}
                </Disclosure>
              </div>
            </div>
          </Form.Item>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="w-full flex justify-between">
                <p className="text-base">Amount</p>
              </div>
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
                      const balance = `${activeAccount?.balances.ethereum}`;

                      if (
                        parseFloat(value) <= parseFloat(balance) &&
                        Number(value) > 0
                      ) {
                        return Promise.resolve();
                      }

                      return Promise.reject(t('send.insufficientFunds'));
                    },
                  }),
                ]}
              >
                <div className="relative">
                  <span
                    onClick={() => {
                      setIsMessageVisible(true);
                      form.setFieldValue('amount', totalMaxNativeTokenValue);
                      setInputValue((prev) => ({
                        ...prev,
                        amount: totalMaxNativeTokenValue,
                      }));
                    }}
                    className="absolute bottom-[11px] left-[22px] text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-[100px]"
                  >
                    MAX
                  </span>
                  <input
                    type="number"
                    name="amount"
                    placeholder={t('send.amount')}
                    className="custom-autolock-input"
                    value={inputValue.amount}
                    onChange={handleInputChange}
                  />
                  <div className="relative">
                    {isValidAmount !== null && (
                      <img
                        src={
                          isValidAmount === true
                            ? '/assets/icons/successIcon.svg'
                            : '/assets/icons/errorIcon.svg'
                        }
                        alt={isValidAmount === true ? 'Success' : 'Error'}
                        className={`absolute`}
                        style={
                          hasAccountAssets
                            ? {
                                right: `5rem`,
                                top: `-28.5px`,
                              }
                            : { right: `2rem`, top: `-26.5px` }
                        }
                      />
                    )}
                  </div>
                </div>
              </Form.Item>
            </div>
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
            <Button
              className={`${
                isValidAmount && isValidAddress ? 'opacity-100' : 'opacity-60'
              }xl:p-18 h-[40px] w-[21rem] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none`}
              type="submit"
              onClick={() => handleStepChange('next')}
            >
              {t('buttons.next')}
            </Button>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
