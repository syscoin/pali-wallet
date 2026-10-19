import { Switch, Menu } from '@headlessui/react';
import { Form, Input } from 'antd';
import { toSvg } from 'jdenticon';
import * as React from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

//todo: update with the new function

import { TransactionType } from '../../types/transactions';
import { PaliWhiteSmallIconSvg, ArrowDownSvg } from 'components/Icon/Icon';
import { Button, Fee, Icon, Tooltip } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useRequestScope } from 'hooks/useRequestScope';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { INetworkType } from 'types/network';
import { ITokenSysProps } from 'types/tokens';
import { handleTransactionError } from 'utils/errorHandling';
import { parseUnits } from 'utils/ethersV6Compat';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';
import {
  isNFT,
  getAssetBalance,
  ellipsis,
  MINIMUM_FEE,
  adjustUrl,
  createNavigationContext,
  navigateWithContext,
  getWalletNavigationScope,
  removeScientificNotation,
} from 'utils/index';
import {
  assertValidAssetAmount,
  isAssetAmountEqualToBalance,
  isAssetAmountWithinBalance,
  toEightDecimalBuilderAmount,
} from 'utils/syscoinAssetAmount';
import { getRefreshedSyscoinAssetSelection } from 'utils/syscoinAssetSelection';
import { sanitizeErrorMessage } from 'utils/syscoinErrorSanitizer';
import { isValidSYSAddress } from 'utils/validations';

import {
  getScopedSendDraft,
  useSendDraftWriter,
  useSendPreparationGuard,
} from './useSendDraftWriter';

const nativeAtomicAmount = (value: unknown) =>
  parseUnits(String(removeScientificNotation(String(value))), 8);

export const SendSys = () => {
  const scopeKey = useSelector(() =>
    JSON.stringify(getWalletNavigationScope())
  );
  return <SendSysForm key={scopeKey} scopeKey={scopeKey} />;
};

const SendSysForm = ({ scopeKey }: { scopeKey: string }) => {
  const {
    controllerEmitter,
    isUnlocked,
    isLoading: controllerLoading,
    connectionUnavailable,
  } = useController();
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const location = useLocation();
  const isCurrentForm = useSendPreparationGuard(scopeKey, location.pathname);
  const beginAddressCopy = useRequestScope(scopeKey);

  const { account: activeAccount, assets: accountAssets } = useSelector(
    selectActiveAccountWithAssets
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  // Hydrate only the matching account/network draft, once for this mounted form.
  const scopedDraft = getScopedSendDraft(
    location.pathname,
    location.state,
    scopeKey
  );
  // Incomplete or foreign token drafts are disposable. Drop the entire draft:
  // retaining its amount/MAX would reinterpret it as a native send.
  const initialDraft = useRef(
    scopedDraft.selectedAsset &&
      scopedDraft.selectedAsset.chainId !== activeNetwork.chainId
      ? {}
      : scopedDraft
  ).current;
  const initialRBF =
    typeof initialDraft.RBF === 'boolean' ? initialDraft.RBF : true;
  const [RBF, setRBF] = useState<boolean>(initialRBF);
  const initialSelectedAsset = initialDraft.selectedAsset || null;
  // Restore asset MAX only when the saved amount exactly matches its balance.
  const initialIsMaxSend =
    initialDraft.isMaxSend === true &&
    (!initialSelectedAsset ||
      isAssetAmountEqualToBalance(
        String(initialDraft.formValues?.amount ?? ''),
        String(initialSelectedAsset.balance ?? '0'),
        initialSelectedAsset.decimals ?? 8
      ));

  const [selectedAsset, setSelectedAsset] = useState<ITokenSysProps | null>(
    initialSelectedAsset
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isMaxSend, setIsMaxSend] = useState<boolean>(initialIsMaxSend);
  // Only explicit native MAX intent follows balance refreshes. A manually
  // entered amount remains fixed, even when it happened to equal the balance.
  const nativeMaxIntent = useRef(initialIsMaxSend && !initialSelectedAsset);
  // A delayed asset-MAX restoration cannot override a later explicit choice.
  const maxIntentRevision = useRef(0);

  const [form] = Form.useForm();

  // Fee rate will be managed by the Fee component
  const [feeRate, setFeeRate] = useState<number | null>(() => {
    const restored = Number(initialDraft.formValues?.fee);
    return Number.isFinite(restored) && restored > 0 ? restored : null;
  });
  const feeWasChosen = useRef(
    Object.prototype.hasOwnProperty.call(initialDraft.formValues || {}, 'fee')
  );

  // Track form value changes using a ref to avoid dependency issues
  const formValuesRef = useRef<any>(initialDraft.formValues || {});

  useEffect(() => {
    const refreshBalances = async () => {
      try {
        await controllerEmitter(
          ['wallet', 'refreshActiveAccountBalances'],
          [{ includeAssets: true }]
        );
      } catch (error) {
        console.error('Failed to refresh send balances:', error);
      }
    };

    refreshBalances();
  }, [activeAccount?.address, activeNetwork.chainId]);

  useEffect(() => {
    if (!selectedAsset || !accountAssets?.syscoin) return;

    const refreshedAsset = getRefreshedSyscoinAssetSelection(
      selectedAsset,
      accountAssets.syscoin,
      activeNetwork.chainId
    );

    if (refreshedAsset) {
      setSelectedAsset(refreshedAsset);
    }
  }, [accountAssets?.syscoin, activeNetwork.chainId, selectedAsset]);

  const draftState = useMemo(
    () => ({ selectedAsset, RBF, isMaxSend }),
    [selectedAsset, RBF, isMaxSend]
  );
  const nativeBalance = activeAccount?.balances[INetworkType.Syscoin] || '0';
  const preparationOptions = useRef({
    selectedAsset,
    RBF,
    feeRate,
    nativeBalance,
  });
  preparationOptions.current = { selectedAsset, RBF, feeRate, nativeBalance };
  const saveCurrentState = useSendDraftWriter({
    form,
    location,
    navigate,
    scopeKey,
    state: draftState,
    enabled: isUnlocked && !controllerLoading && !connectionUnavailable,
  });

  // Save typed values immediately, including before blur or a quick popup close.
  const handleFormValuesChange = useCallback(
    (changedValues: any, allValues: any) => {
      if (Object.prototype.hasOwnProperty.call(changedValues, 'fee')) {
        feeWasChosen.current = true;
      }
      if (Object.prototype.hasOwnProperty.call(changedValues, 'amount')) {
        nativeMaxIntent.current = false;
        maxIntentRevision.current += 1;
      }
      formValuesRef.current = allValues;
      void saveCurrentState(allValues);
    },
    [saveCurrentState]
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

  // Track if we've already restored form values to prevent duplicate restoration
  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);

  // ✅ MEMOIZED: Callbacks to prevent unnecessary re-renders
  const handleFeeChange = useCallback((newFee: number) => {
    feeWasChosen.current = true;
    setFeeRate(newFee);

    // If in MAX send mode, recalculate the amount
    // For UTXO, the backend handles fee subtraction for MAX sends
    // So we keep the full balance in the amount field
    // The isMaxSend flag tells the backend to subtract fees
  }, []);

  // ✅ OPTIMIZED: Fee fetching with proper dependencies
  useEffect(() => {
    const canApplyRecommendation = () =>
      isCurrentForm() &&
      !feeWasChosen.current &&
      form.getFieldValue('fee') === undefined;
    const fetchInitialFee = async () => {
      try {
        const fee = (await controllerEmitter(
          ['wallet', 'getRecommendedFee'],
          []
        )) as number;
        if (!canApplyRecommendation()) return;
        setFeeRate(fee);
        form.setFieldsValue({ fee });
      } catch (error) {
        if (!canApplyRecommendation()) return;
        console.error('Failed to fetch initial fee:', error);
        const fallbackFee = 0.0000001;
        setFeeRate(fallbackFee);
        form.setFieldsValue({ fee: fallbackFee });
      }
    };
    fetchInitialFee();
  }, [activeNetwork.chainId, form, isCurrentForm]);

  // ✅ MEMOIZED: Computed values
  const isAccountImported = useMemo(
    () => activeAccount?.isImported,
    [activeAccount?.isImported]
  );

  const assets = useMemo(
    () =>
      (accountAssets.syscoin || []).filter(
        (asset) => asset.chainId === activeNetwork.chainId
      ),
    [accountAssets.syscoin, activeNetwork.chainId]
  );

  const assetDecimals = useMemo(
    () => selectedAsset?.decimals ?? 8,
    [selectedAsset?.decimals]
  );

  // Keep balance as string to preserve precision
  const balanceStr = useMemo(
    () =>
      selectedAsset
        ? String(selectedAsset.balance ?? '0')
        : activeAccount?.balances[INetworkType.Syscoin] || '0',
    [selectedAsset, activeAccount?.balances]
  );
  const maxSelection = useRef({ balanceStr, selectedAsset });
  maxSelection.current = { balanceStr, selectedAsset };

  const handleMaxButton = useCallback(() => {
    if (!isCurrentForm()) return;
    maxIntentRevision.current += 1;
    const current = maxSelection.current;
    nativeMaxIntent.current = !current.selectedAsset;
    // Simply fill in the full balance
    form.setFieldValue('amount', current.balanceStr);
    setIsMaxSend(true);
    // Validation still updates the field error; an invalid zero/unknown balance
    // is not an unhandled asynchronous failure of this click handler.
    void form.validateFields(['amount']).catch(() => undefined);
  }, [form, isCurrentForm]);

  // Restore form values if coming back from navigation
  useEffect(() => {
    if (!hasRestoredRef.current) {
      hasRestoredRef.current = true;
      const { formValues } = initialDraft;

      if (formValues) {
        isRestoringRef.current = true;
        hasRestoredRef.current = true;
        form.setFieldsValue(formValues);
        // Also update the ref to keep it in sync
        formValuesRef.current = formValues;

        // Native MAX rebases in the balance effect below. Asset MAX retains its
        // existing deferred restoration once the form is initialized.
        if (initialIsMaxSend && initialSelectedAsset) {
          const restoredRevision = maxIntentRevision.current;
          // Add a small delay to ensure form is fully initialized
          const timer = setTimeout(() => {
            if (
              !isCurrentForm() ||
              maxIntentRevision.current !== restoredRevision
            ) {
              isRestoringRef.current = false;
              return;
            }
            handleMaxButton();
            isRestoringRef.current = false;
          }, 100);
          return () => {
            clearTimeout(timer);
            isRestoringRef.current = false;
          };
        } else {
          isRestoringRef.current = false;
        }
      }

      // Do NOT clear the navigation state here - we need it to persist
      // for when the popup is closed and reopened
    }
  }, [
    initialDraft,
    initialIsMaxSend,
    initialSelectedAsset,
    form,
    handleMaxButton,
    isCurrentForm,
  ]);

  // Watch the amount field for changes
  const watchedAmount = Form.useWatch('amount', form);

  // Rebase explicit native MAX before rechecking asset equality. The amount change
  // also invalidates any unsigned preparation started with the old balance.
  useEffect(() => {
    if (!isCurrentForm()) return;
    if (selectedAsset) nativeMaxIntent.current = false;
    if (nativeMaxIntent.current) {
      if (String(form.getFieldValue('amount')) !== String(balanceStr)) {
        form.setFieldValue('amount', balanceStr);
        formValuesRef.current = form.getFieldsValue();
        void saveCurrentState(formValuesRef.current);
        void form.validateFields(['amount']).catch(() => undefined);
      }
      setIsMaxSend(true);
      return;
    }

    if (watchedAmount !== undefined && watchedAmount !== null) {
      const inputAmount = String(watchedAmount).trim();

      if (inputAmount && balanceStr) {
        try {
          if (selectedAsset) {
            setIsMaxSend(
              isAssetAmountEqualToBalance(
                inputAmount,
                String(balanceStr),
                assetDecimals
              )
            );
          } else {
            // A manually entered full-balance amount can still subtract fees
            // at submission, but must not become live MAX intent in its draft.
            setIsMaxSend(false);
          }
        } catch {
          setIsMaxSend(false);
        }
      } else {
        setIsMaxSend(false);
      }
    } else {
      setIsMaxSend(false);
    }
  }, [
    watchedAmount,
    balanceStr,
    selectedAsset,
    assetDecimals,
    form,
    saveCurrentState,
    isCurrentForm,
    isUnlocked,
    controllerLoading,
    connectionUnavailable,
  ]);

  const handleSelectedAsset = useCallback(
    (item: number | string) => {
      maxIntentRevision.current += 1;
      if (assets) {
        const getAsset = assets.find(
          (asset) => String(asset.assetGuid) === String(item)
        );

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
    const xpub = (activeAccount as any)?.xpub as string | undefined;
    const isImported = Boolean((activeAccount as any)?.isImported);
    if (!accountAddress) return;

    // Prefer XPUB page for UTXO accounts when available, including imported extended-key accounts.
    // Fall back to /address for UTXO single-address imports (WIF) where xpub === address.
    const isSingleAddressUtxoImport =
      isImported && Boolean(xpub) && xpub === accountAddress;
    const useAddressPathForUtxo =
      isBitcoinBased && (!xpub || isSingleAddressUtxoImport);
    const pathSegment = isBitcoinBased
      ? useAddressPathForUtxo
        ? 'address'
        : 'xpub'
      : 'address';
    const identifier = isBitcoinBased
      ? useAddressPathForUtxo
        ? accountAddress
        : xpub!
      : accountAddress;

    const base = adjustUrl(activeNetwork.explorer || activeNetwork.url);
    window.open(
      `${base}${pathSegment}/${encodeURIComponent(identifier)}`,
      '_blank'
    );
  }, [
    activeAccount?.address,
    (activeAccount as any)?.xpub,
    (activeAccount as any)?.isImported,
    isBitcoinBased,
    activeNetwork.explorer,
    activeNetwork.url,
  ]);

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
    if (!isCurrentForm()) return;
    // Prevent submission during restoration
    if (isRestoringRef.current) {
      console.log('[SendSys] Preventing submission during restoration');
      return;
    }

    // An unsigned result belongs to the inputs that requested it, not later edits.
    const preparationInputs = () =>
      JSON.stringify({
        values: form.getFieldsValue(),
        // History counters and display metadata can refresh while the unsigned
        // estimator runs. Only changes that affect this transaction invalidate it.
        asset: preparationOptions.current.selectedAsset
          ? {
              assetGuid: preparationOptions.current.selectedAsset.assetGuid,
              assetType: preparationOptions.current.selectedAsset.assetType,
              decimals: preparationOptions.current.selectedAsset.decimals,
              symbol: preparationOptions.current.selectedAsset.symbol,
              balance: preparationOptions.current.selectedAsset.balance,
            }
          : null,
        rbf: preparationOptions.current.RBF,
        feeRate: preparationOptions.current.feeRate,
        nativeBalance: preparationOptions.current.selectedAsset
          ? null
          : preparationOptions.current.nativeBalance,
        nativeMaxIntent: nativeMaxIntent.current,
      });
    const submittedInputs = preparationInputs();
    const isCurrentPreparation = () =>
      isCurrentForm() && preparationInputs() === submittedInputs;

    try {
      setIsLoading(true);

      // Capture ALL form values at submission time
      const allFormValues = form.getFieldsValue();

      // For native SYS transactions
      if (!selectedAsset) {
        const amountAtomic = nativeAtomicAmount(amount);
        const balanceAtomic = nativeAtomicAmount(
          activeAccount.balances[INetworkType.Syscoin]
        );

        // Only the explicit MAX button/restored MAX draft may sweep a fresh
        // funding snapshot. A manually entered full-balance amount remains a
        // bounded subtract-fee request, never permission to expand that amount.
        const nativeSweep = nativeMaxIntent.current;
        const isMaxTransaction = nativeSweep || amountAtomic.eq(balanceAtomic);
        let quotedGrossAmount = String(amount);

        // For validation, we need to estimate the total fee to ensure sufficient funds
        let estimatedTotalFee = 0.001; // Conservative default
        let psbt = null;
        try {
          const quote = (await controllerEmitter(
            ['wallet', 'getEstimateSysTransactionFee'],
            [
              {
                amount: amount, // Keep as string to preserve precision
                receivingAddress: receiver,
                feeRate,
                txOptions: { rbf: RBF },
                isMax: isMaxTransaction,
                ...(nativeSweep ? { nativeSweep: true } : {}),
                token: null, // Explicitly pass null for native transactions
              },
            ]
          )) as {
            fee: number;
            grossAmount?: string;
            psbt: any;
            recipientAmount?: string;
          };
          if (!isCurrentPreparation()) return;

          const { fee: estimatedFee, psbt: estimatedPsbt } = quote;
          if (nativeSweep) {
            // MAX's reviewed amount must come from the same UTXOs used to
            // construct its unsigned PSBT, not an independently timed balance
            // summary. Refuse old/malformed quotes rather than falling back.
            const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;
            if (
              typeof quote.grossAmount !== 'string' ||
              typeof quote.recipientAmount !== 'string' ||
              !decimal.test(quote.grossAmount) ||
              !decimal.test(quote.recipientAmount)
            ) {
              throw new Error('Invalid native MAX quote');
            }
            const gross = nativeAtomicAmount(quote.grossAmount);
            const recipient = nativeAtomicAmount(quote.recipientAmount);
            const fee = nativeAtomicAmount(estimatedFee);
            if (
              recipient.lte(0) ||
              fee.lt(0) ||
              !gross.eq(recipient.add(fee))
            ) {
              throw new Error('Invalid native MAX quote');
            }
            quotedGrossAmount = quote.grossAmount;
          }

          estimatedTotalFee = estimatedFee;
          psbt = estimatedPsbt;

          // Critical validation: If PSBT creation failed, we cannot proceed
          if (!psbt || !estimatedPsbt) {
            throw new Error('Failed to create transaction PSBT');
          }
        } catch (error: any) {
          if (!isCurrentPreparation()) return;
          setIsLoading(false);

          // Create transaction values object for centralized error handling
          const basicTxValues = {
            fee: parseFloat(formatSyscoinValue(feeRate.toString())), // Convert from satoshis to SYS safely
            amount: amount, // Keep as string to preserve precision
          };

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
            // Fallback for non-structured errors
            const sanitizedMessage = sanitizeErrorMessage(error);
            alert.error(
              t('send.transactionCreationFailed', {
                error: sanitizedMessage,
              }) ||
                `Failed to create transaction: ${sanitizedMessage}. Please try again.`
            );
          }
          return;
        }

        // For non-max sends, validate amount + fee doesn't exceed balance
        if (!isMaxTransaction) {
          const totalNeeded = amountAtomic.add(
            nativeAtomicAmount(estimatedTotalFee)
          );

          if (totalNeeded.gt(balanceAtomic)) {
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
          amount: quotedGrossAmount,
          fee: estimatedTotalFee, // Actual fee amount (compliant with SysProvider API)
          feeRate: feeRate, // Add fee rate for transaction details display
          rbf: RBF, // RBF state for transaction details display
          token: null,
          psbt: psbt,
          isMax: isMaxTransaction, // Pass isMax flag for correct total calculation
        };

        // Use navigateWithContext to automatically handle state preservation
        if (!isCurrentPreparation()) return;
        navigateWithContext(
          navigate,
          '/send/confirm',
          {
            submissionStarted: false,
            tx: txData,
            transactionType: TransactionType.UTXO,
          },
          returnContext
        );
      } else {
        const builderAmount = toEightDecimalBuilderAmount(
          String(amount),
          assetDecimals,
          selectedAsset.assetType
        );

        // For tokens, we need to estimate the fee for display
        let tokenFeeEstimate = MINIMUM_FEE; // Default
        let tokenPsbt = null;
        try {
          const { fee: estimatedFee, psbt } = (await controllerEmitter(
            ['wallet', 'getEstimateSysTransactionFee'],
            [
              {
                amount: builderAmount,
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
          if (!isCurrentPreparation()) return;

          tokenFeeEstimate = estimatedFee;
          tokenPsbt = psbt;

          // Critical validation: If PSBT creation failed, we cannot proceed
          if (!psbt || !tokenPsbt) {
            throw new Error('Failed to create token transaction PSBT');
          }
        } catch (error: any) {
          if (!isCurrentPreparation()) return;
          setIsLoading(false);

          // Create transaction values object for centralized error handling
          const basicTxValues = {
            fee: parseFloat(formatSyscoinValue(feeRate.toString())), // Convert from satoshis to SYS safely
            amount: amount, // Keep as string to preserve precision
          };

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
            // Fallback for non-structured errors
            const sanitizedMessage = sanitizeErrorMessage(error);
            alert.error(
              t('send.transactionCreationFailed', {
                error: sanitizedMessage,
              }) ||
                `Failed to create token transaction: ${sanitizedMessage}. Please try again.`
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
        if (!isCurrentPreparation()) return;
        navigateWithContext(
          navigate,
          '/send/confirm',
          {
            submissionStarted: false,
            tx: {
              sender: activeAccount?.address,
              receivingAddress: receiver,
              amount: amount, // Keep as string to preserve precision
              fee: tokenFeeEstimate, // Actual fee amount (compliant with SysProvider API)
              feeRate: feeRate, // Add fee rate for transaction details display
              rbf: RBF, // RBF state for transaction details display
              psbt: tokenPsbt,
              token: {
                symbol: selectedAsset.symbol,
                guid: selectedAsset.assetGuid,
                decimals: assetDecimals,
              },
              isMax: false, // Tokens don't support max send functionality
              transactionType: TransactionType.UTXO,
            },
          },
          returnContext
        );
      }
    } catch (error) {
      if (!isCurrentPreparation()) return;
      setIsLoading(false);

      alert.error(t('send.internalError'));
    } finally {
      // A connection interruption cancels preparation while the same form can remain visible.
      if (isCurrentForm(false)) setIsLoading(false);
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
          <button
            type="button"
            aria-label={t('home.viewAccountOnExplorer')}
            className="add-identicon ml-1 mr-2 my-2 cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue"
            onClick={openAccountInExplorer}
            title={t('home.viewAccountOnExplorer')}
          />
        </Tooltip>
        <div className="flex min-w-0 max-w-full flex-wrap gap-1 justify-center items-center">
          <span className="shrink-0">
            <PaliWhiteSmallIconSvg />
          </span>
          <div className="flex min-w-0 max-w-full flex-wrap justify-center text-white gap-1 text-xs font-normal items-center">
            <p className="min-w-0 max-w-full font-medium [overflow-wrap:anywhere]">
              {activeAccount?.label}
            </p>
            <Tooltip content={t('buttons.copy')}>
              <button
                type="button"
                aria-label={t('buttons.copy')}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 hover:text-brand-royalblue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue transition-colors duration-200"
                onClick={async () => {
                  if (!isCurrentForm(false)) return;
                  const current = beginAddressCopy();
                  try {
                    await navigator.clipboard.writeText(activeAccount?.address);
                    if (current() && isCurrentForm(false))
                      alert.success(t('home.addressCopied'));
                  } catch {
                    if (current() && isCurrentForm(false))
                      alert.error(t('transactions.copyFailed'));
                  }
                }}
              >
                {ellipsis(activeAccount?.address, 4, 4)}
                <Icon name="copy" className="text-xs" />
              </button>
            </Tooltip>
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
        initialValues={{
          RBF: true,
          ...initialDraft.formValues,
        }}
        onFinish={nextStep}
        autoComplete="off"
        className="flex flex-col gap-2 items-center justify-center mt-6 text-center w-full pb-20 md:pb-0"
        onValuesChange={handleFormValuesChange}
      >
        <div className="sender-custom-input">
          <Form.Item
            name="receiver"
            className="w-full md:max-w-md"
            hasFeedback
            rules={[
              {
                required: true,
                message: t('send.addressRequired'),
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
                  if (!isCurrentForm())
                    return Promise.reject(
                      new Error('Send form is no longer active.')
                    );
                  if (isValid) {
                    return Promise.resolve();
                  }

                  return Promise.reject(new Error(t('send.invalidSysAddress')));
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
        <div className="flex gap-2 w-full items-start">
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
                      <Menu.Button className="inline-flex items-center w-[100px] gap-4  justify-center border border-alpha-whiteAlpha300 px-5 py-[7px]  bg-brand-blue800 hover:bg-opacity-30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
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
                        className={`scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-56 h-56 text-brand-white font-poppins bg-brand-blue800 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right
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
                            <div className="flex flex-col items-start flex-1 overflow-hidden">
                              <p className="truncate max-w-[100px]">
                                {activeNetwork.currency?.toUpperCase() || 'SYS'}
                              </p>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gray-500 bg-opacity-80 text-white">
                                {t('send.native')}
                              </span>
                            </div>
                          </button>
                        </Menu.Item>

                        {assets.length > 0
                          ? assets.map((item: any) =>
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
                                    <div className="flex flex-col items-start flex-1 overflow-hidden">
                                      <p className="truncate max-w-[100px]">
                                        {item?.symbol?.length > 8
                                          ? item.symbol.slice(0, 8) + '...'
                                          : item?.symbol}
                                      </p>
                                      {isNFT(item.assetGuid) && (
                                        <span className="text-[10px] text-brand-gray200 font-mono">
                                          GUID: {item.assetGuid.slice(0, 8)}...
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-end">
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                          isNFT(item.assetGuid)
                                            ? 'bg-gray-500 bg-opacity-80 text-white'
                                            : 'bg-brand-royalbluemedium bg-opacity-80 text-white'
                                        }`}
                                      >
                                        {isNFT(item.assetGuid) ? 'NFT' : 'SPT'}
                                      </span>
                                    </div>
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

          <div className="flex flex-1 min-w-0 relative">
            <div className="value-custom-input w-full relative">
              <button
                type="button"
                onClick={handleMaxButton}
                className="absolute left-[15px] top-5 transform -translate-y-1/2 text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-pill cursor-pointer hover:bg-alpha-whiteAlpha200 z-10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-bkg-1"
              >
                MAX
              </button>
              <Form.Item
                name="amount"
                className="relative w-full"
                hasFeedback
                rules={[
                  {
                    required: true,
                    // Message comes from the validator below; a message here
                    // would render twice for empty values.
                    message: '',
                  },
                  () => ({
                    async validator(_, value) {
                      // Work with strings to avoid precision loss
                      const inputAmount = value ? String(value).trim() : '';

                      // Check if empty or invalid
                      if (!inputAmount || inputAmount === '') {
                        return Promise.reject(
                          new Error(t('send.amountRequired'))
                        );
                      }

                      if (selectedAsset) {
                        try {
                          assertValidAssetAmount(
                            inputAmount,
                            assetDecimals,
                            selectedAsset.assetType
                          );
                        } catch {
                          return Promise.reject(
                            new Error(t('send.invalidAmount'))
                          );
                        }

                        if (
                          !isAssetAmountWithinBalance(
                            inputAmount,
                            String(selectedAsset.balance ?? '0'),
                            assetDecimals
                          )
                        ) {
                          return Promise.reject(
                            new Error(t('send.insufficientFunds'))
                          );
                        }

                        return Promise.resolve();
                      }

                      // Get balance as string to preserve precision
                      // Native SYS balance is already in decimal format.
                      const validationBalanceStr = activeAccount?.balances[
                        INetworkType.Syscoin
                      ]
                        ? String(activeAccount.balances[INetworkType.Syscoin])
                        : '0';

                      // Compare integer satoshis without rounding a large balance.
                      try {
                        const inputAtomic = nativeAtomicAmount(inputAmount);
                        const balanceAtomic =
                          nativeAtomicAmount(validationBalanceStr);

                        if (inputAtomic.lte(0)) {
                          return Promise.reject(
                            new Error(t('send.invalidAmount'))
                          );
                        }

                        if (inputAtomic.gt(balanceAtomic)) {
                          return Promise.reject(
                            new Error(t('send.insufficientFunds'))
                          );
                        }

                        return Promise.resolve();
                      } catch (error) {
                        // Non-decimal or sub-satoshi input is invalid.
                        return Promise.reject(
                          new Error(t('send.invalidAmount'))
                        );
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

        <ToastActionFooter className="fixed bottom-4 left-4 right-4 md:relative md:bottom-auto md:left-auto md:right-auto md:mt-3 md:w-[96%]">
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            fullWidth
            loading={isLoading}
          >
            {t('buttons.next')}
          </Button>
        </ToastActionFooter>
      </Form>
    </div>
  );
};
