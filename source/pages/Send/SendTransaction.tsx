import { getErc20Abi } from '@sidhujag/sysweb3-utils';
import { BigNumber, ethers } from 'ethers';
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  IconButton,
} from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  ICustomFeeParams,
  IDecodedTx,
  IFeeState,
  ITransactionParams,
  ITxState,
  IApprovedTokenInfos,
  ICustomApprovedAllowanceAmount,
} from 'types/transactions';
import { dispatchBackgroundEvent } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { ellipsis } from 'utils/format';
import {
  isUserCancellationError,
  isDeviceLockedError,
  isBlindSigningError,
} from 'utils/isUserCancellationError';
import { logError } from 'utils/logger';
import { clearNavigationState } from 'utils/navigationState';
import removeScientificNotation from 'utils/removeScientificNotation';
import { omitTransactionObjectData } from 'utils/transactions';
import { validateTransactionDataValue } from 'utils/validateTransactionDataValue';

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

  const isLegacyTransaction = txMetadata.isLegacyTx || false;
  const isApproval = txMetadata.isApproval || false;
  const approvalType = txMetadata.approvalType;
  const tokenStandard = txMetadata.tokenStandard;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>();
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

  // Helper function to safely convert fee values to numbers and format them
  const safeToFixed = (value: any, decimals = 9): string => {
    const numValue = Number(value);
    return isNaN(numValue) ? '0' : numValue.toFixed(decimals);
  };

  const formattedValueAndCurrency = `${removeScientificNotation(
    Number(tx?.value ? tx?.value : 0) / 10 ** 18
  )} ${' '} ${activeNetwork.currency?.toUpperCase()}`;

  const omitTransactionObject = omitTransactionObjectData(dataTx, ['type']);

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
        const erc20AbiInstance = new ethers.utils.Interface(getErc20Abi());

        // The amount is already in the smallest unit (wei)
        let parsedAmount;
        try {
          // Direct wei/smallest unit input - no conversion needed
          parsedAmount = ethers.BigNumber.from(
            customApprovedAllowanceAmount.customAllowanceValue
          );
        } catch (parseError) {
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
          // Legacy transaction handling
          let txWithoutType = omitTransactionObjectData(txToSend, [
            'type',
          ]) as ITxState;

          // Remove EIP-1559 fields for legacy transactions
          if (
            txWithoutType.maxFeePerGas ||
            txWithoutType.maxPriorityFeePerGas
          ) {
            txWithoutType = omitTransactionObjectData(txWithoutType, [
              'maxFeePerGas',
              'maxPriorityFeePerGas',
            ]) as ITxState;
          }

          const getLegacyGasFee = Boolean(
            customFee.isCustom && customFee.gasPrice > 0
          )
            ? customFee.gasPrice * 10 ** 9
            : await controllerEmitter([
                'wallet',
                'ethereumTransaction',
                'getRecommendedGasPrice',
              ]);

          response = await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              {
                ...txWithoutType,
                nonce: customNonce,
                gasPrice: ethers.utils.hexlify(Number(getLegacyGasFee)),
                gasLimit: BigNumber.from(
                  Boolean(
                    customFee.isCustom &&
                      customFee.gasLimit &&
                      customFee.gasLimit > 0
                  )
                    ? customFee.gasLimit
                    : fee.gasLimit
                ),
              },
              isLegacyTransaction,
            ],
            false,
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          );
        } else {
          // EIP-1559 transaction handling
          response = await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              {
                ...txToSend,
                nonce: customNonce,
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
                  Boolean(
                    customFee.isCustom &&
                      customFee.gasLimit &&
                      customFee.gasLimit > 0
                  )
                    ? customFee.gasLimit
                    : fee.gasLimit
                ),
              },
              false, // isLegacy = false for EIP-1559
            ],
            false,
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          );
        }

        if (isExternal)
          dispatchBackgroundEvent(`${eventName}.${host}`, response.hash);
        setConfirmed(true);
        // Don't set loading to false here - let the navigation effect handle it
        return response.hash;
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

        // For all other errors
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

    const getGasAndFunction = async () => {
      try {
        const { feeDetails, formTx, nonce, isInvalidTxData, gasLimitError } =
          await fetchGasAndDecodeFunction(
            validatedDataTxWithoutType as ITransactionParams,
            activeNetwork
          );

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
          setTimeout(window.close, 3000);
        }
      }
    };

    getGasAndFunction();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [validatedDataTxWithoutType, activeNetwork.chainId]); // Only depend on chainId, not the whole network object

  useEffect(() => {
    setValueAndCurrency(formattedValueAndCurrency);
  }, [tx]);

  // Navigate when transaction is confirmed
  useEffect(() => {
    if (confirmed) {
      // Clear navigation state when actually navigating
      clearNavigationState();

      if (isExternal) {
        // Show success toast
        alert.success(t('transactions.youCanCheckYour'));
        // Keep loading spinner visible until window closes
        setTimeout(window.close, 2000);
      } else {
        // For internal navigation, navigate immediately
        // The loading spinner will disappear when component unmounts
        navigate('/home');
      }
    }
  }, [confirmed, alert, t, navigate, isExternal]);

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

          setApprovedTokenInfos({
            tokenSymbol: tokenInfo.symbol,
            tokenDecimals: Number(tokenInfo.decimals) || 18, // Ensure it's a number
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
            const tokenId = decodedTxData.inputs[1].toString();
            setNftInfo({ tokenId });
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
    controllerEmitter,
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
      amountString = ethers.BigNumber.from(rawAmount).toString();
    } else if (typeof rawAmount === 'object' && rawAmount.hex) {
      // It's an object with hex property
      amountString = ethers.BigNumber.from(rawAmount.hex).toString();
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
                            {approvedTokenInfos?.tokenSymbol}
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
                          {approvedTokenInfos?.tokenSymbol} #
                          {nftInfo?.tokenId || '...'}
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
                      <span>{ellipsis(dataTx.to)}</span>
                      <IconButton onClick={() => copy(dataTx.to)}>
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
                                nftInfo?.tokenId || decodedTxData?.inputs?.[1]
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
      ) : null}
    </>
  );
};
