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
import { Button, Icon, Tooltip } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useRequestScope } from 'hooks/useRequestScope';
import { RootState } from 'state/store';
import {
  selectEnsNameToAddress,
  selectActiveAccountWithAssets,
  selectValidEnsCache,
} from 'state/vault/selectors';
import { ENS_CACHE_TTL_MS } from 'state/vaultGlobal';
import { ITokenEthProps } from 'types/tokens';
import {
  findEvmAddressPoisoningCollision,
  getTrustedEvmRecipients,
} from 'utils/addressPoisoning';
import { parseEther, parseUnits, formatUnits } from 'utils/ethersV6Compat';
import { BigNumber } from 'utils/ethersV6Compat';
import { getLocalEvmRecipients } from 'utils/evmRecipients';
import {
  getAssetBalance,
  ellipsis,
  formatFullPrecisionBalance,
  createNavigationContext,
  getTokenTypeBadgeColor,
  navigateWithContext,
  getWalletNavigationScope,
} from 'utils/index';
import { buildExplorerUrl } from 'utils/strings';
import { getDefaultGasLimit } from 'utils/transactionUtils';
import { isValidEthereumAddress } from 'utils/validations';

import {
  getScopedSendDraft,
  useSendDraftWriter,
  useSendPreparationGuard,
} from './useSendDraftWriter';

const renderVerificationSpinner = (className: string) => (
  <svg
    className={className}
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
);

const getExactNftBalance = (token: {
  balance: number;
  rawBalance?: string;
}): string | null => {
  if (
    (token.rawBalance === undefined || token.rawBalance === null) &&
    (!Number.isSafeInteger(token.balance) || token.balance < 0)
  )
    return null;
  const value = token.rawBalance ?? String(token.balance);
  return typeof value === 'string' && /^\d+$/.test(value)
    ? BigNumber.from(value).toString()
    : null;
};

// Share the existing 1,000-wei tolerance across validation, preview and draft UI.
const isNativeMaxAmount = (amount: string, balance: string): boolean => {
  try {
    return parseEther(balance).sub(parseEther(amount)).abs().lte(1000);
  } catch {
    return false;
  }
};

export const SendEth = () => {
  const scopeKey = useSelector(() =>
    JSON.stringify(getWalletNavigationScope())
  );
  return <SendEthForm key={scopeKey} scopeKey={scopeKey} />;
};

const SendEthForm = ({ scopeKey }: { scopeKey: string }) => {
  const { alert, navigate } = useUtils();
  const { t } = useTranslation();
  const {
    controllerEmitter,
    isUnlocked,
    isLoading: controllerLoading,
    connectionUnavailable,
  } = useController();
  const location = useLocation();
  const isCurrentForm = useSendPreparationGuard(scopeKey, location.pathname);
  const beginAddressCopy = useRequestScope(scopeKey);

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

  const hasAccountAssets = Boolean(activeAccountAssets?.ethereum);
  const isAccountImported = activeAccount?.isImported || false;

  // Hydrate only the matching account/network draft, once for this mounted form.
  const initialDraft = useRef(
    getScopedSendDraft(location.pathname, location.state, scopeKey)
  ).current;
  const initialSelectedAsset = initialDraft.selectedAsset || null;
  const initialSelectedNftTokenId =
    initialDraft.formValues?.nftTokenId ??
    initialDraft.selectedNftTokenId ??
    null;
  const initialIsMaxSend = initialDraft.isMaxSend === true;

  const [selectedAsset, setSelectedAsset] = useState<ITokenEthProps | null>(
    initialSelectedAsset
  );
  const [isCalculatingGas, setIsCalculatingGas] = useState(false);
  const [cachedFeeData, setCachedFeeData] = useState<any>(null);
  const [isMaxSend, setIsMaxSend] = useState(initialIsMaxSend);

  // NFT-related state
  const [nftTokenIds, setNftTokenIds] = useState<
    { balance: number; rawBalance?: string; tokenId: string }[]
  >([]);
  const [isLoadingNftTokenIds, setIsLoadingNftTokenIds] = useState(false);
  const [selectedNftTokenId, setSelectedNftTokenId] = useState<string | null>(
    initialSelectedNftTokenId
  );
  const [isVerifyingTokenId, setIsVerifyingTokenId] = useState(false);
  const [verifiedTokenBalance, setVerifiedTokenBalance] = useState<
    string | null
  >(null);
  const [verificationError, setVerificationError] = useState<string | null>(
    null
  );

  // ERC-20 verification state
  const [isVerifyingERC20, setIsVerifyingERC20] = useState(false);
  const [verifiedERC20Balance, setVerifiedERC20Balance] = useState<{
    atomic: string;
    decimals: number;
    formatted: string;
  } | null>(null);
  const selectedTokenDecimals =
    verifiedERC20Balance?.decimals ?? selectedAsset?.decimals ?? 18;

  const [form] = Form.useForm();
  // Receiver suggestions / ENS state
  const [receiverInput, setReceiverInput] = useState('');
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { address: string; label: string; type: 'account' | 'recent' | 'ens' }[]
  >([]);

  const accounts = useSelector((state: RootState) => state.vault.accounts);
  // Use valid (non-expired) ENS cache for security
  const ensCache = useSelector(selectValidEnsCache);
  const ensNameToAddress = useSelector(selectEnsNameToAddress);
  const resolvedEnsRecipient = useRef<{
    address: string;
    editRevision: number;
    expiresAt: number;
    input: string;
    lookupRevision: number;
  } | null>(null);
  const receiverEditRevision = useRef(0);
  const ensLookupRevision = useRef(0);
  const vaultActiveAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );
  const currentEvmTransactions = useMemo(
    () =>
      accountTransactions?.[vaultActiveAccount.type]?.[vaultActiveAccount.id]
        ?.ethereum?.[activeNetwork?.chainId] || [],
    [
      accountTransactions,
      activeNetwork?.chainId,
      vaultActiveAccount.id,
      vaultActiveAccount.type,
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
  const {
    accounts: localRecipientAccounts,
    addresses: localEvmAddresses,
    incompatibleSmartAddresses,
  } = useMemo(
    () => getLocalEvmRecipients(accounts, activeNetwork),
    [accounts, activeNetwork]
  );

  // Disable MAX sends when there is a pending outgoing tx.
  // Many RPCs do not expose a reliable "pending spendable" balance, so allowing MAX
  // while the account has an in-flight tx often results in mempool rejection.
  const hasPendingOutgoingEvmTx = useMemo(() => {
    try {
      if (!activeAccount?.address) return false;
      const chainId = Number(activeNetwork?.chainId);
      const txs =
        accountTransactions?.[vaultActiveAccount.type]?.[vaultActiveAccount.id]
          ?.ethereum?.[chainId] || [];
      const fromLower = String(activeAccount.address).toLowerCase();
      return (txs as any[]).some((tx) => {
        const txFrom = String(tx?.from || '').toLowerCase();
        if (!txFrom || txFrom !== fromLower) return false;
        if (tx?.isCanceled) return false;
        if (tx?.isReplaced) return false;
        if (String(tx?.status || '').toLowerCase() === 'replaced') return false;
        // Some networks/providers do not populate `confirmations` reliably (can remain 0
        // even when mined). Treat as "pending" only if we have no on-chain inclusion info.
        const hasBlockNumber =
          tx?.blockNumber !== undefined &&
          tx?.blockNumber !== null &&
          Number(tx.blockNumber) > 0;
        const hasBlockHash = Boolean(tx?.blockHash);
        if (hasBlockNumber || hasBlockHash) return false; // mined/included

        const confirmations = Number(tx?.confirmations ?? 0);
        return confirmations === 0; // pending/unmined
      });
    } catch {
      return false;
    }
  }, [
    activeAccount?.address,
    activeNetwork?.chainId,
    accountTransactions,
    vaultActiveAccount.id,
    vaultActiveAccount.type,
  ]);

  // Track form value changes using a ref to avoid dependency issues
  const formValuesRef = useRef<any>(initialDraft.formValues || {});
  const tokenIdVerificationTimeoutRef = useRef<NodeJS.Timeout>();
  const nftRequest = useRef(0);
  // Bind positive ownership to this exact form/contract/ID, and invalidate it
  // synchronously before an input change can submit through an old render.
  const ownedNftRef = useRef<string | null>(null);
  const nftOwnershipKey = (contract: string, tokenId: string) =>
    `${scopeKey}:${contract.toLowerCase()}:${tokenId}`;
  const beginNftLookup = useCallback(() => {
    const request = ++nftRequest.current;
    ownedNftRef.current = null;
    clearTimeout(tokenIdVerificationTimeoutRef.current);
    setIsLoadingNftTokenIds(false);
    setIsVerifyingTokenId(false);
    setVerifiedTokenBalance(null);
    setVerificationError(null);
    return () => request === nftRequest.current && isCurrentForm();
  }, [isCurrentForm]);

  useEffect(() => {
    const refreshBalances = async () => {
      try {
        await controllerEmitter(
          ['wallet', 'refreshActiveAccountBalances'],
          [{ includeAssets: false }]
        );
      } catch (error) {
        console.error('Failed to refresh send balances:', error);
      }
    };

    refreshBalances();
  }, [activeAccount?.address, activeNetwork.chainId]);

  useEffect(() => {
    if (!selectedAsset || !activeAccountAssets?.ethereum) return;

    const refreshedAsset = activeAccountAssets.ethereum.find((asset) => {
      const sameContract =
        asset.contractAddress?.toLowerCase() ===
        selectedAsset.contractAddress?.toLowerCase();
      const sameTokenId =
        String(asset.tokenId || '') === String(selectedAsset.tokenId || '');
      const sameChain =
        asset.chainId === activeNetwork.chainId &&
        selectedAsset.chainId === activeNetwork.chainId;

      return sameContract && sameTokenId && sameChain;
    });

    if (
      refreshedAsset &&
      (String(refreshedAsset.balance) !== String(selectedAsset.balance) ||
        refreshedAsset.rawBalance !== selectedAsset.rawBalance)
    ) {
      setSelectedAsset(refreshedAsset);
      if (refreshedAsset.isNft && refreshedAsset.tokenStandard === 'ERC-1155') {
        // A newer balance read supersedes any in-flight ownership lookup.
        beginNftLookup();
        setVerifiedTokenBalance(getExactNftBalance(refreshedAsset));
      }
    }
  }, [
    activeAccountAssets?.ethereum,
    selectedAsset?.balance,
    selectedAsset?.rawBalance,
    selectedAsset?.chainId,
    selectedAsset?.contractAddress,
    selectedAsset?.tokenId,
    activeNetwork.chainId,
    beginNftLookup,
  ]);

  const draftState = useMemo(
    () => ({ selectedAsset, selectedNftTokenId, isMaxSend }),
    [selectedAsset, selectedNftTokenId, isMaxSend]
  );
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
    (_changedValues: any, allValues: any) => {
      formValuesRef.current = allValues;
      if (typeof allValues?.receiver === 'string') {
        setReceiverInput(allValues.receiver);
      }
      void saveCurrentState(allValues);
    },
    [saveCurrentState]
  );

  // Initialize receiverInput from form on mount (restored state)
  useEffect(() => {
    const initialReceiver = form.getFieldValue('receiver');
    if (typeof initialReceiver === 'string') {
      setReceiverInput(initialReceiver);
    }
  }, [form]);

  // A memoized selector (or this callback's closure) can outlive an entry's
  // TTL. Check its backing name and timestamp at the actual use boundary.
  const getCachedEnsRecipient = useCallback(
    (name: string) => {
      const address = ensNameToAddress[name.toLowerCase()];
      const entry = address && ensCache[address.toLowerCase()];
      const expiresAt = entry ? entry.timestamp + ENS_CACHE_TTL_MS : 0;
      return entry &&
        entry.name.toLowerCase() === name.toLowerCase() &&
        Date.now() < expiresAt
        ? { address, expiresAt }
        : null;
    },
    [ensNameToAddress, ensCache]
  );

  // Minimal ENS resolver via background method
  const tryResolveEns = useCallback(
    async (
      maybeEns: string
    ): Promise<{ address: string; expiresAt: number } | null> => {
      if (!maybeEns || !maybeEns.toLowerCase().endsWith('.eth')) return null;
      // 1) Try cache first
      const cached = getCachedEnsRecipient(maybeEns);
      if (cached && cached.address.startsWith('0x')) return cached;
      // 2) Fallback to background resolver on mainnet
      try {
        const resolved = (await controllerEmitter(
          ['wallet', 'resolveEns'],
          [maybeEns]
        )) as string | null;
        if (!isCurrentForm()) return null;
        if (
          resolved &&
          typeof resolved === 'string' &&
          resolved.startsWith('0x')
        ) {
          return {
            address: resolved,
            expiresAt: Date.now() + ENS_CACHE_TTL_MS,
          };
        }
        return null;
      } catch (_e) {
        return null;
      }
    },
    [getCachedEnsRecipient, isCurrentForm]
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
        localRecipientAccounts.forEach((acct) => {
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
      } catch {}

      // Only recipients from canonical outbound transactions are trusted as
      // recent. Incoming dust and explorer token-event placeholders are never
      // promoted into an address-selection surface.
      trustedRecentRecipients.forEach((address) => {
        if (incompatibleSmartAddresses.has(address.toLowerCase())) return;
        const maybeName = (ensCache as any)?.[address]?.name;
        const display = maybeName || address;
        if (!q || String(display).toLowerCase().includes(q)) {
          results.push({ label: display, address, type: 'recent' });
        }
      });

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
    [
      localRecipientAccounts,
      incompatibleSmartAddresses,
      ensCache,
      trustedRecentRecipients,
    ]
  );

  // Save state when user blurs from input fields
  const handleFieldBlur = () => {
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
  };

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
    if (!hasRestoredRef.current) {
      hasRestoredRef.current = true;
      const { formValues, isMaxSend: restoredIsMaxSend } = initialDraft;

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
  }, [initialDraft, form]); // Hydration never reapplies mirrored route drafts.

  // ✅ MEMOIZED: Handlers
  const handleSelectedAsset = async (value: string) => {
    const current = beginNftLookup();
    setNftTokenIds([]);
    setSelectedNftTokenId(null);
    try {
      if (value === '-1') {
        setSelectedAsset(null);
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
            setVerifiedTokenBalance(getExactNftBalance(getAsset));
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

              if (!current()) return;
              setNftTokenIds(result || []);

              // Auto-select first token if only one
              if (result && result.length === 1) {
                setSelectedNftTokenId(result[0].tokenId);
                // Also set it in the form
                form.setFieldValue('nftTokenId', result[0].tokenId);
                if (result[0].balance > 0)
                  ownedNftRef.current = nftOwnershipKey(
                    getAsset.contractAddress,
                    result[0].tokenId
                  );
              }
            } catch {
              if (!current()) return;
              setNftTokenIds([]);
              alert.error(t('send.errorLoadingNfts'));
            } finally {
              if (current()) setIsLoadingNftTokenIds(false);
            }
          }
        } else {
          // Clear the NFT token ID field when switching away from NFT
          form.setFieldValue('nftTokenId', undefined);
        }
      } else {
        setSelectedAsset(null);
      }
    } catch (error) {
      console.error(error);
    }
  };

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
      if (!isCurrentForm()) return;
      if (
        selectedAsset?.isNft &&
        selectedAsset.tokenStandard !== 'ERC-1155' &&
        ownedNftRef.current !==
          nftOwnershipKey(
            selectedAsset.contractAddress,
            String(values.nftTokenId || '').trim()
          )
      ) {
        alert.error(
          isVerifyingTokenId
            ? t('send.verifyingOwnership')
            : verificationError || t('send.tokenVerificationFailed')
        );
        return;
      }
      try {
        const receiver = String(values.receiver || '');
        // Only submit the result this validation admitted. A concurrent cache
        // publication must not substitute an unchecked destination at onFinish.
        const destination = receiver.toLowerCase().endsWith('.eth')
          ? resolvedEnsRecipient.current?.input === receiver.toLowerCase() &&
            resolvedEnsRecipient.current.editRevision ===
              receiverEditRevision.current &&
            resolvedEnsRecipient.current.lookupRevision ===
              ensLookupRevision.current &&
            Date.now() < resolvedEnsRecipient.current.expiresAt
            ? resolvedEnsRecipient.current.address
            : null
          : receiver;
        if (!destination) {
          alert.error(t('send.unableToResolveEns'));
          return;
        }
        if (
          destination &&
          incompatibleSmartAddresses.has(destination.toLowerCase())
        ) {
          alert.error(t('send.smartAccountWrongNetwork'));
          return;
        }
        values = { ...values, receiver: destination };
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

        const isMax =
          !selectedAsset &&
          Boolean(values.amount) &&
          isNativeMaxAmount(
            values.amount,
            String(activeAccount?.balances?.ethereum || 0)
          );

        // If the user is trying to MAX-send while they already have a pending outgoing tx,
        // block it to prevent mempool "insufficient funds" rejections.
        if (!selectedAsset && isMax && hasPendingOutgoingEvmTx) {
          alert.error(t('send.maxUnavailablePendingTx'));
          return;
        }

        // Prepare component state to preserve
        // Capture ALL form values at submission time
        const allFormValues = form.getFieldsValue();
        const state = {
          formValues: allFormValues,
          selectedAsset,
          selectedNftTokenId,
          isMaxSend: isMax, // Use the calculated isMax value
        };

        // Create navigation context for returning from confirm
        const returnContext = {
          ...createNavigationContext('/send/eth', undefined, state),
          // Include existing return context to make it recursive
          returnContext: location.state?.returnContext,
        };

        // Use navigateWithContext to automatically handle state preservation
        if (!isCurrentForm()) return;
        navigateWithContext(
          navigate,
          '/send/confirm',
          {
            submissionStarted: false,
            tx: {
              sender: activeAccount.address,
              receivingAddress: values.receiver,
              amount: values.amount,
              token: selectedAsset
                ? {
                    ...selectedAsset,
                    ...(!selectedAsset.isNft && verifiedERC20Balance
                      ? { decimals: verifiedERC20Balance.decimals }
                      : {}),
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
      hasPendingOutgoingEvmTx,
      isVerifyingTokenId,
      verificationError,
      nftOwnershipKey,
      location.state?.returnContext,
      isCurrentForm,
      incompatibleSmartAddresses,
      verifiedERC20Balance,
    ]
  );

  const finalBalance = () => {
    if (selectedAsset) {
      // For ERC-20 tokens, prefer verified balance if available
      if (!selectedAsset.isNft && verifiedERC20Balance !== null) {
        const displayBalance = formatFullPrecisionBalance(
          verifiedERC20Balance.formatted,
          4
        );
        return `${displayBalance} ${
          selectedAsset.tokenSymbol?.toUpperCase() || ''
        }`;
      }

      if (selectedAsset.tokenStandard === 'ERC-1155') {
        const balance =
          verifiedTokenBalance ?? getExactNftBalance(selectedAsset);
        if (balance !== null)
          return `${formatFullPrecisionBalance(balance, 4)} ${
            selectedAsset.tokenSymbol
          }`;
      }

      // For NFTs and unverified tokens, use stored balance
      return getAssetBalance(selectedAsset, false);
    }

    // For native currency, format the balance for display (4 decimals)
    const fullBalance = String(activeAccount?.balances?.ethereum || 0);
    const displayBalance = formatFullPrecisionBalance(fullBalance, 4);

    return `${displayBalance} ${activeNetwork.currency.toUpperCase()}`;
  };

  const getLabel = () => {
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
  };

  const openAccountInExplorer = useCallback(() => {
    const accountAddress = activeAccount?.address;
    if (!accountAddress) return;

    window.open(
      buildExplorerUrl(
        activeNetwork.explorer || activeNetwork.url,
        'address',
        accountAddress
      ),
      '_blank'
    );
  }, [
    activeAccount?.address,
    isBitcoinBased,
    activeNetwork.url,
    activeNetwork.explorer,
  ]);

  const handleMaxButton = () => {
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

        // Keep the verified atomic balance exact, including dust and uint256s
        // beyond JavaScript's integer precision. Fees use the native currency.
        fullBalance = verifiedERC20Balance.formatted;
      } else {
        // For ERC-721, this shouldn't be called (amount field is hidden)
        return;
      }
    } else {
      // For native ETH, use full balance
      // The backend will handle gas deduction for MAX sends
      if (hasPendingOutgoingEvmTx) {
        alert.error(t('send.maxUnavailablePendingTx'));
        return;
      }
      fullBalance = String(activeAccount?.balances?.ethereum || 0);
    }

    form.setFieldValue('amount', fullBalance);
    setIsMaxSend(true);

    // Update the form values ref immediately
    formValuesRef.current = { ...formValuesRef.current, amount: fullBalance };

    // Force validation to run after setting the value
    void form.validateFields(['amount']).catch(() => undefined);

    // Save state immediately after MAX is set
    setTimeout(() => {
      saveCurrentState();
    }, 0);
  };

  // Verify manually entered NFT token ID
  const verifyTokenId = async (tokenId: string) => {
    const current = beginNftLookup();
    if (!selectedAsset || !activeAccount.address || !tokenId.trim()) {
      return;
    }

    setIsVerifyingTokenId(true);

    try {
      const result = (await controllerEmitter(
        [
          'wallet',
          selectedAsset?.tokenStandard === 'ERC-721'
            ? 'verifyERC721Ownership'
            : 'verifyERC1155Ownership',
        ],
        [selectedAsset.contractAddress, activeAccount.address, [tokenId]]
      )) as {
        balance: number;
        rawBalance?: string;
        tokenId: string;
        verified: boolean;
      }[];

      if (!current()) return;
      if (result && result.length > 0) {
        const tokenInfo = result[0];
        const balance = getExactNftBalance(tokenInfo);
        if (tokenInfo.verified && balance !== null && balance !== '0') {
          ownedNftRef.current = nftOwnershipKey(
            selectedAsset.contractAddress,
            tokenId.trim()
          );
          setVerifiedTokenBalance(balance);
          setVerificationError(null);
        } else {
          setVerifiedTokenBalance('0');
          setVerificationError(
            balance === '0'
              ? t('send.youDontOwnThisToken')
              : t('send.tokenVerificationFailed')
          );
        }
      } else {
        setVerifiedTokenBalance('0');
        setVerificationError(t('send.tokenNotFound'));
      }
    } catch {
      if (!current()) return;
      setVerifiedTokenBalance('0');
      setVerificationError(t('send.verificationFailed'));
    } finally {
      if (current()) setIsVerifyingTokenId(false);
    }
  };

  const hasCheckedRestoredNft = useRef(false);
  useEffect(() => {
    if (hasCheckedRestoredNft.current) return;
    hasCheckedRestoredNft.current = true;
    if (!initialDraft.selectedAsset?.isNft) return;
    const tokenId = String(
      initialDraft.formValues?.nftTokenId ??
        initialDraft.selectedNftTokenId ??
        initialDraft.selectedAsset.tokenId ??
        ''
    );
    if (tokenId) void verifyTokenId(tokenId);
  }, [initialDraft, verifyTokenId]);

  // Handle manual token ID input with debounced verification
  const handleManualTokenIdChange = (value: string) => {
    beginNftLookup();
    setSelectedNftTokenId(value);
    // Also update the form field to keep them in sync
    form.setFieldValue('nftTokenId', value);

    if (value) {
      // Debounce verification to avoid too many calls
      tokenIdVerificationTimeoutRef.current = setTimeout(() => {
        verifyTokenId(value);
      }, 500);
    }
  };

  // A verified balance belongs only to this selection and request lifetime.
  useEffect(() => {
    let current = true;
    setVerifiedERC20Balance(null);
    setIsVerifyingERC20(false);
    if (!selectedAsset || selectedAsset.isNft || !activeAccount.address) return;
    setVerificationError(null);

    const timeoutId = setTimeout(async () => {
      setIsVerifyingERC20(true);
      try {
        const result = (await controllerEmitter(
          ['wallet', 'getERC20TokenInfo'],
          [selectedAsset.contractAddress, activeAccount.address]
        )) as { balance: string; decimals: number };
        if (current) {
          if (
            !result ||
            typeof result.balance !== 'string' ||
            !/^\d+$/.test(result.balance) ||
            !Number.isInteger(result.decimals) ||
            result.decimals < 0 ||
            result.decimals > 255
          )
            throw new Error('Invalid ERC-20 balance');
          const atomic = BigNumber.from(result.balance).toString();
          setVerifiedERC20Balance({
            atomic,
            decimals: result.decimals,
            formatted: formatUnits(atomic, result.decimals).replace(/\.0$/, ''),
          });
        }
      } catch (error) {
        if (current) {
          setVerificationError(t('send.tokenVerificationFailed'));
          console.error('Error verifying ERC-20 balance:', error);
        }
      } finally {
        if (current) setIsVerifyingERC20(false);
      }
    }, 1000);
    return () => {
      current = false;
      clearTimeout(timeoutId);
    };
  }, [selectedAsset, activeAccount.address]);

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
    let current = true;
    reverseEnsTimeoutRef.current = setTimeout(async () => {
      try {
        await controllerEmitter(['wallet', 'reverseResolveEns'], [input]);
        if (
          current &&
          isCurrentForm() &&
          form.getFieldValue('receiver') === input
        )
          buildSuggestions(input);
      } catch {}
    }, 600);

    return () => {
      current = false;
      if (reverseEnsTimeoutRef.current) {
        clearTimeout(reverseEnsTimeoutRef.current);
        reverseEnsTimeoutRef.current = undefined;
      }
    };
  }, [receiverInput, ensCache, buildSuggestions, isCurrentForm, form]);

  // Calculate gas fees when component mounts or asset changes
  useEffect(() => {
    if (selectedAsset || !activeAccount?.address || cachedFeeData) return;
    let current = true;
    setIsCalculatingGas(true);

    const calculateGasFees = async () => {
      try {
        const feeData = (await controllerEmitter([
          'wallet',
          'ethereumTransaction',
          'getFeeDataWithDynamicMaxPriorityFeePerGas',
        ])) as any;

        if (current && feeData?.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          // Cache serializable fee rates; the backend handles the gas limit.
          setCachedFeeData({
            maxFeePerGas: BigNumber.from(feeData.maxFeePerGas).toHexString(),
            maxPriorityFeePerGas: BigNumber.from(
              feeData.maxPriorityFeePerGas
            ).toHexString(),
          });
        }
      } catch (error) {
        console.error('Error calculating gas fees:', error);
        // Leave failed prefetches uncached; confirmation still validates fees.
      } finally {
        if (current) setIsCalculatingGas(false);
      }
    };
    void calculateGasFees();
    return () => {
      current = false;
    };
  }, [selectedAsset, activeAccount?.address, cachedFeeData]);

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

  const isAmountDisabled =
    (selectedAsset?.isNft &&
      selectedAsset?.tokenStandard === 'ERC-1155' &&
      verifiedTokenBalance === null) ||
    (!selectedAsset?.isNft && selectedAsset && verifiedERC20Balance === null) ||
    isVerifyingERC20 ||
    isVerifyingTokenId;

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
          <p
            className="text-white text-xs font-semibold"
            title={verifiedTokenBalance || undefined}
          >
            {finalBalance()}
          </p>
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
        onFinish={handleSubmit}
        autoComplete="off"
        className="flex flex-col gap-2 items-center justify-center mt-6 text-center w-full pb-20 md:pb-0"
        onValuesChange={handleFormValuesChange}
        initialValues={initialDraft.formValues}
      >
        <div className="sender-custom-input">
          <Form.Item
            name="receiver"
            className="w-full md:max-w-md"
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

                  const assertNotPoisoned = (address: string) => {
                    if (incompatibleSmartAddresses.has(address.toLowerCase())) {
                      throw new Error(t('send.smartAccountWrongNetwork'));
                    }
                    const collision = findEvmAddressPoisoningCollision(
                      address,
                      trustedRecentRecipients,
                      localEvmAddresses
                    );
                    if (collision) {
                      throw new Error(
                        t('send.addressPoisoningBlocked', {
                          address: collision.trustedAddress,
                        })
                      );
                    }
                  };

                  // Accept valid hex addresses directly
                  if (isValidEthereumAddress(value)) {
                    assertNotPoisoned(value);
                    return Promise.resolve();
                  }

                  // Attempt ENS resolution for .eth names on mainnet
                  if (
                    typeof value === 'string' &&
                    value.toLowerCase().endsWith('.eth')
                  ) {
                    const editRevision = receiverEditRevision.current;
                    const lookupRevision = ++ensLookupRevision.current;
                    const resolved = await tryResolveEns(value);
                    if (
                      !isCurrentForm() ||
                      receiverEditRevision.current !== editRevision ||
                      ensLookupRevision.current !== lookupRevision ||
                      form.getFieldValue('receiver') !== value
                    )
                      return Promise.reject(
                        new Error('Send form is no longer active.')
                      );
                    if (resolved) {
                      assertNotPoisoned(resolved.address);
                      resolvedEnsRecipient.current = {
                        input: String(value).toLowerCase(),
                        editRevision,
                        lookupRevision,
                        ...resolved,
                      };
                      // Preserve ENS intent in the input and draft so a later
                      // Next revalidates the name instead of trusting derived hex.
                      void saveCurrentState();
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(t('send.unableToResolveEns'))
                    );
                  }

                  return Promise.reject(new Error(t('send.invalidEthAddress')));
                },
              }),
            ]}
          >
            <div
              className="relative"
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null
                  )
                ) {
                  setIsSuggestionsOpen(false);
                }
              }}
            >
              <Input
                type="text"
                placeholder={t('send.receiver')}
                value={receiverInput}
                onChange={(e) => {
                  const v = e.target.value || '';
                  receiverEditRevision.current += 1;
                  resolvedEnsRecipient.current = null;
                  setReceiverInput(v);
                  // Keep Form state in sync so validation can react to typing
                  form.setFieldValue('receiver', v);
                  void saveCurrentState();
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
                        receiverEditRevision.current += 1;
                        resolvedEnsRecipient.current = null;
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

        <div className="flex gap-2 w-full items-start mb-6">
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
                    <Menu.Button className="inline-flex items-center w-[100px] gap-4 justify-center border border-alpha-whiteAlpha300 px-5 py-[7px] bg-brand-blue800 hover:bg-opacity-30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
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
                      unmount={false}
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
                                <Menu.Item>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectedAsset(item.id)}
                                    className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                  >
                                    <div className="flex flex-col items-start flex-1 overflow-hidden">
                                      <p className="truncate max-w-[100px]">
                                        {item.tokenSymbol.length > 8
                                          ? item.tokenSymbol.slice(0, 8) + '...'
                                          : item.tokenSymbol}
                                      </p>
                                      <span className="text-[10px] text-brand-gray200 font-mono">
                                        {ellipsis(item.contractAddress, 4, 4)}
                                        {item.isNft &&
                                          item.tokenStandard === 'ERC-1155' &&
                                          item.tokenId && (
                                            <>
                                              {' '}
                                              • #
                                              {item.tokenId.length > 8
                                                ? ellipsis(item.tokenId, 4, 3)
                                                : item.tokenId}
                                            </>
                                          )}
                                      </span>
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
            <div className="flex flex-1 min-w-0 relative">
              <div className="value-custom-input w-full relative">
                <button
                  type="button"
                  disabled={isAmountDisabled}
                  onClick={
                    // Disable MAX button until verification complete
                    isAmountDisabled ? undefined : handleMaxButton
                  }
                  className={`absolute left-[15px] top-5 transform -translate-y-1/2 text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-pill z-10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-bkg-1 ${
                    isAmountDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-alpha-whiteAlpha200'
                  }`}
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
                      message: '',
                    },
                    () => ({
                      async validator(_, value) {
                        // Check if value is empty
                        if (!value || value === '') {
                          return Promise.reject('');
                        }

                        // Fungible amounts use the token's verified decimal
                        // scale, never native ETH's 18-decimal parser or floats.
                        if (selectedAsset && !selectedAsset.isNft) {
                          if (verifiedERC20Balance === null) {
                            return Promise.reject(
                              t('send.pleaseWaitForBalanceVerification')
                            );
                          }
                          const { atomic, decimals, formatted } =
                            verifiedERC20Balance;
                          const valueString = String(value);
                          const fractional = valueString.split('.')[1] || '';
                          if (fractional.length > decimals) {
                            return Promise.reject(
                              t(
                                decimals === 0
                                  ? 'send.amountMustBePositiveInteger'
                                  : 'send.invalidAmount'
                              )
                            );
                          }
                          let tokenValue: BigNumber;
                          try {
                            tokenValue = parseUnits(valueString, decimals);
                          } catch {
                            return Promise.reject(t('send.invalidAmount'));
                          }
                          if (tokenValue.lte(0)) return Promise.reject('');
                          if (tokenValue.gt(atomic)) {
                            return Promise.reject(
                              t('send.insufficientFundsVerified', {
                                balance: formatted,
                              })
                            );
                          }
                          return Promise.resolve();
                        }

                        const isERC1155 =
                          selectedAsset?.isNft &&
                          selectedAsset?.tokenStandard === 'ERC-1155';

                        // For ERC-1155 NFTs, validate against verified balance
                        if (isERC1155) {
                          const quantity = String(value);
                          if (
                            !/^\d+$/.test(quantity) ||
                            BigNumber.from(quantity).lte(0)
                          ) {
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

                          if (
                            BigNumber.from(quantity).gt(verifiedTokenBalance)
                          ) {
                            return Promise.reject(
                              t('send.youOnlyOwn', {
                                amount: verifiedTokenBalance,
                              })
                            );
                          }

                          return Promise.resolve();
                        }

                        // Native currency uses its 18-decimal denomination.
                        let valueBN: BigNumber;
                        try {
                          valueBN = parseEther(String(value));
                        } catch {
                          return Promise.reject('');
                        }
                        if (valueBN.lte(0)) return Promise.reject('');

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

                          // Only the current MAX amount gets confirmation-time gas
                          // deduction. A prior MAX click cannot exempt a fixed amount.
                          if (!isNativeMaxAmount(String(value), balanceEth)) {
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
                          Number(selectedTokenDecimals) === 0
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
                      isAmountDisabled
                    }
                    placeholder={
                      selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155'
                        ? verifiedTokenBalance !== null &&
                          BigNumber.from(verifiedTokenBalance).gt(1)
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

                        setIsMaxSend(isNativeMaxAmount(inputValue, balanceEth));
                      } else {
                        // For tokens or empty input, clear MAX flag
                        setIsMaxSend(false);
                      }
                    }}
                    onBlur={() => {
                      // Keep invalid input visible for correction, rather than
                      // silently changing the amount the user requested.
                      form.validateFields(['amount']).catch(() => null);
                      handleFieldBlur();
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
                            {renderVerificationSpinner(
                              'animate-spin h-3 w-3 text-brand-royalblue'
                            )}
                            <p className="text-brand-royalblue text-[10px]">
                              {t('send.verifyingBalance')}
                            </p>
                          </>
                        ) : verificationError ? (
                          <>
                            <p className="text-warning-error text-[10px]">
                              {verificationError}
                            </p>
                            <button
                              type="button"
                              className="text-brand-royalblue text-[10px] underline"
                              onClick={() => {
                                if (isCurrentForm())
                                  setSelectedAsset((asset) =>
                                    asset ? { ...asset } : null
                                  );
                              }}
                            >
                              {t('receive.retry')}
                            </button>
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
                        beginNftLookup();
                        if (nft.balance > 0)
                          ownedNftRef.current = nftOwnershipKey(
                            selectedAsset.contractAddress,
                            nft.tokenId
                          );
                        setSelectedNftTokenId(nft.tokenId);
                        form.setFieldValue('nftTokenId', nft.tokenId);
                        setVerifiedTokenBalance(getExactNftBalance(nft));
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
                        {renderVerificationSpinner(
                          'animate-spin -ml-1 mr-2 h-3 w-3 text-brand-royalblue'
                        )}
                        {t('send.verifyingOwnership')}
                      </p>
                    ) : verificationError || verifiedTokenBalance !== null ? (
                      <p
                        className={
                          verificationError || verifiedTokenBalance === '0'
                            ? 'text-xs text-red-400 text-center'
                            : 'text-xs text-green-400 text-center'
                        }
                      >
                        {verificationError || verifiedTokenBalance === '0'
                          ? '❌ '
                          : '✅ '}
                        {verificationError ||
                          t(
                            verifiedTokenBalance === '0'
                              ? 'send.youDontOwnThisToken'
                              : 'send.youOwnThisToken'
                          )}
                      </p>
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

        <ToastActionFooter className="fixed bottom-4 left-4 right-4 md:relative md:bottom-auto md:left-auto md:right-auto md:mt-3 md:w-[96%]">
          <Button
            id="send-eth-next-btn"
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            fullWidth
            loading={!selectedAsset && isCalculatingGas}
          >
            {t('buttons.next')}
          </Button>
        </ToastActionFooter>
      </Form>
    </div>
  );
};
