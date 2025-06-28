import { Menu } from '@headlessui/react';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Form } from 'antd';
import { BigNumber, ethers } from 'ethers';
import { toSvg } from 'jdenticon';
import { uniqueId } from 'lodash';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import errorIcon from 'assets/all_assets/errorIcon.svg';
import successIcon from 'assets/all_assets/successIcon.svg';
import { PaliWhiteSmallIconSvg } from 'components/Icon/Icon';
import { Button, Tooltip, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { IERC1155Collection, ITokenEthProps } from 'types/tokens';
import { getAssetBalance, ellipsis, adjustUrl } from 'utils/index';

export const SendEth = () => {
  const { alert, navigate } = useUtils();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { account: activeAccount, assets: activeAccountAssets } = useSelector(
    selectActiveAccountWithAssets
  );

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  // ✅ MEMOIZED: Computed values
  const isAccountImported = useMemo(
    () => activeAccount?.isImported || false,
    [activeAccount?.isImported]
  );

  const hasAccountAssets = useMemo(
    () => activeAccountAssets && activeAccountAssets.ethereum?.length > 0,
    [activeAccountAssets?.ethereum?.length]
  );

  // State management
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [isCalculatingGas, setIsCalculatingGas] = useState(false);
  const [cachedFeeData, setCachedFeeData] = useState<{
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    totalFeeEth: number;
  } | null>(null);
  const [inputValue, setInputValue] = useState({ address: '', amount: 0 });
  const [isValidAddress, setIsValidAddress] = useState(null);
  const [isValidAmount, setIsValidAmount] = useState(null);

  const [form] = Form.useForm();

  // ✅ MEMOIZED: Handlers
  const handleInputChange = useCallback(
    (e) => {
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
    },
    [selectedAsset, activeAccount?.balances.ethereum]
  );

  const handleSelectedAsset = useCallback(
    (item: string) => {
      // Clear cached fee when switching assets
      setCachedFeeData(null);

      if (item === '-1') {
        setSelectedAsset(null);
      } else if (activeAccountAssets?.ethereum?.length > 0) {
        const getAsset = activeAccountAssets.ethereum.find(
          (asset) => asset.contractAddress === item
        );

        if (getAsset) {
          setSelectedAsset(getAsset);
          return;
        }

        setSelectedAsset(null);
      }
    },
    [activeAccountAssets?.ethereum]
  );

  // ✅ MEMOIZED: Complex computed values
  const tokenId = useMemo(() => form.getFieldValue('amount'), [form]);

  const collectionItemSymbol = useMemo(
    () =>
      selectedAsset?.collection?.find((item) => item.tokenId === +tokenId)
        ?.tokenSymbol,
    [selectedAsset?.collection, tokenId]
  );

  const finalSymbolToNextStep = useMemo(
    () =>
      selectedAsset?.is1155
        ? collectionItemSymbol || selectedAsset?.collectionName
        : selectedAsset?.tokenSymbol,
    [
      selectedAsset?.is1155,
      collectionItemSymbol,
      selectedAsset?.collectionName,
      selectedAsset?.tokenSymbol,
    ]
  );

  const nextStep = useCallback(() => {
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
              // Pass cached gas data to avoid recalculation on confirm screen
              cachedGasData: !selectedAsset ? cachedFeeData : null,
            },
          },
        });
      }
    } catch (error) {
      alert.error(t('send.internalError'));
    }
  }, [
    isValidAmount,
    isValidAddress,
    form,
    navigate,
    activeAccount.address,
    selectedAsset,
    finalSymbolToNextStep,
    alert,
    t,
    cachedFeeData,
  ]);

  const finalBalance = useCallback(() => {
    if (selectedAsset?.is1155 === undefined) {
      const balance = selectedAsset
        ? getAssetBalance(selectedAsset, activeAccount, false, activeNetwork)
        : `${
            activeAccount.balances.ethereum
          } ${activeNetwork.currency.toUpperCase()}`;
      return balance;
    }

    return selectedAsset.collection.map(
      (nft: IERC1155Collection, index: number, arr: IERC1155Collection[]) =>
        `${nft.balance} ${nft.tokenSymbol} ${
          index === arr.length - 1 ? '' : '- '
        }`
    );
  }, [selectedAsset, activeAccount, activeNetwork]);

  const getLabel = useCallback(() => {
    if (selectedAsset?.is1155 === undefined) {
      return selectedAsset?.tokenSymbol
        ? selectedAsset?.tokenSymbol.toUpperCase()
        : activeNetwork.currency.toUpperCase();
    }

    return selectedAsset?.collectionName.toUpperCase();
  }, [selectedAsset, activeNetwork.currency]);

  const openAccountInExplorer = useCallback(() => {
    const accountAddress = activeAccount?.address;
    if (!accountAddress) return;

    let explorerUrl;
    if (isBitcoinBased) {
      // For UTXO networks, use the network URL pattern
      explorerUrl = `${adjustUrl(activeNetwork.url)}address/${accountAddress}`;
    } else {
      // For EVM networks, use the explorer pattern
      explorerUrl = `${adjustedExplorer}address/${accountAddress}`;
    }

    window.open(explorerUrl, '_blank');
  }, [
    activeAccount?.address,
    isBitcoinBased,
    activeNetwork.url,
    adjustedExplorer,
  ]);

  const calculateGasFees = useCallback(async () => {
    // Only calculate for native ETH transactions
    if (selectedAsset) {
      return;
    }

    // Don't recalculate if already calculating
    if (isCalculatingGas) {
      return;
    }

    const receiver =
      form.getFieldValue('receiver') ||
      '0x0000000000000000000000000000000000000000';

    setIsCalculatingGas(true);

    try {
      // Get fee data for EIP-1559 transaction
      const { maxFeePerGas, maxPriorityFeePerGas } = (await controllerEmitter([
        'wallet',
        'ethereumTransaction',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
      ])) as any;

      // Estimate gas limit for a simple transfer
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
      const totalFeeEth = Number(totalFeeWei.toString()) / 10 ** 18;

      // Cache the fee data
      setCachedFeeData({
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit: gasLimit.toString(),
        totalFeeEth,
      });
    } catch (error) {
      console.error('Error calculating gas fees:', error);
      // Don't cache on error, but don't block the UI either
    } finally {
      setIsCalculatingGas(false);
    }
  }, [selectedAsset, activeAccount.address, controllerEmitter, form]); // isCalculatingGas excluded to prevent loops

  const calculateMaxAmount = useCallback(async () => {
    if (selectedAsset) {
      // For tokens, use full balance as fees are paid in native token
      return selectedAsset.balance;
    }

    // Only show calculating if we don't have cached data
    if (!cachedFeeData) {
      setIsCalculatingFee(true);
      // Calculate gas fees first
      await calculateGasFees();
    }

    try {
      let totalFeeEth;

      // Use cached fee data if available
      if (cachedFeeData) {
        totalFeeEth = cachedFeeData.totalFeeEth;
      } else {
        // If still no cached data after calculation, use conservative estimate
        const conservativeFee =
          activeNetwork.chainId === 570 ? 0.00001 : 0.0001;
        totalFeeEth = conservativeFee;
      }

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
  }, [
    selectedAsset,
    cachedFeeData,
    calculateGasFees,
    activeAccount.balances.ethereum,
    activeNetwork.chainId,
  ]);

  // ✅ OPTIMIZED: Effect with proper dependencies
  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder || !activeAccount?.xpub) return;

    placeholder.innerHTML = toSvg(activeAccount.xpub, 50, {
      backColor: '#07152B',
      padding: 1,
    });
  }, [activeAccount?.address, activeAccount?.xpub]);

  // Calculate gas fees when component mounts or asset changes
  useEffect(() => {
    // Only calculate for native ETH (not tokens)
    if (!selectedAsset && activeAccount?.address && !cachedFeeData) {
      calculateGasFees();
    }
  }, [selectedAsset, activeAccount?.address, cachedFeeData, calculateGasFees]);

  // Recalculate gas when receiver address changes
  useEffect(() => {
    if (
      !selectedAsset &&
      isValidAddress &&
      activeAccount?.address &&
      inputValue.address
    ) {
      // Clear cache to force recalculation with new receiver
      setCachedFeeData(null);
      calculateGasFees();
    }
  }, [
    inputValue.address,
    isValidAddress,
    selectedAsset,
    activeAccount?.address,
    calculateGasFees,
  ]);

  return (
    <>
      <div className="w-full md:max-w-sm">
        <div className="flex flex-col items-center justify-center">
          <Tooltip content={t('home.viewOnExplorer')}>
            <div
              className="add-identicon ml-1 mr-2 my-2 cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80 rounded-full"
              onClick={openAccountInExplorer}
              title={t('home.viewAccountOnExplorer')}
            />
          </Tooltip>
          <div className="flex gap-1 justify-center items-center">
            <PaliWhiteSmallIconSvg />
            <div className="flex text-white gap-1 text-xs font-normal w-max items-center">
              <p className="font-medium">{activeAccount?.label}</p>
              <div className="flex items-center gap-1">
                <Tooltip content={t('buttons.copy')}>
                  <p
                    className="cursor-pointer hover:text-brand-royalblue transition-colors duration-200 select-none"
                    onClick={() => {
                      navigator.clipboard.writeText(activeAccount?.address);
                      alert.success(t('home.addressCopied'));
                    }}
                  >
                    {ellipsis(activeAccount?.address, 4, 4)}
                  </p>
                </Tooltip>
                <Tooltip content={t('buttons.copy')}>
                  <div
                    className="cursor-pointer transition-colors duration-200 ml-1"
                    onClick={() => {
                      navigator.clipboard.writeText(activeAccount?.address);
                      alert.success(t('home.addressCopied'));
                    }}
                  >
                    <Icon
                      name="copy"
                      className="text-xs hover:text-brand-royalblue"
                    />
                  </div>
                </Tooltip>
              </div>
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
                    {({ open }) => (
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

                        {hasAccountAssets ? (
                          <Menu.Items
                            as="div"
                            className={`scrollbar-styled absolute z-10 left-[-103px] mt-[1px] py-3 w-44 h-56 text-brand-white font-poppins bg-brand-blue800 border border-alpha-whiteAlpha300 rounded-2xl shadow-2xl overflow-auto origin-top-right
                            transform transition-all duration-100 ease-out ${
                              open
                                ? 'opacity-100 scale-100 pointer-events-auto'
                                : 'opacity-0 scale-95 pointer-events-none'
                            }`}
                            static
                          >
                            <Menu.Item>
                              <button
                                onClick={() => handleSelectedAsset('-1')}
                                className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                              >
                                <p>
                                  {activeNetwork?.currency.toUpperCase() ||
                                    'SYS'}
                                </p>
                                <small>{t('send.receiver')}</small>
                              </button>
                            </Menu.Item>

                            {hasAccountAssets &&
                              Object.values(activeAccountAssets.ethereum).map(
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
                      </div>
                    )}
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
                    // First ensure gas is calculated for native ETH
                    if (!selectedAsset && !cachedFeeData) {
                      setIsCalculatingFee(true);
                    }

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
                  {isCalculatingFee ? (
                    <span className="animate-pulse">...</span>
                  ) : (
                    'MAX'
                  )}
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
                />
                <div className="relative">
                  {isValidAmount !== null && (
                    <img
                      src={
                        isValidAmount === true
                          ? '/assets/all_assets/successIcon.svg'
                          : '/assets/all_assets/errorIcon.svg'
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
                isValidAmount &&
                isValidAddress &&
                (selectedAsset || cachedFeeData) &&
                !isCalculatingGas
                  ? 'opacity-100'
                  : 'opacity-60'
              }xl:p-18 h-[40px] w-[21rem] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none`}
              type="submit"
              onClick={nextStep}
              disabled={
                !isValidAmount ||
                !isValidAddress ||
                (!selectedAsset && !cachedFeeData) ||
                isCalculatingGas
              }
            >
              {!selectedAsset && (isCalculatingGas || !cachedFeeData) ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-brand-blue400 border-t-transparent rounded-full" />
                  Calculating fees...
                </span>
              ) : (
                t('buttons.next')
              )}
            </Button>
          </div>
        </Form>
      </div>
    </>
  );
};
