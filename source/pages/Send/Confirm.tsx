import { buildSmartAccountErc20Transfer } from 'utils/smartAccount/erc20Transfer';
import { prepareSmartAccountNativeMaximum } from 'utils/smartAccount/nativeMaximum';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import currency from 'currency.js';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  startTransition,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { assertSupportedEvmFees } from '../../shared/dappTransaction.ts';
import { parseErc20Units } from '../../shared/erc20';
import { EVM_FEE_APPROVAL_LIFETIME_MS } from '../../shared/evmFeeApproval';
import { getEvmTransferCost } from '../../shared/evmTransferCost';
import {
  ICustomFeeParams,
  IFeeState,
  ITxState,
  TransactionType,
} from '../../types/transactions';
import {
  Button,
  Icon,
  Tooltip,
  IconButton,
  DeviceWaitingBanner,
} from 'components/index';
import { PqSigningOverlay } from 'components/Loading';
import { SyscoinTransactionDetailsFromPSBT } from 'components/TransactionDetails';
import { useUtils, usePrice } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useEIP1559 } from 'hooks/useEIP1559';
import { RootState } from 'state/store';
import {
  selectEnsNameToAddress,
  selectValidEnsCache,
} from 'state/vault/selectors';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  findEvmAddressPoisoningCollision,
  getTrustedEvmRecipients,
} from 'utils/addressPoisoning';
import { handleTransactionError } from 'utils/errorHandling';
import {
  formatEther,
  formatUnits,
  parseUnits,
  toEthersBigNumberish,
} from 'utils/ethersV6Compat';
import { BigNumber } from 'utils/ethersV6Compat';
import { Interface } from 'utils/ethersV6Compat';
import { getLocalEvmRecipients } from 'utils/evmRecipients';
import {
  EVM_SIGNED_STORAGE_FULL,
  isSavedEvmNonceConflict,
} from 'utils/evmTransactionContext';
import { formatGweiValue, formatSyscoinValue } from 'utils/formatSyscoinValue';
import {
  truncate,
  logError,
  ellipsis,
  removeScientificNotation,
  omitTransactionObjectData,
  INITIAL_FEE,
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS,
} from 'utils/index';
import { navigateBack } from 'utils/navigationState';
import { normalizeNftTokenId } from 'utils/nftTokenId';
import { safeToFixed } from 'utils/safeToFixed';
import {
  getSmartAccountLocalOwnerContexts,
  prepareSmartAccountFeeQuote,
  signAndSubmitSmartAccountExecutions,
  type SmartAccountFeeOverrides,
} from 'utils/smartAccount';
import { canPublishAccountAddress } from 'utils/smartAccount/addressIdentity';
import { sanitizeErrorMessage } from 'utils/syscoinErrorSanitizer';
import { getTokenTypeBadgeColor } from 'utils/tokens';
import { getErc721Abi, getErc1155Abi } from 'utils/validations';

import { EditPriorityModal } from './EditPriority';
import { parseWalletErc20SendAmount } from './erc20SendAmount';
import { useConfirmSubmission } from './useConfirmSubmission';
import { openWalletTokenReview } from './walletTokenReviewPort';
import type { WalletTokenReviewPayload } from '../../shared/walletTokenReview';

const NON_SOFTWARE_MAX_SEND_RESERVE_WEI = parseUnits(
  '0.000001',
  'ether'
).toBigInt();
const NATIVE_EVM_MAX_SEND_INITIAL_GAS_RESERVE = BigNumber.from(500_000);
const nativeMaxSendValue = (
  balance: string | number,
  gasLimit: BigNumber,
  feeRate: BigNumber,
  reserveWei: bigint
) => {
  const [whole, fraction] = String(balance).split('.');
  const balanceWei = parseUnits(
    fraction ? `${whole}.${fraction.slice(0, 18)}` : whole,
    'ether'
  );
  const { maximumFee } = getEvmTransferCost(
    BigInt(0),
    gasLimit.toBigInt(),
    feeRate.toBigInt()
  );
  return balanceWei.sub(maximumFee + reserveWei);
};
const transactionReviewDivider = (
  <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
);

export const SendConfirm = () => {
  const { controllerEmitter, isUnlocked, isLoading, connectionUnavailable } =
    useController();
  const { t } = useTranslation();
  const { alert, navigate, useCopyClipboard } = useUtils();
  const { getFiatAmount, isFiatAvailable } = usePrice();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const {
    accounts,
    activeAccount: activeAccountMeta,
    accountTransactions,
  } = useSelector((state: RootState) => state.vault);
  const { fiat } = useSelector((state: RootState) => state.price);
  const activeSlip44 = useSelector(
    (state: RootState) => state.vaultGlobal?.activeSlip44
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const currentEvmTransactions = useMemo(
    () =>
      accountTransactions?.[activeAccountMeta.type]?.[activeAccountMeta.id]
        ?.ethereum?.[activeNetwork?.chainId] || [],
    [
      accountTransactions,
      activeAccountMeta.id,
      activeAccountMeta.type,
      activeNetwork?.chainId,
    ]
  );
  const trustedRecentRecipients = useMemo(
    () =>
      getTrustedEvmRecipients(
        currentEvmTransactions,
        activeAccount?.address || ''
      ),
    [activeAccount?.address, currentEvmTransactions]
  );
  const { addresses: localEvmAddresses, getRecipientIssue } = useMemo(
    () => getLocalEvmRecipients(accounts, activeNetwork),
    [accounts, activeNetwork]
  );
  // Use valid (non-expired) ENS cache for security
  const ensCache = useSelector(selectValidEnsCache);
  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const location = useLocation();
  const submission = useConfirmSubmission({
    location,
    navigate,
    controllerEmitter,
    isUnlocked,
    isLoading,
    connectionUnavailable,
  });
  const { state } = submission;
  const tokenReviewPort = useRef<ReturnType<typeof openWalletTokenReview>>();
  useEffect(() => {
    const retireOnDeparture = () => {
      if (!submission.isActive()) tokenReviewPort.current?.close();
    };
    window.addEventListener('hashchange', retireOnDeparture);
    window.addEventListener('popstate', retireOnDeparture);
    return () => {
      tokenReviewPort.current?.close();
      window.removeEventListener('hashchange', retireOnDeparture);
      window.removeEventListener('popstate', retireOnDeparture);
    };
  }, []);
  useEffect(() => {
    if (!submission.isActive()) tokenReviewPort.current?.close();
  }, [location, state]);

  // Bind this local, non-broadcast failure to the reviewed transaction and
  // active wallet context. A later quote refresh alone does not dismiss it.
  const capacityNoticeScope = JSON.stringify([
    location.pathname,
    activeAccountMeta.type,
    activeAccountMeta.id,
    activeAccount?.address,
    activeNetwork?.chainId,
    activeNetwork?.url,
    state?.walletScope,
    state?.tx?.sender,
    state?.tx?.receivingAddress,
    state?.tx?.amount,
    state?.tx?.nonce,
    state?.tx?.transactionType,
    state?.tx?.token?.contractAddress,
    state?.tx?.token?.tokenId,
    state?.tx?.tokenAmountUnits,
  ]);
  const [capacityNotice, setCapacityNotice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [isPqSigning, setIsPqSigning] = useState(false);
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
  const recipientPoisoningCollision = useMemo(
    () =>
      isBitcoinBased
        ? null
        : findEvmAddressPoisoningCollision(
            resolvedToAddress || toRaw,
            trustedRecentRecipients,
            localEvmAddresses
          ),
    [
      isBitcoinBased,
      localEvmAddresses,
      resolvedToAddress,
      toRaw,
      trustedRecentRecipients,
    ]
  );

  const recipientIssue = isBitcoinBased
    ? null
    : getRecipientIssue(resolvedToAddress || toRaw);

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
  const basicTxValues = state?.tx;
  const reviewedErc20Units = useMemo(() => {
    if (isBitcoinBased || !basicTxValues) return undefined;
    const { amount, token, tokenAmountUnits, transactionType } = basicTxValues;
    if (transactionType !== TransactionType.ERC20) {
      // A saved token review without its exact route cannot become a native send.
      return token &&
        transactionType !== TransactionType.ERC721 &&
        transactionType !== TransactionType.ERC1155
        ? null
        : undefined;
    }
    if (
      !token ||
      typeof amount !== 'string' ||
      typeof tokenAmountUnits !== 'string'
    )
      return null;
    try {
      return parseWalletErc20SendAmount(amount, token.decimals) ===
        tokenAmountUnits
        ? tokenAmountUnits
        : null;
    } catch {
      return null;
    }
  }, [basicTxValues, isBitcoinBased]);
  const tokenReviewInvalid = reviewedErc20Units === null;
  const isSmartAccountSend =
    !isBitcoinBased &&
    Boolean(activeAccount?.isSmartAccount && activeAccount.smartAccount);
  const [smartAccountQuote, setSmartAccountQuote] = useState<{
    executions: { data: string; target: string; value: string }[];
    feeOverrides: SmartAccountFeeOverrides;
    gasUnits: string;
    key: string;
    maximumFeeWei: string;
  }>();
  const [smartAccountQuoteError, setSmartAccountQuoteError] =
    useState<string>();
  const [smartAccountQuoteNeedsRefresh, setSmartAccountQuoteNeedsRefresh] =
    useState(false);
  const requiresSptReview = isBitcoinBased && Boolean(basicTxValues?.token);
  const sptReviewKey = requiresSptReview
    ? JSON.stringify([
        activeNetwork?.chainId,
        activeNetwork?.url,
        basicTxValues?.psbt,
      ])
    : '';
  const [sptReview, setSptReview] = useState<{
    error: string | null;
    key: string;
  }>({ error: 'Transaction details are loading', key: '' });
  const handleSptReviewStateChange = useCallback(
    (error: string | null) => setSptReview({ error, key: sptReviewKey }),
    [sptReviewKey]
  );
  const sptReviewError = !requiresSptReview
    ? null
    : sptReview.key === sptReviewKey
    ? sptReview.error
    : 'Transaction details are loading';
  const sptReviewMessage =
    sptReviewError === 'Transaction details are loading'
      ? t('transactions.detailsLoading')
      : sptReviewError;
  const nativeTotal = useMemo(() => {
    if (!isBitcoinBased || basicTxValues?.token) {
      return undefined;
    }
    try {
      let total = parseUnits(
        String(removeScientificNotation(basicTxValues.amount)),
        8
      );
      if (
        !basicTxValues.isMax &&
        !feeCalculationError &&
        basicTxValues.fee !== undefined
      ) {
        total = total.add(
          parseUnits(String(removeScientificNotation(basicTxValues.fee)), 8)
        );
      }
      const amount = formatUnits(total, 8);
      const [whole, fraction = ''] = amount.split('.');
      return {
        amount,
        formatted: `${whole.replace(
          /\B(?=(\d{3})+(?!\d))/g,
          ','
        )}.${fraction.padEnd(8, '0')}`,
      };
    } catch {
      return {
        amount: basicTxValues?.amount,
        formatted: t('send.calculating'),
      };
    }
  }, [basicTxValues, isBitcoinBased, feeCalculationError, t]);
  const cachedGasData = basicTxValues?.cachedGasData;
  // Initialize fee state after basicTxValues is available
  const [fee, setFee] = useState<IFeeState>({
    gasLimit: basicTxValues?.defaultGasLimit || 42000,
    maxFeePerGas: 0,
    maxPriorityFeePerGas: 0,
    baseFee: 0,
    gasPrice: 0,
  });
  const [quotedEvmFeeMode, setQuotedEvmFeeMode] = useState<boolean>();
  const feeSelectionRef = useRef('');
  feeSelectionRef.current = JSON.stringify({
    customFee,
    fee,
    gasPrice,
    isEIP1559Compatible,
    resolvedToAddress,
  });
  const renderedFeeSelection = feeSelectionRef.current;

  const [refreshingCustomNativeFee, setRefreshingCustomNativeFee] =
    useState(false);
  const refreshCustomNativeFeeApproval = () => {
    setRefreshingCustomNativeFee(true);
    setFeeCalculationError(null);
  };

  // Manual retry function for fee calculation
  const retryFeeCalculation = () => {
    if (isNativeSoftwareSend && customFee.isCustom) {
      refreshCustomNativeFeeApproval();
      return;
    }
    setQuotedEvmFeeMode(undefined);
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
      resolvedToAddress,
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

  // The confirmation screen displays the fee and total as calculated by SendSys.
  // When the user changes fee rate in SendSys and clicks "Next", SendSys recalculates
  // the transaction with the new fee rate and passes the correct values here.

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit && customFee.gasLimit > 0
  );
  const isNativeSoftwareSend =
    !isBitcoinBased &&
    !isSmartAccountSend &&
    !activeAccount?.isLedgerWallet &&
    !activeAccount?.isTrezorWallet &&
    (activeAccountMeta.type === KeyringAccountType.HDAccount ||
      activeAccountMeta.type === KeyringAccountType.Imported) &&
    !location.pathname.startsWith('/external') &&
    state?.external !== true &&
    Boolean(
      basicTxValues &&
        !basicTxValues.token &&
        (!basicTxValues.transactionType ||
          basicTxValues.transactionType === TransactionType.NATIVE_ETH)
    );
  const isFixedNativeSoftwareSend =
    isNativeSoftwareSend && !basicTxValues.isMax;
  const isOrdinaryTokenSend =
    !isBitcoinBased &&
    !isSmartAccountSend &&
    Boolean(basicTxValues?.token) &&
    [
      TransactionType.ERC20,
      TransactionType.ERC721,
      TransactionType.ERC1155,
    ].includes(basicTxValues?.transactionType);
  const exactWalletFeeReview = (() => {
    if (
      (!isNativeSoftwareSend && !isOrdinaryTokenSend) ||
      isEIP1559Compatible === undefined
    )
      return;
    try {
      const gasLimit = BigInt(
        validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
      );
      const fees = isEIP1559Compatible
        ? {
            maxFeePerGas:
              customFee.isCustom && customFee.maxFeePerGas > 0
                ? parseUnits(safeToFixed(customFee.maxFeePerGas), 9).toString()
                : fee.exactEip1559Fee?.maxFeePerGas,
            maxPriorityFeePerGas:
              customFee.isCustom && customFee.maxPriorityFeePerGas >= 0
                ? parseUnits(
                    safeToFixed(customFee.maxPriorityFeePerGas),
                    9
                  ).toString()
                : fee.exactEip1559Fee?.maxPriorityFeePerGas,
          }
        : {
            gasPrice:
              customFee.isCustom && customFee.gasPrice > 0
                ? parseUnits(safeToFixed(customFee.gasPrice), 9).toString()
                : gasPrice,
          };
      const feeCap = fees.gasPrice ?? fees.maxFeePerGas;
      if (
        feeCap === undefined ||
        (isEIP1559Compatible && fees.maxPriorityFeePerGas === undefined)
      )
        return;
      assertSupportedEvmFees(fees, !isEIP1559Compatible);
      const net = isFixedNativeSoftwareSend
        ? parseUnits(String(basicTxValues.amount), 'ether').toBigInt()
        : isNativeSoftwareSend
        ? nativeMaxSendValue(
            activeAccount.balances.ethereum,
            BigNumber.from(gasLimit),
            BigNumber.from(feeCap),
            BigInt(0)
          ).toBigInt()
        : BigInt(0);
      if (isFixedNativeSoftwareSend && net <= BigInt(0)) return;
      const value = net > BigInt(0) ? net : BigInt(0);
      return {
        value,
        gasLimit,
        fees,
        ...getEvmTransferCost(value, gasLimit, BigInt(feeCap)),
      };
    } catch {
      return undefined;
    }
  })();

  const tokenFeeReview = isOrdinaryTokenSend ? exactWalletFeeReview : undefined;

  const smartAccountFeeOverrides = useMemo(() => {
    try {
      if (isEIP1559Compatible === undefined) return undefined;
      if (isEIP1559Compatible === false) {
        const price = customFee.isCustom
          ? parseUnits(safeToFixed(customFee.gasPrice), 9)
          : BigNumber.from(gasPrice);
        if (price.lte(0)) return undefined;
        return { gasPrice: price.toString() };
      }
      const cap = customFee.isCustom
        ? customFee.maxFeePerGas
        : fee.maxFeePerGas;
      const tip = customFee.isCustom
        ? customFee.maxPriorityFeePerGas
        : fee.maxPriorityFeePerGas;
      if (!(cap > 0) || tip === undefined || tip < 0) return undefined;
      const overrides = {
        maxFeePerGas: parseUnits(safeToFixed(cap), 9).toString(),
        maxPriorityFeePerGas: parseUnits(safeToFixed(tip), 9).toString(),
      };
      assertSupportedEvmFees(overrides);
      return overrides;
    } catch {
      return undefined;
    }
  }, [
    customFee,
    fee.maxFeePerGas,
    fee.maxPriorityFeePerGas,
    gasPrice,
    isEIP1559Compatible,
  ]);
  const smartAccountQuoteKey = isSmartAccountSend
    ? JSON.stringify([
        isSmartAccountSend,
        activeAccountMeta.type,
        activeAccountMeta.id,
        activeAccount?.address,
        activeNetwork.chainId,
        activeNetwork.url,
        activeSlip44,
        basicTxValues,
        resolvedToAddress,
        customFee,
        smartAccountFeeOverrides,
      ])
    : '';
  const smartAccountQuoteReady = Boolean(
    smartAccountQuote?.key === smartAccountQuoteKey &&
      smartAccountFeeOverrides &&
      !smartAccountQuoteError &&
      !smartAccountQuoteNeedsRefresh
  );
  const feeEstimateReady =
    isBitcoinBased ||
    (!isCalculatingFees &&
      !feeCalculationError &&
      isEIP1559Compatible !== undefined &&
      (!(isNativeSoftwareSend || isOrdinaryTokenSend) ||
        Boolean(exactWalletFeeReview)) &&
      (isSmartAccountSend
        ? smartAccountQuoteReady
        : quotedEvmFeeMode === isEIP1559Compatible));

  const displayedAmount = useMemo(() => {
    if (isSmartAccountSend && !basicTxValues?.token && basicTxValues?.isMax)
      return smartAccountQuote
        ? formatEther(smartAccountQuote.executions[0].value)
        : t('send.calculating');
    if (basicTxValues?.token || !basicTxValues?.isMax)
      return basicTxValues?.amount;
    try {
      if (!isBitcoinBased) {
        if (!feeEstimateReady) return t('send.calculating');
        if (isNativeSoftwareSend && exactWalletFeeReview)
          return exactWalletFeeReview.value > BigInt(0)
            ? formatEther(exactWalletFeeReview.value.toString()).replace(
                /\.0$/,
                ''
              )
            : t('send.calculating');
        const gasLimit = BigNumber.from(
          validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
        );
        const feeRate = isEIP1559Compatible
          ? parseUnits(
              safeToFixed(
                customFee.isCustom && customFee.maxFeePerGas > 0
                  ? customFee.maxFeePerGas
                  : fee.maxFeePerGas
              ),
              9
            )
          : BigNumber.from(gasPrice);
        if (gasLimit.lte(0) || feeRate.lte(0)) return t('send.calculating');
        // The live selected account supplies the review estimate. Submission
        // uses the same arithmetic after its existing fresh balance read.
        const net = nativeMaxSendValue(
          activeAccount.balances.ethereum,
          gasLimit,
          feeRate,
          NON_SOFTWARE_MAX_SEND_RESERVE_WEI
        );
        return net.gt(0)
          ? formatEther(net).replace(/\.0$/, '')
          : t('send.calculating');
      }
      // UTXO MAX keeps the gross balance in navigation state; the prepared
      // transaction deducts its quoted fee from the recipient output.
      const gross = parseUnits(
        String(removeScientificNotation(basicTxValues.amount)),
        8
      );
      const quotedFee = parseUnits(
        String(removeScientificNotation(basicTxValues.fee)),
        8
      );
      if (gross.lt(0) || quotedFee.lt(0) || quotedFee.gt(gross)) {
        return t('send.calculating');
      }
      return formatSyscoinValue(gross.sub(quotedFee));
    } catch {
      return t('send.calculating');
    }
  }, [
    basicTxValues,
    isBitcoinBased,
    isNativeSoftwareSend,
    exactWalletFeeReview,
    isSmartAccountSend,
    smartAccountQuote,
    t,
    feeEstimateReady,
    validateCustomGasLimit,
    customFee,
    fee,
    isEIP1559Compatible,
    gasPrice,
    activeAccount.balances.ethereum,
  ]);

  const nativeReviewRequest = (() => {
    if (!isNativeSoftwareSend || !feeEstimateReady || !exactWalletFeeReview)
      return null;
    const { value, gasLimit, fees, maximumFee } = exactWalletFeeReview;
    if (value <= BigInt(0)) return null;
    const params = {
      from: basicTxValues.sender,
      to: resolvedToAddress || basicTxValues.receivingAddress,
      data: '0x',
      chainId: activeNetwork.chainId,
      value: value.toString(),
      gasLimit: gasLimit.toString(),
      ...fees,
    };
    return {
      params,
      legacy: isEIP1559Compatible === false,
      maximumFee: maximumFee.toString(),
      scope: state.walletScope,
      key: JSON.stringify([params, state.walletScope, renderedFeeSelection]),
    };
  })();
  const nativeReviewKey = nativeReviewRequest?.key;
  const [nativeFeeApproval, setNativeFeeApproval] = useState<{
    id: string;
    key: string;
  } | null>(null);
  const nativeFeeExpiry = useRef<ReturnType<typeof setTimeout>>();
  const retireNativeFeeApproval = () => {
    if (nativeFeeExpiry.current) clearTimeout(nativeFeeExpiry.current);
    nativeFeeExpiry.current = undefined;
    setNativeFeeApproval(null);
  };
  useEffect(() => {
    setNativeFeeApproval(null);
    if (!nativeReviewRequest) return;
    const request = nativeReviewRequest;
    let cancelled = false;
    let id: string | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const started = performance.now();
    const discard = () => {
      if (id)
        void controllerEmitter(
          ['wallet', 'discardNativeEvmFeeReview'],
          [id]
        ).catch(() => undefined);
    };
    const fresh = refreshingCustomNativeFee && customFee.isCustom;
    const action = fresh ? 'refreshNativeEvmFeeReview' : 'reviewNativeEvmFee';
    void controllerEmitter(
      ['wallet', action],
      [request.params, request.legacy, request.maximumFee, request.scope]
    )
      .then((result: any) => {
        if (
          typeof result?.id !== 'string' ||
          !result.id ||
          result.maximumFee !== request.maximumFee ||
          !Number.isSafeInteger(result.validForMs) ||
          result.validForMs <= 0 ||
          result.validForMs > EVM_FEE_APPROVAL_LIFETIME_MS
        )
          throw new Error('Native fee approval unavailable');
        id = result.id;
        if (cancelled) {
          discard();
          return;
        }
        const remaining = started + result.validForMs - performance.now();
        if (remaining <= 0) throw new Error('Native fee approval expired');
        setNativeFeeApproval({ id: result.id, key: request.key });
        if (fresh) setRefreshingCustomNativeFee(false);
        expiry = setTimeout(() => {
          discard();
          retireNativeFeeApproval();
          setFeeCalculationError(t('send.feeCalculationFailedRetry'));
        }, remaining);
        nativeFeeExpiry.current = expiry;
      })
      .catch((error) => {
        if (!cancelled) {
          discard();
          if (fresh) setRefreshingCustomNativeFee(false);
          setFeeCalculationError(
            isSavedEvmNonceConflict(error)
              ? t('send.savedNonceConflict')
              : t('send.feeCalculationFailedRetry')
          );
        }
      });
    return () => {
      cancelled = true;
      if (expiry) clearTimeout(expiry);
      if (nativeFeeExpiry.current === expiry)
        nativeFeeExpiry.current = undefined;
      discard();
    };
  }, [nativeReviewKey]);
  const confirmationFeeReady =
    feeEstimateReady &&
    (!isNativeSoftwareSend ||
      Boolean(nativeReviewKey && nativeFeeApproval?.key === nativeReviewKey));
  const confirmationFeeReadyRef = useRef(confirmationFeeReady);
  confirmationFeeReadyRef.current = confirmationFeeReady;

  useEffect(() => {
    if (
      !isSmartAccountSend ||
      !basicTxValues ||
      recipientIssue ||
      !smartAccountFeeOverrides ||
      smartAccountQuoteNeedsRefresh ||
      tokenReviewInvalid
    )
      return;
    let cancelled = false;
    const overrides = smartAccountFeeOverrides;
    setSmartAccountQuoteError(undefined);
    const prepare = async () => {
      const target =
        resolvedToAddress || String(basicTxValues.receivingAddress || '');
      if (!target || target.toLowerCase().endsWith('.eth'))
        throw new Error('Unresolved recipient');
      const transactionType =
        basicTxValues.transactionType || TransactionType.NATIVE_ETH;
      let execution = { target, data: '0x', value: '0x0' };
      if (transactionType === TransactionType.NATIVE_ETH) {
        execution.value = parseUnits(
          String(removeScientificNotation(basicTxValues.amount || '0')),
          18
        ).toHexString();
      } else {
        if (
          ![
            TransactionType.ERC20,
            TransactionType.ERC721,
            TransactionType.ERC1155,
          ].includes(transactionType)
        )
          throw new Error('Unsupported smart account transfer');
        execution.target = basicTxValues.token.contractAddress;
        if (transactionType === TransactionType.ERC20) {
          if (!reviewedErc20Units) throw new Error('ERC20 review required');
          execution = {
            ...buildSmartAccountErc20Transfer(
              basicTxValues.token.contractAddress,
              target,
              reviewedErc20Units
            ),
          };
        } else {
          const tokenId = normalizeNftTokenId(basicTxValues.token.tokenId);
          const abi = new Interface(
            transactionType === TransactionType.ERC721
              ? await getErc721Abi()
              : await getErc1155Abi()
          );
          execution.data =
            transactionType === TransactionType.ERC721
              ? abi.encodeFunctionData(
                  'safeTransferFrom(address,address,uint256)',
                  [
                    activeAccount.address,
                    target,
                    toEthersBigNumberish(BigNumber.from(tokenId)),
                  ]
                )
              : abi.encodeFunctionData(
                  'safeTransferFrom(address,address,uint256,uint256,bytes)',
                  [
                    activeAccount.address,
                    target,
                    toEthersBigNumberish(BigNumber.from(tokenId)),
                    toEthersBigNumberish(
                      BigNumber.from(String(basicTxValues.amount))
                    ),
                    '0x',
                  ]
                );
        }
      }
      const assertQuoteCurrent = () => {
        if (cancelled || !submission.isActive())
          throw new Error('Smart account confirmation is no longer active');
      };
      const quoteExecution = (candidate: typeof execution) => {
        assertQuoteCurrent();
        return prepareSmartAccountFeeQuote({
          accountAddress: activeAccount.address,
          accountId: activeAccountMeta.id,
          controllerEmitter,
          executions: [candidate],
          feeOverrides: overrides,
        });
      };
      let quote;
      if (
        transactionType === TransactionType.NATIVE_ETH &&
        basicTxValues.isMax
      ) {
        const maximum = await prepareSmartAccountNativeMaximum({
          target,
          assertCurrent: assertQuoteCurrent,
          async readBalance() {
            const balance = (await controllerEmitter(
              ['wallet', 'refreshActiveAccountBalances'],
              [{ includeAssets: false }]
            )) as { nativeBalance: string };
            return parseUnits(
              String(removeScientificNotation(balance.nativeBalance)),
              18
            ).toString();
          },
          async quote(candidate) {
            const quote = await quoteExecution(candidate);
            return { quote, maximumFeeUnits: quote.maximumFeeWei };
          },
        });
        execution = { ...maximum.execution };
        quote = maximum.quote;
      } else quote = await quoteExecution(execution);
      if (!cancelled && submission.isActive())
        setSmartAccountQuote({
          ...quote,
          executions: [execution],
          feeOverrides: overrides,
          key: smartAccountQuoteKey,
        });
    };
    prepare().catch(() => {
      if (!cancelled && submission.isActive())
        setSmartAccountQuoteError(t('send.unableToCalculateFees'));
    });
    return () => {
      cancelled = true;
    };
  }, [
    smartAccountQuoteKey,
    retryTrigger,
    smartAccountQuoteNeedsRefresh,
    reviewedErc20Units,
  ]);

  const getNativeEvmGasLimit = useCallback(
    async (maxSendFeeRateWei?: BigNumber): Promise<BigNumber> => {
      const fallbackGasLimit = BigNumber.from(
        basicTxValues?.defaultGasLimit || 42000
      );

      if (
        !basicTxValues ||
        isSmartAccountSend ||
        basicTxValues.token ||
        basicTxValues.transactionType !== TransactionType.NATIVE_ETH
      ) {
        return fallbackGasLimit;
      }

      const rawTo = String(basicTxValues.receivingAddress || '');
      const to = resolvedToAddress || rawTo;
      if (!to || to.toLowerCase().endsWith('.eth')) {
        throw new Error('Native transfer recipient is not resolved');
      }

      let value = BigNumber.from(0);
      try {
        value = parseUnits(String(basicTxValues.amount || '0'), 'ether');
      } catch (error) {
        logError('error parsing native EVM amount', 'Transaction', error);
        throw error;
      }

      const getSpendableMaxValue = (gasLimit: BigNumber) => {
        if (!maxSendFeeRateWei || maxSendFeeRateWei.lte(0)) {
          return null;
        }

        const { maximumFee } = getEvmTransferCost(
          BigInt(0),
          gasLimit.toBigInt(),
          maxSendFeeRateWei.toBigInt()
        );

        const reserved =
          maximumFee +
          (isNativeSoftwareSend
            ? BigInt(0)
            : NON_SOFTWARE_MAX_SEND_RESERVE_WEI);
        return value.gt(reserved) ? value.sub(reserved) : null;
      };

      let estimateValue = value;
      if (basicTxValues.isMax && value.gt(0)) {
        estimateValue =
          getSpendableMaxValue(NATIVE_EVM_MAX_SEND_INITIAL_GAS_RESERVE) ||
          BigNumber.from(1);
      }

      const estimateGas = async (estimateWithValue: BigNumber) => {
        const transaction = {
          data: '0x',
          from: basicTxValues.sender,
          to,
          value: estimateWithValue.toHexString(),
        };
        const estimatedGasLimit = (await controllerEmitter(
          ['wallet', 'getFreshNativeEvmGasLimit'],
          [transaction, state?.walletScope]
        )) as any;

        return BigNumber.from(estimatedGasLimit);
      };

      try {
        let estimatedGasLimit = await estimateGas(estimateValue);

        if (basicTxValues.isMax && value.gt(0) && maxSendFeeRateWei) {
          for (let i = 0; i < 2; i += 1) {
            const refinedValue = getSpendableMaxValue(estimatedGasLimit);
            if (!refinedValue || refinedValue.eq(estimateValue)) {
              break;
            }

            estimateValue = refinedValue;
            const refinedGasLimit = await estimateGas(estimateValue);
            if (refinedGasLimit.eq(estimatedGasLimit)) {
              break;
            }
            estimatedGasLimit = refinedGasLimit;
          }
        }

        return estimatedGasLimit;
      } catch (error) {
        logError('error estimating native EVM gas limit', 'Transaction', error);
        throw error;
      }
    },
    [
      basicTxValues,
      controllerEmitter,
      resolvedToAddress,
      isSmartAccountSend,
      isNativeSoftwareSend,
      state?.walletScope,
    ]
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
      if (!isFiatAvailable || currentFee === undefined || currentFee === null)
        return null;

      const feeAmount =
        typeof currentFee === 'string' ? parseFloat(currentFee) : currentFee;
      if (isNaN(feeAmount) || feeAmount <= 0) return null;

      return getFiatAmount(feeAmount, 6, String(fiat.asset).toUpperCase());
    } catch (error) {
      return null;
    }
  };

  const getTotalFiatAmount = (totalAmount: number | string) => {
    if (!isFiatAvailable) return null;
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

    // Always use a valid gas limit - custom, estimated native send, or fallback.
    const gasLimit = validateCustomGasLimit
      ? customFee.gasLimit
      : (
          await getNativeEvmGasLimit(BigNumber.from(correctGasPrice))
        ).toNumber();

    const initialFee = { ...INITIAL_FEE, gasLimit };

    initialFee.gasPrice = parseFloat(formatGweiValue(correctGasPrice)); // Convert wei back to Gwei for display using safe conversion

    // Use startTransition for non-critical fee updates
    startTransition(() => {
      setFee(initialFee);
      setGasPrice(correctGasPrice);
      setQuotedEvmFeeMode(false);
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

  const handleTokenSendError = (error: any, label: string) => {
    if (
      isOrdinaryTokenSend &&
      !activeAccount?.isLedgerWallet &&
      !activeAccount?.isTrezorWallet &&
      (activeAccountMeta.type === KeyringAccountType.HDAccount ||
        activeAccountMeta.type === KeyringAccountType.Imported) &&
      !location.pathname.startsWith('/external') &&
      state?.external !== true &&
      error?.code === EVM_SIGNED_STORAGE_FULL &&
      error?.transactionNotBroadcast === true
    ) {
      if (submission.isActive()) setCapacityNotice(capacityNoticeScope);
      setLoading(false);
      return true;
    }
    const handled = handleTransactionError(
      error,
      alert,
      t,
      activeAccount,
      activeNetwork,
      basicTxValues
    );
    if (!handled) {
      logError(label, 'Transaction', error);
      alert.error(t('send.cantCompleteTxs'));
    }
    setLoading(false);
    return handled;
  };

  const performConfirm = async (approvedFeeSelection: string) => {
    if (
      !isBitcoinBased &&
      (!confirmationFeeReadyRef.current ||
        feeSelectionRef.current !== approvedFeeSelection)
    )
      return;
    const approvedNativeFeeId =
      nativeFeeApproval && nativeFeeApproval.key === nativeReviewKey
        ? nativeFeeApproval.id
        : undefined;
    if (isNativeSoftwareSend && !approvedNativeFeeId) return;
    if (tokenReviewInvalid) return;
    if (isSmartAccountSend && !smartAccountQuoteReady) return;
    if (sptReviewError) {
      alert.error(sptReviewMessage);
      return;
    }
    const submitEmitter = submission.controllerEmitter;
    // The reviewed software envelope is already fixed. Capture the other MAX
    // amount before the foreground refresh used by that submission path.
    const nativeMax =
      !isNativeSoftwareSend &&
      !isBitcoinBased &&
      !isSmartAccountSend &&
      !basicTxValues?.token &&
      basicTxValues?.isMax &&
      (!basicTxValues?.transactionType ||
        basicTxValues.transactionType === TransactionType.NATIVE_ETH);
    let approvedNativeMax: BigNumber | undefined;
    if (nativeMax) {
      if (renderedFeeSelection !== approvedFeeSelection) return;
      try {
        approvedNativeMax = parseUnits(String(displayedAmount), 'ether');
        if (approvedNativeMax.lte(0)) throw new Error('Invalid MAX review');
      } catch {
        alert.error(t('send.maxBalanceReviewRequired'));
        return;
      }
    }
    const assertSmartAccountConfirmationCurrent = () => {
      if (
        !submission.isActive() ||
        feeSelectionRef.current !== approvedFeeSelection
      )
        throw Object.assign(
          new Error('Smart account confirmation context or fee changed.'),
          { transactionNotBroadcast: true }
        );
    };
    if (recipientIssue) {
      alert.error(t(recipientIssue));
      return;
    }
    if (recipientPoisoningCollision) {
      alert.error(
        t('send.addressPoisoningBlocked', {
          address: recipientPoisoningCollision.trustedAddress,
        })
      );
      return;
    }

    let balance: string | number = isBitcoinBased
      ? activeAccount.balances[INetworkType.Syscoin]
      : activeAccount.balances[INetworkType.Ethereum];

    // The software submission owns a fresh pending balance check and must use
    // the review ID and amount displayed at the click, without rewriting Redux.
    if (!isNativeSoftwareSend) {
      try {
        const refreshedBalance = (await submitEmitter(
          ['wallet', 'refreshActiveAccountBalances'],
          [{ includeAssets: false }]
        )) as { nativeBalance: string };
        balance = refreshedBalance.nativeBalance || '0';
      } catch (error) {
        console.error('Failed to refresh balance before confirming:', error);
        if (nativeMax) {
          if (submission.isActive())
            alert.error(t('send.maxBalanceReviewRequired'));
          return;
        }
      }
    }
    if (nativeMax || isNativeSoftwareSend || isOrdinaryTokenSend) {
      if (!submission.isActive()) return;
      if (feeSelectionRef.current !== approvedFeeSelection) return;
    }

    if (activeAccount && (isNativeSoftwareSend || Number(balance) >= 0)) {
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

      const submitSmartAccountExecution = async (
        target: string,
        value: string,
        data: string,
        feeOverrides: SmartAccountFeeOverrides = smartAccountFeeOverrides
      ) => {
        let publicationRequested = false;
        try {
          assertSmartAccountConfirmationCurrent();
          if (
            !smartAccountQuoteReady ||
            !smartAccountQuote ||
            smartAccountQuote.executions.length !== 1 ||
            target.toLowerCase() !==
              smartAccountQuote.executions[0].target.toLowerCase() ||
            data.toLowerCase() !==
              smartAccountQuote.executions[0].data.toLowerCase() ||
            !BigNumber.from(value).eq(smartAccountQuote.executions[0].value) ||
            JSON.stringify(feeOverrides) !==
              JSON.stringify(smartAccountQuote.feeOverrides)
          )
            throw Object.assign(new Error('Smart account fee quote changed.'), {
              transactionNotBroadcast: true,
            });
          await signAndSubmitSmartAccountExecutions({
            accountAddress: activeAccount.address,
            accountId: activeAccount.id,
            authenticatorContexts: getSmartAccountLocalOwnerContexts({
              accounts,
              controllerEmitter: submitEmitter,
            }),
            controllerEmitter: submitEmitter,
            executions: [{ target, value, data }],
            feeOverrides,
            maximumUserOpFeeWei: smartAccountQuote.maximumFeeWei,
            onPrepared: assertSmartAccountConfirmationCurrent,
            onBeforeSubmit: async () => {
              assertSmartAccountConfirmationCurrent();
              publicationRequested = true;
              await submission.beforeBroadcast();
            },
            onAuthenticatorSigningResolved: (authenticator) => {
              if (authenticator === 'slh-dsa') {
                setIsPqSigning(false);
              }
            },
            onAuthenticatorSigningStarted: (authenticator) => {
              if (authenticator === 'slh-dsa') {
                setIsPqSigning(true);
              }
            },
            smartAccount: activeAccount.smartAccount,
          });
        } catch (error) {
          // A same-text error after the publication boundary is not evidence
          // that refreshing/re-signing is safe, regardless of its marker.
          if (
            publicationRequested &&
            error?.message === 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED'
          )
            error = Object.assign(new Error(error.message), error, {
              transactionNotBroadcast: false,
            });
          submission.recordError(error);
          if (
            error?.message === 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED' &&
            error?.transactionNotBroadcast === true &&
            !publicationRequested
          ) {
            setSmartAccountQuoteNeedsRefresh(true);
            alert.error(t('send.smartAccountFeeQuoteChanged'));
          }
          throw error;
        } finally {
          setIsPqSigning(false);
        }
      };

      const assertPasskeyTokenRecipientAllowed = async () => {
        const blacklistResult = (await submitEmitter(
          ['wallet', 'checkAddressBlacklist'],
          [destinationTo]
        )) as {
          isBlacklisted: boolean;
          reason?: string;
          severity?: string;
        };

        if (
          blacklistResult.isBlacklisted &&
          (blacklistResult.severity === 'critical' ||
            blacklistResult.severity === 'high')
        ) {
          throw Object.assign(
            new Error(
              `Token transfer blocked: ${
                blacklistResult.reason || 'The recipient address is blacklisted'
              }. Severity: ${
                blacklistResult.severity
              }. Please verify the token recipient address before proceeding.`
            ),
            {
              code: 'PALI_TOKEN_RECIPIENT_BLOCKED',
              recipientBlockReason: blacklistResult.reason,
              recipientBlockSeverity: blacklistResult.severity,
            }
          );
        }
      };

      switch (transactionType) {
        // SYSCOIN/UTXO TRANSACTIONS
        case TransactionType.UTXO:
          try {
            // Use atomic wrapper for all wallets
            await submitEmitter(
              ['wallet', 'signSendAndSaveTransaction'],
              [
                {
                  psbt: basicTxValues.psbt,
                  utxoFeeReview: basicTxValues.utxoFeeReview,
                  ordinaryWalletSend:
                    location.pathname === '/send/confirm' &&
                    location.state?.external !== true,
                  isTrezor: activeAccount.isTrezorWallet,
                  isLedger: activeAccount.isLedgerWallet,
                },
              ],
              activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
                ? 300000 // 5 minutes timeout for hardware wallet operations
                : SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS
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
          if (activeAccount.isSmartAccount && activeAccount.smartAccount) {
            try {
              const amount = smartAccountQuote.executions[0].value;
              await submitSmartAccountExecution(
                destinationTo,
                amount,
                '0x',
                smartAccountQuote.feeOverrides
              );

              setConfirmed(true);
              setLoading(false);
            } catch (error: any) {
              const wasHandledSpecifically = handleTransactionError(
                error,
                alert,
                t,
                activeAccount,
                activeNetwork,
                basicTxValues
              );

              if (!wasHandledSpecifically) {
                logError('error', 'Transaction', error);
                alert.error(t('send.cantCompleteTxs'));
              }
              setLoading(false);
            }
            return;
          }

          const restTx = omitTransactionObjectData(txObjectState, [
            'chainId',
            'maxFeePerGas',
            'maxPriorityFeePerGas',
          ]) as ITxState;

          let value = parseUnits(String(basicTxValues.amount), 'ether');
          // For MAX sends we must use the same minimum, otherwise MAX value deduction
          // can overshoot once the tx is bumped at send time.
          let maxSendGasLimit: BigNumber | null = null;
          try {
            // For MAX sends, use the actual balance instead of parsed amount to avoid rounding errors
            // The amount from basicTxValues might be rounded for display, causing precision issues
            if (nativeMax) {
              // Use the already-fetched EVM balance (ETH units)
              const gasLimitCandidate = BigNumber.from(
                validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
              );
              maxSendGasLimit = gasLimitCandidate;

              const feeRate = isEIP1559Compatible
                ? parseUnits(
                    Boolean(customFee.isCustom && customFee.maxFeePerGas > 0)
                      ? safeToFixed(customFee.maxFeePerGas)
                      : safeToFixed(fee.maxFeePerGas),
                    9
                  )
                : BigNumber.from(gasPrice);
              // The refreshed balance is an affordability check, not a new
              // authorization to change the recipient's reviewed amount.
              const affordableMax = nativeMaxSendValue(
                balance,
                maxSendGasLimit,
                feeRate,
                NON_SOFTWARE_MAX_SEND_RESERVE_WEI
              );
              if (
                !submission.isActive() ||
                feeSelectionRef.current !== approvedFeeSelection
              ) {
                setLoading(false);
                return;
              }
              if (!approvedNativeMax || affordableMax.lt(approvedNativeMax)) {
                alert.error(t('send.maxBalanceReviewRequired'));
                setLoading(false);
                return;
              }
              value = approvedNativeMax;
            }

            if (isNativeSoftwareSend) {
              if (!nativeReviewRequest) {
                setLoading(false);
                return;
              }
              retireNativeFeeApproval();
              await submitEmitter(
                ['wallet', 'sendAndSaveEthTransaction'],
                [
                  { ...restTx, ...nativeReviewRequest.params },
                  nativeReviewRequest.legacy,
                  undefined,
                  undefined,
                  {
                    nativeReview: {
                      id: approvedNativeFeeId!,
                      scope: nativeReviewRequest.scope,
                    },
                  },
                ],
                10000
              );
              setConfirmed(true);
              setLoading(false);
              return;
            }

            const isLegacy = isEIP1559Compatible === false;
            const gasLimit =
              maxSendGasLimit ||
              BigNumber.from(
                validateCustomGasLimit
                  ? customFee.gasLimit
                  : fee.gasLimit || basicTxValues.defaultGasLimit || 42000
              );
            const rate = isLegacy
              ? BigNumber.from(gasPrice)
              : parseUnits(
                  safeToFixed(
                    customFee.isCustom && customFee.maxFeePerGas > 0
                      ? customFee.maxFeePerGas
                      : fee.maxFeePerGas
                  ),
                  9
                );
            const fees = isLegacy
              ? { gasPrice: rate.toHexString() }
              : {
                  maxFeePerGas: rate,
                  maxPriorityFeePerGas: parseUnits(
                    safeToFixed(
                      customFee.isCustom && customFee.maxPriorityFeePerGas >= 0
                        ? customFee.maxPriorityFeePerGas
                        : fee.maxPriorityFeePerGas
                    ),
                    9
                  ),
                };
            const hardware =
              activeAccountMeta.type === KeyringAccountType.Ledger ||
              activeAccountMeta.type === KeyringAccountType.Trezor;
            await submitEmitter(
              ['wallet', 'sendAndSaveEthTransaction'],
              [
                {
                  ...restTx,
                  from: basicTxValues.sender,
                  to: destinationTo,
                  data: '0x',
                  chainId: activeNetwork.chainId,
                  value: value.toHexString(),
                  gasLimit: isLegacy ? gasLimit.toHexString() : gasLimit,
                  ...fees,
                },
                isLegacy,
                undefined,
                undefined,
                hardware
                  ? { hardwareScope: state.walletScope }
                  : {
                      nativeReview: {
                        id: approvedNativeFeeId!,
                        scope: state.walletScope,
                      },
                    },
              ],
              hardware ? 300000 : 10000
            );

            setConfirmed(true);
            setLoading(false);

            return;
          } catch (error: any) {
            if (isNativeSoftwareSend) {
              retireNativeFeeApproval();
              if (
                error?.transactionNotBroadcast === true &&
                error?.code === EVM_SIGNED_STORAGE_FULL
              ) {
                if (submission.isActive())
                  setCapacityNotice(capacityNoticeScope);
                setLoading(false);
                return;
              }
              if (error?.transactionNotBroadcast === true)
                setFeeCalculationError(
                  isSavedEvmNonceConflict(error)
                    ? t('send.savedNonceConflict')
                    : t('send.feeCalculationFailedRetry')
                );
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
          if (activeAccount.isSmartAccount && activeAccount.smartAccount) {
            try {
              await assertPasskeyTokenRecipientAllowed();
              const data = smartAccountQuote.executions[0].data;
              await submitSmartAccountExecution(
                basicTxValues.token.contractAddress,
                '0x0',
                data
              );

              setConfirmed(true);
              setLoading(false);
            } catch (error: any) {
              const wasHandledSpecifically = handleTransactionError(
                error,
                alert,
                t,
                activeAccount,
                activeNetwork,
                basicTxValues
              );

              if (!wasHandledSpecifically) {
                logError('error send passkey token', 'Transaction', error);
                alert.error(t('send.cantCompleteTxs'));
              }

              setLoading(false);
            }
            return;
          }

          //HANDLE DIFFERENT TOKEN TRANSACTION TYPES
          switch (transactionType) {
            case TransactionType.ERC20:
            case TransactionType.ERC721:
            case TransactionType.ERC1155:
              try {
                if (!tokenFeeReview)
                  throw new Error('Token fee review required');
                const common = {
                  networkUrl: activeNetwork.url,
                  receiver: destinationTo,
                  tokenAddress: basicTxValues.token.contractAddress,
                  gasLimit: tokenFeeReview.gasLimit.toString(),
                  ...(isEIP1559Compatible
                    ? {
                        isLegacy: false as const,
                        maxFeePerGas: tokenFeeReview.fees.maxFeePerGas!,
                        maxPriorityFeePerGas:
                          tokenFeeReview.fees.maxPriorityFeePerGas!,
                      }
                    : {
                        isLegacy: true as const,
                        gasPrice: tokenFeeReview.fees.gasPrice!,
                      }),
                };
                let payload: WalletTokenReviewPayload;
                if (transactionType === TransactionType.ERC20) {
                  if (!reviewedErc20Units)
                    throw new Error('ERC20 review required');
                  payload = {
                    type: 'ERC20',
                    transaction: {
                      ...common,
                      tokenAmountUnits: reviewedErc20Units,
                    },
                  };
                } else {
                  let tokenId: string;
                  try {
                    tokenId = normalizeNftTokenId(basicTxValues.token.tokenId);
                  } catch {
                    alert.error(t('send.invalidTokenId'));
                    setLoading(false);
                    return;
                  }
                  if (transactionType === TransactionType.ERC721) {
                    payload = {
                      type: 'ERC721',
                      transaction: { ...common, tokenId },
                    };
                  } else {
                    const { amount } = basicTxValues;
                    const quantity = String(amount);
                    if (
                      (typeof amount !== 'string' &&
                        !Number.isSafeInteger(amount)) ||
                      !/^\d{1,256}$/.test(quantity)
                    )
                      throw new Error('Invalid ERC1155 amount');
                    const tokenAmount = parseErc20Units(
                      normalizeNftTokenId(quantity)
                    );
                    if (tokenAmount === '0')
                      throw new Error('Invalid ERC1155 amount');
                    payload = {
                      type: 'ERC1155',
                      transaction: { ...common, tokenId, tokenAmount },
                    };
                  }
                }
                const review = openWalletTokenReview({
                  chainId: activeNetwork.chainId,
                  walletScope: state.walletScope,
                  ...payload,
                });
                tokenReviewPort.current = review;
                try {
                  await review.ready;
                  if (
                    !submission.isActive() ||
                    !confirmationFeeReadyRef.current ||
                    feeSelectionRef.current !== approvedFeeSelection
                  )
                    throw Object.assign(new Error('Token review changed'), {
                      transactionNotBroadcast: true,
                    });
                  const hardware =
                    activeAccount.isTrezorWallet ||
                    activeAccount.isLedgerWallet;
                  await submission.submit(
                    () => review.submit(hardware ? 300000 : 10000),
                    hardware ? review.isOpen : undefined
                  );
                } finally {
                  if (tokenReviewPort.current === review)
                    tokenReviewPort.current = undefined;
                  review.close();
                }
                setConfirmed(true);
                setLoading(false);
              } catch (error: any) {
                if (
                  handleTokenSendError(error, `error send ${transactionType}`)
                )
                  return;
              }
              break;
          }

          break;
      }
    } else {
      alert.error(t('send.enoughFunds'));
    }
  };

  const handleConfirm = () => {
    if (tokenReviewInvalid) return;
    if (sptReviewError) {
      alert.error(sptReviewMessage);
      return;
    }
    if (recipientIssue) {
      alert.error(t(recipientIssue));
      return;
    }
    // A queued handler must retain the quote it rendered, including readiness
    // before the initial debounce or after a newer fee selection replaces it.
    if (
      !confirmationFeeReady ||
      !confirmationFeeReadyRef.current ||
      (!isBitcoinBased && renderedFeeSelection !== feeSelectionRef.current)
    )
      return;
    setCapacityNotice(null);
    return submission
      .run(() => performConfirm(renderedFeeSelection))
      .catch((error) => {
        if (!submission.isActive()) return;
        logError('error', 'Transaction', error);
        alert.error(t('send.cantCompleteTxs'));
      });
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
    if (
      !basicTxValues ||
      isBitcoinBased ||
      recipientIssue ||
      isEIP1559Compatible === undefined
    )
      return;

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
      resolvedToAddress,
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
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } = cachedGasData;

        // Convert hex strings back to BigNumbers (they were serialized for navigation)
        assertSupportedEvmFees({ maxFeePerGas, maxPriorityFeePerGas });
        if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined)
          throw new Error('Incomplete cached EIP-1559 fee data');
        const maxFeeBN = BigNumber.from(maxFeePerGas);
        const maxPriorityBN = BigNumber.from(maxPriorityFeePerGas);

        // A zero priority is a valid type-2 fee, not a cache miss or legacy signal.
        if (!maxFeeBN.isZero()) {
          const setCachedGasFeeDetails = async () => {
            setIsCalculatingFees(true);
            setFeeCalculationError(null);
            const gasLimit = (await getNativeEvmGasLimit(maxFeeBN)).toNumber();
            const initialFeeDetails = {
              maxFeePerGas: parseFloat(formatGweiValue(maxFeeBN)),
              baseFee: parseFloat(formatGweiValue(maxFeeBN.sub(maxPriorityBN))),
              maxPriorityFeePerGas: parseFloat(formatGweiValue(maxPriorityBN)),
              gasLimit,
              exactEip1559Fee: {
                maxFeePerGas: maxFeeBN.toString(),
                maxPriorityFeePerGas: maxPriorityBN.toString(),
              },
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
            setQuotedEvmFeeMode(true);

            // Cache the result
            setFeeCalculationCache(
              (prev) => new Map(prev.set(cacheKey, initialFeeDetails))
            );
          };

          setCachedGasFeeDetails()
            .catch((error) => {
              logError(
                'error applying cached native EVM fee data',
                'Transaction',
                error
              );
              setFeeCalculationError(t('send.feeCalculationFailedRetry'));
            })
            .finally(() => {
              setIsCalculatingFees(false);
            });
          return; // Skip fee-rate recalculation
        }
      } catch (error) {
        logError(
          'error reading cached native EVM fee data',
          'Transaction',
          error
        );
      }
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

        // Missing/invalid data must not become a zero/default quote. A genuine
        // zero tip remains usable with a positive cap from the qualified SDK.
        if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined)
          throw new Error('Incomplete EIP-1559 fee data');
        assertSupportedEvmFees({ maxFeePerGas, maxPriorityFeePerGas });
        const maxFeeBN = BigNumber.from(maxFeePerGas);
        const maxPriorityBN = BigNumber.from(maxPriorityFeePerGas);

        const gasLimit = validateCustomGasLimit
          ? customFee.gasLimit
          : (await getNativeEvmGasLimit(maxFeeBN)).toNumber();

        const initialFeeDetails = {
          maxFeePerGas: parseFloat(formatGweiValue(maxFeeBN)),
          baseFee: parseFloat(formatGweiValue(maxFeeBN.sub(maxPriorityBN))),
          maxPriorityFeePerGas: parseFloat(formatGweiValue(maxPriorityBN)),
          gasLimit,
          exactEip1559Fee: {
            maxFeePerGas: maxFeeBN.toString(),
            maxPriorityFeePerGas: maxPriorityBN.toString(),
          },
        };

        const formattedTxObject = {
          from: basicTxValues.sender,
          to: basicTxValues.receivingAddress,
          chainId: activeNetwork.chainId,
          maxFeePerGas: maxFeeBN,
          maxPriorityFeePerGas: maxPriorityBN,
        };

        setTxObjectState(formattedTxObject);

        const finalFeeDetails = {
          ...initialFeeDetails,
          gasLimit,
        };

        setFee(finalFeeDetails as any);
        setQuotedEvmFeeMode(true);

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
          setFeeCalculationError(t('send.feeNetworkBusyRetry'));
        } else {
          setFeeCalculationError(t('send.feeCalculationFailedRetry'));
        }
      } finally {
        setIsCalculatingFees(false);
      }
    }, 500); // 500ms debounce

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    basicTxValues?.sender,
    basicTxValues?.receivingAddress,
    basicTxValues?.amount,
    isBitcoinBased,
    isEIP1559Compatible,
    activeNetwork.chainId,
    recipientIssue,
    resolvedToAddress,
    customFee.isCustom,
    customFee.gasLimit,
    validateCustomGasLimit,
    getNativeEvmGasLimit,
    isCalculatingFees,
    cachedGasData,
    feeCalculationError, // Added feeCalculationError to dependencies
    retryTrigger, // Added retryTrigger to dependencies
  ]);

  const getCalculatedFee = useMemo(() => {
    if (isBitcoinBased) return 0;
    if (isNativeSoftwareSend || isOrdinaryTokenSend) {
      const canShowFee =
        isNativeSoftwareSend && basicTxValues.isMax
          ? feeEstimateReady
          : confirmationFeeReady;
      return canShowFee && exactWalletFeeReview
        ? formatEther(exactWalletFeeReview.maximumFee.toString())
        : undefined;
    }
    if (isSmartAccountSend)
      return smartAccountQuoteReady
        ? formatEther(smartAccountQuote.maximumFeeWei)
        : undefined;

    // Use custom gas limit, or fee.gasLimit, or default from transaction type
    const gasLimit = Number(
      validateCustomGasLimit
        ? customFee.gasLimit
        : fee?.gasLimit || basicTxValues.defaultGasLimit || 0
    );

    // If values aren't ready yet, indicate pending by returning undefined
    if (!gasLimit) return undefined as unknown as number;

    // Handle legacy transactions (non-EIP1559)
    if (isEIP1559Compatible === false) {
      const gasPriceValue = Number(
        customFee.isCustom && customFee.gasPrice > 0
          ? customFee.gasPrice
          : parseFloat(formatGweiValue(gasPrice))
      );

      if (isNaN(gasPriceValue) || isNaN(gasLimit))
        return undefined as unknown as number;

      // Use BigNumber to prevent overflow for large gas prices
      const gasLimitBN = BigNumber.from(gasLimit);
      // Limit to 9 decimal places to avoid parseUnits error
      const gasPriceStr = gasPriceValue.toFixed(9);
      const gasPriceWeiBN = parseUnits(gasPriceStr, 'gwei');
      const totalFeeWeiBN = gasLimitBN.mul(gasPriceWeiBN);
      return Number(formatEther(totalFeeWeiBN));
    }

    // Handle EIP-1559 transactions
    if (!fee?.maxFeePerGas) return undefined as unknown as number;

    const feePerGas = Number(
      customFee.isCustom ? customFee.maxFeePerGas : fee?.maxFeePerGas
    );

    // Ensure we don't return NaN
    if (isNaN(feePerGas) || isNaN(gasLimit))
      return undefined as unknown as number;

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
    isNativeSoftwareSend,
    isOrdinaryTokenSend,
    exactWalletFeeReview,
    feeEstimateReady,
    confirmationFeeReady,
    isEIP1559Compatible,
    gasPrice,
    validateCustomGasLimit,
    isSmartAccountSend,
    smartAccountQuote,
    smartAccountQuoteReady,
  ]);

  useEffect(() => {
    if (!copied) return;
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

  // Navigate home with success feedback when the transaction is submitted
  useEffect(() => {
    if (confirmed && submission.isActive()) {
      alert.success(t('send.txSuccessfullMessage'));
      navigate('/home');
    }
  }, [confirmed, alert, t, navigate, submission.isActive]);

  // A Confirm page without transaction data is unusable (e.g. stale
  // restored route): redirect home instead of rendering a blank screen
  useEffect(() => {
    if (!submission.hasUsableEntry && !confirmed && submission.ownsRoute()) {
      navigateBack(navigate, {
        state: { returnContext: submission.returnContext },
      });
    }
  }, [
    submission.hasUsableEntry,
    submission.ownsRoute,
    submission.returnContext,
    confirmed,
    navigate,
  ]);

  const cancelConfirmation = () => {
    if (!submission.ownsRoute()) return;
    navigateBack(navigate, {
      state: { returnContext: submission.returnContext },
    });
  };

  // Don't render main content if transaction is confirmed (toast will show)
  // The overlay handles loading display, so we just check for confirmed state
  const shouldShowMainContent = !confirmed;

  const renderFeeAmount = (feeAmount: number | string | undefined) => {
    const formattedFee = getFormattedFee(feeAmount);
    const fiatAmount = getFeeFiatAmount(feeAmount);
    return (
      <div className="flex flex-col">
        <span>{formattedFee}</span>
        {fiatAmount && (
          <span className="text-brand-gray200 text-xs">≈ {fiatAmount}</span>
        )}
      </div>
    );
  };

  const formatNativeTotal = (feeAmount: any) => {
    const total = basicTxValues.isMax
      ? currency(basicTxValues.amount, { precision: 8 })
      : currency(feeAmount, { precision: 8 }).add(basicTxValues.amount);
    return {
      totalAmount: basicTxValues.isMax ? basicTxValues.amount : total.value,
      totalCrypto: total.format({ symbol: '' }),
    };
  };

  const renderContractIdentifier = (value: string, label: string) => (
    <div className="flex items-center gap-2">
      <span className="text-white text-sm font-mono">
        <Tooltip content={value}>{label}</Tooltip>
      </span>
      <button
        type="button"
        aria-label={t('buttons.copy')}
        onClick={() => copy(value)}
        className="text-brand-gray200 hover:text-white transition-colors"
      >
        <Icon
          name="Copy"
          isSvg
          className="w-4 h-4 text-brand-gray200 hover:text-white"
        />
      </button>
    </div>
  );

  const renderTokenHeading = (name: string, standard: string) => (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h3 className="text-white font-medium text-base">{name}</h3>
        <span
          className={`text-xs px-2 py-1 rounded-full ${getTokenTypeBadgeColor(
            standard
          )}`}
        >
          {standard}
        </span>
      </div>
    </div>
  );

  const renderAddress = (
    label: string,
    address: string,
    display: React.ReactNode,
    publishable = true
  ) => (
    <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
      {t(label)}
      <span className="text-white text-xs">
        {publishable ? (
          <Tooltip content={address} childrenClassName="flex">
            {display}
            <IconButton
              aria-label={t('buttons.copy')}
              onClick={() => copy(address ?? '')}
            >
              <Icon
                wrapperClassname="flex items-center justify-center"
                name="Copy"
                isSvg
                className="px-1 text-brand-white hover:text-fields-input-borderfocus"
              />
            </IconButton>
          </Tooltip>
        ) : (
          t('receive.addressUnavailable')
        )}
      </span>
    </div>
  );

  const renderFeeError = () => (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 px-2 py-1 bg-warning-error bg-opacity-10 rounded">
        <Icon name="warning" className="w-3 h-3 text-warning-error" />
        <span className="text-warning-error text-xs">
          {feeCalculationError === t('send.savedNonceConflict')
            ? feeCalculationError
            : t('send.unableToLoad')}
        </span>
      </div>
      <Tooltip content={feeCalculationError}>
        <IconButton
          aria-label={t('receive.retry')}
          onClick={retryFeeCalculation}
          className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center p-1 hover:bg-brand-blue600 rounded-full transition-all duration-200"
        >
          <Icon
            name="reload"
            className="w-3.5 h-3.5 text-brand-gray200 hover:text-white cursor-pointer transition-colors"
          />
        </IconButton>
      </Tooltip>
    </div>
  );

  return (
    <>
      <EditPriorityModal
        showModal={isOpenEditFeeModal}
        setIsOpen={setIsOpenEditFeeModal}
        customFee={customFee}
        setCustomFee={(next) => {
          setCustomFee(next);
          if (isNativeSoftwareSend && customFee.isCustom && feeCalculationError)
            refreshCustomNativeFeeApproval();
        }}
        setHaveError={() => {
          // No-op function since haveError is not used
        }}
        fee={fee}
        estimatedFeeFloor={fee}
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
                {renderTokenHeading(
                  basicTxValues.token.name ||
                    basicTxValues.token.symbol ||
                    'NFT',
                  basicTxValues.token.tokenStandard
                )}

                {/* Contract Address */}
                <div className="mb-3">
                  <p className="text-brand-gray200 text-xs mb-1">
                    {t('settings.contractAddress')}
                  </p>
                  {renderContractIdentifier(
                    basicTxValues.token.contractAddress,
                    ellipsis(basicTxValues.token.contractAddress, 8, 6)
                  )}
                </div>

                {/* Token Details */}
                <div className="space-y-2">
                  {/* Token ID */}
                  <div className="bg-bkg-3 rounded-lg px-3 py-2">
                    <p className="text-brand-gray200 text-xs mb-1">
                      {t('send.tokenId')}
                    </p>
                    <div className="text-white font-medium break-all">
                      {basicTxValues.token.tokenId ? (
                        basicTxValues.token.tokenId.length > 20 ? (
                          <Tooltip
                            content={basicTxValues.token.tokenId}
                            focusable
                          >
                            #{ellipsis(basicTxValues.token.tokenId, 8, 8)}
                          </Tooltip>
                        ) : (
                          `#${basicTxValues.token.tokenId}`
                        )
                      ) : (
                        <span className="text-warning-error">
                          {t('send.missingTokenId')}
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
                      <p className="text-white font-medium text-lg break-all">
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
                  <p className="text-white text-2xl font-semibold mb-2 break-all">
                    {displayedAmount}{' '}
                    {basicTxValues.token
                      ? basicTxValues.token.symbol
                      : activeNetwork.currency.toUpperCase()}
                  </p>
                </div>

                {/* Token Details (if ERC20 or SPT) */}
                {basicTxValues.token && !basicTxValues.token.isNft && (
                  <>
                    {/* Token Name and Type */}
                    {renderTokenHeading(
                      basicTxValues.token.name || basicTxValues.token.symbol,
                      isBitcoinBased ? 'SPT' : 'ERC-20'
                    )}

                    {/* Contract Address or Asset GUID */}
                    <div className="bg-bkg-3 rounded-lg px-3 py-2">
                      <p className="text-brand-gray200 text-xs mb-1">
                        {isBitcoinBased
                          ? t('send.assetGuid')
                          : t('settings.contractAddress')}
                      </p>
                      {renderContractIdentifier(
                        isBitcoinBased
                          ? basicTxValues.token.guid ||
                              basicTxValues.token.assetGuid
                          : basicTxValues.token.contractAddress,
                        isBitcoinBased
                          ? basicTxValues.token.guid ||
                              basicTxValues.token.assetGuid ||
                              t('send.notAvailable')
                          : ellipsis(basicTxValues.token.contractAddress, 8, 6)
                      )}
                    </div>

                    {/* Decimals */}
                    <div className="bg-bkg-3 rounded-lg px-3 py-2 mt-2">
                      <p className="text-brand-gray200 text-xs mb-1">
                        {t('settings.decimals')}
                      </p>
                      <div className="text-white text-sm font-mono">
                        {basicTxValues.token.decimals ?? t('send.notAvailable')}
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
            {renderAddress(
              'send.from',
              basicTxValues.sender,
              ellipsis(basicTxValues.sender, 7, 15),
              canPublishAccountAddress(
                activeAccount,
                activeAccountMeta.type,
                activeNetwork.chainId
              )
            )}
            {transactionReviewDivider}
            {renderAddress(
              'send.to',
              tooltipToAddress,
              <>{ellipsis(labelToDisplay, 7, 15)} </>
            )}
            {recipientIssue && (
              <p
                role="alert"
                className="w-full mt-3 p-3 rounded-lg border border-warning-error text-warning-error text-xs"
              >
                {t(recipientIssue)}
              </p>
            )}
            {recipientPoisoningCollision && (
              <div className="w-full mt-3 p-3 rounded-lg border border-warning-error bg-warning-error bg-opacity-10">
                <div className="flex items-start gap-2">
                  <Icon
                    name="warning"
                    className="w-4 h-4 mt-0.5 text-warning-error shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-warning-error text-xs font-semibold">
                      {t('send.addressPoisoningTitle')}
                    </p>
                    <p className="text-brand-gray200 text-xs mt-1">
                      {t('send.addressPoisoningBlocked', {
                        address: recipientPoisoningCollision.trustedAddress,
                      })}
                    </p>
                    <p className="text-white text-[10px] font-mono break-all mt-2">
                      {recipientPoisoningCollision.trustedAddress}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {transactionReviewDivider}
            {/* Only show fee section if we have meaningful fee information */}
            {!(isBitcoinBased && basicTxValues.fee === 0) && (
              <div className="flex flex-row items-end w-full">
                <div className="flex flex-col text-xs text-brand-gray200 font-poppins font-normal">
                  {t(
                    isSmartAccountSend
                      ? 'send.smartAccountMaxFee'
                      : isBitcoinBased
                      ? 'send.networkFee'
                      : 'send.estimatedGasFee'
                  )}
                  <span className="text-white text-xs">
                    {(() => {
                      if (feeCalculationError) {
                        return renderFeeError();
                      }

                      if (isBitcoinBased && basicTxValues.utxoFeeReview)
                        return renderFeeAmount(
                          formatSyscoinValue(
                            basicTxValues.utxoFeeReview.feeSatoshis
                          )
                        );

                      let feeAmount;
                      if (isNativeSoftwareSend || isOrdinaryTokenSend) {
                        feeAmount = getCalculatedFee;
                      } else if (
                        !isSmartAccountSend &&
                        basicTxValues.fee !== undefined &&
                        basicTxValues.fee > 0
                      ) {
                        feeAmount = basicTxValues.fee;
                      } else if (isBitcoinBased) {
                        feeAmount = basicTxValues.fee;
                      } else {
                        feeAmount = getCalculatedFee;
                      }

                      return renderFeeAmount(feeAmount);
                    })()}
                  </span>
                </div>
                {!isBitcoinBased &&
                  (!feeCalculationError ||
                    (isNativeSoftwareSend && customFee.isCustom)) &&
                  (isEIP1559Compatible ? (
                    <button
                      type="button"
                      id="edit-fee-button"
                      aria-label={t('send.editFee')}
                      disabled={
                        loading ||
                        submission.pending ||
                        isCalculatingFees ||
                        (refreshingCustomNativeFee && !!nativeReviewKey) ||
                        (!customFee.isCustom && !(fee.maxFeePerGas > 0))
                      }
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded hover:text-fields-input-borderfocus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200 disabled:cursor-not-allowed"
                      onClick={() => setIsOpenEditFeeModal(true)}
                    >
                      <span aria-hidden="true">
                        <Icon
                          name="EditTx"
                          isSvg
                          className="text-brand-white hover:text-fields-input-borderfocus"
                        />
                      </span>
                    </button>
                  ) : null)}
              </div>
            )}
            {isSmartAccountSend && (
              <div className="text-xs text-brand-gray200 mt-2">
                <p>{t('send.smartAccountFeeDetails')}</p>
                {(smartAccountQuoteError || smartAccountQuoteNeedsRefresh) && (
                  <>
                    <p role="status">
                      {smartAccountQuoteNeedsRefresh
                        ? t('send.smartAccountFeeQuoteChanged')
                        : smartAccountQuoteError}
                    </p>
                    <button
                      type="button"
                      className="underline"
                      disabled={loading || submission.pending}
                      onClick={() => {
                        setSmartAccountQuoteNeedsRefresh(false);
                        setSmartAccountQuoteError(undefined);
                        setSmartAccountQuote(undefined);
                        setRetryTrigger((previous) => previous + 1);
                      }}
                    >
                      {t('send.refreshFeeQuote')}
                    </button>
                  </>
                )}
              </div>
            )}
            {transactionReviewDivider}
            <div className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {!basicTxValues.token?.isNft ? (
                <>
                  {t('send.total')} (
                  {t(
                    isBitcoinBased
                      ? 'send.amountAndNetworkFee'
                      : 'send.amountAndFee'
                  )}
                  )
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
                              {t(
                                isBitcoinBased
                                  ? 'send.plusNetworkFee'
                                  : 'send.plusGasFee'
                              )}
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
                                  aria-label={t('receive.retry')}
                                  onClick={retryFeeCalculation}
                                  className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center p-0.5 hover:bg-brand-blue600 rounded-full transition-all duration-200"
                                >
                                  <Icon
                                    name="reload"
                                    className="w-3 h-3 text-brand-gray200 hover:text-white cursor-pointer transition-colors"
                                  />
                                </IconButton>
                              </span>
                            ) : gasFeeFiat ? (
                              <span className="text-brand-gray200 text-xs">
                                {t(
                                  isBitcoinBased
                                    ? 'send.networkFeeApprox'
                                    : 'send.gasFeeApprox'
                                )}{' '}
                                {gasFeeFiat}
                              </span>
                            ) : null}
                          </div>
                        );
                      }

                      // For native currency transactions (ETH/SYS), calculate combined total
                      let totalAmount;
                      let totalCrypto;

                      // If there's a fee calculation error, just show the amount without fee
                      if (isSmartAccountSend && smartAccountQuoteReady) {
                        const totalWei = BigNumber.from(
                          smartAccountQuote.executions[0].value
                        ).add(smartAccountQuote.maximumFeeWei);
                        totalAmount = formatEther(totalWei);
                        totalCrypto = totalAmount;
                      } else if (
                        isNativeSoftwareSend &&
                        exactWalletFeeReview &&
                        confirmationFeeReady
                      ) {
                        totalAmount = formatEther(
                          exactWalletFeeReview.total.toString()
                        );
                        totalCrypto = totalAmount;
                      } else if (
                        !isBitcoinBased &&
                        !isSmartAccountSend &&
                        !basicTxValues.token &&
                        basicTxValues.isMax
                      ) {
                        // Match the exact reviewed amount and the fee displayed above.
                        // Never fall back to the stale gross amount while loading.
                        try {
                          if (
                            !confirmationFeeReady ||
                            getCalculatedFee === undefined
                          )
                            throw new Error('MAX total unavailable');
                          const shownFee =
                            basicTxValues.fee > 0
                              ? basicTxValues.fee
                              : getCalculatedFee;
                          totalAmount = formatEther(
                            parseUnits(String(displayedAmount), 18).add(
                              parseUnits(
                                String(removeScientificNotation(shownFee)),
                                18
                              )
                            )
                          );
                          totalCrypto = totalAmount;
                        } catch {
                          totalAmount = 0;
                          totalCrypto = undefined;
                        }
                      } else if (nativeTotal !== undefined) {
                        totalAmount = nativeTotal.amount;
                        totalCrypto = nativeTotal.formatted;
                      } else if (feeCalculationError) {
                        totalAmount = basicTxValues.amount;
                        totalCrypto = currency(basicTxValues.amount, {
                          precision: 8,
                        }).format({ symbol: '' });
                      } else if (basicTxValues.fee !== undefined) {
                        // For MAX sends, don't add fee to amount since amount is already (balance - fee)
                        ({ totalAmount, totalCrypto } = formatNativeTotal(
                          basicTxValues.fee
                        ));
                      } else if (isBitcoinBased) {
                        // For MAX sends, don't add fee to amount since amount is already (balance - fee)
                        ({ totalAmount, totalCrypto } = formatNativeTotal(
                          basicTxValues.fee
                        ));
                      } else if (
                        !isBitcoinBased &&
                        isEIP1559Compatible === false
                      ) {
                        const calculatedFeeEther = getCalculatedFee;
                        ({ totalAmount, totalCrypto } =
                          formatNativeTotal(calculatedFeeEther));
                      } else {
                        const calculatedFeeEther = getCalculatedFee;
                        if (calculatedFeeEther !== undefined) {
                          ({ totalAmount, totalCrypto } =
                            formatNativeTotal(calculatedFeeEther));
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
                            {totalCrypto === undefined
                              ? t('send.calculating')
                              : removeScientificNotation(totalCrypto)}{' '}
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
                        return renderFeeError();
                      }

                      let feeAmount;

                      if (isBitcoinBased) {
                        feeAmount = basicTxValues.fee;
                      } else {
                        feeAmount = getCalculatedFee;
                      }

                      return renderFeeAmount(feeAmount);
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

              {requiresSptReview && !showAdvancedDetails && sptReviewError && (
                <p role="status" className="mt-2 text-warning-error text-sm">
                  {sptReviewMessage}
                </p>
              )}

              {(showAdvancedDetails || requiresSptReview) && (
                <div
                  className={
                    showAdvancedDetails
                      ? 'mt-2 -mx-6 border-y border-alpha-whiteAlpha300 bg-brand-blue700 overflow-hidden'
                      : ''
                  }
                >
                  <div
                    className="max-h-[500px] overflow-y-auto"
                    style={{ overflowX: 'hidden' }}
                  >
                    {/* SPT review is mandatory before approval. Native previews
                        retain lazy decoding until Advanced is expanded. */}
                    <SyscoinTransactionDetailsFromPSBT
                      key={sptReviewKey || 'native-preview'}
                      onReviewStateChange={
                        requiresSptReview
                          ? handleSptReviewStateChange
                          : undefined
                      }
                      psbt={basicTxValues.psbt}
                      reviewOnly={!showAdvancedDetails}
                      transaction={basicTxValues}
                      showTechnicalDetails={true}
                      showTransactionOptions={true}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {capacityNotice === capacityNoticeScope && submission.isActive() && (
            <div className="w-full max-w-md mx-auto mt-4 p-3 rounded-lg border border-warning-error bg-warning-error bg-opacity-10">
              <p role="alert" className="text-warning-error text-sm">
                {t('send.signedStorageFull')}
              </p>
              <button
                type="button"
                className="mt-2 text-white text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                onClick={() => setCapacityNotice(null)}
              >
                {t('buttons.close')}
              </button>
            </div>
          )}
          <DeviceWaitingBanner account={activeAccount} show={loading} />
          <PqSigningOverlay
            expectedSeconds={90}
            show={isPqSigning}
            subtitle={t('settings.slhDsaSigningOverlayDescription')}
            title={t('settings.slhDsaSigningInProgress')}
            warningSeconds={180}
          />

          <div className="flex items-center justify-center gap-3 py-6 w-full mt-4">
            <Button
              type="button"
              disabled={loading || submission.pending}
              onClick={cancelConfirmation}
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
            >
              {t('buttons.cancel')}
            </Button>

            <Button
              type="button"
              disabled={
                confirmed ||
                submission.blocked ||
                Boolean(recipientPoisoningCollision) ||
                Boolean(recipientIssue) ||
                Boolean(sptReviewError) ||
                tokenReviewInvalid ||
                !confirmationFeeReady ||
                isCalculatingFees ||
                (!isBitcoinBased && isEIP1559Compatible === undefined) ||
                (isSmartAccountSend && !smartAccountQuoteReady) ||
                (!isBitcoinBased && !!feeCalculationError)
              }
              loading={loading}
              onClick={handleConfirm}
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none"
            >
              {t('buttons.confirm')}
            </Button>
          </div>
          {tokenReviewInvalid && (
            <p role="status" className="text-sm text-warning-error text-center">
              {t('send.tokenVerificationFailed')}
            </p>
          )}
          {submission.unknown && (
            <p role="status" className="text-sm text-brand-gray200 text-center">
              {t('send.submissionStatusUnknown')}
            </p>
          )}
        </div>
      ) : null}
      {!basicTxValues && submission.interrupted && (
        <div className="text-center">
          <p role="status" className="text-sm text-brand-gray200">
            {t(
              submission.unknown
                ? 'send.submissionStatusUnknown'
                : 'send.cantCompleteTxs'
            )}
          </p>
          <Button
            variant="secondary"
            type="button"
            onClick={cancelConfirmation}
            className="mx-auto mt-4"
          >
            {t(submission.unknown ? 'buttons.close' : 'send.backToEdit')}
          </Button>
        </div>
      )}
    </>
  );
};
