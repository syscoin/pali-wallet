import { Menu } from '@headlessui/react';
import { Form, Input } from 'antd';
import { BigNumber, ethers } from 'ethers';
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

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import { TransactionType } from '../../types/transactions';
import { PaliWhiteSmallIconSvg, ArrowDownSvg } from 'components/Icon/Icon';
import { NeutralButton, Tooltip, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { ITokenEthProps } from 'types/tokens';
import {
  getAssetBalance,
  ellipsis,
  adjustUrl,
  formatFullPrecisionBalance,
  createNavigationContext,
  navigateWithContext,
  saveNavigationState,
} from 'utils/index';
import { getDefaultGasLimit } from 'utils/transactionUtils';
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

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const hasAccountAssets = Boolean(activeAccountAssets?.ethereum);
  const isAccountImported = activeAccount?.isImported || false;

  // Restore form state if coming back from navigation
  const initialSelectedAsset = location.state?.selectedAsset || null;
  const initialNftTokenIds = location.state?.nftTokenIds || [];
  const initialSelectedNftTokenId = location.state?.selectedNftTokenId || null;
  const initialIsMaxSend = location.state?.isMaxSend || false;

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
  >(null);
  const [verificationError, setVerificationError] = useState<string | null>(
    null
  );

  // ERC-20 verification state
  const [isVerifyingERC20, setIsVerifyingERC20] = useState(false);
  const [verifiedERC20Balance, setVerifiedERC20Balance] = useState<
    number | null
  >(null);

  const [form] = Form.useForm();

  // Track form value changes using a ref to avoid dependency issues
  const formValuesRef = useRef<any>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Save form state when values change
  const handleFormValuesChange = useCallback(
    (_changedValues: any, allValues: any) => {
      formValuesRef.current = allValues;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      const hasFormData = Object.values(allValues).some(
        (value) => value !== undefined && value !== '' && value !== null
      );

      // Only save if there's actual form data or non-default component state
      if (
        hasFormData ||
        selectedAsset !== null ||
        nftTokenIds.length > 0 ||
        selectedNftTokenId !== null ||
        isMaxSend !== false
      ) {
        saveTimeoutRef.current = setTimeout(async () => {
          const state = {
            formValues: allValues,
            selectedAsset,
            nftTokenIds,
            selectedNftTokenId,
            isMaxSend,
          };

          await saveNavigationState(
            location.pathname,
            undefined,
            state,
            location.state?.returnContext
          );
        }, 2000); // 2 second debounce
      }
    },
    [selectedAsset, nftTokenIds, selectedNftTokenId, isMaxSend, location]
  );

  // Save component state when non-form state changes
  useEffect(() => {
    // Don't save on initial mount or when there's no meaningful state
    if (
      selectedAsset === null &&
      nftTokenIds.length === 0 &&
      selectedNftTokenId === null &&
      isMaxSend === false &&
      Object.keys(formValuesRef.current).length === 0
    ) {
      return;
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const state = {
        formValues: formValuesRef.current,
        selectedAsset,
        nftTokenIds,
        selectedNftTokenId,
        isMaxSend,
      };

      await saveNavigationState(
        location.pathname,
        undefined,
        state,
        location.state?.returnContext
      );
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [selectedAsset, nftTokenIds, selectedNftTokenId, isMaxSend, location]);

  // Restore form values if coming back from navigation
  useEffect(() => {
    if (location.state?.scrollPosition !== undefined) {
      const { formValues, isMaxSend: restoredIsMaxSend } = location.state;

      if (formValues) {
        form.setFieldsValue(formValues);
        formValuesRef.current = formValues;

        // If this was a max send, recalculate the max amount
        if (restoredIsMaxSend) {
          handleMaxButton();
        }
      }

      // Clear the navigation state to prevent re-applying
      window.history.replaceState({}, document.title);
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
          setCachedFeeData(null);
          setIsMaxSend(false);
          return;
        }

        const getAsset = activeAccountAssets?.ethereum?.find(
          (item: ITokenEthProps) => item.contractAddress === value
        );

        if (getAsset) {
          setSelectedAsset(getAsset);
          setCachedFeeData(null);
          setIsMaxSend(false);

          // If it's an NFT, fetch token IDs
          if (getAsset.isNft) {
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
    [
      activeAccount.address,
      activeAccountAssets,
      controllerEmitter,
      alert,
      t,
      form,
    ]
  );

  const finalSymbolToNextStep = useMemo(() => {
    if (selectedAsset?.isNft) {
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
          const balanceEth = String(activeAccount?.balances?.ethereum || '0');

          try {
            const amountBN = ethers.utils.parseEther(values.amount);
            const balanceBN = ethers.utils.parseEther(balanceEth);
            isMax = amountBN.eq(balanceBN);
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
                    symbol:
                      selectedAsset.isNft && values.nftTokenId
                        ? `#${values.nftTokenId}`
                        : finalSymbolToNextStep,
                    tokenId: values.nftTokenId, // Include token ID for NFTs
                  }
                : null,
              // Pass cached gas data to avoid recalculation on confirm screen
              cachedGasData: !selectedAsset ? cachedFeeData : null,
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
        const displayBalance = verifiedERC20Balance.toFixed(4);
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
    const fullBalance = String(activeAccount?.balances?.ethereum || '0');
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

    let explorerUrl;
    if (isBitcoinBased) {
      // For UTXO networks, use the network URL pattern
      explorerUrl = `${adjustUrl(activeNetwork.url)}address/${accountAddress}`;
    } else {
      // For EVM networks, use the explorer pattern
      explorerUrl = `${adjustedExplorer}address/${accountAddress}`;
    }

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
      const { maxFeePerGas, maxPriorityFeePerGas } = (await controllerEmitter([
        'wallet',
        'ethereumTransaction',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
      ])) as any;

      // Cache only the fee rates - gas limit will be handled by backend
      setCachedFeeData({
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
    } catch (error) {
      console.error('Error calculating gas fees:', error);
      // Don't cache on error, but don't block the UI either
    } finally {
      setIsCalculatingGas(false);
    }
  }, [selectedAsset, controllerEmitter]);

  const calculateMaxAmount = useCallback(async (): Promise<string> => {
    if (selectedAsset) {
      // For tokens, use full balance as fees are paid in native token
      return String(selectedAsset.balance);
    }

    try {
      // Get balance in wei using the full precision stored balance
      const balanceEth = activeAccount?.balances?.ethereum || '0';
      const balanceWei = ethers.utils.parseEther(String(balanceEth));

      // Always try to get fresh fee data for max calculations to avoid stale cached data
      let totalFeeWei = BigNumber.from(0);

      if (!cachedFeeData) {
        // Try to calculate fresh fee data
        try {
          const { maxFeePerGas, maxPriorityFeePerGas } =
            (await controllerEmitter([
              'wallet',
              'ethereumTransaction',
              'getFeeDataWithDynamicMaxPriorityFeePerGas',
            ])) as any;
          // Cache the fee data for future use
          setCachedFeeData({
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
          });
        } catch (error) {
          console.error('Error calculating fresh fee data:', error);
        }
      }
      const gasLimit = BigNumber.from(
        getDefaultGasLimit(TransactionType.NATIVE_ETH).toString
      );
      const maxFeePerGas = BigNumber.from(cachedFeeData.maxFeePerGas);
      totalFeeWei = gasLimit.mul(maxFeePerGas);
      // Calculate max amount in wei (no buffer needed when using BigNumber)
      const maxAmountWei = balanceWei.sub(totalFeeWei);

      // If result would be negative, return 0
      if (maxAmountWei.lt(0)) {
        return '0';
      }

      // Convert back to ETH as a string to preserve precision
      const maxAmountEth = ethers.utils.formatEther(maxAmountWei);

      // Return as string to preserve full precision
      return maxAmountEth;
    } catch (error) {
      console.error('Error calculating max amount:', error);
      // Fallback: return balance minus conservative fee using BigNumber
      try {
        const balanceEth = activeAccount?.balances?.ethereum || '0';
        const balanceWei = ethers.utils.parseEther(String(balanceEth));
        const conservativeFee =
          activeNetwork.chainId === 570 ? '0.00001' : '0.001';
        const conservativeFeeWei = ethers.utils.parseEther(conservativeFee);
        const maxAmountWei = balanceWei.sub(conservativeFeeWei);

        if (maxAmountWei.lt(0)) {
          return '0';
        }

        return ethers.utils.formatEther(maxAmountWei);
      } catch (fallbackError) {
        console.error('Error in fallback calculation:', fallbackError);
        return '0';
      }
    }
  }, [
    selectedAsset,
    cachedFeeData,
    activeAccount?.balances?.ethereum,
    activeAccount?.address,
    activeNetwork.chainId,
    controllerEmitter,
    form,
  ]);

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
        fullBalance = String(verifiedERC20Balance);
      } else {
        // For ERC-721, this shouldn't be called (amount field is hidden)
        return;
      }
    } else {
      // For native ETH, use full balance - Confirm component will handle gas deduction for MAX sends
      fullBalance = String(activeAccount?.balances?.ethereum || '0');
    }

    form.setFieldValue('amount', fullBalance);
    setIsMaxSend(true);

    // Force validation to run after setting the value
    form.validateFields(['amount']);
  }, [
    activeAccount?.balances?.ethereum,
    selectedAsset,
    verifiedTokenBalance,
    verifiedERC20Balance,
    form,
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
    [selectedAsset, activeAccount.address, controllerEmitter]
  );

  // Ref to store the timeout ID for proper cleanup
  const tokenIdVerificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle manual token ID input with debounced verification
  const handleManualTokenIdChange = useCallback(
    (value: string) => {
      setSelectedNftTokenId(value);
      // Also update the form field to keep them in sync
      form.setFieldValue('nftTokenId', value);

      // Clear any existing timeout to prevent race conditions
      if (tokenIdVerificationTimeoutRef.current) {
        clearTimeout(tokenIdVerificationTimeoutRef.current);
        tokenIdVerificationTimeoutRef.current = null;
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
        const balance = Number(result.balance) / Math.pow(10, result.decimals);
        setVerifiedERC20Balance(balance);
      }
    } catch (error) {
      console.error('Error verifying ERC-20 balance:', error);
      setVerifiedERC20Balance(null);
    } finally {
      setIsVerifyingERC20(false);
    }
  }, [selectedAsset, activeAccount.address, controllerEmitter]);

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

  // Calculate gas fees when component mounts or asset changes
  useEffect(() => {
    // Only calculate for native ETH (not tokens)
    if (!selectedAsset && activeAccount?.address && !cachedFeeData) {
      calculateGasFees();
    }
  }, [selectedAsset, activeAccount?.address, cachedFeeData, calculateGasFees]);

  // Cleanup token ID verification timeout on unmount or when dependencies change
  useEffect(() => {
    return () => {
      if (tokenIdVerificationTimeoutRef.current) {
        clearTimeout(tokenIdVerificationTimeoutRef.current);
        tokenIdVerificationTimeoutRef.current = null;
      }
    };
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
              Imported
            </div>
          )}
        </div>
        <div className="flex gap-1 mt-[6px]">
          <p className="text-brand-gray200 text-xs">Your balance:</p>
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
                validator(_, value) {
                  if (!value) {
                    return Promise.resolve();
                  }

                  if (isValidEthereumAddress(value)) {
                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input type="text" placeholder={t('send.receiver')} />
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
                      className={`scrollbar-styled absolute z-10 left-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-brand-blue800 border border-fields-input-border focus:border-fields-input-borderfocus rounded-2xl shadow-2xl overflow-auto origin-top-right
                          transform transition-all duration-100 ease-out ${
                            open
                              ? 'opacity-100 scale-100 pointer-events-auto'
                              : 'opacity-0 scale-95 pointer-events-none'
                          }`}
                      static
                    >
                      <Menu.Item>
                        <button
                          onClick={() => handleSelectedAsset('-1')}
                          className="group flex items-center justify-between p-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                        >
                          <p>
                            {activeNetwork?.currency.toUpperCase() || 'SYS'}
                          </p>
                          <small>{t('send.native')}</small>
                        </button>
                      </Menu.Item>

                      {hasAccountAssets &&
                        Object.values(activeAccountAssets.ethereum).map(
                          (item: ITokenEthProps) => (
                            <div key={item.contractAddress}>
                              {item.chainId === activeNetwork.chainId ? (
                                <Menu.Item as="div">
                                  <Menu.Item>
                                    <button
                                      onClick={() =>
                                        handleSelectedAsset(
                                          item.contractAddress
                                        )
                                      }
                                      className="group flex items-center justify-between px-2 py-2 w-full hover:text-brand-royalblue text-brand-white font-poppins text-sm border-0 border-transparent transition-all duration-300"
                                    >
                                      <p>{item.tokenSymbol}</p>
                                      <small>
                                        {item.isNft ? 'NFT' : 'Token'}
                                      </small>
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
                          valueBN = ethers.utils.parseEther(String(value));
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
                          const numValue = parseInt(value);

                          // Must be a positive integer
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
                          // REQUIRE verified balance for ERC-20 tokens
                          if (verifiedERC20Balance === null) {
                            return Promise.reject(
                              t('send.pleaseWaitForBalanceVerification')
                            );
                          }

                          try {
                            const tokenBalanceBN = ethers.utils.parseUnits(
                              String(verifiedERC20Balance),
                              selectedAsset.decimals || 18
                            );
                            const tokenValueBN = ethers.utils.parseUnits(
                              String(value),
                              selectedAsset.decimals || 18
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
                            activeAccount?.balances?.ethereum || '0'
                          );
                          const balanceBN = ethers.utils.parseEther(balanceEth);

                          // First check if amount exceeds total balance
                          if (valueBN.gt(balanceBN)) {
                            return Promise.reject(t('send.insufficientFunds'));
                          }

                          // If MAX is clicked for native ETH, allow full balance (fees will be deducted automatically)
                          if (isMaxSend && valueBN.eq(balanceBN)) {
                            return Promise.resolve();
                          }

                          // For native ETH, also validate against max amount (balance - gas)
                          try {
                            // Calculate max sendable amount
                            const maxAmountStr = await calculateMaxAmount();
                            const maxAmountBN =
                              ethers.utils.parseEther(maxAmountStr);

                            // If amount exceeds max (balance - gas), show specific error
                            if (valueBN.gt(maxAmountBN)) {
                              // Check if it's just slightly over (within gas fee range)
                              if (valueBN.lte(balanceBN)) {
                                return Promise.reject(
                                  t('send.insufficientFundsForGas') ||
                                    'Insufficient funds for gas'
                                );
                              }
                            }
                          } catch (error) {
                            console.error(
                              'Error validating max amount:',
                              error
                            );
                            // If we can't calculate gas, just check against balance
                            // The actual transaction will fail if gas is insufficient
                          }
                        } catch (e) {
                          console.error('Error in BigNumber validation:', e);
                          // Ultimate fallback - just check balance
                          const balance = parseFloat(
                            String(activeAccount?.balances?.ethereum || '0')
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
                        : 'any'
                    }
                    min={
                      selectedAsset?.isNft &&
                      selectedAsset?.tokenStandard === 'ERC-1155'
                        ? '1'
                        : undefined
                    }
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
                          activeAccount?.balances?.ethereum || '0'
                        );

                        try {
                          const inputBN = ethers.utils.parseEther(inputValue);
                          const balanceBN = ethers.utils.parseEther(balanceEth);

                          // Set isMaxSend based on whether value equals balance
                          setIsMaxSend(inputBN.eq(balanceBN));
                        } catch {
                          // If parsing fails, it's not a MAX send
                          setIsMaxSend(false);
                        }
                      } else {
                        // For tokens or empty input, clear MAX flag
                        setIsMaxSend(false);
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

        {/* NFT Token ID Selector */}
        {selectedAsset?.isNft && (
          <div className="w-full md:max-w-md">
            <div className="mb-2">
              <label className="text-brand-gray200 text-xs">
                {selectedAsset?.tokenStandard === 'ERC-1155'
                  ? `${t('send.tokenId')}:`
                  : t('send.selectNft')}
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
                        return Promise.reject();
                      }
                      // Basic validation for token ID format
                      if (!/^\d+$/.test(value)) {
                        return Promise.reject();
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
                        {selectedAsset?.tokenStandard === 'ERC-1155' &&
                        verifiedTokenBalance > 1
                          ? ` (${verifiedTokenBalance} available)`
                          : ''}
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
                : selectedAsset?.tokenStandard === 'ERC-1155'
                ? t('send.erc1155RequiresManualEntry')
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
