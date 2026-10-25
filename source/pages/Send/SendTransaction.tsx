import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Button, DeviceWaitingBanner, WarningModal } from 'components/index';
import { LoadingComponent, PqSigningOverlay } from 'components/Loading';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import store, { RootState } from 'state/store';
import { selectEnsNameToAddress } from 'state/vault/selectors';
import {
  ICustomFeeParams,
  IDecodedTx,
  IFeeState,
  ITransactionParams,
  ITxState,
  IApprovedTokenInfos,
  ICustomApprovedAllowanceAmount,
} from 'types/transactions';
import { convertBigNumberToString, isMaxUint256 } from 'utils/bigNumberUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { formatMethodName } from 'utils/commonMethodSignatures';
import { assertSupportedEvmFees } from 'utils/dappTransaction';
import { handleTransactionError } from 'utils/errorHandling';
import { parseUnits, formatEther } from 'utils/ethersV6Compat';
import { BigNumber } from 'utils/ethersV6Compat';
import {
  IEvmTransactionContext,
  EVM_TRANSACTION_CONTEXT_CHANGED,
} from 'utils/evmTransactionContext';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { ellipsis } from 'utils/format';
import { logError } from 'utils/logger';
import { clearTransactionNavigationState } from 'utils/navigationState';
import { safeBigNumber } from 'utils/safeBigNumber';
import { safeToFixed } from 'utils/safeToFixed';
import {
  getSmartAccountLocalOwnerContexts,
  signAndSubmitSmartAccountExecutions,
  isSmartAccountFeeQuoteChanged,
  SMART_ACCOUNT_FEE_QUOTE_CHANGED,
  type SmartAccountFeeOverrides,
} from 'utils/smartAccount';
import { omitTransactionObjectData } from 'utils/transactions';
import { validateTransactionDataValue } from 'utils/validateTransactionDataValue';

import {
  ApprovalType,
  canEditApprovalAmount,
  formatApprovalTokenAmount,
  getApprovalAmountDisplay,
  getApprovalAddressValues,
  getEffectiveApprovalData,
} from './approval';
import {
  ApprovalDetails,
  TransactionDetailsComponent,
  TransactionDataComponent,
  TransactionHexComponent,
} from './components';
import { EditApprovedAllowanceValueModal } from './EditApprovedAllowanceValueModal';
import { EditPriorityModal } from './EditPriority';
import { tabComponents, tabElements } from './mockedComponentsData/mockedTabs';

type FeeSafetyAdjustment = {
  gasLimit?: {
    recommended: number;
    requested: number;
  };
  gasPrice?: {
    recommended: number;
    requested: number;
  };
  maxFeePerGas?: {
    recommended: number;
    requested: number;
  };
  maxPriorityFeePerGas?: {
    recommended: number;
    requested: number;
  };
};

const getApprovalWalletContextKey = (
  current: Pick<RootState, 'vault' | 'vaultGlobal'>
): string => {
  const { vault, vaultGlobal } = current;
  const { activeAccount, activeNetwork } = vault;
  const account = vault.accounts[activeAccount.type]?.[activeAccount.id];
  return JSON.stringify([
    Boolean(vault.isBitcoinBased),
    activeAccount.type,
    activeAccount.id,
    account?.address?.toLowerCase(),
    activeNetwork.chainId,
    activeNetwork.url,
    vaultGlobal.activeSlip44,
  ]);
};

export const SendTransaction = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { navigate, alert } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const currentApprovalWalletContextKey = useSelector(
    getApprovalWalletContextKey
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();

  const { host, eventName, ...externalTx } = useQueryData();

  const isExternal = Boolean(externalTx.external);
  const [approvedContext] = useState<IEvmTransactionContext>(() => {
    const current = store.getState();
    return (
      externalTx.approvedContext ||
      state?.approvedContext || {
        account: { ...activeAccountMeta, address: activeAccount.address },
        chainId: activeNetwork.chainId,
        rpcUrl: activeNetwork.url,
        slip44: current.vaultGlobal.activeSlip44,
      }
    );
  });
  const dataTx: ITransactionParams = isExternal
    ? externalTx.tx
    : state.external
    ? state.tx
    : state.tx;

  const decodedTxData: IDecodedTx = isExternal
    ? externalTx.decodedTx
    : state.external
    ? state.decodedTx
    : state.decodedTx;

  // Extract transaction metadata
  const txMetadata = isExternal
    ? externalTx.txMetadata
    : state?.txMetadata || {};
  // Determine legacy transaction explicitly: honor metadata or explicit type 0x0
  const explicitType = (dataTx as any)?.type;
  const isLegacyTransaction =
    Boolean(txMetadata.isLegacyTx) ||
    explicitType === 0 ||
    explicitType === '0x0' ||
    dataTx.gasPrice !== undefined;
  const isApproval = txMetadata.isApproval || false;
  const approvalType = txMetadata.approvalType as ApprovalType | undefined;
  const tokenStandard = txMetadata.tokenStandard;
  const approvedWalletContextKey = useMemo(
    () =>
      JSON.stringify([
        false,
        approvedContext.account.type,
        approvedContext.account.id,
        approvedContext.account.address.toLowerCase(),
        approvedContext.chainId,
        approvedContext.rpcUrl,
        approvedContext.slip44,
      ]),
    [approvedContext]
  );
  // An object identity retires metadata even when the wallet leaves and then
  // returns to the same context. Hide the old result during render, before
  // effect cleanup or a replacement metadata request can complete.
  const approvalMetadataScope = useMemo(
    () => ({
      accountAddress: activeAccount.address,
      approvalType,
      approvedContext,
      contractAddress: dataTx?.to,
      decodedTx: decodedTxData,
      eventName,
      host,
      isApproval,
      isApprovedContext:
        currentApprovalWalletContextKey === approvedWalletContextKey,
      transactionData: dataTx?.data,
      walletContextKey: currentApprovalWalletContextKey,
    }),
    [
      activeAccount.address,
      approvalType,
      approvedContext,
      dataTx?.to,
      dataTx?.data,
      decodedTxData,
      eventName,
      host,
      isApproval,
      currentApprovalWalletContextKey,
      approvedWalletContextKey,
    ]
  );
  const currentApprovalMetadataScope = React.useRef(approvalMetadataScope);
  currentApprovalMetadataScope.current = approvalMetadataScope;

  const targetedErc20ContractAddress = useMemo(() => {
    if (!dataTx?.to) return null;

    const method = String(decodedTxData?.method || '').toLowerCase();
    const normalizedTokenStandard = String(tokenStandard || '').toUpperCase();
    const isErc20Approval = isApproval && approvalType === 'erc20-amount';
    const isErc20LikeStandard = ['ERC-20', 'ERC-777', 'ERC-4626'].includes(
      normalizedTokenStandard
    );
    const isErc20LikeMethod = ['approve', 'transfer', 'transferfrom'].includes(
      method
    );

    return isErc20Approval || isErc20LikeStandard || isErc20LikeMethod
      ? dataTx.to
      : null;
  }, [
    dataTx?.to,
    decodedTxData?.method,
    tokenStandard,
    isApproval,
    approvalType,
  ]);

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [closing, setClosing] = useState(false);
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const approvalActionRef = React.useRef<
    'ready' | 'submitting' | 'outcome-unknown' | 'dismissed' | 'completed'
  >('ready');
  const mountedRef = React.useRef(true);
  const closeGenerationRef = React.useRef(0);
  const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [isPqSigning, setIsPqSigning] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>();
  const [txResponse, setTxResponse] = useState<string | null>(null);
  // An unset override follows the latest quote; re-estimation must never
  // replace a nonce the user explicitly selected (including zero).
  const [customNonce, setCustomNonce] = useState<number>();
  const [tabSelected, setTabSelected] = useState<string>(tabElements[0].id);
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = tabElements.findIndex((tab) => tab.id === tabSelected);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? tabElements.length - 1
        : event.key === 'ArrowRight'
        ? (index + 1) % tabElements.length
        : event.key === 'ArrowLeft'
        ? (index + tabElements.length - 1) % tabElements.length
        : -1;
    if (next < 0) return;
    event.preventDefault();
    setTabSelected(tabElements[next].id);
    event.currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };
  // Removed unused haveError state
  const [hasTxDataError, setHasTxDataError] = useState<boolean>(false);
  const [hasGasError, setHasGasError] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [valueAndCurrency, setValueAndCurrency] = useState<string>('');
  const [customFee, setCustomFee] = useState<ICustomFeeParams>({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
    gasPrice: 0,
  });
  const [feeSafetyAdjustment, setFeeSafetyAdjustment] =
    useState<FeeSafetyAdjustment>({});
  const [acceptedDappFeeRequest, setAcceptedDappFeeRequest] =
    useState<boolean>(false);
  const [feeRecommendationOnly, setFeeRecommendationOnly] = useState(false);
  const [feeQuoteRevision, setFeeQuoteRevision] = useState(0);
  const [feeQuoteNeedsRefresh, setFeeQuoteNeedsRefresh] = useState(false);
  const feeQuoteKeyRef = React.useRef('');
  const quotedApprovalDataRef = React.useRef<string>();

  // Approval-specific state
  const [approvalMetadata, setApprovalMetadata] = useState<{
    nftInfo?: { name?: string; tokenId?: string; tokenUri?: string };
    scope: typeof approvalMetadataScope;
    tokenInfo?: IApprovedTokenInfos;
  }>();
  const currentApprovalMetadata =
    approvalMetadataScope.isApprovedContext &&
    approvalMetadata?.scope === approvalMetadataScope
      ? approvalMetadata
      : undefined;
  const approvedTokenInfos = currentApprovalMetadata?.tokenInfo;
  const nftInfo = currentApprovalMetadata?.nftInfo;
  const [customApprovedAllowanceAmount, setCustomApprovedAllowanceAmount] =
    useState<ICustomApprovedAllowanceAmount>({
      isCustom: false,
      defaultAllowanceValue: '0',
      customAllowanceValue: null,
    });
  const [openEditAllowanceModal, setOpenEditAllowanceModal] =
    useState<boolean>(false);

  // Contract warning state
  const [showContractWarning, setShowContractWarning] =
    useState<boolean>(false);
  const [isCheckingContract, setIsCheckingContract] = useState<boolean>(false);
  const [hasCheckedContract, setHasCheckedContract] = useState<boolean>(false);

  const editingDisabled = loading || closing || confirmed || submissionUnknown;
  const editingDisabledRef = React.useRef(editingDisabled);
  editingDisabledRef.current = editingDisabled;
  // A previously rendered editor can still finish validation after Confirm.
  // Check the live action as well as disabling controls in the next render.
  const canEditTransaction = () =>
    mountedRef.current &&
    approvalActionRef.current === 'ready' &&
    !editingDisabledRef.current;
  const updateCustomFee: typeof setCustomFee = (value) => {
    if (canEditTransaction()) setCustomFee(value);
  };
  const updateCustomNonce: typeof setCustomNonce = (value) => {
    if (canEditTransaction()) setCustomNonce(value);
  };
  const updateFeeEditorOpen: typeof setIsOpen = (value) => {
    if (canEditTransaction()) setIsOpen(value);
  };

  const formattedValueAndCurrency = useMemo(() => {
    if (!tx?.value) return `0 ${activeNetwork.currency?.toUpperCase()}`;

    try {
      // Use formatEther to properly handle wei values without precision loss
      const ethValue = formatEther(
        BigNumber.isBigNumber(tx.value) ? tx.value : BigNumber.from(tx.value)
      );
      return `${ethValue.replace(
        /\.0$/,
        ''
      )} ${activeNetwork.currency?.toUpperCase()}`;
    } catch (error) {
      console.error('Error formatting value:', error);
      return `0 ${activeNetwork.currency?.toUpperCase()}`;
    }
  }, [tx?.value, activeNetwork.currency]);

  const omitTransactionObject = omitTransactionObjectData(dataTx, ['type']);
  const hasDappFeeSafetyAdjustment = useMemo(
    () =>
      Boolean(
        feeSafetyAdjustment.gasLimit ||
          feeSafetyAdjustment.gasPrice ||
          feeSafetyAdjustment.maxFeePerGas ||
          feeSafetyAdjustment.maxPriorityFeePerGas
      ),
    [feeSafetyAdjustment]
  );

  const isCurrentFeeBelowEstimate = useMemo(() => {
    if (!customFee.isCustom || !fee) {
      return false;
    }

    if (
      customFee.gasLimit > 0 &&
      fee.gasLimit > 0 &&
      customFee.gasLimit < fee.gasLimit
    ) {
      return true;
    }

    if (isLegacyTransaction) {
      return Boolean(
        fee.gasPrice !== null &&
          fee.gasPrice !== undefined &&
          customFee.gasPrice !== null &&
          customFee.gasPrice !== undefined &&
          customFee.gasPrice >= 0 &&
          customFee.gasPrice < fee.gasPrice
      );
    }

    return (
      (customFee.maxFeePerGas >= 0 &&
        fee.maxFeePerGas > 0 &&
        customFee.maxFeePerGas < fee.maxFeePerGas) ||
      (customFee.maxPriorityFeePerGas >= 0 &&
        fee.maxPriorityFeePerGas > 0 &&
        customFee.maxPriorityFeePerGas < fee.maxPriorityFeePerGas)
    );
  }, [customFee, fee, isLegacyTransaction]);

  const handleUseDappFeeRequest = () => {
    if (!canEditTransaction() || !fee) return;

    if (isLegacyTransaction) {
      setCustomFee({
        isCustom: true,
        gasLimit: feeSafetyAdjustment.gasLimit?.requested || fee.gasLimit,
        gasPrice: feeSafetyAdjustment.gasPrice?.requested ?? fee.gasPrice ?? 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      });
    } else {
      const requestedGasPrice = feeSafetyAdjustment.gasPrice?.requested;
      const requestedMaxFee =
        feeSafetyAdjustment.maxFeePerGas?.requested ??
        requestedGasPrice ??
        fee.maxFeePerGas;
      const requestedPriorityFee =
        feeSafetyAdjustment.maxPriorityFeePerGas?.requested ??
        requestedGasPrice ??
        Math.min(fee.maxPriorityFeePerGas, requestedMaxFee);
      setCustomFee({
        isCustom: true,
        gasLimit: feeSafetyAdjustment.gasLimit?.requested || fee.gasLimit,
        maxFeePerGas: requestedMaxFee,
        maxPriorityFeePerGas: Math.min(requestedPriorityFee, requestedMaxFee),
        gasPrice: 0,
      });
    }

    setAcceptedDappFeeRequest(true);
  };

  const handleUseNetworkFeeSuggestion = () => {
    if (!canEditTransaction() || !fee) return;
    setCustomFee({
      isCustom: true,
      gasLimit: feeSafetyAdjustment.gasLimit?.recommended ?? fee.gasLimit,
      gasPrice: isLegacyTransaction
        ? feeSafetyAdjustment.gasPrice?.recommended ?? fee.gasPrice ?? 0
        : 0,
      maxFeePerGas: isLegacyTransaction
        ? 0
        : feeSafetyAdjustment.maxFeePerGas?.recommended ?? fee.maxFeePerGas,
      maxPriorityFeePerGas: isLegacyTransaction
        ? 0
        : feeSafetyAdjustment.maxPriorityFeePerGas?.recommended ??
          fee.maxPriorityFeePerGas,
    });
    setAcceptedDappFeeRequest(true);
  };

  // Raw input 'to' (could be ENS or address)
  const toRaw = String(dataTx?.to || '');

  // Memoize the validated transaction to prevent unnecessary re-renders
  const validatedDataTxWithoutType = useMemo(
    () => ({
      ...omitTransactionObject,
      type: dataTx.type,
      data: validateTransactionDataValue(dataTx.data),
    }),
    // Use stable dependencies
    [
      dataTx.from,
      dataTx.to,
      dataTx.value,
      dataTx.data,
      dataTx.gas,
      dataTx.gasLimit,
      dataTx.maxFeePerGas,
      dataTx.maxPriorityFeePerGas,
      dataTx.type,
      dataTx.nonce,
      dataTx.accessList,
    ]
  );

  // ENS handling: resolution
  const nameToAddress = useSelector(selectEnsNameToAddress);
  const [resolvedTo, setResolvedTo] = useState<string | null>(
    toRaw.toLowerCase().endsWith('.eth') ? null : toRaw
  );
  // Track ENS resolution failure to avoid indefinite spinner and inform the user
  const [ensResolutionFailed, setEnsResolutionFailed] =
    useState<boolean>(false);

  // Effective address for provider calls (never pass ENS to provider)
  const toAddressForProvider = useMemo(
    () => (toRaw.startsWith('0x') ? toRaw : resolvedTo || ''),
    [toRaw, resolvedTo]
  );

  const effectiveApprovalData = useMemo(
    () =>
      getEffectiveApprovalData({
        approvalType,
        customAmount: customApprovedAllowanceAmount.customAllowanceValue,
        data: validatedDataTxWithoutType.data,
        decimals: approvedTokenInfos?.tokenDecimals,
        decodedTx: decodedTxData,
        isCustom: isApproval && customApprovedAllowanceAmount.isCustom,
      }),
    [
      approvalType,
      customApprovedAllowanceAmount.customAllowanceValue,
      customApprovedAllowanceAmount.isCustom,
      validatedDataTxWithoutType.data,
      approvedTokenInfos?.tokenDecimals,
      decodedTxData,
      isApproval,
    ]
  );
  const hasInvalidCustomAllowance = !effectiveApprovalData;
  const hasCurrentApprovalDataQuote =
    !isApproval ||
    (Boolean(effectiveApprovalData) &&
      quotedApprovalDataRef.current === effectiveApprovalData?.data);

  // Clone tx for estimation with resolved address
  const txForEstimation = useMemo(
    () =>
      ({
        ...validatedDataTxWithoutType,
        data: effectiveApprovalData?.data,
        to: toAddressForProvider || undefined,
      } as ITransactionParams),
    [validatedDataTxWithoutType, toAddressForProvider, effectiveApprovalData]
  );
  const isSmartAccountApproval = Boolean(activeAccount.isSmartAccount);
  const smartAccountFeeOverrides = useMemo<
    SmartAccountFeeOverrides | undefined
  >(() => {
    if (!isSmartAccountApproval || !customFee.isCustom) return undefined;
    try {
      return isLegacyTransaction
        ? {
            gasPrice: parseUnits(safeToFixed(customFee.gasPrice), 9).toString(),
          }
        : {
            maxFeePerGas: parseUnits(
              safeToFixed(customFee.maxFeePerGas),
              9
            ).toString(),
            maxPriorityFeePerGas: parseUnits(
              safeToFixed(customFee.maxPriorityFeePerGas),
              9
            ).toString(),
          };
    } catch {
      return undefined;
    }
  }, [
    isSmartAccountApproval,
    customFee.isCustom,
    customFee.gasPrice,
    customFee.maxFeePerGas,
    customFee.maxPriorityFeePerGas,
    isLegacyTransaction,
  ]);
  const smartAccountQuoteKey = useMemo(
    () =>
      !isSmartAccountApproval
        ? ''
        : JSON.stringify([
            activeAccountMeta.type,
            activeAccountMeta.id,
            activeAccount.address,
            activeNetwork.chainId,
            activeNetwork.url,
            txForEstimation,
            smartAccountFeeOverrides,
            customApprovedAllowanceAmount,
          ]),
    [
      isSmartAccountApproval,
      activeAccountMeta.type,
      activeAccountMeta.id,
      activeAccount.address,
      activeNetwork.chainId,
      activeNetwork.url,
      txForEstimation,
      smartAccountFeeOverrides,
      customApprovedAllowanceAmount,
    ]
  );
  const currentSmartAccountQuoteKeyRef = React.useRef(smartAccountQuoteKey);
  currentSmartAccountQuoteKeyRef.current = smartAccountQuoteKey;
  const hasCurrentSmartAccountFeeQuote =
    !isSmartAccountApproval ||
    (Boolean(fee?.smartAccountFeeQuote) &&
      feeQuoteKeyRef.current === smartAccountQuoteKey &&
      !feeQuoteNeedsRefresh);
  // Reverse cache name->address

  // Lazy resolve if ENS name
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const isEns = toRaw.toLowerCase().endsWith('.eth');
      if (!isEns) return;
      const cached = nameToAddress[toRaw.toLowerCase()];
      if (cached) {
        if (!cancelled) setResolvedTo(cached);
        return;
      }
      try {
        const addr = (await controllerEmitter(
          ['wallet', 'resolveEns'],
          [toRaw]
        )) as string | null;
        if (!cancelled) {
          setResolvedTo(addr || null);
          if (!addr) {
            // Mark failure and stop initial spinner so UI can render an error state
            setEnsResolutionFailed(true);
            setInitialLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          setResolvedTo(null);
          setEnsResolutionFailed(true);
          setInitialLoading(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [toRaw, nameToAddress]);

  const approvalDetails = useMemo(
    () =>
      getApprovalAddressValues(
        decodedTxData,
        resolvedTo || toRaw,
        approvalType
      ),
    [decodedTxData, resolvedTo, toRaw, approvalType]
  );
  const hasInvalidApprovalDetails = isApproval && !approvalDetails.isValid;
  const canEditCurrentApproval = canEditApprovalAmount(
    approvalType,
    decodedTxData?.method
  );
  const rawApprovalAmount =
    approvalType === 'erc20-amount'
      ? convertBigNumberToString(decodedTxData?.inputs?.[1])
      : '';
  const formattedApprovalAmount = useMemo(() => {
    if (approvalType !== 'erc20-amount' || !rawApprovalAmount) {
      return undefined;
    }

    if (approvedTokenInfos?.tokenDecimals === undefined) {
      return rawApprovalAmount;
    }

    try {
      return formatApprovalTokenAmount(
        decodedTxData?.inputs?.[1],
        approvedTokenInfos.tokenDecimals
      );
    } catch {
      return rawApprovalAmount;
    }
  }, [
    approvalType,
    rawApprovalAmount,
    approvedTokenInfos?.tokenDecimals,
    decodedTxData?.inputs,
  ]);
  const { amount: displayedApprovalAmount, isUnlimited: isUnlimitedApproval } =
    getApprovalAmountDisplay({
      canEdit: canEditCurrentApproval,
      customAmount: customApprovedAllowanceAmount.customAllowanceValue,
      formattedAmount: formattedApprovalAmount,
      isCustom: customApprovedAllowanceAmount.isCustom,
      isEffectiveUnlimited:
        approvalType === 'erc20-amount' &&
        effectiveApprovalData?.decodedTx?.method === 'approve' &&
        isMaxUint256(
          convertBigNumberToString(effectiveApprovalData.decodedTx.inputs?.[1])
        ),
    });

  const invalidatePendingClose = () => {
    closeGenerationRef.current += 1;
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleErrorClose = (delay: number, generation: number) => {
    if (
      !mountedRef.current ||
      generation !== closeGenerationRef.current ||
      approvalActionRef.current === 'dismissed' ||
      approvalActionRef.current === 'completed'
    )
      return;
    if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
    const timeout = setTimeout(async () => {
      if (
        !mountedRef.current ||
        generation !== closeGenerationRef.current ||
        closeTimeoutRef.current !== timeout ||
        !['ready', 'outcome-unknown'].includes(approvalActionRef.current)
      )
        return;
      approvalActionRef.current = 'dismissed';
      closeTimeoutRef.current = null;
      setClosing(true);
      try {
        await clearTransactionNavigationState();
      } catch (error) {
        console.error(
          '[SendTransaction] Failed to clear navigation state on error close:',
          error
        );
      } finally {
        if (mountedRef.current && generation === closeGenerationRef.current)
          window.close();
      }
    }, delay);
    closeTimeoutRef.current = timeout;
    return timeout;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidatePendingClose();
    };
  }, []);

  const submitTransaction = async (generation: number) => {
    if (!hasCurrentApprovalDataQuote) return;
    if (!hasCurrentSmartAccountFeeQuote) {
      alert.error(t('send.smartAccountFeeQuoteChanged'));
      return;
    }
    const current = store.getState();
    const account =
      current.vault.accounts[current.vault.activeAccount.type]?.[
        current.vault.activeAccount.id
      ];
    if (
      current.vault.isBitcoinBased ||
      current.vault.activeNetwork.chainId !== approvedContext.chainId ||
      current.vault.activeNetwork.url !== approvedContext.rpcUrl ||
      current.vaultGlobal.activeSlip44 !== approvedContext.slip44 ||
      current.vault.activeAccount.id !== approvedContext.account.id ||
      current.vault.activeAccount.type !== approvedContext.account.type ||
      account?.address?.toLowerCase() !==
        approvedContext.account.address.toLowerCase()
    ) {
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    }
    if (hasInvalidApprovalDetails || hasInvalidCustomAllowance) {
      alert.error(t('send.invalidApprovalDetails'));
      return;
    }
    if (activeAccount.isSmartAccount && !activeAccount.smartAccount) {
      alert.error(t('send.cantCompleteTxs'));
      return;
    }

    // Admission validates dapp requests; contain stale/direct navigation too.
    // Never display/send a default zero for a malformed requested amount.
    let requestedValue: BigNumber;
    try {
      requestedValue = BigNumber.from(dataTx?.value ?? 0);
      if (requestedValue.lt(0)) throw new Error('Invalid transaction value');
    } catch {
      setHasTxDataError(true);
      alert.error(t('send.txWillFail'));
      return;
    }
    if (
      !isLegacyTransaction &&
      customFee.isCustom &&
      (customFee.maxFeePerGas <= 0 ||
        customFee.maxPriorityFeePerGas < 0 ||
        customFee.maxPriorityFeePerGas > customFee.maxFeePerGas)
    ) {
      alert.error(t('send.invalidFeeRate'));
      return;
    }
    setIsPqSigning(false);
    setLoading(true);

    let balance = Number(activeAccount?.balances?.ethereum || 0);

    try {
      const refreshedBalance = (await controllerEmitter(
        ['wallet', 'refreshActiveAccountBalances'],
        [{ includeAssets: false }]
      )) as { nativeBalance: string };
      balance = Number(refreshedBalance.nativeBalance || 0);
    } catch (error) {
      console.error('Failed to refresh balance before sending:', error);
    }

    const canUsePasskeyGasPayer =
      activeAccount?.isSmartAccount && requestedValue.isZero();

    if (activeAccount && (balance > 0 || canUsePasskeyGasPayer)) {
      // Use the same bytes already shown in Data/Hex and used for the fee
      // quote. NFT approvals and unedited transactions retain their input.
      const txToSend =
        isApproval && customApprovedAllowanceAmount.isCustom
          ? { ...tx, data: effectiveApprovalData.data }
          : tx;

      let submissionRequested = false;
      try {
        let response;
        const isPasskeyAccount = Boolean(
          activeAccount.isSmartAccount && activeAccount.smartAccount
        );
        const getSmartAccountFeeOverrides = ():
          | SmartAccountFeeOverrides
          | undefined => {
          if (!fee) return undefined;
          if (isLegacyTransaction) {
            if (!customFee.isCustom && txToSend.gasPrice !== undefined)
              return { gasPrice: BigNumber.from(txToSend.gasPrice).toString() };
            const gasPrice =
              customFee.isCustom && customFee.gasPrice >= 0
                ? customFee.gasPrice
                : fee.gasPrice;
            if (
              gasPrice === undefined ||
              !Number.isFinite(gasPrice) ||
              gasPrice < 0
            )
              throw new Error('Invalid smart account legacy fee override');
            return {
              gasPrice: parseUnits(safeToFixed(gasPrice), 9).toString(),
            };
          }

          const maxPriorityFeePerGas =
            customFee.isCustom && customFee.maxPriorityFeePerGas >= 0
              ? customFee.maxPriorityFeePerGas
              : fee.maxPriorityFeePerGas;
          const maxFeePerGas =
            customFee.isCustom && customFee.maxFeePerGas >= 0
              ? customFee.maxFeePerGas
              : fee.maxFeePerGas;

          if (
            maxPriorityFeePerGas === null ||
            maxPriorityFeePerGas === undefined ||
            maxPriorityFeePerGas < 0 ||
            !maxFeePerGas ||
            maxFeePerGas <= 0
          ) {
            throw new Error('Invalid smart account fee override');
          }

          return {
            maxFeePerGas:
              !customFee.isCustom && txToSend.maxFeePerGas !== undefined
                ? BigNumber.from(txToSend.maxFeePerGas).toString()
                : parseUnits(safeToFixed(maxFeePerGas), 9).toString(),
            maxPriorityFeePerGas:
              !customFee.isCustom && txToSend.maxPriorityFeePerGas !== undefined
                ? BigNumber.from(txToSend.maxPriorityFeePerGas).toString()
                : parseUnits(safeToFixed(maxPriorityFeePerGas), 9).toString(),
          };
        };

        if (isPasskeyAccount) {
          const approvedQuoteKey = smartAccountQuoteKey;
          const assertApprovedQuoteCurrent = () => {
            if (
              !mountedRef.current ||
              generation !== closeGenerationRef.current ||
              currentSmartAccountQuoteKeyRef.current !== approvedQuoteKey
            )
              throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
                transactionNotBroadcast: true,
              });
          };
          const candidateTo =
            resolvedTo || (toRaw.startsWith('0x') ? toRaw : undefined);
          if (!candidateTo) {
            alert.error(t('send.smartAccountContractDeploymentUnsupported'));
            setLoading(false);
            return;
          }

          const passkeyTxValue = txToSend.value
            ? safeBigNumber(
                txToSend.value,
                '0x0',
                'transaction value'
              ).toHexString()
            : '0x0';
          response = await signAndSubmitSmartAccountExecutions({
            accountAddress: activeAccount.address,
            accountId: activeAccount.id,
            authenticatorContexts: getSmartAccountLocalOwnerContexts({
              accounts,
              controllerEmitter,
            }),
            controllerEmitter: (methods, params, timeout, retryConnection) => {
              if (
                methods.length === 2 &&
                methods[0] === 'wallet' &&
                methods[1] === 'submitSmartAccountExecution'
              )
                submissionRequested = true;
              return controllerEmitter(
                methods as Parameters<typeof controllerEmitter>[0],
                params,
                timeout,
                retryConnection
              );
            },
            executions: [
              {
                target: candidateTo,
                value: passkeyTxValue,
                data: validateTransactionDataValue(txToSend.data),
              },
            ],
            feeOverrides: getSmartAccountFeeOverrides(),
            maximumUserOpFeeWei: fee!.smartAccountFeeQuote!.maximumFeeWei,
            expectedContext: approvedContext,
            onPrepared: assertApprovedQuoteCurrent,
            onBeforeSubmit: async () => assertApprovedQuoteCurrent(),
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
        } else if (isLegacyTransaction) {
          // Legacy transaction handling - MUST remove all EIP-1559 fields
          const txWithoutType = omitTransactionObjectData(txToSend, [
            'type',
            'maxFeePerGas',
            'maxPriorityFeePerGas',
          ]) as ITxState;

          const getLegacyGasFee = Boolean(
            customFee.isCustom && customFee.gasPrice >= 0
          )
            ? parseUnits(safeToFixed(customFee.gasPrice), 9) // Convert Gwei to Wei using parseUnits with proper decimal handling
            : txToSend.gasPrice !== undefined
            ? BigNumber.from(txToSend.gasPrice)
            : fee.gasPrice && fee.gasPrice > 0
            ? parseUnits(safeToFixed(fee.gasPrice), 9) // Convert Gwei to Wei using parseUnits with proper decimal handling
            : await controllerEmitter([
                'wallet',
                'ethereumTransaction',
                'getRecommendedGasPrice',
              ]).then((gas) => BigNumber.from(gas)); // This returns wei already, so BigNumber.from is fine

          // Determine if we have a valid destination address. For contract deployments, omit 'to'
          const candidateTo =
            resolvedTo || (toRaw.startsWith('0x') ? toRaw : undefined);
          const toField: string | undefined = candidateTo;

          const baseLegacyTx: any = {
            ...txWithoutType,
            value: txWithoutType.value
              ? safeBigNumber(
                  txWithoutType.value,
                  '0x0',
                  'transaction value'
                ).toHexString()
              : '0x0', // Convert value to hex string using safe conversion
            nonce: customNonce ?? tx.nonce,
            gasPrice: getLegacyGasFee.toHexString(), // Use BigNumber.toHexString() for precision
            gasLimit: BigNumber.from(
              Boolean(
                customFee.isCustom &&
                  customFee.gasLimit &&
                  customFee.gasLimit > 0
              )
                ? customFee.gasLimit
                : tx.gasLimit && BigNumber.isBigNumber(tx.gasLimit)
                ? tx.gasLimit // Keep as BigNumber
                : fee.gasLimit || 42000 // Fallback to fee or default
            ).toHexString(), // Convert to hex string for ethers
            ...(toField ? { to: toField } : {}),
          };

          submissionRequested = true;
          response = await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              baseLegacyTx,
              isLegacyTransaction,
              undefined,
              undefined,
              { expectedContext: approvedContext },
            ],
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          );
        } else {
          // EIP-1559 transaction handling
          // Determine if we have a valid destination address. For contract deployments, omit 'to'
          const candidateTo =
            resolvedTo || (toRaw.startsWith('0x') ? toRaw : undefined);
          const toField: string | undefined = candidateTo;

          const base1559Tx: any = {
            ...txToSend,
            value: txToSend.value
              ? safeBigNumber(
                  txToSend.value,
                  '0x0',
                  'transaction value'
                ).toHexString()
              : '0x0', // Convert value to hex string using safe conversion
            nonce: customNonce ?? tx.nonce,
            maxPriorityFeePerGas: Boolean(
              customFee.isCustom && customFee.maxPriorityFeePerGas >= 0
            )
              ? parseUnits(safeToFixed(customFee.maxPriorityFeePerGas), 9)
              : tx.maxPriorityFeePerGas !== null &&
                tx.maxPriorityFeePerGas !== undefined
              ? safeBigNumber(
                  tx.maxPriorityFeePerGas,
                  parseUnits(safeToFixed(fee.maxPriorityFeePerGas), 9),
                  'transaction maxPriorityFeePerGas'
                )
              : parseUnits(safeToFixed(fee.maxPriorityFeePerGas), 9), // Fallback to fee
            maxFeePerGas: Boolean(
              customFee.isCustom && customFee.maxFeePerGas >= 0
            )
              ? parseUnits(safeToFixed(customFee.maxFeePerGas), 9)
              : tx.maxFeePerGas !== null && tx.maxFeePerGas !== undefined
              ? safeBigNumber(
                  tx.maxFeePerGas,
                  parseUnits(safeToFixed(fee.maxFeePerGas), 9),
                  'transaction maxFeePerGas'
                )
              : parseUnits(safeToFixed(fee.maxFeePerGas), 9), // Fallback to fee
            gasLimit: Boolean(
              customFee.isCustom && customFee.gasLimit && customFee.gasLimit > 0
            )
              ? BigNumber.from(customFee.gasLimit)
              : tx.gasLimit !== null && tx.gasLimit !== undefined
              ? safeBigNumber(
                  tx.gasLimit,
                  BigNumber.from(fee.gasLimit || 42000),
                  'transaction gasLimit'
                )
              : BigNumber.from(fee.gasLimit || 42000), // Fallback to fee
            ...(toField ? { to: toField } : {}),
          };

          assertSupportedEvmFees(base1559Tx);
          submissionRequested = true;
          response = await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              base1559Tx,
              false, // isLegacy = false for EIP-1559
              undefined,
              undefined,
              { expectedContext: approvedContext },
            ],
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          );
        }

        if (!mountedRef.current || generation !== closeGenerationRef.current)
          return response.hash;
        invalidatePendingClose();
        approvalActionRef.current = 'completed';
        setConfirmed(true);

        // Store the response data for dispatch later
        if (isExternal) {
          setTxResponse(response.hash);
        }
        // Don't set loading to false here - let the navigation effect handle it
        return response.hash;
      } catch (error: any) {
        if (
          error?.message === SMART_ACCOUNT_FEE_QUOTE_CHANGED &&
          submissionRequested
        )
          error = Object.assign(new Error(error.message), error, {
            transactionNotBroadcast: false,
          });
        if (isSmartAccountFeeQuoteChanged(error) && !submissionRequested) {
          if (mountedRef.current && generation === closeGenerationRef.current) {
            setFeeQuoteNeedsRefresh(true);
            setLoading(false);
            alert.error(t('send.smartAccountFeeQuoteChanged'));
          }
          return error;
        }
        // A local controller timeout does not cancel the background send.
        // Keep the attempt consumed unless the background explicitly proved
        // that it failed before any broadcast attempt.
        if (submissionRequested && error?.transactionNotBroadcast !== true) {
          approvalActionRef.current = 'outcome-unknown';
          setSubmissionUnknown(true);
        }
        // Handle specific errors (blacklist, cancellation, device issues, etc.)
        const wasHandledSpecifically = handleTransactionError(
          error,
          alert,
          t,
          activeAccount,
          activeNetwork
        );

        // For errors that were handled specifically, just stop loading
        if (wasHandledSpecifically) {
          setLoading(false);
          return;
        }

        // For all other unhandled errors, show generic message
        logError('error', 'Transaction', error);
        alert.error(
          t(
            error?.message === EVM_TRANSACTION_CONTEXT_CHANGED
              ? 'transactions.psbtSigningContextChanged'
              : 'send.cantCompleteTxs'
          )
        );

        if (isExternal) {
          if (!mountedRef.current || generation !== closeGenerationRef.current)
            return error;
          await clearTransactionNavigationState();
          scheduleErrorClose(4000, generation);
        } else {
          setLoading(false);
        }
        return error;
      } finally {
        setIsPqSigning(false);
      }
    } else {
      setLoading(false);
      alert.error(t('send.enoughFunds'));
      if (isExternal) {
        if (!mountedRef.current || generation !== closeGenerationRef.current)
          return;
        await clearTransactionNavigationState();
        scheduleErrorClose(2000, generation);
      }
    }
  };

  const handleConfirm = async () => {
    if (!mountedRef.current || approvalActionRef.current !== 'ready') return;
    invalidatePendingClose();
    const generation = closeGenerationRef.current;
    approvalActionRef.current = 'submitting';
    setIsOpen(false);
    setOpenEditAllowanceModal(false);
    try {
      return await submitTransaction(generation);
    } catch (error: any) {
      // Preparation/cleanup failures must also settle the UI without an
      // uncaught promise or permanently disabling cancellation.
      if (mountedRef.current && generation === closeGenerationRef.current) {
        setLoading(false);
        setIsPqSigning(false);
        logError('preparation failed', 'Transaction', error);
        alert.error(
          t(
            error?.message === EVM_TRANSACTION_CONTEXT_CHANGED
              ? 'transactions.psbtSigningContextChanged'
              : 'send.cantCompleteTxs'
          )
        );
      }
    } finally {
      if (approvalActionRef.current === 'submitting')
        approvalActionRef.current = 'ready';
    }
  };

  const handleCancel = async () => {
    if (
      !mountedRef.current ||
      !['ready', 'outcome-unknown'].includes(approvalActionRef.current)
    )
      return;
    invalidatePendingClose();
    const generation = closeGenerationRef.current;
    approvalActionRef.current = 'dismissed';
    setClosing(true);
    try {
      await clearTransactionNavigationState();
    } catch (error) {
      console.error(
        '[SendTransaction] Failed to clear navigation state on cancel:',
        error
      );
    } finally {
      if (mountedRef.current && generation === closeGenerationRef.current) {
        if (isExternal) window.close();
        else navigate('/home');
      }
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;
    const generation = closeGenerationRef.current;
    let feeErrorCloseTimeout: ReturnType<typeof setTimeout> | null = null;

    const getGasAndFunction = async () => {
      try {
        if (hasInvalidCustomAllowance) {
          if (isMounted) setInitialLoading(false);
          return;
        }
        if (isSmartAccountApproval) setInitialLoading(true);
        // If ENS input and not resolved yet, don't call provider
        if (!toAddressForProvider && toRaw.toLowerCase().endsWith('.eth')) {
          return; // wait until resolvedTo is ready
        }
        await controllerEmitter(
          ['wallet', 'refreshActiveAccountBalances'],
          [
            {
              includeAssets: false,
              targetEvmTokenContractAddress: targetedErc20ContractAddress,
            },
          ]
        );
        if (
          isSmartAccountApproval &&
          customFee.isCustom &&
          !smartAccountFeeOverrides
        )
          throw new Error('Invalid smart account fee override');
        const {
          feeDetails,
          feeSafety,
          formTx,
          isInvalidTxData,
          gasLimitError,
          recommendationOnly,
        } = await fetchGasAndDecodeFunction(
          txForEstimation,
          activeNetwork,
          approvedContext,
          smartAccountFeeOverrides
        );

        // Only update state if component is still mounted
        if (isMounted) {
          setHasGasError(gasLimitError);
          setHasTxDataError(isInvalidTxData);
          setFee(feeDetails);
          quotedApprovalDataRef.current = txForEstimation.data;
          feeQuoteKeyRef.current = smartAccountQuoteKey;
          setFeeQuoteNeedsRefresh(false);
          setFeeSafetyAdjustment(feeSafety || {});
          setAcceptedDappFeeRequest(false);
          setFeeRecommendationOnly(Boolean(recommendationOnly));
          setTx(formTx);
          setInitialLoading(false);
        }
      } catch (e) {
        // Don't handle error if request was aborted
        if (e.name === 'AbortError') {
          return;
        }

        if (
          isMounted &&
          mountedRef.current &&
          generation === closeGenerationRef.current
        ) {
          setInitialLoading(false);
          logError('error getting fees', 'Transaction', e);
          alert.error(t('send.txWillFail'), e);
          await clearTransactionNavigationState();
          if (!isMounted) return;
          feeErrorCloseTimeout = scheduleErrorClose(3000, generation) ?? null;
        }
      }
    };

    // If the request used an ENS name that failed to resolve, skip gas estimation
    if (
      !(
        toRaw.toLowerCase().endsWith('.eth') &&
        !toAddressForProvider &&
        ensResolutionFailed
      )
    ) {
      getGasAndFunction();
    }

    return () => {
      isMounted = false;
      abortController.abort();
      if (
        feeErrorCloseTimeout !== null &&
        closeTimeoutRef.current === feeErrorCloseTimeout
      ) {
        clearTimeout(feeErrorCloseTimeout);
        closeTimeoutRef.current = null;
      }
    };
  }, [
    txForEstimation,
    hasInvalidCustomAllowance,
    toAddressForProvider,
    toRaw,
    activeNetwork.chainId,
    ensResolutionFailed,
    targetedErc20ContractAddress,
    isSmartAccountApproval,
    smartAccountFeeOverrides,
    smartAccountQuoteKey,
    feeQuoteRevision,
  ]); // ensure we wait for resolved address

  // Check for contract interaction with non-contract address
  useEffect(() => {
    const checkContract = async () => {
      // Only check once per transaction
      if (
        hasCheckedContract ||
        !toAddressForProvider ||
        !dataTx?.data ||
        isCheckingContract
      ) {
        return;
      }

      // Skip if no data or data is just '0x' (simple transfer)
      const hasCallData =
        dataTx.data && dataTx.data !== '0x' && dataTx.data.length > 2;
      if (!hasCallData) {
        return;
      }

      // Skip contract deployments (no 'to' address)
      if (
        !toAddressForProvider ||
        toAddressForProvider === '0x0000000000000000000000000000000000000000'
      ) {
        return;
      }

      setIsCheckingContract(true);

      try {
        // Check if address is a contract
        const isContract = await controllerEmitter(
          ['wallet', 'isContractAddress'],
          [toAddressForProvider]
        );

        // Show warning if sending call data to non-contract address
        if (!isContract) {
          setShowContractWarning(true);
        }
      } catch (error) {
        console.error('Error checking contract address:', error);
        // In case of error, don't show warning to avoid false positives
      } finally {
        setIsCheckingContract(false);
        setHasCheckedContract(true);
      }
    };

    if (
      !initialLoading &&
      (toAddressForProvider || !toRaw.toLowerCase().endsWith('.eth'))
    ) {
      checkContract();
    }
  }, [
    toAddressForProvider,
    toRaw,
    dataTx?.data,
    hasCheckedContract,
    initialLoading,
  ]);

  useEffect(() => {
    setValueAndCurrency(formattedValueAndCurrency);
  }, [formattedValueAndCurrency]);

  // Navigate when transaction is confirmed
  useEffect(() => {
    if (confirmed) {
      // Clear navigation state when actually navigating
      const cleanup = clearTransactionNavigationState().then(
        () => true,
        (error) => {
          console.error(
            '[SendTransaction] Failed to clear navigation state on success:',
            error
          );
          return false;
        }
      );

      if (isExternal) {
        // Show success toast
        alert.success(t('transactions.youCanCheckYour'));
        // Close window after showing success message
        const generation = closeGenerationRef.current;
        if (closeTimeoutRef.current !== null)
          clearTimeout(closeTimeoutRef.current);
        const timeout = setTimeout(async () => {
          if (
            !mountedRef.current ||
            generation !== closeGenerationRef.current ||
            closeTimeoutRef.current !== timeout ||
            approvalActionRef.current !== 'completed'
          )
            return;
          approvalActionRef.current = 'dismissed';
          closeTimeoutRef.current = null;
          if (!(await cleanup)) return;
          if (!mountedRef.current || generation !== closeGenerationRef.current)
            return;
          if (txResponse) {
            // Dispatch event right before closing
            dispatchBackgroundEvent(`${eventName}.${host}`, txResponse);
          }
          window.close();
        }, 2000);
        closeTimeoutRef.current = timeout;
      } else {
        // For internal navigation, navigate immediately
        // The loading spinner will disappear when component unmounts
        navigate('/home');
      }
    }
  }, [confirmed, alert, t, navigate, isExternal, txResponse, eventName, host]);

  // Fetch token info for approval transactions
  useEffect(() => {
    const scope = approvalMetadataScope;
    if (!scope.isApproval || !scope.contractAddress || !scope.isApprovedContext)
      return;
    let cancelled = false;
    const canApplyMetadata = () =>
      !cancelled &&
      currentApprovalMetadataScope.current === scope &&
      getApprovalWalletContextKey(store.getState()) === scope.walletContextKey;

    const getTokenInfo = async (contractAddress: string) => {
      try {
        if (scope.approvalType === 'erc20-amount') {
          // Fetch ERC-20 token info
          const tokenInfo = (await controllerEmitter(
            ['wallet', 'getERC20TokenInfo'],
            [contractAddress, scope.accountAddress, scope.approvedContext]
          )) as {
            balance: string;
            decimals: number;
            name: string;
            symbol: string;
          };

          // Preserve zero-decimal tokens; fallback to 18 only if missing/invalid
          const parsed = Number(tokenInfo.decimals);
          const safeDecimals =
            Number.isFinite(parsed) && parsed >= 0 ? parsed : 18;
          if (!canApplyMetadata()) return;
          setApprovalMetadata({
            scope,
            tokenInfo: {
              tokenSymbol: tokenInfo.symbol,
              tokenDecimals: safeDecimals,
            },
          });
        } else if (
          scope.approvalType === 'erc721-single' ||
          scope.approvalType === 'nft-all'
        ) {
          // Fetch NFT collection info
          const tokenDetails = (await controllerEmitter(
            ['wallet', 'getTokenDetails'],
            [contractAddress, scope.accountAddress, scope.approvedContext]
          )) as any;
          if (!canApplyMetadata()) return;
          // For single NFT approvals, try to get token metadata
          const tokenId =
            scope.approvalType === 'erc721-single' &&
            scope.decodedTx?.inputs?.[1]
              ? convertBigNumberToString(scope.decodedTx.inputs[1])
              : undefined;
          setApprovalMetadata({
            scope,
            tokenInfo: tokenDetails
              ? {
                  tokenSymbol: tokenDetails.symbol || 'NFT',
                  tokenDecimals: 0, // NFTs don't have decimals
                }
              : undefined,
            nftInfo: tokenId ? { tokenId } : undefined,
          });
        }
      } catch (error) {
        console.error('Failed to get token info:', error);
      }
    };

    getTokenInfo(scope.contractAddress);

    return () => {
      cancelled = true;
    };
  }, [approvalMetadataScope]);

  // The allowance editor accepts human-readable token units and is available
  // only for plain approve calls. Increment/decrement methods keep their
  // original calldata and cannot be rewritten through this state.
  useEffect(() => {
    if (!isApproval || !canEditCurrentApproval) {
      setCustomApprovedAllowanceAmount({
        isCustom: false,
        defaultAllowanceValue: '0',
        customAllowanceValue: null,
      });
      return;
    }

    if (approvedTokenInfos?.tokenDecimals === undefined) return;

    try {
      setCustomApprovedAllowanceAmount({
        isCustom: false,
        defaultAllowanceValue: formatApprovalTokenAmount(
          decodedTxData?.inputs?.[1],
          approvedTokenInfos.tokenDecimals
        ),
        customAllowanceValue: null,
      });
    } catch {
      setCustomApprovedAllowanceAmount({
        isCustom: false,
        defaultAllowanceValue: '0',
        customAllowanceValue: null,
      });
    }
  }, [
    isApproval,
    canEditCurrentApproval,
    decodedTxData?.inputs,
    approvedTokenInfos?.tokenDecimals,
  ]);

  const renderFeeNoticeText = (title: string, description: string) => (
    <>
      <p className="text-warning-info text-xs font-semibold mb-1">{t(title)}</p>
      <p className="text-warning-info text-xs leading-5">{t(description)}</p>
    </>
  );

  return (
    <>
      <EditPriorityModal
        showModal={isOpen}
        setIsOpen={updateFeeEditorOpen}
        customFee={customFee}
        setCustomFee={updateCustomFee}
        setHaveError={() => {
          // No-op function since haveError is not used
        }}
        fee={fee}
        estimatedFeeFloor={fee}
        isSendLegacyTransaction={isLegacyTransaction}
        defaultGasLimit={100000} // General transactions can vary widely
      />

      {canEditCurrentApproval &&
        approvedTokenInfos?.tokenDecimals !== undefined && (
          <EditApprovedAllowanceValueModal
            showModal={openEditAllowanceModal}
            host={host}
            approvedTokenInfos={approvedTokenInfos}
            customApprovedAllowanceAmount={customApprovedAllowanceAmount}
            setCustomApprovedAllowanceAmount={setCustomApprovedAllowanceAmount}
            setOpenEditFeeModal={setOpenEditAllowanceModal}
          />
        )}

      <WarningModal
        show={showContractWarning}
        onClose={() => setShowContractWarning(false)}
        title={t('send.potentialMistake')}
        description={t('send.contractDataToNonContract')}
        warningMessage={`${t('nftDetails.network')}: ${
          activeNetwork.label || activeNetwork.url
        }\n${t('send.address')}: ${ellipsis(dataTx?.to || '', 6, 4)}`}
        buttonText={t('settings.gotIt')}
      />

      {initialLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingComponent />
        </div>
      ) : tx?.from ? (
        <div className="flex flex-col w-full h-screen">
          <div className="flex-1 overflow-y-auto pb-20 remove-scrollbar">
            {isApproval ? (
              // Approval-specific UI
              <div className="flex flex-col items-center justify-center w-full divide-bkg-3 divide-dashed divide-y">
                <div className="pb-4 w-full">
                  <div className="flex flex-col gap-4 items-center justify-center w-full text-center text-brand-white font-poppins font-thin">
                    <div
                      className="mb-1.5 p-3 text-xs rounded-xl"
                      style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
                    >
                      <span className="text-sm font-medium font-thin">
                        {host}
                      </span>
                    </div>

                    {approvalType === 'erc20-amount' && (
                      <>
                        <span className="text-brand-white text-lg">
                          {t('send.grantAccess')}{' '}
                          <span className="text-brand-royalbluemedium font-semibold">
                            {approvedTokenInfos?.tokenSymbol ||
                              t('send.unknownToken', {
                                address: dataTx?.to?.slice(0, 8),
                                interpolation: { escapeValue: false },
                              })}
                          </span>
                        </span>
                      </>
                    )}

                    {approvalType === 'erc721-single' && (
                      <>
                        <span className="text-brand-white text-lg">
                          {t('send.approveNftTransfer')}
                        </span>
                        <span className="text-brand-graylight text-sm">
                          {t('send.allowTransferOf')}{' '}
                          {approvedTokenInfos?.tokenSymbol ||
                            t('send.unknownNft', {
                              address: dataTx?.to?.slice(0, 8),
                              interpolation: { escapeValue: false },
                            })}{' '}
                          #{nftInfo?.tokenId || '...'}
                        </span>
                      </>
                    )}

                    {approvalType === 'nft-all' && (
                      <>
                        <span className="text-brand-white text-lg">
                          {decodedTxData?.inputs?.[1]
                            ? t('send.grantCollectionAccess')
                            : t('send.revokeCollectionAccess')}
                        </span>
                        <span className="text-brand-graylight text-sm">
                          {decodedTxData?.inputs?.[1]
                            ? t('send.grantCollectionControl', {
                                token:
                                  approvedTokenInfos?.tokenSymbol ||
                                  tokenStandard,
                                interpolation: { escapeValue: false },
                              })
                            : t('send.revokeCollectionAccessDescription', {
                                token:
                                  approvedTokenInfos?.tokenSymbol ||
                                  tokenStandard,
                                interpolation: { escapeValue: false },
                              })}
                        </span>
                        {decodedTxData?.inputs?.[1] && (
                          <div className="mt-2 p-3 bg-red-900/20 border border-red-500 rounded-lg">
                            <span className="text-red-400 text-xs">
                              ⚠️ {t('send.warningCollectionControl')}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 items-center justify-center mt-4 w-full">
                    <ApprovalDetails
                      {...approvalDetails}
                      formattedAmount={displayedApprovalAmount}
                      isUnlimited={isUnlimitedApproval}
                      tokenSymbol={approvedTokenInfos?.tokenSymbol}
                    />

                    {canEditCurrentApproval &&
                      approvedTokenInfos?.tokenDecimals !== undefined && (
                        <div>
                          <button
                            type="button"
                            className="text-blue-300 text-sm"
                            disabled={loading || closing || confirmed}
                            onClick={() => {
                              if (
                                loading ||
                                closing ||
                                confirmed ||
                                approvalActionRef.current !== 'ready'
                              )
                                return;
                              setOpenEditAllowanceModal(true);
                            }}
                          >
                            {t('send.editPermission')}
                          </button>
                        </div>
                      )}

                    {approvalType === 'erc721-single' && (
                      <div className="mt-2 text-center">
                        <p className="text-brand-white text-sm">
                          {t('send.tokenId')}:{' '}
                          {nftInfo?.tokenId ||
                            convertBigNumberToString(
                              decodedTxData?.inputs?.[1]
                            )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              // Regular transaction UI
              <div className="flex flex-col items-center justify-center w-full text-center text-brand-white font-poppins ">
                <div className="flex flex-col items-center mb-6 text-center">
                  <div className="relative w-[50px] h-[50px] bg-brand-pink200 rounded-[100px] flex items-center justify-center mb-2">
                    <img
                      className="relative w-[30px] h-[30px]"
                      src={'/assets/all_assets/ArrowUp.svg'}
                      alt=""
                    />
                  </div>
                  <p className="text-brand-gray200 text-xs font-light">
                    {t('buttons.send')}
                  </p>
                  <p className="text-white text-base">{valueAndCurrency}</p>
                </div>

                <div className="py-2 text-white text-xs flex w-full justify-between border-b border-dashed border-alpha-whiteAlpha300">
                  <p>{t('components.local')}</p>
                  <p>{host}</p>
                </div>
                <div className="py-2 text-white text-xs flex w-full justify-between">
                  <p>{t('send.method')}</p>
                  <p>
                    {formatMethodName(
                      decodedTxData?.method || 'Contract Interaction',
                      activeNetwork.currency,
                      t
                    )}
                  </p>
                </div>

                {hasTxDataError && (
                  <span className="text-red-600 text-sm my-4">
                    {t('send.contractEstimateError')}
                  </span>
                )}

                {hasGasError && (
                  <span className="disabled text-xs my-4 text-center">
                    {t('send.rpcEstimateError')}
                  </span>
                )}
              </div>
            )}

            {(hasDappFeeSafetyAdjustment && !acceptedDappFeeRequest) ||
            isCurrentFeeBelowEstimate ? (
              <div className="w-full mt-4">
                {hasDappFeeSafetyAdjustment && !acceptedDappFeeRequest && (
                  <div className="rounded-xl border border-warning-info bg-warning-info bg-opacity-10 p-3 text-left">
                    {renderFeeNoticeText(
                      feeRecommendationOnly
                        ? 'send.feeBelowEstimateTitle'
                        : 'send.dappFeeRaisedTitle',
                      feeRecommendationOnly
                        ? 'send.customFeeBelowEstimateWarning'
                        : 'send.dappFeeRaisedDescription'
                    )}
                    <button
                      type="button"
                      className="mt-2 text-xs text-brand-white underline"
                      disabled={editingDisabled}
                      onClick={handleUseDappFeeRequest}
                    >
                      {t('send.useDappFeeRequest')}
                    </button>
                    {feeRecommendationOnly && (
                      <button
                        type="button"
                        className="mt-2 ml-3 text-xs text-brand-white underline"
                        disabled={editingDisabled}
                        onClick={handleUseNetworkFeeSuggestion}
                      >
                        {t('send.useNetworkFeeSuggestion')}
                      </button>
                    )}
                  </div>
                )}

                {isCurrentFeeBelowEstimate && (
                  <div className="mt-2 rounded-xl border border-warning-info bg-warning-info bg-opacity-10 p-3 text-left">
                    {renderFeeNoticeText(
                      'send.feeBelowEstimateTitle',
                      'send.customFeeBelowEstimateWarning'
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <div className="w-full mt-6">
              <div
                className="flex gap-2 flex-wrap text-center text-brand-white font-normal"
                id="tabExample"
                role="tablist"
              >
                {tabElements.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`${tab.id}-tab`}
                    aria-controls={tab.id}
                    aria-selected={tab.id === tabSelected}
                    tabIndex={tab.id === tabSelected ? 0 : -1}
                    className={`h-[40px] w-[92px] text-base font-normal cursor-pointer hover:opacity-60 rounded-t-[20px] py-[8px] px-[16px] ${
                      tab.id === tabSelected
                        ? 'bg-brand-blue600'
                        : 'bg-alpha-whiteAlpha200'
                    }`}
                    onClick={() => setTabSelected(tab.id)}
                    onKeyDown={handleTabKeyDown}
                  >
                    {t(`send.${tab.tabName.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>

            <div id="tabContentExample" className="flex flex-col w-full">
              {tabComponents.map((component) => (
                <div
                  key={component.id}
                  className={`${
                    component.id !== tabSelected
                      ? 'hidden'
                      : 'flex flex-col w-full justify-center items-center'
                  }`}
                  id={component.id}
                  role="tabpanel"
                  aria-labelledby={`${component.id}-tab`}
                >
                  {component.component === 'details' ? (
                    <TransactionDetailsComponent
                      tx={tx}
                      decodedTx={decodedTxData}
                      customNonce={customNonce}
                      editingDisabled={editingDisabled}
                      setCustomNonce={updateCustomNonce}
                      setCustomFee={updateCustomFee}
                      setHaveError={() => {
                        // No-op function since haveError is not used
                      }}
                      setFee={setFee}
                      fee={fee}
                      setIsOpen={updateFeeEditorOpen}
                      customFee={customFee}
                    />
                  ) : component.component === 'data' &&
                    effectiveApprovalData ? (
                    <TransactionDataComponent
                      decodedTx={effectiveApprovalData?.decodedTx}
                    />
                  ) : component.component === 'hex' && effectiveApprovalData ? (
                    <TransactionHexComponent
                      dataHex={effectiveApprovalData?.data}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* Fixed button container at bottom */}
          <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <DeviceWaitingBanner account={activeAccount} show={loading} />
            <PqSigningOverlay
              expectedSeconds={90}
              show={isPqSigning}
              subtitle={t('settings.slhDsaSigningOverlayDescription')}
              title={t('settings.slhDsaSigningInProgress')}
              warningSeconds={180}
            />
            {hasTxDataError && (
              <p className="text-center text-warning-error text-xs mb-2">
                {t('send.contractEstimateError')}
              </p>
            )}
            {(hasInvalidApprovalDetails || hasInvalidCustomAllowance) && (
              <p className="text-center text-warning-error text-xs mb-2">
                {t('send.invalidApprovalDetails')}
              </p>
            )}
            {!hasInvalidCustomAllowance && !hasCurrentApprovalDataQuote && (
              <p className="text-center text-xs mb-2">
                {t('send.calculating')}
              </p>
            )}
            {feeQuoteNeedsRefresh && (
              <div className="text-center text-warning-info text-xs mb-2">
                <p>{t('send.smartAccountFeeQuoteChanged')}</p>
                <Button
                  type="button"
                  onClick={() =>
                    setFeeQuoteRevision((revision) => revision + 1)
                  }
                >
                  {t('send.refreshFeeQuote')}
                </Button>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <Button
                variant="secondary"
                type="button"
                disabled={
                  closing || confirmed || (loading && !submissionUnknown)
                }
                onClick={handleCancel}
              >
                {t('buttons.cancel')}
              </Button>

              <Button
                variant="primary"
                type="button"
                loading={loading}
                disabled={
                  closing ||
                  confirmed ||
                  submissionUnknown ||
                  !hasCurrentSmartAccountFeeQuote ||
                  !hasCurrentApprovalDataQuote ||
                  hasTxDataError ||
                  hasInvalidApprovalDetails ||
                  hasInvalidCustomAllowance
                }
                onClick={handleConfirm}
              >
                {t('buttons.confirm')}
              </Button>
            </div>
          </ToastActionFooter>
        </div>
      ) : // Render a clear error state when ENS couldn't be resolved
      ensResolutionFailed ? (
        <div className="flex w-full flex-col pb-24">
          <div className="flex flex-1 items-center justify-center px-6 py-6 text-center">
            <div className="bg-bkg-2 border border-bkg-4 rounded-2xl p-4 max-w-md w-full">
              <p className="text-white text-sm mb-2">
                {t('send.unableToResolveEns')}
              </p>
              <p className="text-brand-gray200 text-xs">
                {t('send.verifyEnsOrUseAddress')}
              </p>
            </div>
          </div>
          <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 z-50">
            <Button
              variant="secondary"
              type="button"
              disabled={closing}
              onClick={handleCancel}
            >
              {t('buttons.cancel')}
            </Button>
          </ToastActionFooter>
        </div>
      ) : null}
    </>
  );
};
