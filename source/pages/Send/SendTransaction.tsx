import { Interface } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { parseUnits, formatEther } from '@ethersproject/units';
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  IconButton,
  WarningModal,
  Tooltip,
} from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
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
import { convertBigNumberToString } from 'utils/bigNumberUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { handleTransactionError } from 'utils/errorHandling';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { ellipsis } from 'utils/format';
import { logError } from 'utils/logger';
import { clearNavigationState } from 'utils/navigationState';
import removeScientificNotation from 'utils/removeScientificNotation';
import { safeBigNumber } from 'utils/safeBigNumber';
import { safeToFixed } from 'utils/safeToFixed';
import { omitTransactionObjectData } from 'utils/transactions';
import { validateTransactionDataValue } from 'utils/validateTransactionDataValue';
import { getErc20Abi } from 'utils/validations';

import {
  TransactionDetailsComponent,
  TransactionDataComponent,
  TransactionHexComponent,
} from './components';
import { EditApprovedAllowanceValueModal } from './EditApprovedAllowanceValueModal';
import { EditPriorityModal } from './EditPriority';
import { tabComponents, tabElements } from './mockedComponentsData/mockedTabs';

export const SendTransaction = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { navigate, alert, useCopyClipboard } = useUtils();
  const [copied, copy] = useCopyClipboard();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();

  const { host, eventName, ...externalTx } = useQueryData();

  const isExternal = Boolean(externalTx.external);
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
    explicitType === '0x0';
  const isApproval = txMetadata.isApproval || false;
  const approvalType = txMetadata.approvalType;
  const tokenStandard = txMetadata.tokenStandard;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>();
  const [txResponse, setTxResponse] = useState<string | null>(null);
  const [customNonce, setCustomNonce] = useState<number>();
  const [tabSelected, setTabSelected] = useState<string>(tabElements[0].id);
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

  // Approval-specific state
  const [approvedTokenInfos, setApprovedTokenInfos] =
    useState<IApprovedTokenInfos>();
  const [customApprovedAllowanceAmount, setCustomApprovedAllowanceAmount] =
    useState<ICustomApprovedAllowanceAmount>({
      isCustom: false,
      defaultAllowanceValue: 0,
      customAllowanceValue: null,
    });
  const [openEditAllowanceModal, setOpenEditAllowanceModal] =
    useState<boolean>(false);

  // NFT-specific state for approvals
  const [nftInfo, setNftInfo] = useState<{
    name?: string;
    tokenId?: string;
    tokenUri?: string;
  }>();

  // Contract warning state
  const [showContractWarning, setShowContractWarning] =
    useState<boolean>(false);
  const [isCheckingContract, setIsCheckingContract] = useState<boolean>(false);
  const [hasCheckedContract, setHasCheckedContract] = useState<boolean>(false);

  const formattedValueAndCurrency = useMemo(() => {
    if (!tx?.value) return `0 ${activeNetwork.currency?.toUpperCase()}`;

    try {
      // Use formatEther to properly handle wei values without precision loss
      const ethValue = formatEther(
        BigNumber.isBigNumber(tx.value) ? tx.value : BigNumber.from(tx.value)
      );
      return `${removeScientificNotation(
        Number(ethValue)
      )} ${activeNetwork.currency?.toUpperCase()}`;
    } catch (error) {
      console.error('Error formatting value:', error);
      return `0 ${activeNetwork.currency?.toUpperCase()}`;
    }
  }, [tx?.value, activeNetwork.currency]);

  const omitTransactionObject = omitTransactionObjectData(dataTx, ['type']);

  // Raw input 'to' (could be ENS or address)
  const toRaw = String(dataTx?.to || '');

  // Memoize the validated transaction to prevent unnecessary re-renders
  const validatedDataTxWithoutType = useMemo(
    () => ({
      ...omitTransactionObject,
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
    ]
  );

  // ENS handling: display and resolution
  const ensCache = useSelector((s: RootState) => s.vaultGlobal.ensCache);
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

  // Clone tx for estimation with resolved address
  const txForEstimation = useMemo(
    () =>
      ({
        ...validatedDataTxWithoutType,
        to: toAddressForProvider || undefined,
      } as ITransactionParams),
    [validatedDataTxWithoutType, toAddressForProvider]
  );
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

  const displayToLabel = useMemo(() => {
    if (toRaw.toLowerCase().endsWith('.eth')) return toRaw; // show the ENS input
    const cachedName = ensCache?.[toRaw.toLowerCase()]?.name;
    return cachedName || toRaw;
  }, [toRaw, ensCache]);

  // Lazy reverse-resolve for address input -> show ENS name if available later
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!toRaw || !toRaw.startsWith('0x')) return;
      const cachedName = ensCache?.[toRaw.toLowerCase()]?.name;
      if (cachedName) return;
      try {
        await controllerEmitter(['wallet', 'reverseResolveEns'], [toRaw]);
        if (!cancelled) {
          // ensCache will update via store; label will re-render from selector
        }
      } catch {}
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [toRaw, ensCache]);

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      let txToSend = tx;

      // Handle approval-specific data encoding
      if (
        isApproval &&
        approvalType === 'erc20-amount' &&
        customApprovedAllowanceAmount.isCustom
      ) {
        // Ensure we have token info
        if (
          !approvedTokenInfos ||
          approvedTokenInfos.tokenDecimals === undefined
        ) {
          alert.error(
            'Token information not loaded. Please wait and try again.'
          );
          setLoading(false);
          return;
        }

        // Only encode custom amount for ERC-20 approvals
        const abi = await getErc20Abi();
        const erc20AbiInstance = new Interface(abi);

        // Parse the custom allowance amount consistently as human-readable token units
        let parsedAmount;
        try {
          const customValue = String(
            customApprovedAllowanceAmount.customAllowanceValue
          );
          const decimals = approvedTokenInfos?.tokenDecimals ?? 18;
          parsedAmount = parseUnits(customValue, decimals);
        } catch (parseError) {
          console.error('Error parsing amount:', parseError);
          alert.error('Invalid amount format. Please enter a valid number.');
          setLoading(false);
          return;
        }

        const encodedDataWithCustomValue = erc20AbiInstance.encodeFunctionData(
          'approve',
          [decodedTxData?.inputs[0], parsedAmount]
        );

        txToSend = { ...tx, data: encodedDataWithCustomValue };
      }
      // For NFT approvals, the transaction data remains unchanged

      try {
        let response;

        if (isLegacyTransaction) {
          // Legacy transaction handling - MUST remove all EIP-1559 fields
          const txWithoutType = omitTransactionObjectData(txToSend, [
            'type',
            'maxFeePerGas',
            'maxPriorityFeePerGas',
          ]) as ITxState;

          const getLegacyGasFee = Boolean(
            customFee.isCustom && customFee.gasPrice > 0
          )
            ? parseUnits(safeToFixed(customFee.gasPrice), 9) // Convert Gwei to Wei using parseUnits with proper decimal handling
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
            nonce: customNonce,
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

          response = await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [baseLegacyTx, isLegacyTransaction],
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
            nonce: customNonce,
            maxPriorityFeePerGas: Boolean(
              customFee.isCustom && customFee.maxPriorityFeePerGas > 0
            )
              ? parseUnits(safeToFixed(customFee.maxPriorityFeePerGas), 9)
              : tx.maxPriorityFeePerGas &&
                BigNumber.isBigNumber(tx.maxPriorityFeePerGas)
              ? tx.maxPriorityFeePerGas // Use the BigNumber from tx
              : parseUnits(safeToFixed(fee.maxPriorityFeePerGas), 9), // Fallback to fee
            maxFeePerGas: Boolean(
              customFee.isCustom && customFee.maxFeePerGas > 0
            )
              ? parseUnits(safeToFixed(customFee.maxFeePerGas), 9)
              : tx.maxFeePerGas && BigNumber.isBigNumber(tx.maxFeePerGas)
              ? tx.maxFeePerGas // Use the BigNumber from tx
              : parseUnits(safeToFixed(fee.maxFeePerGas), 9), // Fallback to fee
            gasLimit: Boolean(
              customFee.isCustom && customFee.gasLimit && customFee.gasLimit > 0
            )
              ? BigNumber.from(customFee.gasLimit)
              : tx.gasLimit && BigNumber.isBigNumber(tx.gasLimit)
              ? tx.gasLimit // Use the BigNumber from tx
              : BigNumber.from(fee.gasLimit || 42000), // Fallback to fee
            ...(toField ? { to: toField } : {}),
          };

          response = await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              base1559Tx,
              false, // isLegacy = false for EIP-1559
            ],
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          );
        }

        setConfirmed(true);

        // Store the response data for dispatch later
        if (isExternal) {
          setTxResponse(response.hash);
        }
        // Don't set loading to false here - let the navigation effect handle it
        return response.hash;
      } catch (error: any) {
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
        alert.error(t('send.cantCompleteTxs'));

        if (isExternal) {
          clearNavigationState();
          setTimeout(window.close, 4000);
        } else {
          setLoading(false);
        }
        return error;
      }
    } else {
      alert.error(t('send.enoughFunds'));
      if (isExternal) {
        clearNavigationState();
        setTimeout(window.close, 2000);
      }
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;
    let closeTimeoutId: NodeJS.Timeout | null = null;

    const getGasAndFunction = async () => {
      try {
        // If ENS input and not resolved yet, don't call provider
        if (!toAddressForProvider && toRaw.toLowerCase().endsWith('.eth')) {
          return; // wait until resolvedTo is ready
        }
        const { feeDetails, formTx, nonce, isInvalidTxData, gasLimitError } =
          await fetchGasAndDecodeFunction(txForEstimation, activeNetwork);

        // Only update state if component is still mounted
        if (isMounted) {
          setHasGasError(gasLimitError);
          setHasTxDataError(isInvalidTxData);
          setFee(feeDetails);
          setTx(formTx);
          setCustomNonce(nonce);
          setInitialLoading(false);
        }
      } catch (e) {
        // Don't handle error if request was aborted
        if (e.name === 'AbortError') {
          return;
        }

        if (isMounted) {
          setInitialLoading(false);
          logError('error getting fees', 'Transaction', e);
          alert.error(t('send.txWillFail'), e);
          clearNavigationState();
          closeTimeoutId = setTimeout(window.close, 3000);
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
      if (closeTimeoutId) {
        clearTimeout(closeTimeoutId);
      }
    };
  }, [
    txForEstimation,
    toAddressForProvider,
    toRaw,
    activeNetwork.chainId,
    ensResolutionFailed,
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
      clearNavigationState();

      if (isExternal) {
        // Show success toast
        alert.success(t('transactions.youCanCheckYour'));
        // Close window after showing success message
        setTimeout(() => {
          if (txResponse) {
            // Dispatch event right before closing
            dispatchBackgroundEvent(`${eventName}.${host}`, txResponse);
          }
          window.close();
        }, 2000);
      } else {
        // For internal navigation, navigate immediately
        // The loading spinner will disappear when component unmounts
        navigate('/home');
      }
    }
  }, [confirmed, alert, t, navigate, isExternal, txResponse, eventName, host]);

  // Handle copy success message
  useEffect(() => {
    if (!copied) return;
    alert.success(t('home.addressCopied'));
  }, [copied, alert, t]);

  // Fetch token info for approval transactions
  useEffect(() => {
    if (!isApproval || !dataTx?.to) return;

    const abortController = new AbortController();

    const getTokenInfo = async (contractAddress: string) => {
      try {
        if (approvalType === 'erc20-amount') {
          // Fetch ERC-20 token info
          const tokenInfo = (await controllerEmitter(
            ['wallet', 'getERC20TokenInfo'],
            [contractAddress, activeAccount.address]
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
          setApprovedTokenInfos({
            tokenSymbol: tokenInfo.symbol,
            tokenDecimals: safeDecimals,
          });
        } else if (
          approvalType === 'erc721-single' ||
          approvalType === 'nft-all'
        ) {
          // Fetch NFT collection info
          const tokenDetails = (await controllerEmitter(
            ['wallet', 'getTokenDetails'],
            [contractAddress, activeAccount.address]
          )) as any;

          if (tokenDetails) {
            setApprovedTokenInfos({
              tokenSymbol: tokenDetails.symbol || 'NFT',
              tokenDecimals: 0, // NFTs don't have decimals
            });
          }

          // For single NFT approvals, try to get token metadata
          if (approvalType === 'erc721-single' && decodedTxData?.inputs?.[1]) {
            const tokenIdString = convertBigNumberToString(
              decodedTxData.inputs[1]
            );
            setNftInfo({ tokenId: tokenIdString });
            // TODO: Fetch token URI and metadata if needed
          }
        }
      } catch (error) {
        console.error('Failed to get token info:', error);
      }
    };

    getTokenInfo(dataTx.to);

    return () => {
      abortController.abort();
    };
  }, [
    isApproval,
    approvalType,
    dataTx?.to,
    activeAccount.address,
    decodedTxData,
  ]);

  // Calculate default allowance value for ERC-20 approvals
  useMemo(() => {
    if (
      !isApproval ||
      approvalType !== 'erc20-amount' ||
      !decodedTxData ||
      !approvedTokenInfos?.tokenDecimals
    )
      return;

    // inputs[1] is the decoded amount (could be BigNumber, string, or object with _hex property)
    const rawAmount = decodedTxData?.inputs?.[1];
    if (!rawAmount) return;

    let amountString;

    // Handle different types of amount values
    if (rawAmount._isBigNumber || rawAmount._hex) {
      // It's an ethers BigNumber object
      amountString = BigNumber.from(rawAmount).toString();
    } else if (typeof rawAmount === 'object' && rawAmount.hex) {
      // It's an object with hex property
      amountString = BigNumber.from(rawAmount.hex).toString();
    } else if (typeof rawAmount === 'object' && rawAmount.toString) {
      // It's some other object with toString method
      amountString = rawAmount.toString();
    } else {
      // It's already a string or number
      amountString = String(rawAmount);
    }

    // Keep the raw amount as-is (already in smallest unit)
    const calculatedAllowanceValue = amountString;

    setCustomApprovedAllowanceAmount({
      isCustom: false,
      defaultAllowanceValue: calculatedAllowanceValue,
      customAllowanceValue: null,
    });
  }, [
    isApproval,
    approvalType,
    decodedTxData,
    approvedTokenInfos?.tokenDecimals,
  ]);

  return (
    <>
      <EditPriorityModal
        showModal={isOpen}
        setIsOpen={setIsOpen}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={() => {
          // No-op function since haveError is not used
        }}
        fee={fee}
        isSendLegacyTransaction={isLegacyTransaction}
        defaultGasLimit={100000} // General transactions can vary widely
      />

      {approvalType === 'erc20-amount' && (
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
                          <span className="text-brand-royalblue font-semibold">
                            {approvedTokenInfos?.tokenSymbol ||
                              `Unknown Token (${dataTx?.to?.slice(0, 8)}...)`}
                          </span>
                        </span>
                        <span className="text-brand-graylight text-sm">
                          {t('send.byGrantingPermission')}
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
                            `Unknown NFT (${dataTx?.to?.slice(0, 8)}...)`}{' '}
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
                            ? `${t('send.grantCompleteControl')} ${
                                approvedTokenInfos?.tokenSymbol || tokenStandard
                              } tokens`
                            : `${t('send.revokeAccessTo')} ${
                                approvedTokenInfos?.tokenSymbol || tokenStandard
                              } collection`}
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
                    <div
                      className="flex items-center justify-around mt-1 p-3 w-full text-xs rounded-xl"
                      style={{
                        backgroundColor: 'rgba(22, 39, 66, 1)',
                        maxWidth: '150px',
                      }}
                    >
                      <Tooltip
                        content={
                          resolvedTo || (toRaw.startsWith('0x') ? toRaw : '')
                        }
                      >
                        <span>{ellipsis(displayToLabel)}</span>
                      </Tooltip>
                      <IconButton onClick={() => copy(resolvedTo || toRaw)}>
                        <Icon
                          name="copy"
                          className="text-brand-white hover:text-fields-input-borderfocus"
                          wrapperClassname="flex items-center justify-center"
                        />
                      </IconButton>
                    </div>

                    {approvalType === 'erc20-amount' && (
                      <div>
                        <button
                          type="button"
                          className="text-blue-300 text-sm"
                          onClick={() => setOpenEditAllowanceModal(true)}
                        >
                          {t('send.editPermission')}
                        </button>
                      </div>
                    )}

                    {(approvalType === 'erc721-single' ||
                      approvalType === 'nft-all') && (
                      <div className="mt-2 text-center">
                        <p className="text-brand-white text-sm">
                          {approvalType === 'erc721-single'
                            ? `Token ID: ${
                                nftInfo?.tokenId ||
                                convertBigNumberToString(
                                  decodedTxData?.inputs?.[1]
                                )
                              }`
                            : `Operator: ${ellipsis(
                                decodedTxData?.inputs?.[0] || ''
                              )}`}
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
                      alt="Icon"
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
                  <p>{decodedTxData?.method}</p>
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

            <div className="w-full mt-6">
              <ul
                className="flex gap-2 flex-wrap text-center text-brand-white font-normal"
                id="tabExample"
                role="tablist"
              >
                {tabElements.map((tab) => (
                  <li
                    className={`h-[40px] w-[92px] text-base font-normal cursor-pointer hover:opacity-60 ${
                      tab.id === tabSelected
                        ? 'bg-brand-blue600 rounded-t-[20px] py-[8px] px-[16px] '
                        : 'bg-alpha-whiteAlpha200 rounded-t-[20px] py-[8px] px-[16px] '
                    }`}
                    role="presentation"
                    key={tab.id}
                    onClick={() => setTabSelected(tab.id)}
                  >
                    {t(`send.${tab.tabName.toLowerCase()}`)}
                  </li>
                ))}
              </ul>
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
                >
                  {component.component === 'details' ? (
                    <TransactionDetailsComponent
                      tx={tx}
                      decodedTx={decodedTxData}
                      setCustomNonce={setCustomNonce}
                      setCustomFee={setCustomFee}
                      setHaveError={() => {
                        // No-op function since haveError is not used
                      }}
                      setFee={setFee}
                      fee={fee}
                      setIsOpen={setIsOpen}
                      customFee={customFee}
                    />
                  ) : component.component === 'data' ? (
                    <TransactionDataComponent decodedTx={decodedTxData} />
                  ) : component.component === 'hex' ? (
                    <TransactionHexComponent
                      methodName={decodedTxData.method}
                      dataHex={validatedDataTxWithoutType.data}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* Fixed button container at bottom */}
          <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <div className="flex gap-3 justify-center">
              <SecondaryButton
                type="button"
                disabled={loading}
                onClick={async () => {
                  // Clear navigation state when user cancels/goes away
                  await clearNavigationState();
                  if (isExternal) {
                    window.close();
                  } else {
                    navigate('/home');
                  }
                }}
              >
                {t('buttons.cancel')}
              </SecondaryButton>

              <PrimaryButton
                type="button"
                loading={loading}
                onClick={handleConfirm}
              >
                {t('buttons.confirm')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : // Render a clear error state when ENS couldn't be resolved
      ensResolutionFailed ? (
        <div className="flex items-center justify-center min-h-[400px] px-6 text-center">
          <div className="bg-bkg-2 border border-bkg-4 rounded-2xl p-4 max-w-md w-full">
            <p className="text-white text-sm mb-2">
              {t('send.unableToResolveEns')}
            </p>
            <p className="text-brand-gray200 text-xs">
              {t('send.verifyEnsOrUseAddress')}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
};
