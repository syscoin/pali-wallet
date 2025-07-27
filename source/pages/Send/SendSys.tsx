import { Switch, Menu } from '@headlessui/react';
import { Form, Input } from 'antd';
import currency from 'currency.js';
import { toSvg } from 'jdenticon';
import * as React from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

//todo: update with the new function

import { TransactionType } from '../../types/transactions';
import { PaliWhiteSmallIconSvg, ArrowDownSvg } from 'components/Icon/Icon';
import { Tooltip, Fee, NeutralButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { ISyscoinTransactionError, INetworkType } from 'types/network';
import { ITokenSysProps } from 'types/tokens';
import {
  truncate,
  isNFT,
  getAssetBalance,
  formatCurrency,
  ellipsis,
  MINIMUM_FEE,
  adjustUrl,
  createNavigationContext,
  navigateWithContext,
  saveNavigationState,
} from 'utils/index';
import { isValidSYSAddress } from 'utils/validations';

export const SendSys = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const location = useLocation();

  const { account: activeAccount, assets: accountAssets } = useSelector(
    selectActiveAccountWithAssets
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  // Restore state from navigation if available
  const initialRBF = location.state?.RBF ?? true;
  const [RBF, setRBF] = useState<boolean>(initialRBF);
  const initialSelectedAsset = location.state?.selectedAsset || null;
  const initialIsMaxSend = location.state?.isMaxSend ?? false;

  const [selectedAsset, setSelectedAsset] = useState<ITokenSysProps | null>(
    initialSelectedAsset
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isMaxSend, setIsMaxSend] = useState<boolean>(initialIsMaxSend);

  const [form] = Form.useForm();

  // Fee rate will be managed by the Fee component
  const [feeRate, setFeeRate] = useState<number | null>(null);

  // Track form value changes using a ref to avoid dependency issues
  const formValuesRef = useRef<any>({});

  // Save navigation state when user completes interaction
  const saveCurrentState = useCallback(async () => {
    const state = {
      formValues: formValuesRef.current,
      selectedAsset,
      RBF,
      isMaxSend,
    };

    await saveNavigationState(
      location.pathname,
      undefined,
      state,
      location.state?.returnContext
    );
  }, [selectedAsset, RBF, isMaxSend, location]);

  // Update form values ref when they change (no save yet)
  const handleFormValuesChange = useCallback(
    (changedValues: any, allValues: any) => {
      formValuesRef.current = allValues;
    },
    []
  );

  // Save state when user blurs from input fields
  const handleFieldBlur = useCallback(() => {
    const hasFormData = Object.values(formValuesRef.current).some(
      (value) => value !== undefined && value !== '' && value !== null
    );

    // Only save if there's actual form data or non-default component state
    if (
      hasFormData ||
      selectedAsset !== null ||
      RBF !== true ||
      isMaxSend !== false
    ) {
      saveCurrentState();
    }
  }, [selectedAsset, RBF, isMaxSend, saveCurrentState]);

  // Save component state when non-form state changes
  useEffect(() => {
    // Don't save on initial mount or when there's no meaningful state
    if (
      selectedAsset === null &&
      RBF === true &&
      isMaxSend === false &&
      Object.keys(formValuesRef.current).length === 0
    ) {
      return;
    }

    // Save immediately when these state values change
    saveCurrentState();
  }, [selectedAsset, RBF, isMaxSend, saveCurrentState]);

  // Track if we've already restored form values to prevent duplicate restoration
  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);

  // Restore form values if coming back from navigation
  useEffect(() => {
    if (
      location.state?.scrollPosition !== undefined &&
      !hasRestoredRef.current
    ) {
      const { formValues, isMaxSend: restoredIsMaxSend } = location.state;

      if (formValues) {
        isRestoringRef.current = true;
        hasRestoredRef.current = true;
        form.setFieldsValue(formValues);
        // Also update the ref to keep it in sync
        formValuesRef.current = formValues;

        // If this was a max send, recalculate the max amount
        if (restoredIsMaxSend) {
          // Add a small delay to ensure form is fully initialized
          setTimeout(() => {
            handleMaxButton();
            isRestoringRef.current = false;
          }, 100);
        } else {
          isRestoringRef.current = false;
        }
      }

      // Do NOT clear the navigation state here - we need it to persist
      // for when the popup is closed and reopened
    }
  }, [location.state, form]);

  // ✅ MEMOIZED: Callbacks to prevent unnecessary re-renders
  const handleFeeChange = useCallback((newFee: number) => {
    setFeeRate(newFee);
  }, []);

  // ✅ OPTIMIZED: Fee fetching with proper dependencies
  useEffect(() => {
    const fetchInitialFee = async () => {
      try {
        const fee = (await controllerEmitter(
          ['wallet', 'getRecommendedFee'],
          []
        )) as number;
        setFeeRate(fee);
        form.setFieldsValue({ fee });
      } catch (error) {
        console.error('Failed to fetch initial fee:', error);
        const fallbackFee = 0.0000001;
        setFeeRate(fallbackFee);
        form.setFieldsValue({ fee: fallbackFee });
      }
    };
    fetchInitialFee();
  }, [activeNetwork.chainId, form, controllerEmitter]);

  // ✅ MEMOIZED: Computed values
  const isAccountImported = useMemo(
    () => activeAccount?.isImported,
    [activeAccount?.isImported]
  );

  const assets = useMemo(
    () => (accountAssets.syscoin ? Object.values(accountAssets.syscoin) : []),
    [accountAssets.syscoin]
  );

  const assetDecimals = useMemo(
    () =>
      selectedAsset && selectedAsset?.decimals ? selectedAsset.decimals : 8,
    [selectedAsset?.decimals]
  );

  const formattedAssetBalance = useMemo(
    () =>
      selectedAsset &&
      truncate(
        formatCurrency(String(+selectedAsset.balance), selectedAsset.decimals),
        14
      ),
    [selectedAsset, assetDecimals]
  );

  // Keep balance as string to preserve precision
  const balanceStr = useMemo(
    () =>
      selectedAsset
        ? formattedAssetBalance || '0'
        : activeAccount?.balances[INetworkType.Syscoin] || '0',
    [selectedAsset, formattedAssetBalance, activeAccount?.balances]
  );

  // Watch the amount field for changes
  const watchedAmount = Form.useWatch('amount', form);

  // Update isMaxSend based on comparison with balance
  useEffect(() => {
    if (watchedAmount !== undefined && watchedAmount !== null) {
      const inputAmount = String(watchedAmount).trim();

      if (inputAmount && balanceStr) {
        // Normalize both values to handle "1.0" == "1" cases
        // parseFloat and back to string removes trailing zeros
        const normalizeAmount = (val: string) => {
          const parsed = parseFloat(val);
          return isNaN(parsed) ? val : parsed.toString();
        };

        const normalizedInput = normalizeAmount(inputAmount);
        const normalizedBalance = normalizeAmount(String(balanceStr));

        setIsMaxSend(normalizedInput === normalizedBalance);
      } else {
        setIsMaxSend(false);
      }
    } else {
      setIsMaxSend(false);
    }
  }, [watchedAmount, balanceStr]);

  const handleMaxButton = useCallback(() => {
    // Simply fill in the full balance
    form.setFieldValue('amount', balanceStr);
    setIsMaxSend(true);
    form.validateFields(['amount']); // Trigger validation after setting value
  }, [balanceStr, form]);

  const handleSelectedAsset = useCallback(
    (item: number) => {
      if (assets) {
        const getAsset = assets.find((asset: any) => asset.assetGuid === item);

        if (getAsset) {
          setSelectedAsset(getAsset);
          return;
        }

        setSelectedAsset(null);
      }
    },
    [assets]
  );

  const openAccountInExplorer = useCallback(() => {
    const accountAddress = activeAccount?.address;
    if (!accountAddress) return;

    window.open(
      `${adjustUrl(activeNetwork.url)}address/${accountAddress}`,
      '_blank'
    );
  }, [activeAccount?.address, activeNetwork.url]);

  const RBFOnChange = useCallback(
    (value: any) => {
      // For SPTs, the switch shows ZDAG, so we need to invert the value
      // When ZDAG is enabled (value=true), RBF should be disabled (false)
      const rbfValue = selectedAsset ? !value : value;
      setRBF(rbfValue);

      form.setFieldsValue({ RBF: rbfValue });
    },
    [selectedAsset, form]
  );

  const nextStep = async ({ receiver, amount }: any) => {
    // Prevent submission during restoration
    if (isRestoringRef.current) {
      console.log('[SendSys] Preventing submission during restoration');
      return;
    }

    try {
      setIsLoading(true);

      // Capture ALL form values at submission time
      const allFormValues = form.getFieldsValue();

      // For native SYS transactions
      if (!selectedAsset) {
        const amountCurrency = currency(amount, { precision: 8 });
        const balanceCurrency = currency(
          activeAccount.balances[INetworkType.Syscoin],
          {
            precision: 8,
          }
        );

        // Determine if this is a MAX send by comparing amount to balance
        const isMaxTransaction = amountCurrency.value === balanceCurrency.value;

        // For validation, we need to estimate the total fee to ensure sufficient funds
        let estimatedTotalFee = 0.001; // Conservative default
        let psbt = null;
        try {
          const { fee: estimatedFee, psbt: estimatedPsbt } =
            (await controllerEmitter(
              ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
              [
                {
                  amount: Number(amount),
                  receivingAddress: receiver,
                  feeRate,
                  txOptions: { rbf: RBF },
                  isMax: isMaxTransaction,
                  token: null, // Explicitly pass null for native transactions
                },
              ]
            )) as { fee: number; psbt: any };

          estimatedTotalFee = estimatedFee;
          psbt = estimatedPsbt;

          // Critical validation: If PSBT creation failed, we cannot proceed
          if (!psbt || !estimatedPsbt) {
            throw new Error('Failed to create transaction PSBT');
          }
        } catch (error: any) {
          setIsLoading(false);

          // Handle structured errors from syscoinjs-lib
          if (error.error && error.code) {
            const sysError = error as ISyscoinTransactionError;

            switch (sysError.code) {
              case 'INSUFFICIENT_FUNDS':
                alert.error(
                  t('send.insufficientFundsDetails', {
                    shortfall: sysError.shortfall?.toFixed(8) || '0',
                    currency: activeNetwork.currency.toUpperCase(),
                  })
                );
                break;

              case 'SUBTRACT_FEE_FAILED':
                alert.error(
                  t('send.subtractFeeFailedDetails', {
                    fee: sysError.fee?.toFixed(8) || '0',
                    remainingFee: sysError.remainingFee?.toFixed(8) || '0',
                    currency: activeNetwork.currency.toUpperCase(),
                  })
                );
                break;

              case 'INVALID_FEE_RATE':
                alert.error(t('send.invalidFeeRate'));
                break;

              case 'INVALID_AMOUNT':
                alert.error(t('send.invalidAmount'));
                break;

              default:
                alert.error(
                  t('send.transactionCreationFailedWithCode', {
                    code: sysError.code,
                    message: sysError.message,
                  })
                );
            }
          } else {
            // Fallback for non-structured errors
            alert.error(
              t('send.transactionCreationFailed', { error: error.message }) ||
                `Failed to create transaction: ${error.message}. Please try again.`
            );
          }
          return;
        }

        // For non-max sends, validate amount + fee doesn't exceed balance
        if (!isMaxTransaction) {
          const totalNeeded = amountCurrency.add(estimatedTotalFee);

          if (totalNeeded.value > balanceCurrency.value) {
            setIsLoading(false);

            alert.error(t('send.insufficientFunds'));
            return;
          }
        }

        setIsLoading(false);

        // Prepare component state to preserve
        const state = {
          formValues: allFormValues,
          selectedAsset,
          RBF,
          isMaxSend,
        };

        // Create navigation context for returning from confirm

        const returnContext = {
          ...createNavigationContext('/send/sys', undefined, state),
          // Include existing return context to make it recursive
          returnContext: location.state?.returnContext,
        };

        // The sysweb3-keyring library expects a fee rate (SYS per byte), not a total fee.

        const txData = {
          sender: activeAccount?.address,
          receivingAddress: receiver,
          amount: Number(amount),
          fee: estimatedTotalFee, // Actual fee amount (compliant with SysProvider API)
          feeRate: feeRate, // Add fee rate for transaction details display
          rbf: RBF, // RBF state for transaction details display
          token: null,
          psbt: psbt,
          isMax: isMaxTransaction, // Pass isMax flag for correct total calculation
        };

        // Use navigateWithContext to automatically handle state preservation
        navigateWithContext(
          navigate,
          '/send/confirm',
          { tx: txData, transactionType: TransactionType.UTXO },
          returnContext
        );
      } else {
        // For tokens, we need to estimate the fee for display
        let tokenFeeEstimate = MINIMUM_FEE; // Default
        let tokenPsbt = null;
        try {
          const { fee: estimatedFee, psbt } = (await controllerEmitter(
            ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
            [
              {
                amount: Number(amount),
                receivingAddress: receiver,
                feeRate,
                txOptions: { rbf: RBF },
                token: {
                  symbol: selectedAsset.symbol,
                  guid: selectedAsset.assetGuid,
                },
              },
            ]
          )) as { fee: number; psbt: any };

          tokenFeeEstimate = estimatedFee;
          tokenPsbt = psbt;

          // Critical validation: If PSBT creation failed, we cannot proceed
          if (!psbt || !tokenPsbt) {
            throw new Error('Failed to create token transaction PSBT');
          }
        } catch (error: any) {
          setIsLoading(false);

          // Handle structured errors from syscoinjs-lib
          if (error.error && error.code) {
            const sysError = error as ISyscoinTransactionError;

            switch (sysError.code) {
              case 'INSUFFICIENT_FUNDS':
                alert.error(
                  t('send.insufficientFundsDetails', {
                    shortfall: sysError.shortfall?.toFixed(8) || '0',
                    currency: activeNetwork.currency.toUpperCase(),
                  })
                );
                break;

              case 'SUBTRACT_FEE_FAILED':
                alert.error(
                  t('send.subtractFeeFailedDetails', {
                    fee: sysError.fee?.toFixed(8) || '0',
                    remainingFee: sysError.remainingFee?.toFixed(8) || '0',
                    currency: activeNetwork.currency.toUpperCase(),
                  })
                );
                break;

              case 'INVALID_FEE_RATE':
                alert.error(t('send.invalidFeeRate'));
                break;

              case 'INVALID_AMOUNT':
                alert.error(t('send.invalidAmount'));
                break;

              case 'INVALID_ASSET_ALLOCATION':
                alert.error(
                  t('send.invalidAssetAllocation', {
                    guid: error.details?.guid || 'Unknown',
                  })
                );
                break;

              default:
                alert.error(
                  t('send.transactionCreationFailedWithCode', {
                    code: sysError.code,
                    message: sysError.message,
                  })
                );
            }
          } else {
            // Fallback for non-structured errors
            alert.error(
              t('send.transactionCreationFailed', { error: error.message }) ||
                `Failed to create token transaction: ${error.message}. Please try again.`
            );
          }
          return;
        }

        setIsLoading(false);

        // Prepare component state to preserve
        const state = {
          formValues: allFormValues,
          selectedAsset,
          RBF,
          isMaxSend,
        };

        // Create navigation context for returning from confirm
        const returnContext = {
          ...createNavigationContext('/send/sys', undefined, state),
          // Include existing return context to make it recursive
          returnContext: location.state?.returnContext,
        };

        // Use navigateWithContext to automatically handle state preservation
        navigateWithContext(
          navigate,
          '/send/confirm',
          {
            tx: {
              sender: activeAccount?.address,
              receivingAddress: receiver,
              amount: Number(amount),
              fee: tokenFeeEstimate, // Actual fee amount (compliant with SysProvider API)
              feeRate: feeRate, // Add fee rate for transaction details display
              rbf: RBF, // RBF state for transaction details display
              psbt: tokenPsbt,
              token: {
                symbol: selectedAsset.symbol,
                guid: selectedAsset.assetGuid,
              },
              isMax: false, // Tokens don't support max send functionality
              transactionType: TransactionType.UTXO,
            },
          },
          returnContext
        );
      }
    } catch (error) {
      setIsLoading(false);

      alert.error(t('send.internalError'));
    }
  };

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(activeAccount?.xpub, 50, {
      backColor: '#07152B',
      padding: 1,
    });
  }, [activeAccount?.address]);

  // Remove the useEffect that was causing fluctuations
  // The MAX button already handles the calculation properly

  return (
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
              {t('components.imported')}
            </div>
          )}
        </div>
        <div className="flex gap-1 mt-[6px]">
          <p className="text-brand-gray200 text-xs">
            {t('components.yourBalance')}
          </p>
          <p className="text-white text-xs font-semibold">
            {selectedAsset
              ? getAssetBalance(
                  selectedAsset,
                  activeAccount,
                  true,
                  activeNetwork
                )
              : `${activeAccount.balances[INetworkType.Syscoin]} ${
                  activeNetwork.currency
                }`}
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
          RBF: true,
        }}
        onFinish={nextStep}
        autoComplete="off"
        className="flex flex-col gap-2 items-center justify-center mt-6 text-center md:w-full"
        onValuesChange={handleFormValuesChange}
      >
        <div className="sender-custom-input">
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
                  if (!value) {
                    return Promise.resolve();
                  }

                  const isValid = await isValidSYSAddress(
                    value,
                    activeNetwork.chainId
                  );
                  if (isValid) {
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
              onBlur={handleFieldBlur}
            />
          </Form.Item>
        </div>
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
                  {({ open }) => (
                    <div className="relative inline-block text-left">
                      <Menu.Button className="inline-flex items-center w-[100px] gap-4  justify-center border border-alpha-whiteAlpha300 px-5 py-[7px]  bg-brand-blue800 hover:bg-opacity-30 rounded-[100px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
                        <p className="w-full uppercase text-white text-xs font-normal">
                          {String(
                            selectedAsset?.symbol
                              ? selectedAsset?.symbol
                              : activeNetwork.currency
                          )}
                        </p>
                        <ArrowDownSvg />
                      </Menu.Button>

                      <Menu.Items
                        as="div"
                        className={`scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-brand-blue800 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right
                          transform transition-all duration-100 ease-out ${
                            open
                              ? 'opacity-100 scale-100 pointer-events-auto'
                              : 'opacity-0 scale-95 pointer-events-none'
                          }`}
                        static
                      >
                        <Menu.Item as="div" key="native-sys">
                          <button
                            type="button"
                            onClick={() => handleSelectedAsset(-1)}
                            className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                          >
                            <p>SYS</p>
                            <small>{t('send.native')}</small>
                          </button>
                        </Menu.Item>

                        {accountAssets.syscoin.length > 0
                          ? accountAssets.syscoin.map((item: any) =>
                              item?.assetGuid ? (
                                <Menu.Item
                                  as="div"
                                  key={`asset-${item.assetGuid}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleSelectedAsset(item.assetGuid);
                                    }}
                                    className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                  >
                                    <p>{item?.symbol}</p>

                                    <small>
                                      {isNFT(item.assetGuid) ? 'NFT' : 'SPT'}
                                    </small>
                                  </button>
                                </Menu.Item>
                              ) : null
                            )
                          : null}
                      </Menu.Items>
                    </div>
                  )}
                </Menu>
              </Form.Item>
            }
          </div>

          <div className="flex md:w-96 relative">
            <div className="value-custom-input w-full relative">
              <span
                onClick={handleMaxButton}
                className="absolute left-[15px] top-[50%] transform -translate-y-1/2 text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-[100px] cursor-pointer hover:bg-alpha-whiteAlpha200 z-10"
              >
                MAX
              </span>
              <Form.Item
                name="amount"
                className="relative w-full"
                hasFeedback
                rules={[
                  {
                    required: true,
                    message: '',
                  },
                  () => ({
                    async validator(_, value) {
                      // Work with strings to avoid precision loss
                      const inputAmount = value ? String(value).trim() : '';

                      // Check if empty or invalid
                      if (!inputAmount || inputAmount === '') {
                        return Promise.reject('');
                      }

                      // Check if it's a valid positive number
                      const numValue = parseFloat(inputAmount);
                      if (isNaN(numValue) || numValue <= 0) {
                        return Promise.reject('');
                      }

                      // Get balance as string to preserve precision
                      let validationBalanceStr: string;
                      if (selectedAsset) {
                        // For assets, the balance is already formatted
                        validationBalanceStr = formattedAssetBalance
                          ? String(formattedAssetBalance)
                          : '0';
                      } else {
                        // For native SYS, balance is already in decimal format
                        validationBalanceStr = activeAccount?.balances[
                          INetworkType.Syscoin
                        ]
                          ? String(activeAccount.balances[INetworkType.Syscoin])
                          : '0';
                      }

                      // Use currency.js with 8 decimal precision for safe comparison
                      try {
                        const inputCurrency = currency(inputAmount, {
                          precision: 8,
                        });
                        const balanceCurrency = currency(validationBalanceStr, {
                          precision: 8,
                        });

                        if (inputCurrency.value <= 0) {
                          return Promise.reject('');
                        }

                        if (inputCurrency.value > balanceCurrency.value) {
                          return Promise.reject(t('send.insufficientFunds'));
                        }

                        return Promise.resolve();
                      } catch (error) {
                        // If currency.js can't parse, it's an invalid amount
                        return Promise.reject('');
                      }
                    },
                  }),
                ]}
              >
                <Input
                  name="amount"
                  id="with-max-button"
                  type="number"
                  placeholder={t('send.amount')}
                  onBlur={handleFieldBlur}
                />
              </Form.Item>
            </div>
          </div>
        </div>

        <Fee
          disabled={false}
          recommend={feeRate}
          form={form}
          onFeeChange={handleFeeChange}
        />

        <div className="flex justify-between w-full">
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal text-white">
              {selectedAsset ? 'Z-DAG' : 'RBF'}
            </span>
            <Tooltip
              childrenClassName="text-brand-white h-4"
              content={
                selectedAsset
                  ? t('send.zdagOption', {
                      currency: activeNetwork.currency.toUpperCase(),
                    })
                  : t('send.rbfOption', {
                      currency: activeNetwork.currency.toUpperCase(),
                    })
              }
            >
              <Icon isSvg name="Info" />
            </Tooltip>
          </div>
          <Form.Item
            name="RBF"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <div className="flex items-center gap-2">
              <Switch
                checked={selectedAsset ? !RBF : RBF}
                onChange={RBFOnChange}
                className="relative inline-flex items-center w-9 h-4 border border-white rounded-full"
              >
                <span
                  className={`${
                    (selectedAsset ? !RBF : RBF)
                      ? 'bg-brand-green translate-x-6'
                      : 'bg-brand-redDark translate-x-1'
                  } inline-block w-2 h-2 transform rounded-full`}
                  id="rbf-switch"
                />
              </Switch>
            </div>
          </Form.Item>
        </div>

        <div className="relative mt-14 w-[96%] md:static md:mt-3">
          <NeutralButton type="submit" fullWidth loading={isLoading}>
            {t('buttons.next')}
          </NeutralButton>
        </div>
      </Form>
    </div>
  );
};
