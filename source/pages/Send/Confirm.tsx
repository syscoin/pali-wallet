import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import currency from 'currency.js';
import { BigNumber, ethers } from 'ethers';
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  startTransition,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  ICustomFeeParams,
  IFeeState,
  ITxState,
  TransactionType,
} from '../../types/transactions';
import { Button, Icon, Tooltip, IconButton } from 'components/index';
import { SyscoinTransactionDetailsFromPSBT } from 'components/TransactionDetails';
import { useUtils, usePrice } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useEIP1559 } from 'hooks/useEIP1559';
import { RootState } from 'state/store';
import { ISyscoinTransactionError, INetworkType } from 'types/network';
import {
  truncate,
  logError,
  ellipsis,
  removeScientificNotation,
  omitTransactionObjectData,
  INITIAL_FEE,
  saveNavigationState,
  clearNavigationState,
} from 'utils/index';
import {
  isUserCancellationError,
  isDeviceLockedError,
  isBlindSigningError,
} from 'utils/isUserCancellationError';

import { EditPriorityModal } from './EditPriority';

export const SendConfirm = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { alert, navigate, useCopyClipboard } = useUtils();
  const { getFiatAmount } = usePrice();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const { fiat } = useSelector((state: RootState) => state.price);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const location = useLocation();
  const { state } = location;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [customFee, setCustomFee] = useState<ICustomFeeParams>({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
    gasPrice: 0,
  });

  const [gasPrice, setGasPrice] = useState<number>(0);
  const [txObjectState, setTxObjectState] = useState<any>();
  const [isOpenEditFeeModal, setIsOpenEditFeeModal] = useState<boolean>(false);
  // Removed unused haveError state

  const { isEIP1559Compatible } = useEIP1559();
  const [copied, copy] = useCopyClipboard();

  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  // Add fee calculation cache and debouncing
  const [feeCalculationCache, setFeeCalculationCache] = useState<
    Map<string, any>
  >(new Map());
  const [isCalculatingFees, setIsCalculatingFees] = useState(false);

  // Handle both normal navigation and restoration
  const basicTxValues = state.tx;
  const cachedGasData = basicTxValues?.cachedGasData;

  // Initialize fee state after basicTxValues is available
  const [fee, setFee] = useState<IFeeState>({
    gasLimit: basicTxValues?.defaultGasLimit || 42000,
    maxFeePerGas: 0,
    maxPriorityFeePerGas: 0,
    baseFee: 0,
    gasPrice: 0,
  });

  // Save navigation state when confirm page loads to preserve transaction data and return context
  useEffect(() => {
    const saveConfirmState = async () => {
      // Only save if we have transaction data and return context
      await saveNavigationState(
        location.pathname,
        undefined,
        state,
        state.returnContext
      );
    };

    saveConfirmState();
  }, [state, location.pathname]);

  // The confirmation screen displays the fee and total as calculated by SendSys.
  // When the user changes fee rate in SendSys and clicks "Next", SendSys recalculates
  // the transaction with the new fee rate and passes the correct values here.

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit && customFee.gasLimit > 0
  );

  const getFormattedFee = (currentFee: number | string | undefined) => {
    if (
      currentFee === undefined ||
      currentFee === null ||
      isNaN(Number(currentFee))
    ) {
      return 'Calculating...';
    }
    return `${removeScientificNotation(currentFee)} ${
      activeNetwork.currency
        ? activeNetwork.currency.toUpperCase()
        : activeNetwork.label
    }`;
  };

  const getFeeFiatAmount = (currentFee: number | string | undefined) => {
    try {
      if (currentFee === undefined || currentFee === null) return null;

      const feeAmount =
        typeof currentFee === 'string' ? parseFloat(currentFee) : currentFee;
      if (isNaN(feeAmount) || feeAmount <= 0) return null;

      return getFiatAmount(feeAmount, 6, String(fiat.asset).toUpperCase());
    } catch (error) {
      return null;
    }
  };

  const getTotalFiatAmount = (totalAmount: number | string) => {
    try {
      const total =
        typeof totalAmount === 'string' ? parseFloat(totalAmount) : totalAmount;
      if (isNaN(total) || total <= 0) return null;

      return getFiatAmount(total, 6, String(fiat.asset).toUpperCase());
    } catch (error) {
      return null;
    }
  };

  // Helper function to safely convert fee values to numbers and format them
  const safeToFixed = (value: any, decimals = 9): string => {
    const numValue = Number(value);
    return isNaN(numValue) ? '0' : numValue.toFixed(decimals);
  };

  const getLegacyGasPrice = async () => {
    const correctGasPrice = Boolean(
      customFee.isCustom && customFee.gasPrice > 0
    )
      ? customFee.gasPrice * 10 ** 9 // Convert to WEI because injected gasPrices comes in GWEI
      : await controllerEmitter([
          'wallet',
          'ethereumTransaction',
          'getRecommendedGasPrice',
        ]).then((gas) => BigNumber.from(gas).toNumber());

    // Always use a valid gas limit - custom, default from tx type, or fallback
    const gasLimit =
      customFee.isCustom && customFee.gasLimit > 0
        ? customFee.gasLimit
        : basicTxValues?.defaultGasLimit || 42000;

    const initialFee = { ...INITIAL_FEE, gasLimit };

    initialFee.gasPrice = correctGasPrice;

    // Use startTransition for non-critical fee updates
    startTransition(() => {
      setFee(initialFee);
      setGasPrice(correctGasPrice);
    });

    return { gasLimit, gasPrice: correctGasPrice };
  };

  // Stabilize functions to prevent useEffect re-runs
  const stableControllerEmitter = useRef(controllerEmitter);
  const stableNavigate = useRef(navigate);
  const stableAlert = useRef(alert);
  const stableT = useRef(t);
  const stableGetLegacyGasPrice = useRef(getLegacyGasPrice);

  // Update refs when values change
  useEffect(() => {
    stableControllerEmitter.current = controllerEmitter;
    stableNavigate.current = navigate;
    stableAlert.current = alert;
    stableT.current = t;
    stableGetLegacyGasPrice.current = getLegacyGasPrice;
  }, [controllerEmitter, navigate, alert, t, getLegacyGasPrice]);

  const handleConfirm = async () => {
    const balance = isBitcoinBased
      ? activeAccount.balances[INetworkType.Syscoin]
      : activeAccount.balances[INetworkType.Ethereum];

    if (activeAccount && balance >= 0) {
      setLoading(true);

      // Handle transactions based on type
      const transactionType =
        basicTxValues.transactionType ||
        (isBitcoinBased ? TransactionType.UTXO : TransactionType.NATIVE_ETH);

      switch (transactionType) {
        // SYSCOIN/UTXO TRANSACTIONS
        case TransactionType.UTXO:
          try {
            // Use atomic wrapper for all wallets
            await controllerEmitter(
              ['wallet', 'signSendAndSaveTransaction'],
              [
                {
                  psbt: basicTxValues.psbt,
                  isTrezor: activeAccount.isTrezorWallet,
                  isLedger: activeAccount.isLedgerWallet,
                },
              ],
              false,
              activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                ? 300000 // 5 minutes timeout for hardware wallet operations
                : 10000 // Default 10 seconds for regular wallets
            );

            setConfirmed(true);
            setLoading(false);
          } catch (error: any) {
            // Handle user cancellation gracefully
            if (isUserCancellationError(error)) {
              alert.info(t('transactions.transactionCancelled'));
              setLoading(false);
              return;
            }

            // Handle device locked
            if (isDeviceLockedError(error)) {
              alert.warning(t('settings.lockedDevice'));
              setLoading(false);
              return;
            }

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

                case 'TRANSACTION_SEND_FAILED':
                  // Parse error message to extract meaningful part
                  let errorMsg = sysError.message;
                  try {
                    // Check if the message contains JSON error details
                    const detailsMatch = errorMsg.match(/Details:\s*({.*})/);
                    if (detailsMatch) {
                      const errorDetails = JSON.parse(detailsMatch[1]);
                      if (errorDetails.error) {
                        errorMsg = `Transaction failed: ${errorDetails.error}`;
                      }
                    }
                  } catch (e) {
                    // If parsing fails, use the original message
                  }

                  alert.error(
                    t('send.transactionSendFailed', {
                      message: errorMsg,
                    })
                  );
                  break;

                default:
                  if (basicTxValues.fee > 0.00001) {
                    alert.error(
                      `${truncate(String(sysError.message), 166)} ${t(
                        'send.reduceFee'
                      )}`
                    );
                  } else {
                    alert.error(
                      t('send.transactionCreationFailedWithCode', {
                        code: sysError.code,
                        message: sysError.message,
                      })
                    );
                  }
              }
            } else {
              // Fallback for non-structured errors
              if (error && basicTxValues.fee > 0.00001) {
                alert.error(
                  `${truncate(String(error.message || error), 166)} ${t(
                    'send.reduceFee'
                  )}`
                );
              } else {
                alert.error(t('send.cantCompleteTxs'));
              }
            }

            logError('error SYS', 'Transaction', error);
            setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS FOR NATIVE TOKENS
        case TransactionType.NATIVE_ETH:
          const restTx = omitTransactionObjectData(txObjectState, [
            'chainId',
            'maxFeePerGas',
            'maxPriorityFeePerGas',
          ]) as ITxState;

          let value = ethers.utils.parseUnits(
            String(basicTxValues.amount),
            'ether'
          );

          try {
            // For MAX sends, deduct gas fees from the value
            // This is required because ethers.js validates balance >= value + gas
            if (basicTxValues.isMax) {
              const gasLimit = BigNumber.from(
                validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
              );

              if (isEIP1559Compatible) {
                // EIP-1559 transaction
                const maxFeePerGasWei = ethers.utils.parseUnits(
                  String(
                    Boolean(customFee.isCustom && customFee.maxFeePerGas > 0)
                      ? safeToFixed(customFee.maxFeePerGas)
                      : safeToFixed(fee.maxFeePerGas)
                  ),
                  9
                );
                const maxGasFeeWei = gasLimit.mul(maxFeePerGasWei);
                value = value.sub(maxGasFeeWei);
              } else {
                // Legacy transaction
                const gasPriceWei = BigNumber.from(gasPrice);
                const gasFeeWei = gasLimit.mul(gasPriceWei);
                value = value.sub(gasFeeWei);
              }

              // Ensure value doesn't go negative
              if (value.lt(0)) {
                alert.error(t('send.insufficientFundsForGas'));
                setLoading(false);
                return;
              }
            }

            if (isEIP1559Compatible === false) {
              try {
                // Use atomic wrapper for legacy transactions
                await controllerEmitter(
                  ['wallet', 'sendAndSaveEthTransaction'],
                  [
                    {
                      ...restTx,
                      value,
                      gasPrice: ethers.utils.hexlify(gasPrice),
                      gasLimit: validateCustomGasLimit
                        ? BigNumber.from(customFee.gasLimit)
                        : BigNumber.from(
                            fee.gasLimit ||
                              basicTxValues.defaultGasLimit ||
                              42000
                          ),
                    },
                    !isEIP1559Compatible,
                  ],
                  false,
                  activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                    ? 300000 // 5 minutes timeout for hardware wallet operations
                    : 10000 // Default 10 seconds for regular wallets
                );

                setConfirmed(true);
                setLoading(false);
              } catch (error: any) {
                // Handle user cancellation gracefully
                if (isUserCancellationError(error)) {
                  alert.info(t('transactions.transactionCancelled'));
                  setLoading(false);
                  return;
                }

                // Handle device locked
                if (isDeviceLockedError(error)) {
                  alert.warning(t('settings.lockedDevice'));
                  setLoading(false);
                  return;
                }

                // Handle blind signing requirement
                if (
                  activeAccount.isLedgerWallet &&
                  isBlindSigningError(error)
                ) {
                  alert.warning(t('settings.ledgerBlindSigning'));
                  setLoading(false);
                  return;
                }

                logError('error', 'Transaction', error);
                alert.error(t('send.cantCompleteTxs'));
                setLoading(false);
              }

              return;
            }

            // Use atomic wrapper for EIP-1559 transactions
            await controllerEmitter(
              ['wallet', 'sendAndSaveEthTransaction'],
              [
                {
                  ...restTx,
                  value,
                  maxPriorityFeePerGas: ethers.utils.parseUnits(
                    String(
                      Boolean(
                        customFee.isCustom && customFee.maxPriorityFeePerGas > 0
                      )
                        ? safeToFixed(customFee.maxPriorityFeePerGas)
                        : safeToFixed(fee.maxPriorityFeePerGas)
                    ),
                    9
                  ),
                  maxFeePerGas: ethers.utils.parseUnits(
                    String(
                      Boolean(customFee.isCustom && customFee.maxFeePerGas > 0)
                        ? safeToFixed(customFee.maxFeePerGas)
                        : safeToFixed(fee.maxFeePerGas)
                    ),
                    9
                  ),
                  gasLimit: validateCustomGasLimit
                    ? BigNumber.from(customFee.gasLimit)
                    : BigNumber.from(
                        fee.gasLimit || basicTxValues.defaultGasLimit || 42000
                      ),
                },
              ],
              false,
              activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                ? 300000 // 5 minutes timeout for hardware wallet operations
                : 10000 // Default 10 seconds for regular wallets
            );

            setConfirmed(true);
            setLoading(false);

            return;
          } catch (error: any) {
            // Handle user cancellation gracefully
            if (isUserCancellationError(error)) {
              alert.info(t('transactions.transactionCancelled'));
              setLoading(false);
              return;
            }

            // Handle device locked
            if (isDeviceLockedError(error)) {
              alert.warning(t('settings.lockedDevice'));
              setLoading(false);
              return;
            }

            // Handle blind signing requirement
            if (activeAccount.isLedgerWallet && isBlindSigningError(error)) {
              alert.warning(t('settings.ledgerBlindSigning'));
              setLoading(false);
              return;
            }

            // For MAX sends, if we get insufficient funds error, retry with slightly less
            if (
              basicTxValues.isMax &&
              error.message?.includes('insufficient funds')
            ) {
              const reducedValue = value.sub(BigNumber.from('10000'));

              if (reducedValue.gt(0)) {
                const retryTxObject = {
                  ...restTx,
                  value: reducedValue,
                  maxPriorityFeePerGas: ethers.utils.parseUnits(
                    String(
                      Boolean(
                        customFee.isCustom && customFee.maxPriorityFeePerGas > 0
                      )
                        ? safeToFixed(customFee.maxPriorityFeePerGas)
                        : safeToFixed(fee.maxPriorityFeePerGas)
                    ),
                    9
                  ),
                  maxFeePerGas: ethers.utils.parseUnits(
                    String(
                      Boolean(customFee.isCustom && customFee.maxFeePerGas > 0)
                        ? safeToFixed(customFee.maxFeePerGas)
                        : safeToFixed(fee.maxFeePerGas)
                    ),
                    9
                  ),
                  gasLimit: BigNumber.from(
                    validateCustomGasLimit
                      ? customFee.gasLimit
                      : fee.gasLimit || basicTxValues.defaultGasLimit || 42000
                  ),
                };

                try {
                  // Use atomic wrapper for retry
                  await controllerEmitter(
                    ['wallet', 'sendAndSaveEthTransaction'],
                    [retryTxObject, !isEIP1559Compatible],
                    false,
                    activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                      ? 300000 // 5 minutes timeout for hardware wallet operations
                      : 10000 // Default 10 seconds for regular wallets
                  );

                  setConfirmed(true);
                  setLoading(false);
                  return; // Exit early on success
                } catch (retryError) {
                  // If retry also fails, show error
                  logError('error ETH retry', 'Transaction', retryError);
                  alert.error(t('send.cantCompleteTxs'));
                  setLoading(false);
                  return;
                }
              }
            }

            logError('error ETH', 'Transaction', error);
            alert.error(t('send.cantCompleteTxs'));
            setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS FOR ERC20 TOKENS
        case TransactionType.ERC20:
        // ETHEREUM TRANSACTIONS FOR ERC721 TOKENS
        case TransactionType.ERC721:
        // ETHEREUM TRANSACTIONS FOR ERC1155 TOKENS
        case TransactionType.ERC1155:
          //HANDLE DIFFERENT TOKEN TRANSACTION TYPES
          switch (transactionType) {
            //HANDLE ERC20 TRANSACTION
            case TransactionType.ERC20:
              if (isEIP1559Compatible === false) {
                try {
                  // Use atomic wrapper for legacy ERC20 transactions
                  await controllerEmitter(
                    ['wallet', 'sendAndSaveTokenTransaction'],
                    [
                      'ERC20',
                      {
                        networkUrl: activeNetwork.url,
                        receiver: txObjectState.to,
                        tokenAddress: basicTxValues.token.contractAddress,
                        tokenAmount: `${basicTxValues.amount}`,
                        isLegacy: !isEIP1559Compatible,
                        decimals: basicTxValues?.token?.decimals,
                        gasPrice: ethers.utils.hexlify(gasPrice),
                        gasLimit: validateCustomGasLimit
                          ? BigNumber.from(customFee.gasLimit)
                          : BigNumber.from(
                              fee.gasLimit ||
                                basicTxValues.defaultGasLimit ||
                                65000
                            ),
                      },
                    ],
                    false,
                    activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                      ? 300000 // 5 minutes timeout for hardware wallet operations
                      : 10000 // Default 10 seconds for regular wallets
                  );

                  setConfirmed(true);
                  setLoading(false);
                  return;
                } catch (error: any) {
                  // Handle user cancellation gracefully
                  if (isUserCancellationError(error)) {
                    alert.info(t('transactions.transactionCancelled'));
                    setLoading(false);
                    return;
                  }

                  // Handle device locked
                  if (isDeviceLockedError(error)) {
                    alert.warning(t('settings.lockedDevice'));
                    setLoading(false);
                    return;
                  }

                  // Handle blind signing requirement
                  if (
                    activeAccount.isLedgerWallet &&
                    isBlindSigningError(error)
                  ) {
                    alert.warning(t('settings.ledgerBlindSigning'));
                    setLoading(false);
                    return;
                  }

                  logError('error send ERC20', 'Transaction', error);
                  alert.error(t('send.cantCompleteTxs'));
                  setLoading(false);
                }
                break;
              }
              try {
                await controllerEmitter(
                  ['wallet', 'sendAndSaveTokenTransaction'],
                  [
                    'ERC20',
                    {
                      networkUrl: activeNetwork.url,
                      receiver: txObjectState.to,
                      tokenAddress: basicTxValues.token.contractAddress,
                      tokenAmount: `${basicTxValues.amount}`,
                      isLegacy: !isEIP1559Compatible,
                      decimals: basicTxValues?.token?.decimals,
                      maxPriorityFeePerGas: ethers.utils.parseUnits(
                        String(
                          Boolean(
                            customFee.isCustom &&
                              customFee.maxPriorityFeePerGas > 0
                          )
                            ? safeToFixed(customFee.maxPriorityFeePerGas)
                            : safeToFixed(fee.maxPriorityFeePerGas)
                        ),
                        9
                      ),
                      maxFeePerGas: ethers.utils.parseUnits(
                        String(
                          Boolean(
                            customFee.isCustom && customFee.maxFeePerGas > 0
                          )
                            ? safeToFixed(customFee.maxFeePerGas)
                            : safeToFixed(fee.maxFeePerGas)
                        ),
                        9
                      ),
                      gasLimit: validateCustomGasLimit
                        ? BigNumber.from(customFee.gasLimit)
                        : BigNumber.from(
                            fee.gasLimit ||
                              basicTxValues.defaultGasLimit ||
                              65000
                          ),
                    },
                  ],
                  false,
                  activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                    ? 300000 // 5 minutes timeout for hardware wallet operations
                    : 10000 // Default 10 seconds for regular wallets
                );

                setConfirmed(true);
                setLoading(false);
              } catch (error: any) {
                // Handle user cancellation gracefully
                if (isUserCancellationError(error)) {
                  alert.info(t('transactions.transactionCancelled'));
                  setLoading(false);
                  return;
                }

                // Handle device locked
                if (isDeviceLockedError(error)) {
                  alert.warning(t('settings.lockedDevice'));
                  setLoading(false);
                  return;
                }

                // Handle blind signing requirement
                if (
                  activeAccount.isLedgerWallet &&
                  isBlindSigningError(error)
                ) {
                  alert.warning(t('settings.ledgerBlindSigning'));
                  setLoading(false);
                  return;
                }
                logError('error send ERC20', 'Transaction', error);

                alert.error(t('send.cantCompleteTxs'));
                setLoading(false);
              }
              break;

            //HANDLE ERC721 NFT TRANSACTIONS
            case TransactionType.ERC721:
              try {
                // Validate tokenId before conversion
                const tokenId = basicTxValues.token.tokenId;
                if (
                  tokenId === undefined ||
                  tokenId === null ||
                  tokenId === ''
                ) {
                  alert.error(t('send.invalidTokenId'));
                  setLoading(false);
                  return;
                }

                const numericTokenId = Number(tokenId);
                if (isNaN(numericTokenId) || numericTokenId < 0) {
                  alert.error(t('send.invalidTokenId'));
                  setLoading(false);
                  return;
                }

                await controllerEmitter(
                  ['wallet', 'sendAndSaveTokenTransaction'],
                  [
                    'ERC721',
                    {
                      networkUrl: activeNetwork.url,
                      receiver: txObjectState.to,
                      tokenAddress: basicTxValues.token.contractAddress,
                      tokenId: numericTokenId, // The actual NFT token ID
                      isLegacy: !isEIP1559Compatible,
                      gasPrice: ethers.utils.hexlify(gasPrice),
                      gasLimit: validateCustomGasLimit
                        ? BigNumber.from(customFee.gasLimit)
                        : BigNumber.from(
                            fee.gasLimit ||
                              basicTxValues.defaultGasLimit ||
                              85000
                          ),
                    },
                  ],
                  false,
                  activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                    ? 300000 // 5 minutes timeout for hardware wallet operations
                    : 10000 // Default 10 seconds for regular wallets
                );

                setConfirmed(true);
                setLoading(false);
              } catch (error: any) {
                // Handle user cancellation gracefully
                if (isUserCancellationError(error)) {
                  alert.info(t('transactions.transactionCancelled'));
                  setLoading(false);
                  return;
                }

                // Handle device locked
                if (isDeviceLockedError(error)) {
                  alert.warning(t('settings.lockedDevice'));
                  setLoading(false);
                  return;
                }

                // Handle blind signing requirement
                if (
                  activeAccount.isLedgerWallet &&
                  isBlindSigningError(error)
                ) {
                  alert.warning(t('settings.ledgerBlindSigning'));
                  setLoading(false);
                  return;
                }
                logError('error send ERC721', 'Transaction', error);

                alert.error(t('send.cantCompleteTxs'));
                setLoading(false);
              }
              break;

            //HANDLE ERC1155 NFT TRANSACTIONS
            case TransactionType.ERC1155:
              try {
                // Validate tokenId before conversion
                const tokenId = basicTxValues.token.tokenId;
                if (
                  tokenId === undefined ||
                  tokenId === null ||
                  tokenId === ''
                ) {
                  alert.error(t('send.invalidTokenId'));
                  setLoading(false);
                  return;
                }

                const numericTokenId = Number(tokenId);
                if (isNaN(numericTokenId) || numericTokenId < 0) {
                  alert.error(t('send.invalidTokenId'));
                  setLoading(false);
                  return;
                }

                await controllerEmitter(
                  ['wallet', 'sendAndSaveTokenTransaction'],
                  [
                    'ERC1155',
                    {
                      networkUrl: activeNetwork.url,
                      receiver: txObjectState.to,
                      tokenAddress: basicTxValues.token.contractAddress,
                      tokenId: numericTokenId, // The actual NFT token ID
                      tokenAmount: String(basicTxValues.amount), // The amount of tokens to send
                      isLegacy: !isEIP1559Compatible,
                      maxPriorityFeePerGas: ethers.utils.parseUnits(
                        String(
                          Boolean(
                            customFee.isCustom &&
                              customFee.maxPriorityFeePerGas > 0
                          )
                            ? safeToFixed(customFee.maxPriorityFeePerGas)
                            : safeToFixed(fee.maxPriorityFeePerGas)
                        ),
                        9
                      ),
                      maxFeePerGas: ethers.utils.parseUnits(
                        String(
                          Boolean(
                            customFee.isCustom && customFee.maxFeePerGas > 0
                          )
                            ? safeToFixed(customFee.maxFeePerGas)
                            : safeToFixed(fee.maxFeePerGas)
                        ),
                        9
                      ),
                      gasPrice: ethers.utils.hexlify(gasPrice),
                      gasLimit: validateCustomGasLimit
                        ? BigNumber.from(customFee.gasLimit)
                        : BigNumber.from(
                            fee.gasLimit ||
                              basicTxValues.defaultGasLimit ||
                              90000
                          ),
                    },
                  ],
                  false,
                  activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                    ? 300000 // 5 minutes timeout for hardware wallet operations
                    : 10000 // Default 10 seconds for regular wallets
                );

                setConfirmed(true);
                setLoading(false);
              } catch (error: any) {
                // Handle user cancellation gracefully
                if (isUserCancellationError(error)) {
                  alert.info(t('transactions.transactionCancelled'));
                  setLoading(false);
                  return;
                }

                // Handle device locked
                if (isDeviceLockedError(error)) {
                  alert.warning(t('settings.lockedDevice'));
                  setLoading(false);
                  return;
                }

                // Handle blind signing requirement
                if (
                  activeAccount.isLedgerWallet &&
                  isBlindSigningError(error)
                ) {
                  alert.warning(t('settings.ledgerBlindSigning'));
                  setLoading(false);
                  return;
                }
                logError('error send ERC1155', 'Transaction', error);

                alert.error(t('send.cantCompleteTxs'));
                setLoading(false);
              }

              break;
          }

          break;
      }
    } else {
      alert.error(t('send.enoughFunds'));
    }
  };

  // Initialize fee for UTXO transactions
  useEffect(() => {
    if (isBitcoinBased && basicTxValues?.fee) {
      // For UTXO transactions, use the fee calculated in SendSys
      setFee({
        baseFee: 0,
        gasLimit: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
        // Store the UTXO fee for display purposes
        utxoFee: basicTxValues.fee,
      } as any);
    }
  }, [isBitcoinBased, basicTxValues?.fee]);

  useEffect(() => {
    if (isBitcoinBased) return;
    if (isEIP1559Compatible === undefined) {
      return; // Not calculate fees before being aware of EIP1559 compatibility
    }

    // Skip fee recalculation when using custom fees
    if (customFee.isCustom) {
      return;
    }

    // Create cache key for this fee calculation
    const cacheKey = JSON.stringify({
      sender: basicTxValues.sender,
      receivingAddress: basicTxValues.receivingAddress,
      chainId: activeNetwork.chainId,
      isEIP1559Compatible,
      amount: basicTxValues.amount,
    });

    // Check if we already have cached result
    if (feeCalculationCache.has(cacheKey)) {
      const cachedFee = feeCalculationCache.get(cacheKey);
      setFee(cachedFee);
      return;
    }

    // Prevent concurrent fee calculations
    if (isCalculatingFees) {
      return;
    }

    if (isEIP1559Compatible === false) {
      const getLegacyFeeRecomendation = async () => {
        setIsCalculatingFees(true);
        try {
          const { gasLimit, gasPrice: _gasPrice } =
            await stableGetLegacyGasPrice.current();
          const formattedTxObject = {
            from: basicTxValues.sender,
            to: basicTxValues.receivingAddress,
            chainId: activeNetwork.chainId,
            gasLimit,
            gasPrice: _gasPrice,
          };
          setTxObjectState(formattedTxObject);
        } catch (error) {
          console.error('Legacy fee calculation error:', error);
        } finally {
          setIsCalculatingFees(false);
        }
      };
      getLegacyFeeRecomendation();
      return;
    }

    // If we have cached gas data from SendEth, use it immediately
    if (cachedGasData && !customFee.isCustom) {
      const { maxFeePerGas, maxPriorityFeePerGas } = cachedGasData;
      const gasLimit = basicTxValues.defaultGasLimit || 42000;
      const initialFeeDetails = {
        maxFeePerGas: BigNumber.from(maxFeePerGas).toNumber() / 10 ** 9,
        baseFee:
          (BigNumber.from(maxFeePerGas).toNumber() -
            BigNumber.from(maxPriorityFeePerGas).toNumber()) /
          10 ** 9,
        maxPriorityFeePerGas:
          BigNumber.from(maxPriorityFeePerGas).toNumber() / 10 ** 9,
        gasLimit: BigNumber.from(gasLimit).toNumber(), // Always use default gas limit from transaction type
      };

      const formattedTxObject = {
        from: basicTxValues.sender,
        to: basicTxValues.receivingAddress,
        chainId: activeNetwork.chainId,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };

      setTxObjectState(formattedTxObject);
      setFee(initialFeeDetails as any);

      // Cache the result
      setFeeCalculationCache(
        (prev) => new Map(prev.set(cacheKey, initialFeeDetails))
      );

      return; // Skip recalculation
    }

    // Debounce fee calculation to prevent rapid successive calls
    const timeoutId = setTimeout(async () => {
      setIsCalculatingFees(true);

      try {
        const { maxFeePerGas, maxPriorityFeePerGas } =
          (await stableControllerEmitter.current([
            'wallet',
            'ethereumTransaction',
            'getFeeDataWithDynamicMaxPriorityFeePerGas',
          ])) as any;

        const initialFeeDetails = {
          maxFeePerGas: BigNumber.from(maxFeePerGas).toNumber() / 10 ** 9,
          baseFee:
            (BigNumber.from(maxFeePerGas).toNumber() -
              BigNumber.from(maxPriorityFeePerGas).toNumber()) /
            10 ** 9,
          maxPriorityFeePerGas:
            BigNumber.from(maxPriorityFeePerGas).toNumber() / 10 ** 9,
          gasLimit: basicTxValues.defaultGasLimit || 42000, // Always use appropriate default gas limit
        };

        const formattedTxObject = {
          from: basicTxValues.sender,
          to: basicTxValues.receivingAddress,
          chainId: activeNetwork.chainId,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };

        setTxObjectState(formattedTxObject);

        // Use custom gas limit, or default from transaction type, always have a value
        const getGasLimit =
          customFee.isCustom && customFee.gasLimit > 0
            ? customFee.gasLimit
            : basicTxValues.defaultGasLimit || 42000;

        const finalFeeDetails = {
          ...initialFeeDetails,
          gasLimit: getGasLimit,
        };

        setFee(finalFeeDetails as any);

        // Cache the successful result
        setFeeCalculationCache(
          (prev) => new Map(prev.set(cacheKey, finalFeeDetails))
        );
      } catch (error: any) {
        logError('error getting fees', 'Transaction', error);

        // Check if this is a rate limiting error
        const isRateLimited =
          error.message?.includes('rate limit') ||
          error.message?.includes('Rate limit') ||
          error.message?.includes('<!DOCTYPE html>') ||
          error.message?.includes('cloudflare') ||
          error.message?.includes('Error 1015') ||
          error.message?.includes('429');

        if (isRateLimited) {
          // For rate limiting, show a more specific error and don't navigate away immediately
          stableAlert.current.error(
            'Network is temporarily busy. Please wait a moment and try again.'
          );
          console.warn(
            'Rate limiting detected, not navigating away to allow retry'
          );
        } else {
          // For other errors, show the generic fee error and navigate away
          stableAlert.current.error(stableT.current('send.feeError'));
          stableNavigate.current(-1);
        }
      } finally {
        setIsCalculatingFees(false);
      }
    }, 500); // 500ms debounce

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    basicTxValues.sender,
    basicTxValues.receivingAddress,
    basicTxValues.amount,
    isBitcoinBased,
    isEIP1559Compatible,
    activeNetwork.chainId,
    customFee.isCustom,
    isCalculatingFees,
    cachedGasData,
    // Removed unstable dependencies: controllerEmitter, navigate, alert, t, getLegacyGasPrice
  ]);

  const getCalculatedFee = useMemo(() => {
    if (isBitcoinBased) return 0;

    // Use custom gas limit, or fee.gasLimit, or default from transaction type
    const gasLimit = Number(
      validateCustomGasLimit
        ? customFee.gasLimit
        : fee?.gasLimit || basicTxValues.defaultGasLimit || 0
    );

    if (!gasLimit) return 0;

    // Handle legacy transactions (non-EIP1559)
    if (isEIP1559Compatible === false) {
      const gasPriceValue = Number(
        customFee.isCustom && customFee.gasPrice > 0
          ? customFee.gasPrice
          : gasPrice / 10 ** 9
      );

      if (isNaN(gasPriceValue) || isNaN(gasLimit)) return 0;

      return (gasPriceValue * gasLimit) / 10 ** 9;
    }

    // Handle EIP-1559 transactions
    if (!fee?.maxFeePerGas) return 0;

    const feePerGas = Number(
      customFee.isCustom ? customFee.maxFeePerGas : fee?.maxFeePerGas
    );

    // Ensure we don't return NaN
    if (isNaN(feePerGas) || isNaN(gasLimit)) return 0;

    return (feePerGas * gasLimit) / 10 ** 9;
  }, [
    fee?.gasLimit,
    fee?.maxFeePerGas,
    customFee,
    isBitcoinBased,
    isEIP1559Compatible,
    gasPrice,
    validateCustomGasLimit,
  ]);

  useEffect(() => {
    if (!copied) return;
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

  // Navigate home when transaction is confirmed
  useEffect(() => {
    if (confirmed) {
      navigate('/home', {
        state: { fromTransaction: true },
      });
    }
  }, [confirmed, alert, t, navigate]);

  // Don't render main content if transaction is confirmed (toast will show)
  // The overlay handles loading display, so we just check for confirmed state
  const shouldShowMainContent = !confirmed;

  return (
    <>
      <EditPriorityModal
        showModal={isOpenEditFeeModal}
        setIsOpen={setIsOpenEditFeeModal}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={() => {
          // No-op function since haveError is not used
        }}
        fee={fee}
        isSendLegacyTransaction={!isEIP1559Compatible}
        defaultGasLimit={basicTxValues?.defaultGasLimit || 42000}
      />

      {/* Render main content only when appropriate - prevents blank screen during transaction completion */}
      {shouldShowMainContent && basicTxValues ? (
        <div className="flex flex-col items-center justify-center w-full">
          {basicTxValues.token?.isNft ? (
            <div className="flex flex-col items-center justify-center text-center font-rubik">
              {basicTxValues.token.tokenStandard === 'ERC-1155' ? (
                <>
                  <p>
                    {t('send.tokenId')}: {basicTxValues.token.tokenId}
                  </p>
                  <p>
                    {t('send.amount')}: {basicTxValues.amount}
                  </p>
                </>
              ) : (
                <>
                  <p>{t('send.tokenId')}</p>
                  <span>{basicTxValues.token.tokenId}</span>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col mb-4 items-center text-center">
              <div className="relative w-[50px] h-[50px] bg-brand-pink200 rounded-[100px] flex items-center justify-center mb-2">
                <img
                  className="relative w-[30px] h-[30px]"
                  src={'/assets/all_assets/ArrowUp.svg'}
                  alt="Icon"
                />
              </div>
              <p className="text-brand-gray200 text-xs font-light">
                {t('buttons.send')}
              </p>
              <p className="text-white text-base">
                {basicTxValues.amount}{' '}
                {basicTxValues.token
                  ? basicTxValues.token.symbol
                  : activeNetwork.currency.toUpperCase()}
              </p>
            </div>
          )}

          <div className="flex flex-col p-6 bg-brand-blue700 items-start justify-center w-full max-w-[380px] mx-auto text-left text-sm">
            <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {t('send.from')}
              <span className="text-white text-xs">
                <Tooltip
                  content={basicTxValues.sender}
                  childrenClassName="flex"
                >
                  {ellipsis(basicTxValues.sender, 7, 15)}
                  {
                    <IconButton
                      onClick={() => copy(basicTxValues.sender ?? '')}
                    >
                      <Icon
                        wrapperClassname="flex items-center justify-center"
                        name="Copy"
                        isSvg
                        className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                      />
                    </IconButton>
                  }
                </Tooltip>
              </span>
            </div>
            <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
            <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {t('send.to')}
              <span className="text-white text-xs">
                <Tooltip
                  content={basicTxValues.receivingAddress}
                  childrenClassName="flex"
                >
                  {ellipsis(basicTxValues.receivingAddress, 7, 15)}{' '}
                  {
                    <IconButton
                      onClick={() => copy(basicTxValues.receivingAddress ?? '')}
                    >
                      <Icon
                        wrapperClassname="flex items-center justify-center"
                        name="Copy"
                        isSvg
                        className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                      />
                    </IconButton>
                  }
                </Tooltip>
              </span>
            </div>
            <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
            {/* Only show fee section if we have meaningful fee information */}
            {!(isBitcoinBased && basicTxValues.fee === 0) && (
              <div className="flex flex-row items-end w-full">
                <div className="flex flex-col text-xs text-brand-gray200 font-poppins font-normal">
                  {t('send.estimatedGasFee')}
                  <span className="text-white text-xs">
                    {(() => {
                      let feeAmount;
                      if (
                        basicTxValues.fee !== undefined &&
                        basicTxValues.fee > 0
                      ) {
                        feeAmount = basicTxValues.fee;
                      } else if (isBitcoinBased) {
                        feeAmount = basicTxValues.fee;
                      } else if (
                        !isBitcoinBased &&
                        isEIP1559Compatible === false
                      ) {
                        feeAmount = getCalculatedFee;
                      } else {
                        feeAmount = getCalculatedFee;
                      }

                      const formattedFee = getFormattedFee(feeAmount);
                      const fiatAmount = getFeeFiatAmount(feeAmount);

                      return (
                        <div className="flex flex-col">
                          <span>{formattedFee}</span>
                          {fiatAmount && (
                            <span className="text-brand-gray200 text-xs">
                              ≈ {fiatAmount}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </span>
                </div>
                {!isBitcoinBased && !basicTxValues.token?.isNft
                  ? !isBitcoinBased &&
                    isEIP1559Compatible && (
                      <span
                        className="hover:text-fields-input-borderfocus pb-[3px]"
                        onClick={() => setIsOpenEditFeeModal(true)}
                      >
                        <Icon
                          name="EditTx"
                          isSvg
                          className="px-2 cursor-pointer text-brand-white hover:text-fields-input-borderfocus"
                        />{' '}
                      </span>
                    )
                  : null}
              </div>
            )}
            <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
            <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {!basicTxValues.token?.isNft ? (
                <>
                  Total ({t('send.amountAndFee')})
                  <span className="text-white text-xs">
                    {(() => {
                      // For ERC20 tokens, handle differently since we can't combine token amount + ETH fee into single fiat value
                      if (basicTxValues.token && !basicTxValues.token.isNft) {
                        const gasFeeFiat = getFeeFiatAmount(getCalculatedFee);

                        return (
                          <div className="flex flex-col">
                            <span>
                              {basicTxValues.amount}{' '}
                              {basicTxValues.token.symbol} + Gas Fee
                            </span>
                            {gasFeeFiat && (
                              <span className="text-brand-gray200 text-xs">
                                Gas Fee: ≈ {gasFeeFiat}
                              </span>
                            )}
                          </div>
                        );
                      }

                      // For native currency transactions (ETH/SYS), calculate combined total
                      let totalAmount;
                      let totalCrypto;

                      if (basicTxValues.fee !== undefined) {
                        // For MAX sends, don't add fee to amount since amount is already (balance - fee)
                        if (basicTxValues.isMax) {
                          totalAmount = basicTxValues.amount;
                          totalCrypto = currency(basicTxValues.amount, {
                            precision: 8,
                          }).format({ symbol: '' });
                        } else {
                          const total = currency(basicTxValues.fee, {
                            precision: 8,
                          }).add(basicTxValues.amount);
                          totalAmount = total.value;
                          totalCrypto = total.format({ symbol: '' });
                        }
                      } else if (isBitcoinBased) {
                        // For MAX sends, don't add fee to amount since amount is already (balance - fee)
                        if (basicTxValues.isMax) {
                          totalAmount = basicTxValues.amount;
                          totalCrypto = currency(basicTxValues.amount, {
                            precision: 8,
                          }).format({ symbol: '' });
                        } else {
                          const total = currency(basicTxValues.fee, {
                            precision: 8,
                          }).add(basicTxValues.amount);
                          totalAmount = total.value;
                          totalCrypto = total.format({ symbol: '' });
                        }
                      } else if (
                        !isBitcoinBased &&
                        isEIP1559Compatible === false
                      ) {
                        const calculatedFeeEther = getCalculatedFee;
                        if (basicTxValues.isMax) {
                          // For MAX sends, fee is already deducted from amount
                          totalAmount = basicTxValues.amount;
                          totalCrypto = currency(basicTxValues.amount, {
                            precision: 8,
                          }).format({ symbol: '' });
                        } else {
                          const total = currency(calculatedFeeEther, {
                            precision: 8,
                          }).add(basicTxValues.amount);
                          totalAmount = total.value;
                          totalCrypto = total.format({ symbol: '' });
                        }
                      } else {
                        const calculatedFeeEther = getCalculatedFee;
                        if (calculatedFeeEther !== undefined) {
                          if (basicTxValues.isMax) {
                            // For MAX sends, fee is already deducted from amount
                            totalAmount = basicTxValues.amount;
                            totalCrypto = currency(basicTxValues.amount, {
                              precision: 8,
                            }).format({ symbol: '' });
                          } else {
                            const total = currency(calculatedFeeEther, {
                              precision: 8,
                            }).add(basicTxValues.amount);
                            totalAmount = total.value;
                            totalCrypto = total.format({ symbol: '' });
                          }
                        } else {
                          // If fee calculation is pending, just show the amount
                          totalAmount = basicTxValues.amount;
                          totalCrypto = currency(basicTxValues.amount, {
                            precision: 8,
                          }).format({ symbol: '' });
                        }
                      }

                      const totalFiatAmount = getTotalFiatAmount(totalAmount);

                      return (
                        <div className="flex flex-col">
                          <span>
                            {removeScientificNotation(totalCrypto)}{' '}
                            {activeNetwork.currency.toUpperCase()}
                          </span>
                          {totalFiatAmount && (
                            <span className="text-brand-gray200 text-xs">
                              ≈ {totalFiatAmount}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </span>
                </>
              ) : (
                <>
                  {t('send.fee')}
                  <span className="text-white text-xs">
                    {(() => {
                      let feeAmount;

                      if (isBitcoinBased) {
                        feeAmount = basicTxValues.fee;
                      } else if (
                        !isBitcoinBased &&
                        isEIP1559Compatible === false
                      ) {
                        feeAmount = getCalculatedFee;
                      } else {
                        feeAmount = getCalculatedFee;
                      }

                      const formattedFee = getFormattedFee(feeAmount);
                      const fiatAmount = getFeeFiatAmount(feeAmount);

                      return (
                        <div className="flex flex-col">
                          <span>{formattedFee}</span>
                          {fiatAmount && (
                            <span className="text-brand-gray200 text-xs">
                              ≈ {fiatAmount}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </span>
                </>
              )}
            </div>
          </div>

          {isBitcoinBased && (
            <div className="w-full mt-4">
              <button
                onClick={() => setShowAdvancedDetails(!showAdvancedDetails)}
                className="flex items-center justify-between w-full p-3 bg-brand-blue600 border border-alpha-whiteAlpha300 rounded-lg hover:bg-brand-blue500 transition-colors duration-200"
              >
                <span className="text-white text-sm font-medium">
                  {t('send.advancedDetails')}
                </span>
                <ChevronDoubleDownIcon
                  className={`text-white w-5 h-5 transition-transform duration-200 ${
                    showAdvancedDetails ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {showAdvancedDetails && (
                <div className="mt-2 -mx-6 border-y border-alpha-whiteAlpha300 bg-brand-blue700 overflow-hidden">
                  <div
                    className="max-h-[500px] overflow-y-auto"
                    style={{ overflowX: 'hidden' }}
                  >
                    {/* Component only mounts when expanded - prevents remote asset fetching until needed.
                        The component has its own internal loading state while fetching asset data. */}
                    <SyscoinTransactionDetailsFromPSBT
                      psbt={basicTxValues.psbt}
                      transaction={basicTxValues}
                      showTechnicalDetails={true}
                      showTransactionOptions={true}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-around py-6 w-full mt-4">
            <Button
              type="button"
              onClick={async () => {
                await clearNavigationState();
                navigate('/home');
              }}
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
            >
              {t('buttons.cancel')}
            </Button>

            <Button
              type="button"
              disabled={confirmed}
              loading={loading}
              onClick={handleConfirm}
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none"
            >
              {t('buttons.confirm')}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
};
