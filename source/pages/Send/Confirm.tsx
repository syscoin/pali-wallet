import { BigNumber } from '@ethersproject/bignumber';
import { formatEther, parseUnits } from '@ethersproject/units';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import currency from 'currency.js';
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
import { selectEnsNameToAddress } from 'state/vault/selectors';
import { INetworkType } from 'types/network';
import { handleTransactionError } from 'utils/errorHandling';
import { formatGweiValue } from 'utils/formatSyscoinValue';
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
import { safeToFixed } from 'utils/safeToFixed';
import { sanitizeErrorMessage } from 'utils/syscoinErrorSanitizer';
import { getTokenTypeBadgeColor } from 'utils/tokens';

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
  const ensCache = useSelector(
    (state: RootState) => state.vaultGlobal.ensCache
  );
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

  const [gasPrice, setGasPrice] = useState<string>('0');
  const [txObjectState, setTxObjectState] = useState<any>();
  const [isOpenEditFeeModal, setIsOpenEditFeeModal] = useState<boolean>(false);
  // Removed unused haveError state

  const { isEIP1559Compatible, forceRecheck: forceEIP1559Recheck } =
    useEIP1559();
  const [copied, copy] = useCopyClipboard();

  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  // Resolve ENS lazily (tooltip + enforcement)
  const [resolvedToAddress, setResolvedToAddress] = useState<string | null>(
    null
  );
  const ensNameToAddress = useSelector(selectEnsNameToAddress);

  useEffect(() => {
    const maybeName = String((state as any)?.tx?.receivingAddress || '');
    if (!maybeName || !maybeName.toLowerCase().endsWith('.eth')) {
      setResolvedToAddress(null);
      return;
    }
    // Cache-first: check background-derived map name -> address
    const cached = ensNameToAddress[maybeName.toLowerCase()];
    (async () => {
      try {
        const addr =
          cached ||
          ((await controllerEmitter(['wallet', 'resolveEns'], [maybeName])) as
            | string
            | null);
        if (addr && typeof addr === 'string' && addr.startsWith('0x')) {
          setResolvedToAddress(addr);
        } else {
          setResolvedToAddress(null);
        }
      } catch {
        setResolvedToAddress(null);
      }
    })();
  }, [state, ensNameToAddress]);

  // Display destination: prefer resolved address when input was ENS
  const toRaw = useMemo(
    () => String((state as any)?.tx?.receivingAddress || ''),
    [state]
  );
  const tooltipToAddress = useMemo(
    () =>
      toRaw.toLowerCase().endsWith('.eth') ? resolvedToAddress || toRaw : toRaw,
    [toRaw, resolvedToAddress]
  );
  const labelToDisplay = useMemo(() => {
    if (toRaw.toLowerCase().endsWith('.eth')) return toRaw; // show ENS input
    const cachedName = ensCache?.[toRaw.toLowerCase()]?.name;
    return cachedName || toRaw;
  }, [toRaw, ensCache]);

  // We always display addresses; ENS names are only used as input and resolved to addresses

  // Add fee calculation cache and debouncing
  const [feeCalculationCache, setFeeCalculationCache] = useState<
    Map<string, any>
  >(new Map());
  const [isCalculatingFees, setIsCalculatingFees] = useState(false);
  const [feeCalculationError, setFeeCalculationError] = useState<string | null>(
    null
  );
  const [retryTrigger, setRetryTrigger] = useState(0);

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

  // Manual retry function for fee calculation
  const retryFeeCalculation = () => {
    setFeeCalculationError(null);
    setIsCalculatingFees(false);

    // For EVM networks, also recheck EIP1559 compatibility
    if (!isBitcoinBased) {
      forceEIP1559Recheck();
    }

    // Force recalculation by clearing cache for current params
    const cacheKey = JSON.stringify({
      sender: basicTxValues.sender,
      receivingAddress: basicTxValues.receivingAddress,
      chainId: activeNetwork.chainId,
      isEIP1559Compatible,
      amount: basicTxValues.amount,
    });
    setFeeCalculationCache((prev) => {
      const newCache = new Map(prev);
      newCache.delete(cacheKey);
      return newCache;
    });
    // Trigger recalculation
    setRetryTrigger((prev) => prev + 1);
  };

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

  // Clear navigation state on unmount to prevent stale state
  useEffect(
    () => () => {
      // Don't await here since this runs synchronously on unmount
      clearNavigationState();
    },
    []
  );

  // The confirmation screen displays the fee and total as calculated by SendSys.
  // When the user changes fee rate in SendSys and clicks "Next", SendSys recalculates
  // the transaction with the new fee rate and passes the correct values here.

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit && customFee.gasLimit > 0
  );

  const getFormattedFee = (currentFee: number | string | undefined) => {
    if (feeCalculationError) {
      return t('buttons.error');
    }
    if (
      currentFee === undefined ||
      currentFee === null ||
      isNaN(Number(currentFee))
    ) {
      return t('send.calculating');
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

  const getLegacyGasPrice = async () => {
    const correctGasPrice = Boolean(
      customFee.isCustom && customFee.gasPrice > 0
    )
      ? parseUnits(safeToFixed(customFee.gasPrice), 9).toString() // Convert Gwei to Wei using parseUnits, keep as string for precision
      : await controllerEmitter([
          'wallet',
          'ethereumTransaction',
          'getRecommendedGasPrice',
        ]).then((gas) => BigNumber.from(gas).toString());

    // Always use a valid gas limit - custom, default from tx type, or fallback
    const gasLimit =
      customFee.isCustom && customFee.gasLimit > 0
        ? customFee.gasLimit
        : basicTxValues?.defaultGasLimit || 42000;

    const initialFee = { ...INITIAL_FEE, gasLimit };

    initialFee.gasPrice = parseFloat(formatGweiValue(correctGasPrice)); // Convert wei back to Gwei for display using safe conversion

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
  const stableT = useRef(t);
  const stableGetLegacyGasPrice = useRef(getLegacyGasPrice);

  // Update refs when values change
  useEffect(() => {
    stableNavigate.current = navigate;
    stableT.current = t;
    stableGetLegacyGasPrice.current = getLegacyGasPrice;
  }, [navigate, alert, t, getLegacyGasPrice]);

  const handleConfirm = async () => {
    const balance = isBitcoinBased
      ? activeAccount.balances[INetworkType.Syscoin]
      : activeAccount.balances[INetworkType.Ethereum];

    if (activeAccount && balance >= 0) {
      setLoading(true);

      // Enforce ENS resolution: if user provided an ENS name and it couldn't be resolved, block
      const rawTo = String(basicTxValues?.receivingAddress || '');
      const isEnsInput = rawTo.toLowerCase().endsWith('.eth');
      if (isEnsInput && !resolvedToAddress) {
        setLoading(false);
        alert.error(t('send.unableToResolveEns'));
        return;
      }
      const destinationTo = resolvedToAddress || rawTo;

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
            // Handle all errors with centralized handler
            const wasHandledSpecifically = handleTransactionError(
              error,
              alert,
              t,
              activeAccount,
              activeNetwork,
              basicTxValues,
              sanitizeErrorMessage
            );

            if (!wasHandledSpecifically) {
              const sanitizedMessage = sanitizeErrorMessage(error);
              if (error && basicTxValues.fee > 0.00001) {
                alert.error(
                  `${truncate(sanitizedMessage, 166)} ${t('send.reduceFee')}`
                );
              } else {
                alert.error(t('send.cantCompleteTxs'));
              }
              logError('error SYS', 'Transaction', error);
            }

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

          let value = parseUnits(String(basicTxValues.amount), 'ether');
          const floorToDecimals = (num: string | number, decimals: number) => {
            const s = String(num);
            const parts = s.split('.');
            if (parts.length === 1) return s;
            const [intPart, fracPart] = parts;
            const truncated = fracPart.slice(0, decimals); // floor, do not round
            return truncated.length > 0 ? `${intPart}.${truncated}` : intPart;
          };

          try {
            // For MAX sends, use the actual balance instead of parsed amount to avoid rounding errors
            // The amount from basicTxValues might be rounded for display, causing precision issues
            if (basicTxValues.isMax) {
              // Use the already-fetched EVM balance (ETH units)
              const actualBalanceEth = balance;
              const balanceStrFloored = floorToDecimals(actualBalanceEth, 18);
              value = parseUnits(balanceStrFloored, 'ether');
              const gasLimit = BigNumber.from(
                validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
              );

              if (isEIP1559Compatible) {
                // EIP-1559 transaction
                const maxFeePerGasWei = parseUnits(
                  Boolean(customFee.isCustom && customFee.maxFeePerGas > 0)
                    ? safeToFixed(customFee.maxFeePerGas)
                    : safeToFixed(fee.maxFeePerGas),
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
                      to: destinationTo,
                      value: value.toHexString(), // Convert to hex string to avoid out-of-safe-range error
                      gasPrice: BigNumber.from(gasPrice).toHexString(), // Use BigNumber for precision
                      gasLimit: BigNumber.from(
                        validateCustomGasLimit
                          ? customFee.gasLimit
                          : fee.gasLimit ||
                              basicTxValues.defaultGasLimit ||
                              42000
                      ).toHexString(), // Convert to hex string
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
                // Handle specific errors (blacklist, cancellation, device issues, etc.)
                const wasHandledSpecifically = handleTransactionError(
                  error,
                  alert,
                  t,
                  activeAccount,
                  activeNetwork,
                  basicTxValues
                );

                // For errors that were handled specifically, just stop loading
                if (wasHandledSpecifically) {
                  setLoading(false);
                  return;
                }

                // For all other unhandled errors, show generic message
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
                  to: destinationTo,
                  value: value.toHexString(), // Convert to hex string to avoid out-of-safe-range error
                  maxPriorityFeePerGas: parseUnits(
                    Boolean(
                      customFee.isCustom && customFee.maxPriorityFeePerGas > 0
                    )
                      ? safeToFixed(customFee.maxPriorityFeePerGas)
                      : safeToFixed(fee.maxPriorityFeePerGas),
                    9
                  ),
                  maxFeePerGas: parseUnits(
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
            // For MAX sends, if we get insufficient funds error, retry with a buffer
            // This can happen due to gas price fluctuations between estimation and execution
            if (
              basicTxValues.isMax &&
              error.message?.includes('insufficient funds')
            ) {
              const buffer = BigNumber.from('100000');
              const reducedValue = value.sub(buffer);

              if (reducedValue.gt(0)) {
                const retryTxObject = {
                  ...restTx,
                  to: destinationTo,
                  value: reducedValue.toHexString(), // Convert to hex string to avoid out-of-safe-range error
                  maxPriorityFeePerGas: parseUnits(
                    Boolean(
                      customFee.isCustom && customFee.maxPriorityFeePerGas > 0
                    )
                      ? safeToFixed(customFee.maxPriorityFeePerGas)
                      : safeToFixed(fee.maxPriorityFeePerGas),
                    9
                  ),
                  maxFeePerGas: parseUnits(
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
                  // If retry also fails, handle with specific error messages
                  const wasHandledSpecifically = handleTransactionError(
                    retryError,
                    alert,
                    t,
                    activeAccount,
                    activeNetwork,
                    basicTxValues
                  );

                  if (!wasHandledSpecifically) {
                    logError('error ETH retry', 'Transaction', retryError);
                    alert.error(t('send.cantCompleteTxs'));
                  }

                  setLoading(false);
                  return;
                }
              }
            }

            // Handle specific errors (blacklist, cancellation, etc.) with detailed messages
            const wasHandledSpecifically = handleTransactionError(
              error,
              alert,
              t,
              activeAccount,
              activeNetwork,
              basicTxValues
            );

            if (!wasHandledSpecifically) {
              // Only show generic error if no specific handling occurred
              logError('error ETH', 'Transaction', error);
              alert.error(t('send.cantCompleteTxs'));
            }

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
                        receiver: destinationTo,
                        tokenAddress: basicTxValues.token.contractAddress,
                        tokenAmount: `${basicTxValues.amount}`,
                        isLegacy: !isEIP1559Compatible,
                        decimals: basicTxValues?.token?.decimals,
                        gasPrice: BigNumber.from(gasPrice).toHexString(),
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
                  // Handle specific errors with detailed messages
                  const wasHandledSpecifically = handleTransactionError(
                    error,
                    alert,
                    t,
                    activeAccount,
                    activeNetwork,
                    basicTxValues
                  );

                  if (!wasHandledSpecifically) {
                    logError('error send ERC20', 'Transaction', error);
                    alert.error(t('send.cantCompleteTxs'));
                  }

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
                      receiver: destinationTo,
                      tokenAddress: basicTxValues.token.contractAddress,
                      tokenAmount: `${basicTxValues.amount}`,
                      isLegacy: !isEIP1559Compatible,
                      decimals: basicTxValues?.token?.decimals,
                      maxPriorityFeePerGas: parseUnits(
                        Boolean(
                          customFee.isCustom &&
                            customFee.maxPriorityFeePerGas > 0
                        )
                          ? safeToFixed(customFee.maxPriorityFeePerGas)
                          : safeToFixed(fee.maxPriorityFeePerGas),
                        9
                      ),
                      maxFeePerGas: parseUnits(
                        Boolean(
                          customFee.isCustom && customFee.maxFeePerGas > 0
                        )
                          ? safeToFixed(customFee.maxFeePerGas)
                          : safeToFixed(fee.maxFeePerGas),
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
                // Handle blind signing requirement
                // Handle specific errors (blacklist, cancellation, device issues, etc.)
                const wasHandledSpecifically = handleTransactionError(
                  error,
                  alert,
                  t,
                  activeAccount,
                  activeNetwork,
                  basicTxValues
                );

                // For errors that were handled specifically, just stop loading
                if (wasHandledSpecifically) {
                  setLoading(false);
                  return;
                }

                // For all other unhandled errors, show generic message
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
                      receiver: destinationTo,
                      tokenAddress: basicTxValues.token.contractAddress,
                      tokenId: numericTokenId, // The actual NFT token ID
                      isLegacy: !isEIP1559Compatible,
                      gasPrice: BigNumber.from(gasPrice).toHexString(),
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
                // Handle blind signing requirement
                // Handle specific errors (blacklist, cancellation, device issues, etc.)
                const wasHandledSpecifically = handleTransactionError(
                  error,
                  alert,
                  t,
                  activeAccount,
                  activeNetwork,
                  basicTxValues
                );

                // For errors that were handled specifically, just stop loading
                if (wasHandledSpecifically) {
                  setLoading(false);
                  return;
                }

                // For all other unhandled errors, show generic message
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
                      receiver: destinationTo,
                      tokenAddress: basicTxValues.token.contractAddress,
                      tokenId: numericTokenId, // The actual NFT token ID
                      tokenAmount: String(basicTxValues.amount), // The amount of tokens to send
                      isLegacy: !isEIP1559Compatible,
                      maxPriorityFeePerGas: parseUnits(
                        Boolean(
                          customFee.isCustom &&
                            customFee.maxPriorityFeePerGas > 0
                        )
                          ? safeToFixed(customFee.maxPriorityFeePerGas)
                          : safeToFixed(fee.maxPriorityFeePerGas),
                        9
                      ),
                      maxFeePerGas: parseUnits(
                        Boolean(
                          customFee.isCustom && customFee.maxFeePerGas > 0
                        )
                          ? safeToFixed(customFee.maxFeePerGas)
                          : safeToFixed(fee.maxFeePerGas),
                        9
                      ),
                      gasPrice: BigNumber.from(gasPrice).toHexString(),
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
                // Handle specific errors (blacklist, cancellation, device issues, etc.)
                const wasHandledSpecifically = handleTransactionError(
                  error,
                  alert,
                  t,
                  activeAccount,
                  activeNetwork,
                  basicTxValues
                );

                // For errors that were handled specifically, just stop loading
                if (wasHandledSpecifically) {
                  setLoading(false);
                  return;
                }

                // For all other unhandled errors, show generic message
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
      return; // Wait for EIP1559 compatibility check to complete
    }

    // Skip fee recalculation when using custom fees
    if (customFee.isCustom) {
      return;
    }

    // If we have an error from a previous attempt, don't retry automatically
    if (feeCalculationError) {
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
      // Don't retry if we already have an error
      if (feeCalculationError || isCalculatingFees) {
        return;
      }

      const getLegacyFeeRecomendation = async () => {
        setIsCalculatingFees(true);
        setFeeCalculationError(null); // Clear any previous errors
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

          // Cache the successful result
          setFeeCalculationCache(
            (prev) =>
              new Map(prev.set(cacheKey, { gasLimit, gasPrice: _gasPrice }))
          );
        } catch (error: any) {
          console.error('Legacy fee calculation error:', error);

          // Check if this is a rate limiting error
          const isRateLimited =
            error.message?.includes('rate limit') ||
            error.message?.includes('Rate limit') ||
            error.message?.includes('<!DOCTYPE html>') ||
            error.message?.includes('cloudflare') ||
            error.message?.includes('Error 1015') ||
            error.message?.includes('429') ||
            error.message?.includes('authentication may be required');

          if (isRateLimited) {
            setFeeCalculationError(t('send.networkBusy'));
          } else {
            setFeeCalculationError(t('send.unableToCalculateFees'));
          }
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

      // Convert hex strings back to BigNumbers (they were serialized for navigation)
      const maxFeeBN = BigNumber.from(maxFeePerGas || '0');
      const maxPriorityBN = BigNumber.from(maxPriorityFeePerGas || '0');

      const gasLimit = basicTxValues.defaultGasLimit || 42000;
      const initialFeeDetails = {
        maxFeePerGas: parseFloat(formatGweiValue(maxFeeBN)),
        baseFee: parseFloat(formatGweiValue(maxFeeBN.sub(maxPriorityBN))),
        maxPriorityFeePerGas: parseFloat(formatGweiValue(maxPriorityBN)),
        gasLimit: BigNumber.from(gasLimit).toNumber(), // Always use default gas limit from transaction type
      };

      const formattedTxObject = {
        from: basicTxValues.sender,
        to: basicTxValues.receivingAddress,
        chainId: activeNetwork.chainId,
        maxFeePerGas: maxFeeBN,
        maxPriorityFeePerGas: maxPriorityBN,
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
      setFeeCalculationError(null); // Clear any previous errors

      try {
        const { maxFeePerGas, maxPriorityFeePerGas } =
          (await stableControllerEmitter.current([
            'wallet',
            'ethereumTransaction',
            'getFeeDataWithDynamicMaxPriorityFeePerGas',
          ])) as any;

        const initialFeeDetails = {
          maxFeePerGas: parseFloat(formatGweiValue(maxFeePerGas)),
          baseFee: parseFloat(
            formatGweiValue(
              BigNumber.from(maxFeePerGas).sub(
                BigNumber.from(maxPriorityFeePerGas)
              )
            )
          ),
          maxPriorityFeePerGas: parseFloat(
            formatGweiValue(maxPriorityFeePerGas)
          ),
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
          setFeeCalculationError(
            'Network is temporarily busy. Click to retry.'
          );
        } else {
          setFeeCalculationError('Unable to calculate fees. Click to retry.');
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
    feeCalculationError, // Added feeCalculationError to dependencies
    retryTrigger, // Added retryTrigger to dependencies
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
          : parseFloat(formatGweiValue(gasPrice))
      );

      if (isNaN(gasPriceValue) || isNaN(gasLimit)) return 0;

      // Use BigNumber to prevent overflow for large gas prices
      const gasLimitBN = BigNumber.from(gasLimit);
      // Limit to 9 decimal places to avoid parseUnits error
      const gasPriceStr = gasPriceValue.toFixed(9);
      const gasPriceWeiBN = parseUnits(gasPriceStr, 'gwei');
      const totalFeeWeiBN = gasLimitBN.mul(gasPriceWeiBN);
      return Number(formatEther(totalFeeWeiBN));
    }

    // Handle EIP-1559 transactions
    if (!fee?.maxFeePerGas) return 0;

    const feePerGas = Number(
      customFee.isCustom ? customFee.maxFeePerGas : fee?.maxFeePerGas
    );

    // Ensure we don't return NaN
    if (isNaN(feePerGas) || isNaN(gasLimit)) return 0;

    // Use BigNumber to prevent overflow for large gas prices
    const gasLimitBN = BigNumber.from(gasLimit);
    // Limit to 9 decimal places to avoid parseUnits error
    const feePerGasStr = feePerGas.toFixed(9);
    const feePerGasWeiBN = parseUnits(feePerGasStr, 'gwei');
    const totalFeeWeiBN = gasLimitBN.mul(feePerGasWeiBN);
    return Number(formatEther(totalFeeWeiBN));
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
            <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto">
              {/* NFT Token Information Card */}
              <div className="bg-bkg-2 rounded-2xl p-4 w-full border border-bkg-4 mb-4">
                {/* Token Name and Type */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-medium text-base">
                      {basicTxValues.token.name ||
                        basicTxValues.token.symbol ||
                        'NFT'}
                    </h3>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${getTokenTypeBadgeColor(
                        basicTxValues.token.tokenStandard
                      )}`}
                    >
                      {basicTxValues.token.tokenStandard}
                    </span>
                  </div>
                </div>

                {/* Contract Address */}
                <div className="mb-3">
                  <p className="text-brand-gray200 text-xs mb-1">
                    {t('settings.contractAddress')}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-mono">
                      <Tooltip content={basicTxValues.token.contractAddress}>
                        {ellipsis(basicTxValues.token.contractAddress, 8, 6)}
                      </Tooltip>
                    </span>
                    <button
                      type="button"
                      onClick={() => copy(basicTxValues.token.contractAddress)}
                      className="text-brand-gray200 hover:text-white transition-colors"
                    >
                      <Icon
                        name="Copy"
                        isSvg
                        className="w-4 h-4 text-brand-gray200 hover:text-white"
                      />
                    </button>
                  </div>
                </div>

                {/* Token Details */}
                <div className="space-y-2">
                  {/* Token ID */}
                  <div className="bg-bkg-3 rounded-lg px-3 py-2">
                    <p className="text-brand-gray200 text-xs mb-1">
                      {t('send.tokenId')}
                    </p>
                    <div className="text-white font-medium">
                      {basicTxValues.token.tokenId ? (
                        basicTxValues.token.tokenId.length > 20 ? (
                          <Tooltip content={basicTxValues.token.tokenId}>
                            #{ellipsis(basicTxValues.token.tokenId, 8, 8)}
                          </Tooltip>
                        ) : (
                          `#${basicTxValues.token.tokenId}`
                        )
                      ) : (
                        <span className="text-warning-error">
                          Missing Token ID
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount (for ERC-1155) */}
                  {basicTxValues.token.tokenStandard === 'ERC-1155' && (
                    <div className="bg-bkg-3 rounded-lg px-3 py-2">
                      <p className="text-brand-gray200 text-xs mb-1">
                        {t('send.amount')}
                      </p>
                      <p className="text-white font-medium text-lg">
                        {basicTxValues.amount}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto">
              {/* Token/Currency Information Card */}
              <div className="bg-bkg-2 rounded-2xl p-4 w-full border border-bkg-4 mb-4">
                {/* Amount and Token/Currency */}
                <div className="text-center mb-3">
                  <p className="text-brand-gray200 text-xs mb-1">
                    {t('buttons.send')}
                  </p>
                  <p className="text-white text-2xl font-semibold mb-2">
                    {basicTxValues.amount}{' '}
                    {basicTxValues.token
                      ? basicTxValues.token.symbol
                      : activeNetwork.currency.toUpperCase()}
                  </p>
                </div>

                {/* Token Details (if ERC20 or SPT) */}
                {basicTxValues.token && !basicTxValues.token.isNft && (
                  <>
                    {/* Token Name and Type */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-medium text-base">
                          {basicTxValues.token.name ||
                            basicTxValues.token.symbol}
                        </h3>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${getTokenTypeBadgeColor(
                            isBitcoinBased ? 'SPT' : 'ERC-20'
                          )}`}
                        >
                          {isBitcoinBased ? 'SPT' : 'ERC-20'}
                        </span>
                      </div>
                    </div>

                    {/* Contract Address or Asset GUID */}
                    <div className="bg-bkg-3 rounded-lg px-3 py-2">
                      <p className="text-brand-gray200 text-xs mb-1">
                        {isBitcoinBased
                          ? t('send.assetGuid')
                          : t('settings.contractAddress')}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-mono">
                          <Tooltip
                            content={
                              isBitcoinBased
                                ? basicTxValues.token.guid ||
                                  basicTxValues.token.assetGuid
                                : basicTxValues.token.contractAddress
                            }
                          >
                            {isBitcoinBased
                              ? basicTxValues.token.guid ||
                                basicTxValues.token.assetGuid ||
                                'N/A'
                              : ellipsis(
                                  basicTxValues.token.contractAddress,
                                  8,
                                  6
                                )}
                          </Tooltip>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            copy(
                              isBitcoinBased
                                ? basicTxValues.token.guid ||
                                    basicTxValues.token.assetGuid
                                : basicTxValues.token.contractAddress
                            )
                          }
                          className="text-brand-gray200 hover:text-white transition-colors"
                        >
                          <Icon
                            name="Copy"
                            isSvg
                            className="w-4 h-4 text-brand-gray200 hover:text-white"
                          />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Native Currency Label */}
                {!basicTxValues.token && (
                  <div className="text-center">
                    <span
                      className={`text-xs px-3 py-1 rounded-full ${getTokenTypeBadgeColor(
                        'native'
                      )}`}
                    >
                      {t('send.native')} {activeNetwork?.label || ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col p-6 bg-brand-blue700 items-start justify-center w-full max-w-md mx-auto text-left text-sm rounded-xl">
            <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {t('send.from')}
              <span className="text-white text-xs">
                <Tooltip
                  content={basicTxValues.sender}
                  childrenClassName="flex"
                >
                  {ellipsis(basicTxValues.sender, 7, 15)}
                  <IconButton onClick={() => copy(basicTxValues.sender ?? '')}>
                    <Icon
                      wrapperClassname="flex items-center justify-center"
                      name="Copy"
                      isSvg
                      className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                    />
                  </IconButton>
                </Tooltip>
              </span>
            </div>
            <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
            <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {t('send.to')}
              <span className="text-white text-xs">
                <Tooltip content={tooltipToAddress} childrenClassName="flex">
                  {ellipsis(labelToDisplay, 7, 15)}{' '}
                  <IconButton onClick={() => copy(tooltipToAddress ?? '')}>
                    <Icon
                      wrapperClassname="flex items-center justify-center"
                      name="Copy"
                      isSvg
                      className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                    />
                  </IconButton>
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
                      if (feeCalculationError) {
                        return (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 px-2 py-1 bg-warning-error bg-opacity-10 rounded">
                              <Icon
                                name="warning"
                                className="w-3 h-3 text-warning-error"
                              />
                              <span className="text-warning-error text-xs">
                                {t('send.unableToLoad')}
                              </span>
                            </div>
                            <Tooltip content={feeCalculationError}>
                              <IconButton
                                onClick={retryFeeCalculation}
                                className="p-1 hover:bg-brand-blue600 rounded-full transition-all duration-200"
                              >
                                <Icon
                                  name="reload"
                                  className="w-3.5 h-3.5 text-brand-gray200 hover:text-white cursor-pointer transition-colors"
                                />
                              </IconButton>
                            </Tooltip>
                          </div>
                        );
                      }

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
                {!isBitcoinBased &&
                  !basicTxValues.token?.isNft &&
                  !feeCalculationError &&
                  (isEIP1559Compatible ? (
                    <span
                      className="hover:text-fields-input-borderfocus pb-[3px]"
                      onClick={() => setIsOpenEditFeeModal(true)}
                    >
                      <Icon
                        name="EditTx"
                        isSvg
                        className="px-2 cursor-pointer text-brand-white hover:text-fields-input-borderfocus"
                      />
                    </span>
                  ) : null)}
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
                        const gasFeeFiat = feeCalculationError
                          ? null
                          : getFeeFiatAmount(getCalculatedFee);

                        return (
                          <div className="flex flex-col">
                            <span>
                              {basicTxValues.amount}{' '}
                              {basicTxValues.token.symbol}
                              {t('send.plusGasFee')}
                            </span>
                            {feeCalculationError ? (
                              <span className="text-xs flex items-center gap-1 mt-1">
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-warning-error bg-opacity-10 rounded">
                                  <Icon
                                    name="warning"
                                    className="w-3 h-3 text-warning-error"
                                  />
                                  <span className="text-warning-error">
                                    {t('send.feeUnavailable')}
                                  </span>
                                </div>
                                <IconButton
                                  onClick={retryFeeCalculation}
                                  className="p-0.5 hover:bg-brand-blue600 rounded-full transition-all duration-200"
                                >
                                  <Icon
                                    name="reload"
                                    className="w-3 h-3 text-brand-gray200 hover:text-white cursor-pointer transition-colors"
                                  />
                                </IconButton>
                              </span>
                            ) : gasFeeFiat ? (
                              <span className="text-brand-gray200 text-xs">
                                {t('send.gasFeeApprox')} {gasFeeFiat}
                              </span>
                            ) : null}
                          </div>
                        );
                      }

                      // For native currency transactions (ETH/SYS), calculate combined total
                      let totalAmount;
                      let totalCrypto;

                      // If there's a fee calculation error, just show the amount without fee
                      if (feeCalculationError) {
                        totalAmount = basicTxValues.amount;
                        totalCrypto = currency(basicTxValues.amount, {
                          precision: 8,
                        }).format({ symbol: '' });
                      } else if (basicTxValues.fee !== undefined) {
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
                            {feeCalculationError && (
                              <span className="text-xs text-brand-gray200 ml-1">
                                {t('send.plusFees')}
                              </span>
                            )}
                          </span>
                          {totalFiatAmount && !feeCalculationError && (
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
                      if (feeCalculationError) {
                        return (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 px-2 py-1 bg-warning-error bg-opacity-10 rounded">
                              <Icon
                                name="warning"
                                className="w-3 h-3 text-warning-error"
                              />
                              <span className="text-warning-error text-xs">
                                {t('send.unableToLoad')}
                              </span>
                            </div>
                            <Tooltip content={feeCalculationError}>
                              <IconButton
                                onClick={retryFeeCalculation}
                                className="p-1 hover:bg-brand-blue600 rounded-full transition-all duration-200"
                              >
                                <Icon
                                  name="reload"
                                  className="w-3.5 h-3.5 text-brand-gray200 hover:text-white cursor-pointer transition-colors"
                                />
                              </IconButton>
                            </Tooltip>
                          </div>
                        );
                      }

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
              disabled={
                confirmed ||
                isCalculatingFees ||
                (!isBitcoinBased && !!feeCalculationError)
              }
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
