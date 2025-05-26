import { Menu, Transition } from '@headlessui/react';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Form } from 'antd';
import { BigNumber, ethers } from 'ethers';
import { toSvg } from 'jdenticon';
import { uniqueId } from 'lodash';
import React, { useEffect } from 'react';
import { useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import errorIcon from 'assets/icons/errorIcon.svg';
import successIcon from 'assets/icons/successIcon.svg';
import { Layout, Button } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { IERC1155Collection, ITokenEthProps } from 'types/tokens';
import { getAssetBalance, ellipsis, formatBalanceDecimals } from 'utils/index';

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
  const [estimatedFee, setEstimatedFee] = useState<number>(0);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [cachedFeeData, setCachedFeeData] = useState<{
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    totalFeeEth: number;
  } | null>(null);
  const [inputValue, setInputValue] = useState({ address: '', amount: 0 });
  const [isValidAddress, setIsValidAddress] = useState(null);
  const [isValidAmount, setIsValidAmount] = useState(null);

  const { controllerEmitter } = useController();

  const [form] = Form.useForm();

  const isAccountImported =
    accounts[activeAccountMeta.type][activeAccountMeta.id]?.isImported;

  const hasAccountAssets =
    activeAccount && activeAccount.assets.ethereum?.length > 0;

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    setInputValue((prevState) => ({ ...prevState, [name]: value }));

    if (name === 'address' && value.trim() !== '') {
      const validAddress = isValidEthereumAddress(value);
      setIsValidAddress(validAddress);
    } else if (name === 'amount') {
      // Don't clear cache on every keystroke - let validation handle it

      const balance = selectedAsset
        ? selectedAsset.balance
        : Number(activeAccount?.balances.ethereum);

      const validAmount =
        Number(value) > 0 && parseFloat(value) <= parseFloat(balance);

      const isValidForSelectedAsset = selectedAsset
        ? selectedAsset.isNft || (!selectedAsset.isNft && validAmount)
        : validAmount;

      if (isValidForSelectedAsset) {
        setIsValidAmount(true);
      } else {
        setIsValidAmount(false);
      }
    } else {
      setIsValidAddress(null);
    }
  };

  const handleSelectedAsset = (item: string) => {
    // Clear cached fee when switching assets
    setCachedFeeData(null);

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

  const nextStep = () => {
    const receiver = form.getFieldValue('receiver');
    const amount = form.getFieldValue('amount');

    try {
      if (isValidAmount && isValidAddress) {
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
      }
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

  const calculateMaxAmount = async () => {
    if (selectedAsset) {
      // For tokens, use full balance as fees are paid in native token
      return selectedAsset.balance;
    }

    // Only show calculating if we don't have cached data
    if (!cachedFeeData) {
      setIsCalculatingFee(true);
    }

    try {
      let totalFeeEth;

      // Use cached fee data if available
      if (cachedFeeData) {
        totalFeeEth = cachedFeeData.totalFeeEth;
      } else {
        // Get fee data for EIP-1559 transaction
        const { maxFeePerGas, maxPriorityFeePerGas } = (await controllerEmitter(
          [
            'wallet',
            'ethereumTransaction',
            'getFeeDataWithDynamicMaxPriorityFeePerGas',
          ]
        )) as any;

        // Estimate gas limit for a simple transfer
        const receiver =
          form.getFieldValue('receiver') ||
          '0x0000000000000000000000000000000000000000';
        // Use a minimal amount for gas estimation (1 wei)
        const testAmount = '1';

        const txObject = {
          from: activeAccount.address,
          to: receiver,
          value: testAmount,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };

        const gasLimit = await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
          [txObject]
        ).then((gas) => BigNumber.from(gas));

        // Calculate total fee in ETH
        const totalFeeWei = gasLimit.mul(BigNumber.from(maxFeePerGas));
        totalFeeEth = Number(totalFeeWei.toString()) / 10 ** 18;

        // Cache the fee data
        setCachedFeeData({
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasLimit: gasLimit.toString(),
          totalFeeEth,
        });
      }

      setEstimatedFee(totalFeeEth);

      // Calculate max amount (balance - fee)
      const maxAmount = Math.max(
        0,
        Number(activeAccount.balances.ethereum) - totalFeeEth
      );

      setIsCalculatingFee(false);
      return maxAmount;
    } catch (error) {
      console.error('Error calculating max amount:', error);
      setIsCalculatingFee(false);
      // Fallback: use a conservative fee estimate based on network
      // For Rollux/Syscoin NEVM, fees are typically much lower
      const conservativeFee = activeNetwork.chainId === 570 ? 0.00001 : 0.0001; // Much lower for Rollux
      return Math.max(
        0,
        Number(activeAccount.balances.ethereum) - conservativeFee
      );
    }
  };

  // Remove the useEffect that was calling getFees since we calculate on demand now

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
    <Layout title={getTitle()}>
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
            <p className="text-white text-xs font-semibold">{finalBalance()}</p>
          </div>
        </div>
        <Form
          validateMessages={{ default: '' }}
          form={form}
          id="send-form"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
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
            <div className="relative">
              <input
                type="text"
                name="address"
                placeholder={t('send.receiver')}
                className="custom-receive-input"
                value={inputValue.address}
                onChange={handleInputChange}
              />
              {isValidAddress !== null && (
                <img
                  src={isValidAddress ? successIcon : errorIcon}
                  alt={isValidAddress ? 'Success' : 'Error'}
                  className={`absolute right-8 ${
                    isValidAmount ? 'top-[12.5px]' : 'top-[11.5px]'
                  }`}
                />
              )}
            </div>
          </Form.Item>

          <div className="flex">
            <span
              className={`${
                hasAccountAssets ? 'flex' : 'hidden'
              } items-center absolute left-[71%] z-[99] h-[40px] justify-center px-5 bg-transparent hover:bg-opacity-30`}
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
                        className="inline-flex justify-center items-center py-3 w-full text-white text-xs font-normal"
                      >
                        {String(getLabel())}

                        <ChevronDoubleDownIcon
                          className="text-white hover:text-violet-100 -mr-1 ml-2 w-5 h-5"
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
                            className="scrollbar-styled absolute z-10 left-[-103px] mt-[1px] py-3 w-44 h-56 text-brand-white font-poppins bg-brand-blue800 border border-alpha-whiteAlpha300 rounded-2xl shadow-2xl overflow-auto origin-top-right"
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
              help={form.getFieldError('amount')[0]}
              validateStatus={
                form.getFieldError('amount').length > 0 ? 'error' : ''
              }
              rules={[
                {
                  required: true,
                  message: t('send.amountRequired'),
                },
                () => ({
                  async validator(_, value) {
                    if (!value || Number(value) <= 0) {
                      return Promise.reject('');
                    }

                    const isToken = !!selectedAsset;
                    const isNFT = selectedAsset?.isNft;

                    // For tokens and NFTs
                    if (isToken) {
                      const balance = selectedAsset.balance;
                      const isValueLowerThanBalance =
                        parseFloat(value) <= parseFloat(balance);

                      if (isNFT) {
                        return Promise.resolve(); // NFTs don't need balance check for tokenId
                      }

                      if (isValueLowerThanBalance) {
                        return Promise.resolve();
                      }

                      return Promise.reject(t('send.insufficientFunds'));
                    }

                    // For native currency, we need to check amount + fee
                    const balanceStr = String(
                      activeAccount?.balances.ethereum || '0'
                    );

                    // Quick check if amount alone exceeds balance using string comparison
                    try {
                      const amountBN = ethers.utils.parseEther(value);
                      const balanceBN = ethers.utils.parseEther(balanceStr);

                      if (amountBN.gt(balanceBN)) {
                        return Promise.reject(t('send.insufficientFunds'));
                      }
                    } catch (e) {
                      // Invalid amount format
                      return Promise.reject('');
                    }

                    try {
                      let totalFeeEth;

                      // Use cached fee data if available
                      if (cachedFeeData) {
                        totalFeeEth = cachedFeeData.totalFeeEth;
                      } else {
                        // Use a conservative fee estimate for initial validation
                        // Don't fetch on every keystroke during typing
                        totalFeeEth =
                          activeNetwork.chainId === 570 ? 0.00001 : 0.0001;
                      }

                      const amountBN = ethers.utils.parseEther(value);
                      const feeBN = ethers.utils.parseEther(
                        totalFeeEth.toString()
                      );
                      const balanceBN = ethers.utils.parseEther(balanceStr);

                      if (amountBN.add(feeBN).gt(balanceBN)) {
                        return Promise.reject(t('send.insufficientFunds'));
                      }

                      return Promise.resolve();
                    } catch (e) {
                      return Promise.reject('');
                    }
                  },
                }),
              ]}
            >
              <div className="relative">
                <span
                  onClick={async () => {
                    const maxAmount = await calculateMaxAmount();
                    form.setFieldValue('amount', maxAmount);
                    setInputValue((prev) => ({
                      ...prev,
                      amount: maxAmount,
                    }));
                    // Manually trigger validation and set the field as valid
                    setIsValidAmount(true);
                    // Validate the form field to enable the Next button
                    form.validateFields(['amount']);
                  }}
                  className="absolute bottom-[11px] left-[22px] text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-[100px] cursor-pointer hover:bg-alpha-whiteAlpha200"
                >
                  {isCalculatingFee ? '...' : 'MAX'}
                </span>
                <input
                  type="number"
                  name="amount"
                  placeholder={`${
                    selectedAsset && selectedAsset?.isNft
                      ? 'Token ID'
                      : t('send.amount')
                  }`}
                  className="custom-autolock-input"
                  value={inputValue.amount}
                  onChange={handleInputChange}
                  onFocus={async () => {
                    // Fetch and cache fee when user focuses on amount field
                    if (!selectedAsset && !cachedFeeData) {
                      try {
                        const feeData = (await controllerEmitter([
                          'wallet',
                          'ethereumTransaction',
                          'getFeeDataWithDynamicMaxPriorityFeePerGas',
                        ])) as any;

                        const receiver =
                          form.getFieldValue('receiver') ||
                          '0x0000000000000000000000000000000000000000';

                        const testAmount = '1';
                        const txObject = {
                          from: activeAccount.address,
                          to: receiver,
                          value: testAmount,
                          maxFeePerGas: feeData.maxFeePerGas,
                          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        };

                        const gasLimitBN = await controllerEmitter(
                          ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
                          [txObject]
                        ).then((gas) => BigNumber.from(gas));

                        const totalFeeWei = gasLimitBN.mul(
                          BigNumber.from(feeData.maxFeePerGas)
                        );
                        const totalFeeEth =
                          Number(totalFeeWei.toString()) / 10 ** 18;

                        setCachedFeeData({
                          maxFeePerGas: feeData.maxFeePerGas,
                          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                          gasLimit: gasLimitBN.toString(),
                          totalFeeEth,
                        });
                      } catch (error) {
                        console.log('Error pre-fetching fee:', error);
                      }
                    }
                  }}
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

          <div className="absolute bottom-12 md:static md:mt-3">
            <Button
              className={`${
                isValidAmount && isValidAddress ? 'opacity-100' : 'opacity-60'
              }xl:p-18 h-[40px] w-[21rem] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none`}
              type="submit"
              onClick={nextStep}
            >
              {t('buttons.next')}
            </Button>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
