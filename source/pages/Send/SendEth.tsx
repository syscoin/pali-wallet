import { BigNumber } from '@ethersproject/bignumber';
import { parseEther, parseUnits, formatUnits } from '@ethersproject/units';
import { Menu } from '@headlessui/react';
import { Form, Input } from 'antd';
import { toSvg } from 'jdenticon';
import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { TransactionType } from '../../types/transactions';
import { PaliWhiteSmallIconSvg, ArrowDownSvg } from 'components/Icon/Icon';
import { NeutralButton, Tooltip, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectEnsNameToAddress } from 'state/vault/selectors';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { ITokenEthProps } from 'types/tokens';
import {
  getAssetBalance,
  ellipsis,
  adjustUrl,
  formatFullPrecisionBalance,
  createNavigationContext,
  getTokenTypeBadgeColor,
  navigateWithContext,
  saveNavigationState,
  truncateToDecimals,
} from 'utils/index';
import { getDefaultGasLimit } from 'utils/transactionUtils';
import { isValidEthereumAddress } from 'utils/validations';
export const SendEth = () => {
  const { alert, navigate } = useUtils();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const location = useLocation();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { account: activeAccount, assets: activeAccountAssets } = useSelector(
    selectActiveAccountWithAssets
  );

  // Lazy reverse ENS for typed addresses. Placed later to ensure dependencies are declared
  const reverseEnsTimeoutRef = useRef<NodeJS.Timeout>();

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const hasAccountAssets = Boolean(activeAccountAssets?.ethereum);
  const isAccountImported = activeAccount?.isImported || false;

  // Restore form state if coming back from navigation
  const initialSelectedAsset = location.state?.selectedAsset || null;
  const initialNftTokenIds = location.state?.nftTokenIds || [];
  const initialSelectedNftTokenId = location.state?.selectedNftTokenId || null;
  const initialIsMaxSend = location.state?.isMaxSend || false;
  const initialVerifiedTokenBalance =
    location.state?.verifiedTokenBalance ?? null;

  const [selectedAsset, setSelectedAsset] = useState<ITokenEthProps | null>(
    initialSelectedAsset
  );
  const [isCalculatingGas, setIsCalculatingGas] = useState(false);
  const [cachedFeeData, setCachedFeeData] = useState<any>(null);
  const [isMaxSend, setIsMaxSend] = useState(initialIsMaxSend);

  // NFT-related state
  const [nftTokenIds, setNftTokenIds] =
    useState<{ balance: number; tokenId: string }[]>(initialNftTokenIds);
  const [isLoadingNftTokenIds, setIsLoadingNftTokenIds] = useState(false);
  const [selectedNftTokenId, setSelectedNftTokenId] = useState<string | null>(
    initialSelectedNftTokenId
  );
  const [isVerifyingTokenId, setIsVerifyingTokenId] = useState(false);
  const [verifiedTokenBalance, setVerifiedTokenBalance] = useState<
    number | null
  >(initialVerifiedTokenBalance);
  const [verificationError, setVerificationError] = useState<string | null>(
    null
  );

  // ERC-20 verification state
  const [isVerifyingERC20, setIsVerifyingERC20] = useState(false);
  const [verifiedERC20Balance, setVerifiedERC20Balance] = useState<
    number | null
  >(null);

  const [form] = Form.useForm();
  // Receiver suggestions / ENS state
  const [receiverInput, setReceiverInput] = useState('');
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { address: string; label: string; type: 'account' | 'recent' | 'ens' }[]
  >([]);

  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const ensCache = useSelector(
    (state: RootState) => state.vaultGlobal.ensCache
  );
  const ensNameToAddress = useSelector(selectEnsNameToAddress);
  const vaultActiveAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );

  // Track form value changes using a ref to avoid dependency issues
  const formValuesRef = useRef<any>({});
  const tokenIdVerificationTimeoutRef = useRef<NodeJS.Timeout>();

  // Save navigation state when user completes interaction
  const saveCurrentState = useCallback(async () => {
    // Prefer live form values to avoid races when setFieldValue was just called
    const currentFormValues =
      typeof form?.getFieldsValue === 'function'
        ? form.getFieldsValue()
        : formValuesRef.current;
    const state = {
      formValues: currentFormValues,
      selectedAsset,
      nftTokenIds,
      selectedNftTokenId,
      isMaxSend,
      verifiedTokenBalance,
    };

    await saveNavigationState(
      location.pathname,
      undefined,
      state,
      location.state?.returnContext
    );
  }, [
    selectedAsset,
    nftTokenIds,
    selectedNftTokenId,
    isMaxSend,
    verifiedTokenBalance,
    location,
    form,
  ]);

  // Update form values ref when they change (no save yet)
  const handleFormValuesChange = useCallback(
    (_changedValues: any, allValues: any) => {
      formValuesRef.current = allValues;
      if (typeof allValues?.receiver === 'string') {
        setReceiverInput(allValues.receiver);
      }
    },
    []
  );

  // Initialize receiverInput from form on mount (restored state)
  useEffect(() => {
    const initialReceiver = form.getFieldValue('receiver');
    if (typeof initialReceiver === 'string') {
      setReceiverInput(initialReceiver);
    }
  }, [form]);

  // Minimal ENS resolver via background method
  const tryResolveEns = useCallback(
    async (maybeEns: string): Promise<string | null> => {
      if (!maybeEns || !maybeEns.toLowerCase().endsWith('.eth')) return null;
      const key = maybeEns.toLowerCase();
      // 1) Try cache first
      const cached = ensNameToAddress[key];
      if (cached && cached.startsWith('0x')) return cached;
      // 2) Fallback to background resolver on mainnet
      try {
        const resolved = (await controllerEmitter(
          ['wallet', 'resolveEns'],
          [maybeEns]
        )) as string | null;
        if (
          resolved &&
          typeof resolved === 'string' &&
          resolved.startsWith('0x')
        ) {
          return resolved;
        }
        return null;
      } catch (_e) {
        return null;
      }
    },
    [ensNameToAddress]
  );

  // Build suggestions from local accounts and recent recipients
  const buildSuggestions = useCallback(
    (query: string) => {
      const results: {
        address: string;
        label: string;
        type: 'account' | 'recent' | 'ens';
      }[] = [];
      const q = String(query || '').toLowerCase();

      // Local accounts (EVM)
      try {
        Object.values(accounts || {}).forEach((byId: any) => {
          Object.values(byId || {}).forEach((acct: any) => {
            const addressLower = String(acct?.address || '').toLowerCase();
            const labelLower = String(acct?.label || '').toLowerCase();
            if (!addressLower) return;
            // Only show EVM-style addresses here
            if (!addressLower.startsWith('0x')) return;
            if (!q || addressLower.includes(q) || labelLower.includes(q)) {
              results.push({
                label: acct?.label || acct?.address,
                address: acct.address,
                type: 'account',
              });
            }
          });
        });
      } catch {}

      // Recent recipients for current account + chain
      try {
        const chainId = activeNetwork?.chainId;
        const currentAccTxs =
          accountTransactions?.[vaultActiveAccount.type]?.[
            vaultActiveAccount.id
          ]?.ethereum?.[chainId];
        const seen = new Set<string>();
        (currentAccTxs || []).forEach((tx: any) => {
          const to = String(tx?.to || '').toLowerCase();
          if (!to || seen.has(to)) return;
          const maybeName = (ensCache as any)?.[to]?.name;
          const display = maybeName || to;
          if (!q || String(display).toLowerCase().includes(q)) {
            results.push({ label: display, address: tx.to, type: 'recent' });
            seen.add(to);
          }
        });
      } catch {}

      // ENS suggestion row when typing .eth
      if (q.toLowerCase().endsWith('.eth')) {
        results.unshift({
          label: `${query} (ENS)`,
          address: query,
          type: 'ens',
        });
      }

      // De-duplicate by address (case-insensitive), preserve order and collapse account/recent duplicates
      const deduped: typeof results = [];
      const added = new Set<string>();
      for (const item of results) {
        const key = item.address.toLowerCase();
        if (!added.has(key)) {
          deduped.push(item);
          added.add(key);
        }
      }
      setSuggestions(deduped.slice(0, 10));
    },
    [accounts, accountTransactions, activeAccount, activeNetwork]
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
      nftTokenIds.length > 0 ||
      selectedNftTokenId !== null ||
      isMaxSend !== false ||
      verifiedTokenBalance !== null
    ) {
      saveCurrentState();
    }
  }, [
    selectedAsset,
    nftTokenIds,
    selectedNftTokenId,
    isMaxSend,
    verifiedTokenBalance,
    saveCurrentState,
  ]);

  // Save component state when non-form state changes
  useEffect(() => {
    // Don't save on initial mount or when there's no meaningful state
    if (
      selectedAsset === null &&
      nftTokenIds.length === 0 &&
      selectedNftTokenId === null &&
      isMaxSend === false &&
      verifiedTokenBalance === null &&
      Object.keys(formValuesRef.current).length === 0
    ) {
      return;
    }

    // Save immediately when these state values change
    saveCurrentState();
  }, [
    selectedAsset,
    nftTokenIds,
    selectedNftTokenId,
    isMaxSend,
    verifiedTokenBalance,
    saveCurrentState,
  ]);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(
    () => () => {
      if (tokenIdVerificationTimeoutRef.current) {
        clearTimeout(tokenIdVerificationTimeoutRef.current);
      }
    },
    []
  );

  // Track if we've already restored form values to prevent duplicate restoration
  const hasRestoredRef = useRef(false);

  // Restore form values if coming back from navigation or from saved state
  useEffect(() => {
    const hasScrollable = location.state?.scrollPosition !== undefined;
    const hasFormValues = Boolean(location.state?.formValues);
    if (!hasRestoredRef.current && (hasScrollable || hasFormValues)) {
      const { formValues, isMaxSend: restoredIsMaxSend } = location.state || {};

      if (formValues) {
        hasRestoredRef.current = true;
        form.setFieldsValue(formValues);
        formValuesRef.current = formValues;
        if (typeof formValues.receiver === 'string') {
          setReceiverInput(formValues.receiver);
        }

        // If this was a max send, recalculate the max amount
        if (restoredIsMaxSend) {
          handleMaxButton();
        }
      }

      // Do NOT clear the navigation state here - we need it to persist
      // for when the popup is closed and reopened
    }
  }, [location.state, form]); // handleMaxButton is stable useCallback, no need to include

  // ✅ MEMOIZED: Handlers
  const handleSelectedAsset = useCallback(
    async (value: string) => {
      try {
        if (value === '-1') {
          setSelectedAsset(null);
          setNftTokenIds([]);
          setSelectedNftTokenId(null);
          // Don't clear cached fee data - gas prices don't change based on asset
          setIsMaxSend(false);
          return;
        }

        // Prefer selecting by unique asset id (handles ERC-1155 tokenId correctly).
        // Fallback to contractAddress match for legacy/non-ERC1155 tokens.
        const getAsset =
          activeAccountAssets?.ethereum?.find(
            (item: ITokenEthProps) => item.id === value
          ) ||
          activeAccountAssets?.ethereum?.find(
            (item: ITokenEthProps) => item.contractAddress === value
          );

        if (getAsset) {
          setSelectedAsset(getAsset);
          // Don't clear cached fee data - gas prices don't change based on asset
          setIsMaxSend(false);

          // If it's an NFT, handle based on token standard
          if (getAsset.isNft) {
            if (getAsset.tokenStandard === 'ERC-1155') {
              // ERC-1155 always has stored tokenId
              setSelectedNftTokenId(getAsset.tokenId);
              form.setFieldValue('nftTokenId', getAsset.tokenId);
              form.setFieldValue('amount', '1');
              // Set the balance from the stored token (already specific to this tokenId)
              setVerifiedTokenBalance(getAsset.balance);
              setNftTokenIds([]); // No need to fetch token IDs
              setIsLoadingNftTokenIds(false);
            } else {
              // ERC-721 flow - enumerate token IDs
              setIsLoadingNftTokenIds(true);
              // Set amount to 1 for NFTs
              form.setFieldValue('amount', '1');
              // Initialize the NFT token ID field with empty string to make it controlled from the start
              form.setFieldValue('nftTokenId', '');
              try {
                const result = (await controllerEmitter(
                  ['wallet', 'fetchNftTokenIds'],
                  [
                    getAsset.contractAddress,
                    activeAccount.address,
                    getAsset.tokenStandard || 'ERC-721',
                  ]
                )) as { balance: number; tokenId: string }[] & {
                  hasMore?: boolean;
                  requiresManualEntry?: boolean;
                };

                setNftTokenIds(result || []);

                // Auto-select first token if only one
                if (result && result.length === 1) {
                  setSelectedNftTokenId(result[0].tokenId);
                  // Also set it in the form
                  form.setFieldValue('nftTokenId', result[0].tokenId);
                }
              } catch (error) {
                console.error('Error loading NFT token IDs:', error);
                setNftTokenIds([]);
                alert.error(t('send.errorLoadingNfts'));
              } finally {
                setIsLoadingNftTokenIds(false);
              }
            }
          } else {
            setNftTokenIds([]);
            setSelectedNftTokenId(null);
            // Clear the NFT token ID field when switching away from NFT
            form.setFieldValue('nftTokenId', undefined);
          }
        } else {
          setSelectedAsset(null);
          setNftTokenIds([]);
          setSelectedNftTokenId(null);
        }
      } catch (error) {
        console.error(error);
      }
    },
    [activeAccount.address, activeAccountAssets, alert, t, form]
  );

  const finalSymbolToNextStep = useMemo(() => {
    if (selectedAsset?.isNft) {
      // For ERC-1155, always use stored tokenId
      if (selectedAsset?.tokenStandard === 'ERC-1155') {
        return `#${selectedAsset.tokenId}`;
      }
      // For ERC-721, use selected tokenId
      return selectedNftTokenId
        ? `#${selectedNftTokenId}`
        : selectedAsset?.name || 'NFT';
    }
    return selectedAsset?.tokenSymbol;
  }, [selectedAsset, selectedNftTokenId]);

  const handleSubmit = useCallback(
    async (values: any) => {
      try {
        // Determine transaction type based on selected asset
        let transactionType: TransactionType;
        if (selectedAsset) {
          if (selectedAsset.isNft) {
            transactionType =
              selectedAsset.tokenStandard === 'ERC-1155'
                ? TransactionType.ERC1155
                : TransactionType.ERC721;
          } else {
            transactionType = TransactionType.ERC20;
          }
        } else {
          transactionType = TransactionType.NATIVE_ETH;
        }

        // Determine if this is a MAX send for native ETH
        let isMax = false;
        if (!selectedAsset && values.amount) {
          // Check if the entered value equals the full balance
          const balanceEth = String(activeAccount?.balances?.ethereum || 0);

          try {
            const amountBN = parseEther(values.amount);
            const balanceBN = parseEther(balanceEth);

            // Check if amounts are equal or within a small tolerance (rounding tolerance)
            // This handles cases where the displayed value might be slightly rounded
            // 1000 wei = 0.000000000000001 ETH (negligible but accounts for display rounding)
            const difference = balanceBN.sub(amountBN).abs();
            isMax = difference.lte(1000); // Consider it max if difference is <= 1000 wei
          } catch {
            // If parsing fails, it's not a MAX send
            isMax = false;
          }
        }

        // Prepare component state to preserve
        // Capture ALL form values at submission time
        const allFormValues = form.getFieldsValue();
        const state = {
          formValues: allFormValues,
          selectedAsset,
          nftTokenIds,
          selectedNftTokenId,
          isMaxSend: isMax, // Use the calculated isMax value
          verifiedTokenBalance,
        };

        // Create navigation context for returning from confirm
        const returnContext = {
          ...createNavigationContext('/send/eth', undefined, state),
          // Include existing return context to make it recursive
          returnContext: location.state?.returnContext,
        };

        // Use navigateWithContext to automatically handle state preservation
        navigateWithContext(
          navigate,
          '/send/confirm',
          {
            tx: {
              sender: activeAccount.address,
              receivingAddress: values.receiver,
              amount: values.amount,
              token: selectedAsset
                ? {
                    ...selectedAsset,
                    symbol: finalSymbolToNextStep,
                    tokenId:
                      selectedAsset.tokenStandard === 'ERC-1155'
                        ? selectedAsset.tokenId // For ERC-1155, use the tokenId from the asset itself
                        : values.nftTokenId, // For ERC-721, use the form field value
                  }
                : null,
              // Pass cached gas data to avoid recalculation on confirm screen
              // Always pass it, regardless of asset type
              cachedGasData: cachedFeeData,
              // Pass isMax flag for proper fee handling
              isMax: !selectedAsset ? isMax : false,
              // Pass transaction type and default gas limit
              transactionType,
              defaultGasLimit: getDefaultGasLimit(transactionType),
            },
          },
          returnContext
        );
      } catch (error) {
        alert.error(t('send.internalError'));
      }
    },
    [
      navigate,
      activeAccount.address,
      activeAccount?.balances?.ethereum,
      selectedAsset,
      finalSymbolToNextStep,
      alert,
      t,
      cachedFeeData,
      form,
      nftTokenIds,
      selectedNftTokenId,
      location.state?.returnContext,
    ]
  );

  const finalBalance = useCallback(() => {
    if (selectedAsset) {
      // For ERC-20 tokens, prefer verified balance if available
      if (!selectedAsset.isNft && verifiedERC20Balance !== null) {
        const displayBalance = formatFullPrecisionBalance(
          verifiedERC20Balance,
          4
        );
        return `${displayBalance} ${
          selectedAsset.tokenSymbol?.toUpperCase() || ''
        }`;
      }

      // For NFTs and unverified tokens, use stored balance
      return getAssetBalance(
        selectedAsset,
        activeAccount,
        false,
        activeNetwork
      );
    }

    // For native currency, format the balance for display (4 decimals)
    const fullBalance = String(activeAccount?.balances?.ethereum || 0);
    const displayBalance = formatFullPrecisionBalance(fullBalance, 4);

    return `${displayBalance} ${activeNetwork.currency.toUpperCase()}`;
  }, [selectedAsset, activeAccount, activeNetwork, verifiedERC20Balance]);

  const getLabel = useCallback(() => {
    if (selectedAsset?.isNft) {
      // For NFTs, prefer tokenSymbol over name
      return (
        selectedAsset?.tokenSymbol ||
        selectedAsset?.name ||
        t('send.nftCollection')
      ).toUpperCase();
    }
    return selectedAsset?.tokenSymbol
      ? selectedAsset?.tokenSymbol.toUpperCase()
      : activeNetwork.currency.toUpperCase();
  }, [selectedAsset, activeNetwork.currency, t]);

  const openAccountInExplorer = useCallback(() => {
    const accountAddress = activeAccount?.address;
    if (!accountAddress) return;

    const base = adjustUrl(activeNetwork.explorer || activeNetwork.url);
    const explorerUrl = `${base}address/${accountAddress}`;

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

    setIsCalculatingGas(true);

    try {
      // Get fee data for EIP-1559 transaction
      const feeData = (await controllerEmitter([
        'wallet',
        'ethereumTransaction',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
      ])) as any;

      // Only cache if we got valid fee data
      if (feeData && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        const { maxFeePerGas, maxPriorityFeePerGas } = feeData;

        // Cache only the fee rates - gas limit will be handled by backend
        // IMPORTANT: Convert BigNumbers to hex strings for proper serialization through navigation
        setCachedFeeData({
          maxFeePerGas: BigNumber.from(maxFeePerGas || '0').toHexString(),
          maxPriorityFeePerGas: BigNumber.from(
            maxPriorityFeePerGas || '0'
          ).toHexString(),
        });
      }
    } catch (error) {
      console.error('Error calculating gas fees:', error);
      // Don't cache on error, but don't block the UI either
    } finally {
      setIsCalculatingGas(false);
    }
  }, [selectedAsset, isCalculatingGas]);

  const calculateMaxAmount = useCallback((): string => {
    if (selectedAsset) {
      // For tokens, use full balance as fees are paid in native token
      return String(selectedAsset.balance);
    }

    // For native ETH, return the full balance
    // The backend will handle gas deduction for MAX sends
    const balanceEth = activeAccount?.balances?.ethereum || 0;
    return String(balanceEth);
  }, [selectedAsset, activeAccount?.balances?.ethereum]);

  const handleMaxButton = useCallback(() => {
    // Only work with verified balances - no fallbacks
    let fullBalance: string;

    if (selectedAsset) {
      // For ERC-1155 NFTs, REQUIRE verified balance
      if (selectedAsset.isNft && selectedAsset?.tokenStandard === 'ERC-1155') {
        if (verifiedTokenBalance === null) return; // Don't proceed if not verified
        fullBalance = String(verifiedTokenBalance);
      } else if (!selectedAsset.isNft) {
        // For ERC-20 tokens, REQUIRE verified balance
        if (verifiedERC20Balance === null) return; // Don't proceed if not verified

        // Format to avoid scientific notation for very small numbers
        const balance = verifiedERC20Balance;
        // Use a high precision toFixed to avoid scientific notation
        // Then use parseFloat and toString to remove trailing zeros
        // But if the result would be in scientific notation, keep the fixed format
        const fixedString = balance.toFixed(18);
        const parsed = parseFloat(fixedString);
        const parsedString = parsed.toString();

        // If parsing resulted in scientific notation, use the fixed string
        if (parsedString.includes('e') || parsedString.includes('E')) {
          // Remove only trailing zeros after the last non-zero digit
          fullBalance = fixedString.replace(/0+$/, '').replace(/\.$/, '');
        } else {
          fullBalance = parsedString;
        }
      } else {
        // For ERC-721, this shouldn't be called (amount field is hidden)
        return;
      }
    } else {
      // For native ETH, use full balance
      // The backend will handle gas deduction for MAX sends
      fullBalance = calculateMaxAmount();
    }

    form.setFieldValue('amount', fullBalance);
    setIsMaxSend(true);

    // Update the form values ref immediately
    formValuesRef.current = { ...formValuesRef.current, amount: fullBalance };

    // Force validation to run after setting the value
    form.validateFields(['amount']);

    // Save state immediately after MAX is set
    setTimeout(() => {
      saveCurrentState();
    }, 0);
  }, [
    calculateMaxAmount,
    selectedAsset,
    verifiedTokenBalance,
    verifiedERC20Balance,
    form,
    saveCurrentState,
  ]);

  // Verify manually entered NFT token ID
  const verifyTokenId = useCallback(
    async (tokenId: string) => {
      if (!selectedAsset || !activeAccount.address || !tokenId.trim()) {
        setVerifiedTokenBalance(null);
        setVerificationError(null);
        return;
      }

      setIsVerifyingTokenId(true);
      setVerificationError(null);

      try {
        const result = (await controllerEmitter(
          [
            'wallet',
            selectedAsset?.tokenStandard === 'ERC-721'
              ? 'verifyERC721Ownership'
              : 'verifyERC1155Ownership',
          ],
          [selectedAsset.contractAddress, activeAccount.address, [tokenId]]
        )) as { balance: number; tokenId: string; verified: boolean }[];

        if (result && result.length > 0) {
          const tokenInfo = result[0];
          if (tokenInfo.verified && tokenInfo.balance > 0) {
            setVerifiedTokenBalance(tokenInfo.balance);
            setVerificationError(null);
          } else {
            setVerifiedTokenBalance(0);
            setVerificationError(
              tokenInfo.balance === 0
                ? t('send.youDontOwnThisToken')
                : t('send.tokenVerificationFailed')
            );
          }
        } else {
          setVerifiedTokenBalance(0);
          setVerificationError(t('send.tokenNotFound'));
        }
      } catch (error) {
        console.error('Error verifying token ID:', error);
        setVerifiedTokenBalance(0);
        setVerificationError(t('send.verificationFailed'));
      } finally {
        setIsVerifyingTokenId(false);
      }
    },
    [selectedAsset, activeAccount.address]
  );

  // Handle manual token ID input with debounced verification
  const handleManualTokenIdChange = useCallback(
    (value: string) => {
      setSelectedNftTokenId(value);
      // Also update the form field to keep them in sync
      form.setFieldValue('nftTokenId', value);

      // Clear any existing timeout to prevent verification calls for outdated values
      if (tokenIdVerificationTimeoutRef.current) {
        clearTimeout(tokenIdVerificationTimeoutRef.current);
        tokenIdVerificationTimeoutRef.current = undefined;
      }

      if (value) {
        // Clear previous verification
        setVerifiedTokenBalance(null);
        setVerificationError(null);

        // Debounce verification to avoid too many calls
        tokenIdVerificationTimeoutRef.current = setTimeout(() => {
          verifyTokenId(value);
        }, 500);
      } else {
        setVerifiedTokenBalance(null);
        setVerificationError(null);
      }
    },
    [verifyTokenId, form]
  );

  // Verify ERC-20 token balance
  const verifyERC20Balance = useCallback(async () => {
    if (!selectedAsset || selectedAsset.isNft || !activeAccount.address) {
      setVerifiedERC20Balance(null);
      return;
    }

    setIsVerifyingERC20(true);

    try {
      const result = (await controllerEmitter(
        ['wallet', 'getERC20TokenInfo'],
        [selectedAsset.contractAddress, activeAccount.address]
      )) as { balance: string; decimals: number; name: string; symbol: string };

      if (result) {
        // Use formatUnits to avoid precision loss with large token balances
        const balance = formatUnits(result.balance, result.decimals);
        setVerifiedERC20Balance(Number(balance)); // Safe to convert after formatting
      }
    } catch (error) {
      console.error('Error verifying ERC-20 balance:', error);
      setVerifiedERC20Balance(null);
    } finally {
      setIsVerifyingERC20(false);
    }
  }, [selectedAsset, activeAccount.address]);

  // Verify ERC-20 balance when asset changes
  useEffect(() => {
    if (selectedAsset && !selectedAsset.isNft) {
      // Debounce ERC-20 verification to avoid spam
      const timeoutId = setTimeout(() => {
        verifyERC20Balance();
      }, 1000);

      return () => clearTimeout(timeoutId);
    } else {
      setVerifiedERC20Balance(null);
    }
  }, [selectedAsset, verifyERC20Balance]);

  // Sync form field with component state for NFT token ID
  useEffect(() => {
    if (selectedAsset?.isNft) {
      const currentFormValue = form.getFieldValue('nftTokenId');
      if (currentFormValue !== selectedNftTokenId) {
        form.setFieldValue('nftTokenId', selectedNftTokenId || '');
      }
    } else {
      // Ensure the field is removed when not an NFT to prevent controlled/uncontrolled issues
      form.setFieldValue('nftTokenId', undefined);
    }
  }, [selectedNftTokenId, selectedAsset, form]);

  // Initialize form fields to prevent controlled/uncontrolled issues
  useEffect(() => {
    // Initialize all form fields with default values to ensure they're controlled from the start
    const currentValues = form.getFieldsValue();

    // Only set defaults if the field doesn't already have a value
    if (currentValues.nftTokenId === undefined) {
      form.setFieldValue('nftTokenId', '');
    }
  }, [form]);

  // ✅ OPTIMIZED: Effect with proper dependencies
  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder || !activeAccount?.xpub) return;

    placeholder.innerHTML = toSvg(activeAccount.xpub, 50, {
      backColor: '#07152B',
      padding: 1,
    });
  }, [activeAccount?.address, activeAccount?.xpub]);

  // Attach reverse ENS effect after handlers are defined
  useEffect(() => {
    const input = String(receiverInput || '');
    const isAddress = input.startsWith('0x') && input.length > 10;
    if (!isAddress) return;
    const lower = input.toLowerCase();
    if ((ensCache as any)?.[lower]?.name) return;
    if (reverseEnsTimeoutRef.current) {
      clearTimeout(reverseEnsTimeoutRef.current);
      reverseEnsTimeoutRef.current = undefined;
    }
    reverseEnsTimeoutRef.current = setTimeout(async () => {
      try {
        await controllerEmitter(['wallet', 'reverseResolveEns'], [input]);
        buildSuggestions(input);
      } catch {}
    }, 600);

    return () => {
      if (reverseEnsTimeoutRef.current) {
        clearTimeout(reverseEnsTimeoutRef.current);
        reverseEnsTimeoutRef.current = undefined;
      }
    };
  }, [receiverInput, ensCache, buildSuggestions]);

  // Calculate gas fees when component mounts or asset changes
  useEffect(() => {
    // Only calculate for native ETH (not tokens)
    if (!selectedAsset && activeAccount?.address && !cachedFeeData) {
      calculateGasFees();
    }
  }, [selectedAsset, activeAccount?.address, cachedFeeData, calculateGasFees]);

  // Close suggestions when clicking outside form
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If click is outside any input container, close
      if (!target.closest('.sender-custom-input')) {
        setIsSuggestionsOpen(false);
      }
    };
    document.addEventListener('click', onDocClick, { capture: true });
    return () =>
      document.removeEventListener('click', onDocClick, {
        capture: true,
      } as any);
  }, []);

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
          <p className="text-white text-xs font-semibold">{finalBalance()}</p>
          {/* ERC-20 verification indicators */}
          {selectedAsset && !selectedAsset.isNft && isVerifyingERC20 && (
            <span className="text-brand-royalblue text-xs ml-1">🔄</span>
          )}
          {selectedAsset &&
            !selectedAsset.isNft &&
            verifiedERC20Balance !== null && (
              <span
                className="text-green-400 text-xs ml-1"
                title={t('send.balanceVerified')}
              >
                ✓
              </span>
            )}
          {/* ERC-1155 verification indicators */}
          {selectedAsset?.isNft &&
            selectedAsset?.tokenStandard === 'ERC-1155' &&
            isVerifyingTokenId && (
              <span className="text-brand-royalblue text-xs ml-1">🔄</span>
            )}
          {selectedAsset?.isNft &&
            selectedAsset?.tokenStandard === 'ERC-1155' &&
            verifiedTokenBalance !== null && (
              <span
                className="text-green-400 text-xs ml-1"
                title={t('send.tokenOwnershipVerified')}
              >
                ✓
              </span>
            )}
        </div>
      </div>
      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={handleSubmit}
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

                  // Accept valid hex addresses directly
                  if (isValidEthereumAddress(value)) {
                    return Promise.resolve();
                  }

                  // Attempt ENS resolution for .eth names on mainnet
                  if (
                    typeof value === 'string' &&
                    value.toLowerCase().endsWith('.eth')
                  ) {
                    const resolved = await tryResolveEns(value);
                    if (resolved) {
                      // Replace input with resolved address for submission
                      form.setFieldValue('receiver', resolved);
                      setReceiverInput(resolved);
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(t('send.unableToResolveEns'))
                    );
                  }

                  return Promise.reject(new Error('Invalid Ethereum address'));
                },
              }),
            ]}
          >
            <div className="relative">
              <Input
                type="text"
                placeholder={t('send.receiver')}
                value={receiverInput}
                onChange={(e) => {
                  const v = e.target.value || '';
                  setReceiverInput(v);
                  // Keep Form state in sync so validation can react to typing
                  form.setFieldValue('receiver', v);
                  setIsSuggestionsOpen(true);
                  buildSuggestions(v);
                }}
                onFocus={() => {
                  setIsSuggestionsOpen(true);
                  buildSuggestions(receiverInput);
                }}
                onBlur={handleFieldBlur}
              />
              {isSuggestionsOpen && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-bkg-3 bg-brand-blue800 shadow-2xl">
                  {suggestions.map((sug, idx) => (
                    <button
                      type="button"
                      key={`${sug.type}-${sug.address}-${idx}`}
                      className="w-full text-left px-3 py-2 text-xs text-white hover:bg-alpha-whiteAlpha100 flex items-center justify-between"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        // Set the selected suggestion (ENS name or address). The validator will resolve ENS if needed.
                        form.setFieldValue('receiver', sug.address);
                        setReceiverInput(sug.address);
                        setIsSuggestionsOpen(false);
                        // Trigger validation so UI updates immediately
                        form.validateFields(['receiver']).catch(() => null);
                        // Save selection so it's restored if popup is closed
                        saveCurrentState();
                      }}
                    >
                      <span className="truncate max-w-[75%]">{sug.label}</span>
                      <span className="text-[10px] text-brand-gray200 uppercase">
                        {sug.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Form.Item>
        </div>

        <div className="flex gap-2 w-full items-center mb-6">
          <div className="flex md:max-w-md">
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
                    <Menu.Button className="inline-flex items-center w-[100px] gap-4 justify-center border border-alpha-whiteAlpha300 px-5 py-[7px] bg-brand-blue800 hover:bg-opacity-30 rounded-[100px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
                      <p className="w-full uppercase text-white text-xs font-normal">
                        {String(getLabel())}
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
                      <Menu.Item>
                        <button
                          type="button"
                          onClick={() => handleSelectedAsset('-1')}
                          className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                        >
                          <div className="flex flex-col items-start flex-1 overflow-hidden">
                            <p className="truncate max-w-[100px]">
                              {activeNetwork?.currency.toUpperCase() || 'SYS'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gray-500 bg-opacity-80 text-white">
                              {t('send.native')}
                            </span>
                          </div>
                        </button>
                      </Menu.Item>

                      {hasAccountAssets &&
                        Object.values(activeAccountAssets.ethereum).map(
                          (item: ITokenEthProps) => (
                            <div key={item.id}>
                              {item.chainId === activeNetwork.chainId ? (
                                <Menu.Item as="div">
                                  <Menu.Item>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSelectedAsset(item.id)
                                      }
                                      className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                    >
                                      <div className="flex flex-col items-start flex-1 overflow-hidden">
                                        <p className="truncate max-w-[100px]">
                                          {item.tokenSymbol.length > 8
                                            ? item.tokenSymbol.slice(0, 8) +
                                              '...'
                                            : item.tokenSymbol}
                                        </p>
                                        {item.isNft ? (
                                          <span className="text-[10px] text-brand-gray200 font-mono">
                                            {ellipsis(
                                              item.contractAddress,
                                              4,
                                              4
                                            )}
                                            {item.tokenStandard ===
                                              'ERC-1155' &&
                                              item.tokenId && (
                                                <>
                                                  {' '}
                                                  • #
                                                  {item.tokenId.length > 8
                                                    ? ellipsis(
                                                        item.tokenId,
                                                        4,
                                                        3
                                                      )
                                                    : item.tokenId}
                                                </>
                                              )}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] text-brand-gray200 font-mono">
                                            {ellipsis(
                                              item.contractAddress,
                                              4,
                                              4
                                            )}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-end">
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getTokenTypeBadgeColor(
                                            item.tokenStandard || 'ERC-20'
                                          )}`}
                                        >
                                          {item.tokenStandard || 'ERC-20'}
                                        </span>
                                      </div>
                                    </button>
                                  </Menu.Item>
                                </Menu.Item>
                              ) : null}
                            </div>
                          )
                        )}
                    </Menu.Items>
                  </div>
                )}
              </Menu>
            </Form.Item>
          </div>

          {/* Show amount field for fungible tokens and ERC-1155 NFTs */}
          {(!selectedAsset?.isNft ||
            selectedAsset?.tokenStandard === 'ERC-1155') && (
            <div className="flex md:w-96 relative">
              <div className="value-custom-input w-full relative">
                <span
                  onClick={
                    // Disable MAX button until verification complete
                    (selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155' &&
                      verifiedTokenBalance === null) ||
                    (!selectedAsset?.isNft &&
                      selectedAsset &&
                      verifiedERC20Balance === null) ||
                    isVerifyingERC20 ||
                    isVerifyingTokenId
                      ? undefined
                      : handleMaxButton
                  }
                  className={`absolute left-[15px] top-[50%] transform -translate-y-1/2 text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-[100px] z-10 ${
                    (selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155' &&
                      verifiedTokenBalance === null) ||
                    (!selectedAsset?.isNft &&
                      selectedAsset &&
                      verifiedERC20Balance === null) ||
                    isVerifyingERC20 ||
                    isVerifyingTokenId
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-alpha-whiteAlpha200'
                  }`}
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
                        // Check if value is empty
                        if (!value || value === '') {
                          return Promise.reject('');
                        }

                        // Convert to BigNumber for precise validation
                        let valueBN: BigNumber;
                        try {
                          // Parse the input value to wei for comparison
                          valueBN = parseEther(String(value));
                        } catch (e) {
                          // Invalid number format
                          return Promise.reject('');
                        }

                        // Check if it's positive
                        if (valueBN.lte(0)) {
                          return Promise.reject('');
                        }

                        const isToken = !!selectedAsset;
                        const isERC1155 =
                          selectedAsset?.isNft &&
                          selectedAsset?.tokenStandard === 'ERC-1155';

                        // For ERC-1155 NFTs, validate against verified balance
                        if (isERC1155) {
                          const numValue = parseFloat(value);

                          // Must be a positive integer (check the original float value)
                          if (!Number.isInteger(numValue) || numValue <= 0) {
                            return Promise.reject(
                              t('send.amountMustBePositiveInteger')
                            );
                          }

                          // REQUIRE verified balance - no fallback
                          if (verifiedTokenBalance === null) {
                            return Promise.reject(
                              t('send.pleaseVerifyTokenOwnership')
                            );
                          }

                          if (numValue > verifiedTokenBalance) {
                            return Promise.reject(
                              t('send.youOnlyOwn', {
                                amount: verifiedTokenBalance,
                              })
                            );
                          }

                          return Promise.resolve();
                        }

                        // For regular tokens
                        if (isToken) {
                          // Enforce token decimal precision on the raw string input
                          const decimalsAllowed = Number(
                            selectedAsset?.decimals ?? 18
                          );
                          const valueString = String(value);
                          if (valueString.includes('.')) {
                            const fractional = valueString.split('.')[1] || '';
                            if (
                              decimalsAllowed === 0 &&
                              fractional.length > 0
                            ) {
                              return Promise.reject(
                                t('send.amountMustBePositiveInteger')
                              );
                            }
                            if (
                              decimalsAllowed > 0 &&
                              fractional.length > decimalsAllowed
                            ) {
                              return Promise.reject(t('send.invalidAmount'));
                            }
                          }
                          // REQUIRE verified balance for ERC-20 tokens
                          if (verifiedERC20Balance === null) {
                            return Promise.reject(
                              t('send.pleaseWaitForBalanceVerification')
                            );
                          }

                          try {
                            const tokenBalanceBN = parseUnits(
                              String(verifiedERC20Balance),
                              Number(selectedAsset.decimals ?? 18)
                            );
                            const tokenValueBN = parseUnits(
                              String(value),
                              Number(selectedAsset.decimals ?? 18)
                            );

                            if (tokenValueBN.gt(tokenBalanceBN)) {
                              return Promise.reject(
                                t('send.insufficientFundsVerified', {
                                  balance: verifiedERC20Balance,
                                })
                              );
                            }
                          } catch (e) {
                            // Fallback to simple comparison using verified balance
                            const numValue = parseFloat(value);
                            if (numValue > verifiedERC20Balance) {
                              return Promise.reject(
                                t('send.insufficientFundsVerified', {
                                  balance: verifiedERC20Balance,
                                })
                              );
                            }
                          }

                          return Promise.resolve();
                        }

                        // For native currency, use BigNumber comparison
                        try {
                          const balanceEth = String(
                            activeAccount?.balances?.ethereum || 0
                          );
                          const balanceBN = parseEther(balanceEth);

                          // First check if amount exceeds total balance
                          if (valueBN.gt(balanceBN)) {
                            return Promise.reject(t('send.insufficientFunds'));
                          }

                          // For MAX sends, we need to ensure there's enough for gas
                          if (isMaxSend && valueBN.eq(balanceBN)) {
                            // For MAX sends, we'll validate gas availability at transaction time
                            // The backend will handle the proper gas deduction
                            return Promise.resolve();
                          }

                          // For non-MAX native ETH sends, validate against a conservative gas estimate
                          if (!isMaxSend) {
                            try {
                              // Use cached fee data if available, otherwise use conservative estimate
                              let estimatedGasCost: BigNumber;

                              if (cachedFeeData && cachedFeeData.maxFeePerGas) {
                                // Use cached fee data for estimation
                                const gasLimit = BigNumber.from(
                                  getDefaultGasLimit(
                                    TransactionType.NATIVE_ETH
                                  ).toString()
                                );
                                // cachedFeeData.maxFeePerGas is already a hex string
                                const maxFeePerGas = BigNumber.from(
                                  cachedFeeData.maxFeePerGas
                                );
                                estimatedGasCost = gasLimit.mul(maxFeePerGas);
                              } else {
                                // Use conservative fallback estimate
                                const conservativeFee =
                                  activeNetwork.chainId === 570
                                    ? '0.00001'
                                    : '0.001';
                                estimatedGasCost = parseEther(conservativeFee);
                              }

                              // Check if balance minus amount leaves enough for gas
                              const remainingAfterSend = balanceBN.sub(valueBN);

                              if (remainingAfterSend.lt(estimatedGasCost)) {
                                return Promise.reject(
                                  t('send.insufficientFundsForGas') ||
                                    'Insufficient funds for gas'
                                );
                              }
                            } catch (error) {
                              console.error(
                                'Error validating gas estimate:',
                                error
                              );
                              // On error, allow the transaction to proceed
                              // The backend will provide proper validation
                            }
                          }
                        } catch (e) {
                          console.error('Error in BigNumber validation:', e);
                          // Ultimate fallback - just check balance
                          const balance = parseFloat(
                            String(activeAccount?.balances?.ethereum || 0)
                          );
                          const numValue = parseFloat(value);
                          if (numValue > balance) {
                            return Promise.reject(t('send.insufficientFunds'));
                          }
                        }

                        return Promise.resolve();
                      },
                    }),
                  ]}
                >
                  <Input
                    id="with-max-button"
                    type="number"
                    step={
                      selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155'
                        ? '1'
                        : selectedAsset &&
                          !selectedAsset.isNft &&
                          Number(selectedAsset.decimals) === 0
                        ? '1'
                        : 'any'
                    }
                    min={selectedAsset?.isNft ? '1' : undefined}
                    max={
                      selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155' &&
                      verifiedTokenBalance !== null
                        ? String(verifiedTokenBalance)
                        : undefined
                    }
                    disabled={
                      // Disable until verification complete
                      (selectedAsset?.isNft &&
                        selectedAsset?.tokenStandard === 'ERC-1155' &&
                        verifiedTokenBalance === null) ||
                      (!selectedAsset?.isNft &&
                        selectedAsset &&
                        verifiedERC20Balance === null) ||
                      isVerifyingERC20 ||
                      isVerifyingTokenId
                    }
                    placeholder={
                      selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155'
                        ? verifiedTokenBalance !== null &&
                          verifiedTokenBalance > 1
                          ? `Amount (1-${verifiedTokenBalance})`
                          : t('send.amount')
                        : t('send.amount')
                    }
                    onChange={(e) => {
                      const inputValue = e.target.value;

                      if (!selectedAsset && inputValue) {
                        // Check if the entered value equals the full balance
                        const balanceEth = String(
                          activeAccount?.balances?.ethereum || 0
                        );

                        try {
                          const inputBN = parseEther(inputValue);
                          const balanceBN = parseEther(balanceEth);

                          // Check if amounts are equal or within a small tolerance (rounding tolerance)
                          const difference = balanceBN.sub(inputBN).abs();
                          setIsMaxSend(difference.lte(1000)); // Consider it max if difference is <= 1000 wei
                        } catch {
                          // If parsing fails, it's not a MAX send
                          setIsMaxSend(false);
                        }
                      } else {
                        // For tokens or empty input, clear MAX flag
                        setIsMaxSend(false);
                      }
                    }}
                    onBlur={(e) => {
                      try {
                        const raw = String(e?.target?.value ?? '');
                        if (!raw) {
                          handleFieldBlur();
                          return;
                        }
                        // Auto-truncate on blur for fungible tokens (ERC-20 only)
                        if (selectedAsset && !selectedAsset.isNft) {
                          const decimalsAllowed = Number(
                            selectedAsset.decimals ?? 18
                          );
                          const nextValue: string = truncateToDecimals(
                            raw,
                            Math.max(0, decimalsAllowed)
                          );
                          if (nextValue !== raw) {
                            form.setFieldValue('amount', nextValue);
                            formValuesRef.current = {
                              ...formValuesRef.current,
                              amount: nextValue,
                            };
                          }
                        }
                      } finally {
                        // Re-run validation and persist blur handling
                        form.validateFields(['amount']).catch(() => null);
                        handleFieldBlur();
                      }
                    }}
                  />
                </Form.Item>

                {/* Verification Status Display */}
                {selectedAsset && (
                  <div className="absolute -bottom-6 left-0 right-0">
                    {/* ERC-20 token verification status */}
                    {!selectedAsset.isNft && (
                      <div className="flex items-center justify-center gap-1">
                        {isVerifyingERC20 ? (
                          <>
                            <svg
                              className="animate-spin h-3 w-3 text-brand-royalblue"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              ></circle>
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              ></path>
                            </svg>
                            <p className="text-brand-royalblue text-[10px]">
                              {t('send.verifyingBalance')}
                            </p>
                          </>
                        ) : verifiedERC20Balance === null ? (
                          <p className="text-brand-gray200 text-[10px]">
                            {t('send.waitingForBalanceVerification')}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* NFT Token ID Selector - Only show for ERC-721 */}
        {selectedAsset?.isNft &&
          selectedAsset?.tokenStandard !== 'ERC-1155' && (
            <div className="w-full md:max-w-md">
              <div className="mb-2">
                <label className="text-brand-gray200 text-xs">
                  {t('send.selectNft')}
                </label>
              </div>

              {/* Quick select buttons for discovered tokens */}
              {nftTokenIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {nftTokenIds.map((nft) => (
                    <button
                      key={nft.tokenId}
                      type="button"
                      onClick={() => {
                        setSelectedNftTokenId(nft.tokenId);
                        form.setFieldValue('nftTokenId', nft.tokenId);
                        setVerifiedTokenBalance(nft.balance); // Already verified from enumeration
                        setVerificationError(null);
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        selectedNftTokenId === nft.tokenId
                          ? 'bg-brand-royalblue text-white'
                          : 'bg-fields-input-primary border border-fields-input-border text-brand-gray200 hover:border-brand-royalblue hover:text-white'
                      }`}
                    >
                      #{nft.tokenId}
                      {nft.balance > 1 && ` (${nft.balance}x)`}
                    </button>
                  ))}
                </div>
              )}

              {/* Manual token ID input */}
              <div className="sender-custom-input">
                <Form.Item
                  name="nftTokenId"
                  hasFeedback
                  rules={[
                    {
                      required: true,
                      message: '',
                    },
                    {
                      validator: (_, value) => {
                        if (!value || value.trim() === '') {
                          return Promise.reject(
                            new Error(t('tokens.tokenIdIsRequired'))
                          );
                        }
                        // Basic validation for token ID format
                        if (!/^\d+$/.test(value)) {
                          return Promise.reject(
                            new Error(t('tokens.tokenIdMustBeNumber'))
                          );
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input
                    type="text"
                    value={form.getFieldValue('nftTokenId') || ''}
                    placeholder={
                      isLoadingNftTokenIds
                        ? t('networkConnection.loadingNfts')
                        : t('send.enterTokenId')
                    }
                    disabled={isLoadingNftTokenIds}
                    onChange={(e) => handleManualTokenIdChange(e.target.value)}
                    onBlur={handleFieldBlur}
                  />
                </Form.Item>
              </div>

              {/* Verification status display */}
              {selectedNftTokenId &&
                !nftTokenIds.find(
                  (nft) => nft.tokenId === selectedNftTokenId
                ) && (
                  <div className="mt-2">
                    {isVerifyingTokenId ? (
                      <p className="text-xs text-brand-royalblue flex items-center justify-center">
                        <svg
                          className="animate-spin -ml-1 mr-2 h-3 w-3 text-brand-royalblue"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        {t('send.verifyingOwnership')}
                      </p>
                    ) : verificationError ? (
                      <p className="text-xs text-red-400 text-center">
                        ❌ {verificationError}
                      </p>
                    ) : verifiedTokenBalance !== null ? (
                      verifiedTokenBalance > 0 ? (
                        <p className="text-xs text-green-400 text-center">
                          ✅ {t('send.youOwnThisToken')}
                        </p>
                      ) : (
                        <p className="text-xs text-red-400 text-center">
                          ❌ {t('send.youDontOwnThisToken')}
                        </p>
                      )
                    ) : null}
                  </div>
                )}

              <p className="text-brand-gray200 text-[10px] mt-1 text-center">
                {nftTokenIds.length > 0
                  ? t('send.clickTokenOrEnterManually')
                  : t('send.enterNftTokenId')}
              </p>
            </div>
          )}

        <div className="fixed bottom-4 left-4 right-4 md:relative md:bottom-auto md:left-auto md:right-auto md:mt-3 md:w-[96%]">
          <NeutralButton
            type="submit"
            fullWidth
            loading={!selectedAsset && isCalculatingGas}
          >
            {t('buttons.next')}
          </NeutralButton>
        </div>
      </Form>
    </div>
  );
};
