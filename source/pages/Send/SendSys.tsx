import { Switch, Menu, Transition } from '@headlessui/react';
import { Form, Input } from 'antd';
import currency from 'currency.js';
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
import { useController } from 'hooks/useController';
import { IPriceState } from 'state/price/types';
import { RootState } from 'state/store';
import { ITokenSysProps } from 'types/tokens';
import {
  truncate,
  isNFT,
  getAssetBalance,
  formatCurrency,
  ellipsis,
  MINIMUM_FEE,
  FIELD_VALUES_INITIAL_STATE,
  FieldValuesType,
} from 'utils/index';

export const SendSys = () => {
  const { getFiatAmount } = usePrice();
  const { controllerEmitter } = useController();
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
  const [cachedFeeEstimate, setCachedFeeEstimate] = useState<number | null>(
    null
  );
  const [isCalculatingMax, setIsCalculatingMax] = useState(false);
  const [calculatedMaxAmount, setCalculatedMaxAmount] = useState<string | null>(
    null
  );
  const [fieldsValues, setFieldsValues] = useState<FieldValuesType>(
    FIELD_VALUES_INITIAL_STATE
  );

  const [form] = Form.useForm();

  // Define our desired fee rate and the estimation fee rate
  const ESTIMATION_FEE_RATE = MINIMUM_FEE; // 1000 sat/byte - what the library uses for estimation
  const DESIRED_FEE_RATE = 0.0000001; // 10 sat/byte - what we actually want to pay
  const FEE_SCALING_FACTOR = DESIRED_FEE_RATE / ESTIMATION_FEE_RATE; // 0.001

  // Use our desired lower fee rate
  const feeRate = DESIRED_FEE_RATE;

  const isAccountImported =
    accounts[activeAccountMeta.type][activeAccountMeta.id]?.isImported;

  useEffect(() => {
    form.setFieldsValue({
      verify: true,
      ZDAG: false,
      fee: feeRate,
    });
  }, [form, feeRate]);

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

  // Keep balance as string to preserve precision
  const balanceStr = selectedAsset
    ? formattedAssetBalance || '0'
    : activeAccount?.balances.syscoin || '0';

  // Reusable function to calculate max sendable amount
  const calculateMaxSendableAmount = useCallback(
    async (receiver?: string) => {
      if (selectedAsset) {
        // For tokens, use full balance as fees are paid in SYS
        return {
          maxAmount: balanceStr,
          fee: 0,
        };
      } else {
        // For native SYS, we need to calculate the fee more accurately
        let fee = MINIMUM_FEE;

        // If we have a cached fee estimate, use it immediately
        if (cachedFeeEstimate !== null) {
          fee = cachedFeeEstimate;
        } else {
          // Otherwise, get actual fee estimate
          try {
            // Create a dummy receiver if none provided (for fee estimation)
            const addressForFeeCalc =
              receiver || 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty';

            // For MAX calculation, we need to estimate the fee for sending nearly all balance
            // The fee depends on the number of UTXOs that will be used
            // Start with a more conservative estimate for multi-UTXO transactions
            const testAmount = currency(balanceStr, { precision: 8 }).multiply(
              0.98 // More conservative for multi-UTXO
            ).value;

            const estimatedFee = (await controllerEmitter(
              ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
              [
                {
                  amount: testAmount,
                  receivingAddress: addressForFeeCalc,
                },
              ]
            )) as number;

            // Scale the estimated fee to our desired fee rate
            const scaledEstimatedFee = estimatedFee * FEE_SCALING_FACTOR;

            // For transactions with multiple UTXOs, add extra buffer
            // This accounts for the fact that using all UTXOs increases transaction size
            const feeWithBuffer = scaledEstimatedFee;

            // Now calculate what the actual max would be with this fee
            const potentialMax = currency(balanceStr, {
              precision: 8,
            }).subtract(feeWithBuffer).value;

            // Double-check with the actual max amount
            if (potentialMax > 0) {
              try {
                const refinedFee = (await controllerEmitter(
                  [
                    'wallet',
                    'syscoinTransaction',
                    'getEstimateSysTransactionFee',
                  ],
                  [
                    {
                      amount: potentialMax,
                      receivingAddress: addressForFeeCalc,
                    },
                  ]
                )) as number;

                // Scale the refined fee to our desired rate
                const scaledRefinedFee = refinedFee * FEE_SCALING_FACTOR;

                // If refined fee is significantly higher, use it with buffer
                if (scaledRefinedFee > feeWithBuffer) {
                  fee = scaledRefinedFee * 1.1; // 10% buffer on refined estimate
                } else {
                  fee = feeWithBuffer;
                }
              } catch (error) {
                // If refinement fails, stick with buffered estimate
                fee = feeWithBuffer;
              }
            } else {
              fee = feeWithBuffer;
            }

            setCachedFeeEstimate(fee);
          } catch (error) {
            console.error('Error estimating fee for MAX:', error);
            // Use a more conservative fee if estimation fails
            // Based on actual transaction data at 1000 sat/byte: 3 UTXOs = 0.00283801 SYS fee
            // Scale it down to our desired rate
            const fallbackFeeAt1000SatByte = 0.006; // Conservative estimate for 7 UTXO transaction at 1000 sat/byte
            fee = fallbackFeeAt1000SatByte * FEE_SCALING_FACTOR; // Scale to 1 sat/byte
            console.log('Using scaled fallback fee:', fee);
          }
        }

        // Calculate max amount with proper precision
        const maxAmountCurrency = currency(balanceStr, {
          precision: 8,
        }).subtract(fee);

        // Ensure we don't go negative and apply final safety margin
        let maxAmount = '0';
        if (maxAmountCurrency.value > 0) {
          // Apply a tiny final safety margin (0.00001 SYS) to avoid edge cases
          const finalMax = maxAmountCurrency.subtract(0.00001);
          maxAmount =
            finalMax.value > 0 ? finalMax.format({ symbol: '' }) : '0';
        }

        return {
          maxAmount,
          fee,
        };
      }
    },
    [balanceStr, selectedAsset, controllerEmitter, cachedFeeEstimate]
  );

  const handleMaxButton = useCallback(async () => {
    // Only show loading if we don't have a cached fee
    if (!selectedAsset && cachedFeeEstimate === null) {
      setIsCalculatingMax(true);
    }

    try {
      const { maxAmount } = await calculateMaxSendableAmount(
        fieldsValues.receiver
      );

      form.setFieldValue('amount', maxAmount);
      setFieldsValues({
        ...fieldsValues,
        amount: String(maxAmount),
      });
      setCalculatedMaxAmount(String(maxAmount)); // Store the exact max amount

      // Clear any validation errors and re-validate
      form.setFields([
        {
          name: 'amount',
          errors: [],
        },
      ]);

      // Validate the form field after setting the value
      setTimeout(() => {
        form.validateFields(['amount']);
      }, 0);
    } finally {
      setIsCalculatingMax(false);
    }
  }, [
    calculateMaxSendableAmount,
    fieldsValues,
    form,
    selectedAsset,
    cachedFeeEstimate,
  ]);

  const handleInputChange = useCallback(
    (type: 'receiver' | 'amount', e: any) => {
      // Don't clear calculatedMaxAmount on input change
      // Let the validation handle all cases properly
      setFieldsValues({
        ...fieldsValues,
        [type]: e.target.value,
      });
    },
    [fieldsValues]
  );

  const handleSelectedAsset = (item: number) => {
    if (assets) {
      const getAsset = assets.find((asset: any) => asset.assetGuid === item);

      if (getAsset) {
        setSelectedAsset(getAsset);
        // Clear cached fee when switching assets
        setCachedFeeEstimate(null);
        setCalculatedMaxAmount(null);
        return;
      }

      setSelectedAsset(null);
      // Clear cached fee when switching to native
      setCachedFeeEstimate(null);
      setCalculatedMaxAmount(null);
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

      // For native SYS, validate that amount + fee doesn't exceed balance
      if (!selectedAsset) {
        const amountCurrency = currency(amount, { precision: 8 });
        const balanceCurrency = currency(activeAccount.balances.syscoin, {
          precision: 8,
        });

        // For validation, we need to estimate the total fee to ensure sufficient funds
        let estimatedTotalFee = 0.001; // Conservative default
        try {
          const estimatedFeeAt1000 = (await controllerEmitter(
            ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
            [{ amount: Number(amount), receivingAddress: receiver }]
          )) as number;

          // Scale the fee to our desired rate
          estimatedTotalFee = estimatedFeeAt1000 * FEE_SCALING_FACTOR;
        } catch (error) {
          // Use conservative estimate if fee estimation fails
          estimatedTotalFee = 0.00001;
        }

        const totalNeeded = amountCurrency.add(estimatedTotalFee);

        if (totalNeeded.value > balanceCurrency.value) {
          setIsLoading(false);
          alert.removeAll();
          alert.error(t('send.insufficientFunds'));
          return;
        }

        setIsLoading(false);

        // The sysweb3-keyring library expects a fee rate (SYS per byte), not a total fee.

        const txData = {
          sender: activeAccount.address,
          receivingAddress: receiver,
          amount: Number(amount),
          fee: feeRate, // Fixed fee rate
          estimatedFee: estimatedTotalFee, // Pass the actual estimated fee for display
          token: null,
          isToken: false,
          rbf: !ZDAG,
        };

        // Final safety check - ensure amount + estimated fee doesn't exceed balance
        const finalCheck = amountCurrency.add(estimatedTotalFee);
        if (finalCheck.value > balanceCurrency.value) {
          console.error('Final safety check failed:', {
            amount: amountCurrency.value,
            estimatedFee: estimatedTotalFee,
            total: finalCheck.value,
            balance: balanceCurrency.value,
          });
          alert.removeAll();
          alert.error(t('send.insufficientFunds'));
          return;
        }

        navigate('/send/confirm', {
          state: {
            tx: txData,
          },
        });
      } else {
        // For tokens, we need to estimate the fee for display
        let tokenFeeEstimate = MINIMUM_FEE; // Default
        try {
          const estimatedFeeAt1000 = (await controllerEmitter(
            ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
            [{ amount: Number(amount), receivingAddress: receiver }]
          )) as number;

          // Scale the fee to our desired rate
          tokenFeeEstimate = estimatedFeeAt1000 * FEE_SCALING_FACTOR;
        } catch (error) {
          console.error('Error estimating token fee:', error);
        }

        setIsLoading(false);
        navigate('/send/confirm', {
          state: {
            tx: {
              sender: activeAccount.address,
              receivingAddress: receiver,
              amount: Number(amount),
              fee: feeRate, // Fixed fee rate
              estimatedFee: tokenFeeEstimate, // Pass the actual estimated fee for display
              token: {
                symbol: selectedAsset.symbol,
                guid: selectedAsset.assetGuid,
              },
              isToken: true,
              rbf: !ZDAG,
            },
          },
        });
      }
    } catch (error) {
      setIsLoading(false);
      alert.removeAll();
      alert.error(t('send.internalError'));
    }
  };

  const fiatValueToShow = useMemo(() => {
    const getAmount = getFiatAmount(
      Number(feeRate),
      6,
      String(fiat.asset).toUpperCase()
    );

    return getAmount;
  }, [feeRate]);

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

  // Remove the useEffect that was causing fluctuations
  // The MAX button already handles the calculation properly

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
            fee: feeRate,
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
              onChange={(e) => handleInputChange('receiver', e)}
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
                            <Menu.Item as="div" key={uniqueId()}>
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
                        validationBalanceStr = activeAccount?.balances.syscoin
                          ? String(activeAccount.balances.syscoin)
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

                        // For tokens, just check against balance
                        if (selectedAsset) {
                          if (inputCurrency.value > balanceCurrency.value) {
                            return Promise.reject(t('send.insufficientFunds'));
                          }
                        } else {
                          // For native SYS, check against calculated max if available, otherwise use conservative fee
                          if (calculatedMaxAmount) {
                            // If we have a calculated max amount, validate against it strictly
                            const maxCurrency = currency(calculatedMaxAmount, {
                              precision: 8,
                            });
                            // Allow a tiny tolerance for floating point precision (0.00000001 SYS)
                            if (inputCurrency.value > maxCurrency.value) {
                              return Promise.reject(
                                t('send.insufficientFunds')
                              );
                            }
                          } else {
                            // No calculated max, use conservative fee estimate for validation
                            const feeToUse = 0.001;
                            const totalNeeded = inputCurrency.add(feeToUse);

                            if (totalNeeded.value > balanceCurrency.value) {
                              return Promise.reject(
                                t('send.insufficientFunds')
                              );
                            }
                          }
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
                  className="value-custom-input"
                  type="number"
                  placeholder={t('send.amount')}
                  onChange={(e) => handleInputChange('amount', e)}
                />
              </Form.Item>
              <span
                className="z-[9999] left-[6%] bottom-[11px] text-xs px-[6px] absolute inline-flex items-center w-[41px] h-[18px] bg-transparent border border-alpha-whiteAlpha300 rounded-[100px] cursor-pointer"
                onClick={handleMaxButton}
              >
                {isCalculatingMax ? (
                  <span className="animate-pulse">...</span>
                ) : (
                  'MAX'
                )}
              </span>
            </div>
          </div>

          <Fee
            disabled={true}
            recommend={feeRate}
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
