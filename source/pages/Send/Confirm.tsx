import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import currency from 'currency.js';
import { BigNumber, ethers } from 'ethers';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  KeyringAccountType,
  ISyscoinTransactionError,
} from '@pollum-io/sysweb3-keyring';
import { getContractType } from '@pollum-io/sysweb3-utils';

import {
  Layout,
  DefaultModal,
  Button,
  Icon,
  LoadingComponent,
  Tooltip,
  IconButton,
} from 'components/index';
import { TxSuccessful } from 'components/Modal/WarningBaseModal';
import { SyscoinTransactionDetailsFromPSBT } from 'components/TransactionDetails';
import { useUtils, usePrice } from 'hooks/index';
import { useController } from 'hooks/useController';
import {
  ISysTransaction,
  IEvmTransactionResponse,
} from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { ICustomFeeParams, IFeeState, ITxState } from 'types/transactions';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import {
  truncate,
  logError,
  ellipsis,
  removeScientificNotation,
  omitTransactionObjectData,
  INITIAL_FEE,
  verifyNetworkEIP1559Compatibility,
} from 'utils/index';

import { EditPriorityModal } from './EditPriority';

export const SendConfirm = () => {
  const { controllerEmitter, web3Provider, isLoading } = useController();
  const { t } = useTranslation();
  const { alert, navigate, useCopyClipboard } = useUtils();
  const { getFiatAmount } = usePrice();
  const url = chrome.runtime.getURL('app.html');
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const {
    accounts,
    activeAccount: activeAccountMeta,
    currentBlock,
  } = useSelector((state: RootState) => state.vault);
  const { fiat } = useSelector((state: RootState) => state.price);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [customFee, setCustomFee] = useState<ICustomFeeParams>({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
    gasPrice: 0,
  });
  const [fee, setFee] = useState<IFeeState>();
  const [gasPrice, setGasPrice] = useState<number>(0);
  const [txObjectState, setTxObjectState] = useState<any>();
  const [isOpenEditFeeModal, setIsOpenEditFeeModal] = useState<boolean>(false);
  const [haveError, setHaveError] = useState<boolean>(false);
  const [confirmedTx, setConfirmedTx] = useState<any>();
  const [isEIP1559Compatible, setIsEIP1559Compatible] = useState<boolean>();
  const [copied, copy] = useCopyClipboard();
  const [isReconectModalOpen, setIsReconectModalOpen] = useState(false);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  const basicTxValues = state.tx;

  // The confirmation screen displays the fee and total as calculated by SendSys.
  // When the user changes fee rate in SendSys and clicks "Next", SendSys recalculates
  // the transaction with the new fee rate and passes the correct values here.

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit > 0
  );

  const getFormattedFee = (currentFee: number | string) =>
    `${removeScientificNotation(currentFee)} ${
      activeNetwork.currency
        ? activeNetwork.currency.toUpperCase()
        : activeNetwork.label
    }`;

  const getFeeFiatAmount = (currentFee: number | string) => {
    try {
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
      ? customFee.gasPrice * 10 ** 9 // Convert to WEI because injected gasPrices comes in GWEI
      : await controllerEmitter([
          'wallet',
          'ethereumTransaction',
          'getRecommendedGasPrice',
        ]).then((gas) => BigNumber.from(gas).toNumber());

    const gasLimit: any = await controllerEmitter(
      ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
      [basicTxValues]
    ).then((gas) => BigNumber.from(gas).toNumber());

    const initialFee = INITIAL_FEE;

    initialFee.gasPrice = correctGasPrice;

    setFee({ ...initialFee, gasLimit });

    setGasPrice(correctGasPrice);

    return { gasLimit, gasPrice: correctGasPrice };
  };

  const handleConfirm = async () => {
    const {
      balances: { syscoin, ethereum },
    } = activeAccount;

    const balance = isBitcoinBased ? syscoin : ethereum;

    if (activeAccount && balance >= 0) {
      setLoading(true);

      // Handle with Syscoin and Ethereum transactions with differentes fee values.
      // First switch parameter has to be true because we can't isBitcoinBased prop directly to validate all this conditions,
      // we just need to enter and validate it inside
      switch (true) {
        // SYSCOIN TRANSACTIONS
        case isBitcoinBased === true:
          try {
            // Step 1: Sign the unsigned PSBT
            const signedPsbt = await controllerEmitter(
              ['wallet', 'syscoinTransaction', 'signPSBT'],
              [
                {
                  psbt: basicTxValues.psbt, // Pass the unsigned PSBT
                  isTrezor: activeAccount.isTrezorWallet,
                  isLedger: activeAccount.isLedgerWallet,
                },
              ]
            );

            // Step 2: Send the signed PSBT
            controllerEmitter(
              ['wallet', 'syscoinTransaction', 'sendTransaction'],
              [
                signedPsbt, // Pass the signed PSBT
              ]
            )
              .then((response) => {
                setConfirmedTx(response);
                setConfirmed(true);
                setLoading(false);

                //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                // Use proper alarm utility with automatic cleanup
                createTemporaryAlarm({
                  delayInSeconds: 4,
                  callback: () =>
                    controllerEmitter(['callGetLatestUpdateForAccount']),
                });
              })
              .catch((error: any) => {
                const isNecessaryReconnect = error.message?.includes(
                  'read properties of undefined'
                );
                if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
                  setIsReconectModalOpen(true);
                  setLoading(false);
                  return;
                }
                const isDeviceLocked =
                  error?.message?.includes('Locked device');

                if (isDeviceLocked) {
                  alert.removeAll();
                  alert.warning(t('settings.lockedDevice'));
                  setLoading(false);
                  return;
                }

                // Handle structured errors from syscoinjs-lib sendTransaction
                if (error.error && error.code) {
                  const sysError = error as ISyscoinTransactionError;
                  alert.removeAll();

                  switch (sysError.code) {
                    case 'TRANSACTION_SEND_FAILED':
                      alert.error(
                        t('send.transactionSendFailed', {
                          message: sysError.message,
                        })
                      );
                      break;

                    default:
                      alert.error(
                        t('send.transactionCreationFailedWithCode', {
                          code: sysError.code,
                          message: sysError.message,
                        })
                      );
                  }
                } else {
                  alert.error(t('send.cantCompleteTxs'));
                }

                setLoading(false);
                throw error;
              });

            return;
          } catch (error: any) {
            logError('error SYS', 'Transaction', error);

            // Handle structured errors from syscoinjs-lib
            if (error.error && error.code) {
              const sysError = error as ISyscoinTransactionError;
              alert.removeAll();

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
                  alert.error(
                    t('send.transactionSendFailed', {
                      message: sysError.message,
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
                alert.removeAll();
                alert.error(
                  `${truncate(String(error.message), 166)} ${t(
                    'send.reduceFee'
                  )}`
                );
              } else {
                alert.removeAll();
                alert.error(t('send.cantCompleteTxs'));
              }
            }

            setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS FOR NATIVE TOKENS
        case isBitcoinBased === false && basicTxValues.token === null:
          if (activeAccount.isTrezorWallet) {
            await controllerEmitter(
              ['wallet', 'trezorSigner', 'init'],
              [],
              false
            );
          }
          try {
            const restTx = omitTransactionObjectData(txObjectState, [
              'chainId',
              'maxFeePerGas',
              'maxPriorityFeePerGas',
            ]) as ITxState;

            const value = ethers.utils.parseUnits(
              String(basicTxValues.amount),
              'ether'
            );

            if (isEIP1559Compatible === false) {
              try {
                await controllerEmitter(
                  ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
                  [
                    {
                      ...restTx,
                      value,
                      gasPrice: ethers.utils.hexlify(gasPrice),
                      gasLimit: BigNumber.from(
                        validateCustomGasLimit
                          ? customFee.gasLimit
                          : fee.gasLimit
                      ),
                    },
                    !isEIP1559Compatible,
                  ]
                )
                  .then((response) => {
                    if (activeAccountMeta.type === KeyringAccountType.Trezor)
                      controllerEmitter(
                        ['wallet', 'sendAndSaveTransaction'],
                        [response]
                      );

                    setConfirmedTx(response);

                    setConfirmed(true);

                    setLoading(false);

                    //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                    // Use proper alarm utility with automatic cleanup
                    createTemporaryAlarm({
                      delayInSeconds: 4,
                      callback: () =>
                        controllerEmitter(['callGetLatestUpdateForAccount']),
                    });
                  })
                  .catch((error) => {
                    const isNecessaryReconnect = error.message.includes(
                      'read properties of undefined'
                    );
                    const isNecessaryBlindSigning = error.message.includes(
                      'Please enable Blind signing'
                    );
                    if (
                      activeAccount.isLedgerWallet &&
                      isNecessaryBlindSigning
                    ) {
                      alert.removeAll();
                      alert.warning(t('settings.ledgerBlindSigning'));
                      setLoading(false);
                      return;
                    }
                    if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
                      setIsReconectModalOpen(true);
                      setLoading(false);
                      return;
                    }
                    const isDeviceLocked =
                      error?.message.includes('Locked device');

                    if (isDeviceLocked) {
                      alert.removeAll();
                      alert.warning(t('settings.lockedDevice'));
                      setLoading(false);
                      return;
                    }
                    alert.error(t('send.cantCompleteTxs'));
                    setLoading(false);
                    throw error;
                  });

                return;
              } catch (legacyError: any) {
                logError('error', 'Transaction', legacyError);
                alert.removeAll();
                alert.error(t('send.cantCompleteTxs'));

                setLoading(false);
                return legacyError;
              }
            }

            (
              controllerEmitter(
                ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
                [
                  {
                    ...restTx,
                    value,
                    maxPriorityFeePerGas: ethers.utils.parseUnits(
                      String(
                        Boolean(
                          customFee.isCustom &&
                            customFee.maxPriorityFeePerGas > 0
                        )
                          ? customFee.maxPriorityFeePerGas.toFixed(9)
                          : fee.maxPriorityFeePerGas.toFixed(9)
                      ),
                      9
                    ),
                    maxFeePerGas: ethers.utils.parseUnits(
                      String(
                        Boolean(
                          customFee.isCustom && customFee.maxFeePerGas > 0
                        )
                          ? customFee.maxFeePerGas.toFixed(9)
                          : fee.maxFeePerGas.toFixed(9)
                      ),
                      9
                    ),
                    gasLimit: BigNumber.from(
                      validateCustomGasLimit
                        ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                        : fee.gasLimit
                    ),
                  },
                ]
              ) as Promise<ISysTransaction | IEvmTransactionResponse>
            )
              .then((response) => {
                if (activeAccountMeta.type === KeyringAccountType.Trezor)
                  controllerEmitter(
                    ['wallet', 'sendAndSaveTransaction'],
                    [response]
                  );

                setConfirmedTx(response);

                setConfirmed(true);

                setLoading(false);

                //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                // Use proper alarm utility with automatic cleanup
                createTemporaryAlarm({
                  delayInSeconds: 4,
                  callback: () =>
                    controllerEmitter(['callGetLatestUpdateForAccount']),
                });
              })
              .catch((error: any) => {
                const isNecessaryReconnect = error.message.includes(
                  'read properties of undefined'
                );
                const isNecessaryBlindSigning = error.message.includes(
                  'Please enable Blind signing'
                );
                if (activeAccount.isLedgerWallet && isNecessaryBlindSigning) {
                  alert.removeAll();
                  alert.warning(t('settings.ledgerBlindSigning'));
                  setLoading(false);
                  return;
                }
                if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
                  setIsReconectModalOpen(true);
                  setLoading(false);
                  return;
                }
                const isDeviceLocked = error?.message.includes('Locked device');

                if (isDeviceLocked) {
                  alert.removeAll();
                  alert.warning(t('settings.lockedDevice'));
                  setLoading(false);
                  return;
                }
                alert.error(t('send.cantCompleteTxs'));
                setLoading(false);
                throw error;
              });

            return;
          } catch (error: any) {
            logError('error ETH', 'Transaction', error);

            alert.removeAll();
            alert.error(t('send.cantCompleteTxs'));

            setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS FOR ERC20 & ERC721 TOKENS
        case isBitcoinBased === false && basicTxValues.token !== null:
          if (activeAccount.isTrezorWallet) {
            await controllerEmitter(
              ['wallet', 'trezorSigner', 'init'],
              [],
              false
            );
          }
          //SWITCH CASE TO HANDLE DIFFERENT TOKENS TRANSACTION
          switch (basicTxValues.token.isNft) {
            //HANDLE ERC20 TRANSACTION
            case false:
              if (isEIP1559Compatible === false) {
                try {
                  (
                    controllerEmitter(
                      [
                        'wallet',
                        'ethereumTransaction',
                        'sendSignedErc20Transaction',
                      ],
                      [
                        {
                          networkUrl: activeNetwork.url,
                          receiver: txObjectState.to,
                          tokenAddress: basicTxValues.token.contractAddress,
                          tokenAmount: `${basicTxValues.amount}`,
                          isLegacy: !isEIP1559Compatible,
                          decimals: basicTxValues?.token?.decimals,
                          gasPrice: ethers.utils.hexlify(gasPrice),
                          gasLimit: BigNumber.from(
                            validateCustomGasLimit
                              ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                              : fee.gasLimit * 4
                          ),
                        },
                      ]
                    ) as Promise<IEvmTransactionResponse | ISysTransaction>
                  )
                    .then(async (response) => {
                      if (activeAccountMeta.type === KeyringAccountType.Trezor)
                        controllerEmitter(
                          ['wallet', 'sendAndSaveTransaction'],
                          [response]
                        );

                      setConfirmed(true);

                      setLoading(false);

                      setConfirmedTx(response);

                      //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                      // Use proper alarm utility with automatic cleanup
                      createTemporaryAlarm({
                        delayInSeconds: 4,
                        callback: () =>
                          controllerEmitter(['callGetLatestUpdateForAccount']),
                      });
                    })
                    .catch((error) => {
                      const isNecessaryReconnect = error.message.includes(
                        'read properties of undefined'
                      );
                      const isNecessaryBlindSigning = error.message.includes(
                        'Please enable Blind signing'
                      );
                      if (
                        activeAccount.isLedgerWallet &&
                        isNecessaryBlindSigning
                      ) {
                        alert.removeAll();
                        alert.warning(t('settings.ledgerBlindSigning'));
                        setLoading(false);
                        return;
                      }
                      if (
                        activeAccount.isLedgerWallet &&
                        isNecessaryReconnect
                      ) {
                        setIsReconectModalOpen(true);
                        setLoading(false);
                        return;
                      }
                      const isDeviceLocked =
                        error?.message.includes('Locked device');

                      if (isDeviceLocked) {
                        alert.removeAll();
                        alert.warning(t('settings.lockedDevice'));
                        setLoading(false);
                        return;
                      }
                      logError('error send ERC20', 'Transaction', error);

                      alert.removeAll();
                      alert.error(t('send.cantCompleteTxs'));
                      setLoading(false);
                    });

                  return;
                } catch (_erc20Error) {
                  logError('error send ERC20', 'Transaction', _erc20Error);

                  alert.removeAll();
                  alert.error(t('send.cantCompleteTxs'));

                  setLoading(false);
                }
                break;
              }
              try {
                (
                  controllerEmitter(
                    [
                      'wallet',
                      'ethereumTransaction',
                      'sendSignedErc20Transaction',
                    ],
                    [
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
                              ? customFee.maxPriorityFeePerGas.toFixed(9)
                              : fee.maxPriorityFeePerGas.toFixed(9)
                          ),
                          9
                        ),
                        maxFeePerGas: ethers.utils.parseUnits(
                          String(
                            Boolean(
                              customFee.isCustom && customFee.maxFeePerGas > 0
                            )
                              ? customFee.maxFeePerGas.toFixed(9)
                              : fee.maxFeePerGas.toFixed(9)
                          ),
                          9
                        ),
                        gasLimit: BigNumber.from(
                          validateCustomGasLimit
                            ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                            : fee.gasLimit * 4
                        ),
                      },
                    ]
                  ) as Promise<IEvmTransactionResponse | ISysTransaction>
                )

                  .then(async (response) => {
                    if (activeAccountMeta.type === KeyringAccountType.Trezor)
                      controllerEmitter(
                        ['wallet', 'sendAndSaveTransaction'],
                        [response]
                      );

                    setConfirmed(true);

                    setLoading(false);

                    setConfirmedTx(response);

                    //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                    // Use proper alarm utility with automatic cleanup
                    createTemporaryAlarm({
                      delayInSeconds: 4,
                      callback: () =>
                        controllerEmitter(['callGetLatestUpdateForAccount']),
                    });
                  })
                  .catch((error) => {
                    const isNecessaryReconnect = error.message.includes(
                      'read properties of undefined'
                    );
                    const isNecessaryBlindSigning = error.message.includes(
                      'Please enable Blind signing'
                    );
                    if (
                      activeAccount.isLedgerWallet &&
                      isNecessaryBlindSigning
                    ) {
                      alert.removeAll();
                      alert.warning(t('settings.ledgerBlindSigning'));
                      setLoading(false);
                      return;
                    }
                    if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
                      setIsReconectModalOpen(true);
                      setLoading(false);
                      return;
                    }
                    logError('error send ERC20', 'Transaction', error);
                    const isDeviceLocked =
                      error?.message.includes('Locked device');

                    if (isDeviceLocked) {
                      alert.removeAll();
                      alert.warning(t('settings.lockedDevice'));
                      setLoading(false);
                      return;
                    }
                    logError('error send ERC20', 'Transaction', error);
                    alert.removeAll();
                    alert.error(t('send.cantCompleteTxs'));
                    setLoading(false);
                  });

                return;
              } catch (_erc20Error) {
                logError('error send ERC20', 'Transaction', _erc20Error);

                alert.removeAll();
                alert.error(t('send.cantCompleteTxs'));

                setLoading(false);
              }
              break;

            //HANDLE ERC721/ERC1155 NFTS TRANSACTIONS
            case true:
              const { type } = await getContractType(
                basicTxValues.token.contractAddress,
                web3Provider
              );

              if (activeAccount.isTrezorWallet) {
                await controllerEmitter(
                  ['wallet', 'trezorSigner', 'init'],
                  [],
                  false
                );
              }

              switch (type) {
                case 'ERC-721':
                  try {
                    controllerEmitter(
                      [
                        'wallet',
                        'ethereumTransaction',
                        'sendSignedErc721Transaction',
                      ],
                      [
                        {
                          networkUrl: activeNetwork.url,
                          receiver: txObjectState.to,
                          tokenAddress: basicTxValues.token.contractAddress,
                          tokenId: Number(basicTxValues.amount), // Amount is the same field of TokenID at the SendEth Component,
                          isLegacy: !isEIP1559Compatible,
                          gasPrice: ethers.utils.hexlify(gasPrice),
                          gasLimit: BigNumber.from(
                            validateCustomGasLimit
                              ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                              : fee.gasLimit * 4
                          ),
                        },
                      ]
                    )
                      .then(async (response) => {
                        setConfirmed(true);
                        setLoading(false);
                        setConfirmedTx(response);

                        //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                        // Use proper alarm utility with automatic cleanup
                        createTemporaryAlarm({
                          delayInSeconds: 4,
                          callback: () =>
                            controllerEmitter([
                              'callGetLatestUpdateForAccount',
                            ]),
                        });
                      })
                      .catch((error) => {
                        const isNecessaryReconnect = error.message.includes(
                          'read properties of undefined'
                        );
                        const isNecessaryBlindSigning = error.message.includes(
                          'Please enable Blind signing'
                        );
                        if (
                          activeAccount.isLedgerWallet &&
                          isNecessaryBlindSigning
                        ) {
                          alert.removeAll();
                          alert.warning(t('settings.ledgerBlindSigning'));
                          setLoading(false);
                          return;
                        }
                        if (
                          activeAccount.isLedgerWallet &&
                          isNecessaryReconnect
                        ) {
                          setIsReconectModalOpen(true);
                          setLoading(false);
                          return;
                        }

                        const isDeviceLocked =
                          error?.message.includes('Locked device');

                        if (isDeviceLocked) {
                          alert.removeAll();
                          alert.warning(t('settings.lockedDevice'));
                          setLoading(false);
                          return;
                        }
                        logError('error send ERC721', 'Transaction', error);

                        alert.removeAll();
                        alert.error(t('send.cantCompleteTxs'));
                        setLoading(false);
                      });

                    return;
                  } catch (_erc721Error) {
                    logError('error send ERC721', 'Transaction', _erc721Error);

                    alert.removeAll();
                    alert.error(t('send.cantCompleteTxs'));

                    setLoading(false);
                  }
                case 'ERC-1155':
                  try {
                    controllerEmitter(
                      [
                        'wallet',
                        'ethereumTransaction',
                        'sendSignedErc1155Transaction',
                      ],
                      [
                        {
                          networkUrl: activeNetwork.url,
                          receiver: txObjectState.to,
                          tokenAddress: basicTxValues.token.contractAddress,
                          tokenId: Number(basicTxValues.amount), // Amount is the same field of TokenID at the SendEth Component,
                          isLegacy: !isEIP1559Compatible,
                          maxPriorityFeePerGas: ethers.utils.parseUnits(
                            String(
                              Boolean(
                                customFee.isCustom &&
                                  customFee.maxPriorityFeePerGas > 0
                              )
                                ? customFee.maxPriorityFeePerGas.toFixed(9)
                                : fee.maxPriorityFeePerGas.toFixed(9)
                            ),
                            9
                          ),
                          maxFeePerGas: ethers.utils.parseUnits(
                            String(
                              Boolean(
                                customFee.isCustom && customFee.maxFeePerGas > 0
                              )
                                ? customFee.maxFeePerGas.toFixed(9)
                                : fee.maxFeePerGas.toFixed(9)
                            ),
                            9
                          ),
                          gasPrice: ethers.utils.hexlify(gasPrice),
                          gasLimit: BigNumber.from(
                            validateCustomGasLimit
                              ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                              : fee.gasLimit * 4
                          ),
                        },
                      ]
                    )
                      .then(async (response) => {
                        setConfirmed(true);
                        setLoading(false);
                        setConfirmedTx(response);

                        //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                        // Use proper alarm utility with automatic cleanup
                        createTemporaryAlarm({
                          delayInSeconds: 4,
                          callback: () =>
                            controllerEmitter([
                              'callGetLatestUpdateForAccount',
                            ]),
                        });
                      })
                      .catch((error) => {
                        const isNecessaryReconnect = error.message.includes(
                          'read properties of undefined'
                        );
                        const isNecessaryBlindSigning = error.message.includes(
                          'Please enable Blind signing'
                        );
                        if (
                          activeAccount.isLedgerWallet &&
                          isNecessaryBlindSigning
                        ) {
                          alert.removeAll();
                          alert.warning(t('settings.ledgerBlindSigning'));
                          setLoading(false);
                          return;
                        }
                        if (
                          activeAccount.isLedgerWallet &&
                          isNecessaryReconnect
                        ) {
                          setIsReconectModalOpen(true);
                          setLoading(false);
                          return;
                        }
                        const isDeviceLocked =
                          error?.message.includes('Locked device');

                        if (isDeviceLocked) {
                          alert.removeAll();
                          alert.warning(t('settings.lockedDevice'));
                          setLoading(false);
                          return;
                        }
                        logError('error send ERC1155', 'Transaction', error);

                        alert.removeAll();
                        alert.error(t('send.cantCompleteTxs'));
                        setLoading(false);
                      });

                    return;
                  } catch (_erc1155Error) {
                    logError(
                      'error send ERC1155',
                      'Transaction',
                      _erc1155Error
                    );

                    alert.removeAll();
                    alert.error(t('send.cantCompleteTxs'));

                    setLoading(false);
                  }
              }

              break;
          }

          break;
      }
    }
  };

  useEffect(() => {
    if (isLoading || isBitcoinBased) return;
    const validateEIP1559Compatibility = async () => {
      const isCompatible = await verifyNetworkEIP1559Compatibility(
        web3Provider,
        currentBlock
      );

      setIsEIP1559Compatible(isCompatible);
    };

    validateEIP1559Compatibility();
  }, [isLoading, web3Provider, isBitcoinBased]);

  useEffect(() => {
    if (isBitcoinBased) return;
    if (isEIP1559Compatible === undefined) {
      return; // Not calculate fees before being aware of EIP1559 compatibility
    }
    if (isEIP1559Compatible === false) {
      const getLegacyFeeRecomendation = async () => {
        const { gasLimit, gasPrice: _gasPrice } = await getLegacyGasPrice();
        const formattedTxObject = {
          from: basicTxValues.sender,
          to: basicTxValues.receivingAddress,
          chainId: activeNetwork.chainId,
          gasLimit,
          gasPrice: _gasPrice,
        };
        setTxObjectState(formattedTxObject);
      };
      getLegacyFeeRecomendation();
      return;
    }
    const abortController = new AbortController();

    const getFeeRecomendation = async () => {
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } = (await controllerEmitter(
          [
            'wallet',
            'ethereumTransaction',
            'getFeeDataWithDynamicMaxPriorityFeePerGas',
          ]
        )) as any;

        const initialFeeDetails = {
          maxFeePerGas: BigNumber.from(maxFeePerGas).toNumber() / 10 ** 9,
          baseFee:
            (BigNumber.from(maxFeePerGas).toNumber() -
              BigNumber.from(maxPriorityFeePerGas).toNumber()) /
            10 ** 9,
          maxPriorityFeePerGas:
            BigNumber.from(maxPriorityFeePerGas).toNumber() / 10 ** 9,
          gasLimit: BigNumber.from(0),
        };

        const formattedTxObject = {
          from: basicTxValues.sender,
          to: basicTxValues.receivingAddress,
          chainId: activeNetwork.chainId,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };

        setTxObjectState(formattedTxObject);

        const getGasLimit = await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
          [formattedTxObject]
        ).then((gas) => BigNumber.from(gas).toNumber());

        const finalFeeDetails = {
          ...initialFeeDetails,
          gasLimit: getGasLimit,
        };

        setFee(finalFeeDetails as any);
      } catch (error) {
        logError('error getting fees', 'Transaction', error);
        alert.error(t('send.feeError')); //TODO: Fix this alert, as for now this alert is basically useless because we navigate to the previous screen right after and its not being displayed
        navigate(-1);
      }
    };

    getFeeRecomendation();

    return () => {
      abortController.abort();
    };
  }, [
    basicTxValues,
    isBitcoinBased,
    isEIP1559Compatible,
    activeNetwork,
    controllerEmitter,
    navigate,
    alert,
    t,
    getLegacyGasPrice,
  ]);

  const getCalculatedFee = useMemo(() => {
    const arrayValidation = [
      !fee?.gasLimit,
      !fee?.maxFeePerGas,
      isBitcoinBased,
    ];

    if (arrayValidation.some((validation) => validation === true)) return;

    return (
      (Number(customFee.isCustom ? customFee.maxFeePerGas : fee?.maxFeePerGas) *
        Number(validateCustomGasLimit ? customFee.gasLimit : fee?.gasLimit)) /
      10 ** 9
    );
  }, [fee?.gasLimit, fee?.maxFeePerGas, customFee, isBitcoinBased]);

  useEffect(() => {
    if (!copied) return;
    alert.removeAll();
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

  return (
    <Layout title={t('send.confirm')} canGoBack={true}>
      <TxSuccessful
        show={confirmed}
        title={t('send.txSuccessfull')}
        phraseOne={t('send.txSuccessfullMessage')}
        onClose={() => {
          controllerEmitter(
            ['wallet', 'sendAndSaveTransaction'],
            [confirmedTx]
          );

          controllerEmitter(
            ['wallet', 'setIsLastTxConfirmed'],
            [activeNetwork.chainId, false]
          );

          navigate('/home');
        }}
      />

      <EditPriorityModal
        showModal={isOpenEditFeeModal}
        setIsOpen={setIsOpenEditFeeModal}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={setHaveError}
        fee={fee}
      />

      <DefaultModal
        show={isReconectModalOpen}
        title={t('settings.ledgerReconnection')}
        buttonText={t('buttons.reconnect')}
        description={t('settings.ledgerReconnectionMessage')}
        onClose={() => {
          setIsReconectModalOpen(false);
          window.open(`${url}?isReconnect=true`, '_blank');
        }}
      />

      <DefaultModal
        show={haveError}
        title={t('send.verifyFields')}
        description={t('send.changeFields')}
        onClose={() => setHaveError(false)}
      />
      {Boolean(
        !isBitcoinBased && basicTxValues && fee && isEIP1559Compatible
      ) ||
      Boolean(
        !isBitcoinBased && basicTxValues && isEIP1559Compatible === false
      ) ||
      Boolean(isBitcoinBased && basicTxValues) ? (
        <div className="flex flex-col items-center justify-center w-full">
          {basicTxValues.token?.isNft ? (
            <p className="flex flex-col items-center justify-center text-center font-rubik">
              TokenID
              <span>
                {!basicTxValues.token?.isNft ? (
                  <>
                    {`${basicTxValues.amount} ${' '} ${
                      basicTxValues.token
                        ? basicTxValues.token.symbol
                        : activeNetwork.currency.toUpperCase()
                    }`}
                  </>
                ) : (
                  <>{basicTxValues.amount}</>
                )}
              </span>
            </p>
          ) : (
            <div className="flex flex-col mb-4 items-center text-center">
              <div className="relative w-[50px] h-[50px] bg-brand-pink200 rounded-[100px] flex items-center justify-center mb-2">
                <img
                  className="relative w-[30px] h-[30px]"
                  src={'/assets/icons/ArrowUp.svg'}
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
            <p className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
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
            </p>
            <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
            <p className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
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
            </p>
            <div className="border-dashed border-alpha-whiteAlpha300 border my-3  w-full h-full" />
            {/* Only show fee section if we have meaningful fee information */}
            {!(isBitcoinBased && basicTxValues.fee === 0) && (
              <div className="flex flex-row items-end w-full">
                <p className="flex flex-col text-xs text-brand-gray200 font-poppins font-normal">
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
                        feeAmount = gasPrice / 10 ** 18;
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
                </p>
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
            <p className="flex flex-col w-full text-xs text-brand-gray200 font-poppins font-normal">
              {!basicTxValues.token?.isNft ? (
                <>
                  Total ({t('send.amountAndFee')})
                  <span className="text-white text-xs">
                    {(() => {
                      let totalAmount;
                      let totalCrypto;

                      if (basicTxValues.fee !== undefined) {
                        const total = currency(basicTxValues.fee, {
                          precision: 8,
                        }).add(basicTxValues.amount);
                        totalAmount = total.value;
                        totalCrypto = total.format({ symbol: '' });
                      } else if (isBitcoinBased) {
                        const total = currency(basicTxValues.fee, {
                          precision: 8,
                        }).add(basicTxValues.amount);
                        totalAmount = total.value;
                        totalCrypto = total.format({ symbol: '' });
                      } else if (
                        !isBitcoinBased &&
                        isEIP1559Compatible === false
                      ) {
                        const total = currency(basicTxValues.amount, {
                          precision: 18,
                        }).add(gasPrice / 10 ** 18);
                        totalAmount = total.value;
                        totalCrypto = removeScientificNotation(total.value);
                      } else {
                        const total = currency(basicTxValues.amount, {
                          precision: 18,
                        }).add(getCalculatedFee || 0);
                        totalAmount = total.value;
                        totalCrypto = total.format({ symbol: '' });
                      }

                      const totalFiatAmount = getTotalFiatAmount(totalAmount);

                      return (
                        <div className="flex flex-col">
                          <span>
                            {totalCrypto}
                            &nbsp;
                            {`${
                              activeNetwork.currency
                                ? activeNetwork.currency.toUpperCase()
                                : activeNetwork.label
                            }`}
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
                  Token ID
                  <span className="text-white text-xs">
                    {basicTxValues.amount}
                  </span>
                </>
              )}
            </p>
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
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
              id="send-btn"
              onClick={() => {
                navigate('/home');
              }}
            >
              {t('buttons.cancel')}
            </Button>

            <Button
              type="button"
              className={`${
                loading
                  ? 'opacity-60 cursor-not-allowed'
                  : 'opacity-100 hover:opacity-90'
              } xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none`}
              id="receive-btn"
              loading={loading}
              onClick={handleConfirm}
            >
              {loading && (
                <Icon
                  name="loading"
                  color="#4d76b8"
                  className="w-5 animate-spin-slow"
                  wrapperClassname="mr-2 flex items-center"
                />
              )}
              {t('buttons.confirm')}
            </Button>
          </div>
        </div>
      ) : (
        <LoadingComponent />
      )}
    </Layout>
  );
};
