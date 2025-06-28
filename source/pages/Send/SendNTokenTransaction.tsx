import { BigNumber, ethers } from 'ethers';
import omit from 'lodash/omit';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  DefaultModal,
  Icon,
  IconButton,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { Tooltip } from 'components/Tooltip';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useEIP1559 } from 'hooks/useEIP1559';
import { RootState } from 'state/store';
import { ICustomFeeParams, IFeeState, ITxState } from 'types/transactions';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  logError,
  ellipsis,
  removeScientificNotation,
  omitTransactionObjectData,
} from 'utils/index';

import { EditPriorityModal } from './EditPriority';

export const SendNTokenTransaction = () => {
  // const {
  //   wallet: { ethereumTransaction, sendAndSaveTransaction }, //TODO: validates this gets doesn't leads into bugs
  // }

  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { alert, navigate, useCopyClipboard } = useUtils();
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
  const { host, eventName, ...externalTx } = useQueryData();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState<IFeeState>();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  // Removed unused haveError state
  const [customFee, setCustomFee] = useState<ICustomFeeParams>({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
    gasPrice: 0,
  });
  const [confirmedTx, setConfirmedTx] = useState<any>();
  const { isEIP1559Compatible } = useEIP1559();
  const [errors, setErrors] = useState<{
    eip1559GasError: boolean;
    gasLimitError: boolean;
    txDataError: boolean;
  }>({ eip1559GasError: false, gasLimitError: false, txDataError: false });
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const url = chrome.runtime.getURL('app.html');
  const isExternal = Boolean(externalTx.external);

  const transactionDataValidation = Boolean(
    externalTx.tx?.data && String(externalTx.tx.data).length > 0
  );
  const tx = transactionDataValidation
    ? {
        ...externalTx.tx,
        data:
          String(externalTx.tx.data).length < 66
            ? ethers.utils.formatBytes32String(externalTx.tx.data)
            : externalTx.tx.data, //Messages above 32bytes cannot be decoded through this formatMethods
      }
    : externalTx.tx;

  const isLegacyTransaction =
    Boolean(tx.type === '0x0') || !isEIP1559Compatible;

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit > 0
  );

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount.isTrezorWallet) {
      await controllerEmitter(['wallet', 'trezorSigner', 'init'], [], false);
    }

    if (activeAccount && balance > 0) {
      setLoading(true);
      let txToSend = tx;
      if (tx?.gas) txToSend = omit(txToSend, ['gas']); //Paliative solution until we figure out how to enhance useEffect so its not constantly called
      const txWithoutType = omitTransactionObjectData(txToSend, [
        'type',
      ]) as ITxState;
      if (isLegacyTransaction) {
        let finalLegacyTx = txWithoutType;
        if (txWithoutType.maxFeePerGas || txWithoutType.maxPriorityFeePerGas) {
          finalLegacyTx = omitTransactionObjectData(txWithoutType, [
            'maxFeePerGas',
            'maxPriorityFeePerGas',
          ]) as ITxState;
        }
        try {
          const getLegacyGasFee = Boolean(
            customFee.isCustom && customFee.gasPrice > 0
          )
            ? customFee.gasPrice * 10 ** 9 // Calculate custom value to send to transaction because it comes without decimals, only 8 -> 10 -> 12
            : await controllerEmitter([
                'wallet',
                'ethereumTransaction',
                'getRecommendedGasPrice',
              ]);

          await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
            [
              {
                ...finalLegacyTx,
                gasPrice: ethers.utils.hexlify(Number(getLegacyGasFee)),
                gasLimit: BigNumber.from(
                  validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
                ),
              },
              isLegacyTransaction,
            ]
          )
            .then((response) => {
              controllerEmitter(
                ['wallet', 'sendAndSaveTransaction'],
                [response]
              );

              setConfirmed(true);
              setLoading(false);
              if (isExternal)
                dispatchBackgroundEvent(`${eventName}.${host}`, response);
            })
            .catch((error) => {
              alert.error(t('send.cantCompleteTxs'));
              setLoading(false);
              throw error;
            });

          return;
        } catch (legacyError: any) {
          const isNecessaryReconnect = legacyError.message.includes(
            'read properties of undefined'
          );
          const isNecessaryBlindSigning = legacyError.message.includes(
            'Please enable Blind signing'
          );
          if (activeAccount.isLedgerWallet && isNecessaryBlindSigning) {
            alert.warning(t('settings.ledgerBlindSigning'));
            setLoading(false);
            return;
          }
          if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
            setIsReconectModalOpen(true);
            setLoading(false);
            return;
          }
          logError('error', 'Transaction', legacyError);

          alert.error(t('send.cantCompleteTxs'));

          if (isExternal) setTimeout(window.close, 4000);
          else setLoading(false);
          return legacyError;
        }
      } else {
        try {
          await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
            [
              {
                ...txWithoutType,
                maxPriorityFeePerGas: ethers.utils.parseUnits(
                  String(
                    Boolean(
                      customFee.isCustom && customFee.maxPriorityFeePerGas > 0
                    )
                      ? customFee.maxPriorityFeePerGas.toFixed(9)
                      : fee.maxPriorityFeePerGas.toFixed(9)
                  ),
                  9
                ),
                maxFeePerGas: ethers.utils.parseUnits(
                  String(
                    Boolean(customFee.isCustom && customFee.maxFeePerGas > 0)
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
          )
            .then((response) => {
              setConfirmedTx(response);
              setConfirmed(true);
              setLoading(false);
              if (isExternal)
                dispatchBackgroundEvent(`${eventName}.${host}`, response);
            })
            .catch((error) => {
              alert.error(t('send.cantCompleteTxs'));
              setLoading(false);
              throw error;
            });

          return;
        } catch (notLegacyError) {
          const isNecessaryReconnect = notLegacyError.message.includes(
            'read properties of undefined'
          );
          const isNecessaryBlindSigning = notLegacyError.message.includes(
            'Please enable Blind signing'
          );
          if (activeAccount.isLedgerWallet && isNecessaryBlindSigning) {
            alert.warning(t('settings.ledgerBlindSigning'));
            setLoading(false);
            return;
          }
          if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
            setIsReconectModalOpen(true);
            setLoading(false);
            return;
          }
          logError('error', 'Transaction', notLegacyError);

          alert.error(t('send.cantCompleteTxs'));

          if (isExternal) setTimeout(window.close, 4000);
          else setLoading(false);
          return notLegacyError;
        }
      }
    }
  };

  useEffect(() => {
    const abortController = new AbortController();

    const getInitialFeeRecomendation = async () => {
      const nonce = await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'getRecommendedNonce'],
        [tx.from]
      );
      const baseTx = transactionDataValidation
        ? {
            from: tx.from,
            to: tx.to,
            value: tx.value,
            data: tx.data,
            nonce,
          }
        : {
            from: tx.from,
            to: tx.to,
            value: tx.value,
            nonce,
          };
      let isInvalidTxData = false;
      let gasLimitResult;
      let eip1559GasError = false;
      let gasLimitError = false;
      if (tx.gas) {
        gasLimitResult = BigNumber.from(0);
      } else {
        const currentBlockRequest = (await controllerEmitter(
          [
            'wallet',
            'ethereumTransaction',
            'contentScriptWeb3Provider',
            'send',
          ],
          ['eth_getBlockByNumber', ['latest', false]]
        )) as any;

        const gasLimitFromCurrentBlock = Math.floor(
          Number(currentBlockRequest.gasLimit) * 0.95
        ); //GasLimit from current block with 5% discount, whole limit from block is too much
        gasLimitResult = BigNumber.from(gasLimitFromCurrentBlock);
        gasLimitError = false;

        // verify tx data
        try {
          if (transactionDataValidation) {
            // if it run successfully, the contract data is all right.
            const clonedTx = { ...tx };
            delete clonedTx.gasLimit;
            delete clonedTx.gas;
            delete clonedTx.maxPriorityFeePerGas;
            delete clonedTx.maxFeePerGas;
            delete clonedTx.gasPrice;
            await controllerEmitter(
              [
                'wallet',
                'ethereumTransaction',
                'contentScriptWeb3Provider',
                'send',
              ],
              ['eth_call', [clonedTx, 'latest']]
            );
          }
        } catch (error) {
          if (!error.message.includes('reverted')) {
            isInvalidTxData = true;
          }
        }

        try {
          // if tx data is valid, Pali is able to estimate gas.
          if (!isInvalidTxData) {
            gasLimitResult = await controllerEmitter(
              ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
              [baseTx as any]
            );
          }
        } catch (error) {
          console.error(error);
          gasLimitError = true;
        }
      }

      tx.gasLimit =
        (tx?.gas && Number(tx?.gas) > Number(gasLimitResult)) ||
        (tx?.gasLimit && Number(tx?.gasLimit) > Number(gasLimitResult))
          ? BigNumber.from(tx.gas || tx.gasLimit)
          : gasLimitResult;
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } = (await controllerEmitter(
          [
            'wallet',
            'ethereumTransaction',
            'getFeeDataWithDynamicMaxPriorityFeePerGas',
          ]
        )) as any;

        const feeRecomendation = {
          maxFeePerGas: tx?.maxFeePerGas
            ? Number(tx?.maxFeePerGas) / 10 ** 9
            : maxFeePerGas.toNumber() / 10 ** 9,
          baseFee:
            tx?.maxFeePerGas && tx?.maxPriorityFeePerGas
              ? (Number(tx.maxFeePerGas) - Number(tx.maxPriorityFeePerGas)) /
                10 ** 9
              : maxFeePerGas.sub(maxPriorityFeePerGas).toNumber() / 10 ** 9,
          maxPriorityFeePerGas: tx?.maxPriorityFeePerGas
            ? Number(tx.maxPriorityFeePerGas) / 10 ** 9
            : maxPriorityFeePerGas.toNumber() / 10 ** 9,
          gasLimit: tx.gasLimit,
          gasPrice: tx?.gasPrice
            ? Number(tx.gasPrice) / 10 ** 9
            : Number(
                await controllerEmitter([
                  'wallet',
                  'ethereumTransaction',
                  'getRecommendedGasPrice',
                ])
              ) /
              10 ** 9,
        };

        setFee(feeRecomendation);
      } catch (error) {
        console.error(error);
        eip1559GasError = true;
      }

      setErrors({
        eip1559GasError,
        gasLimitError,
        txDataError: isInvalidTxData,
      });
    };

    if (tx) {
      getInitialFeeRecomendation();
    }

    return () => {
      abortController.abort();
    };
  }, []);

  const getCalculatedFee = useMemo(() => {
    if (!tx.gasPrice && !fee?.gasLimit && !fee?.maxFeePerGas) return;

    return isLegacyTransaction
      ? (Number(customFee.isCustom ? customFee.gasPrice : fee?.gasPrice) *
          Number(validateCustomGasLimit ? customFee.gasLimit : fee?.gasLimit)) /
          10 ** 9
      : (Number(
          customFee.isCustom ? customFee.maxFeePerGas : fee?.maxFeePerGas
        ) *
          Number(validateCustomGasLimit ? customFee.gasLimit : fee?.gasLimit)) /
          10 ** 9;
  }, [fee?.gasPrice, fee?.gasLimit, fee?.maxFeePerGas, customFee]);

  useEffect(() => {
    if (!copied) return;
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

  return (
    <>
      <DefaultModal
        show={confirmed}
        title={t('send.txSuccessfull')}
        description={t('send.txSuccessfullMessage')}
        onClose={() => {
          controllerEmitter(
            ['wallet', 'sendAndSaveTransaction'],
            [confirmedTx]
          );
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />

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

      {tx.from && fee ? (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              {externalTx.decodedTx.method}
            </span>

            {externalTx.decodedTx.method !== 'Contract Deployment' ? (
              <span>
                {`${
                  Number(tx.value ? tx.value : 0) / 10 ** 18
                } ${' '} ${activeNetwork.currency.toUpperCase()}`}
              </span>
            ) : (
              <span>
                {`${0} ${' '} ${activeNetwork.currency.toUpperCase()}`}
              </span>
            )}
          </p>

          {errors.txDataError && (
            <span className="text-red-600 text-xs my-4 text-center">
              {t('send.contractEstimateError')}
            </span>
          )}

          {(errors.eip1559GasError || errors.gasLimitError) && (
            <span className="disabled text-xs my-4 text-center">
              {t('send.rpcEstimateError')}
            </span>
          )}

          <div className="flex flex-col gap-3 items-start justify-center w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              {t('send.from')}
              <span className="text-brand-royalblue text-xs">
                <Tooltip content={tx.from} childrenClassName="flex">
                  {ellipsis(tx.from, 7, 15)}
                  {
                    <IconButton onClick={() => copy(tx.from ?? '')}>
                      <Icon
                        wrapperClassname="flex items-center justify-center"
                        name="copy"
                        className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                      />
                    </IconButton>
                  }
                </Tooltip>
              </span>
            </p>

            {tx.to && (
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('send.to')}
                <span className="text-brand-royalblue text-xs">
                  <Tooltip content={tx.to} childrenClassName="flex">
                    {ellipsis(tx.to, 7, 15)}
                    {
                      <IconButton onClick={() => copy(tx.to ?? '')}>
                        <Icon
                          wrapperClassname="flex items-center justify-center"
                          name="copy"
                          className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                        />
                      </IconButton>
                    }
                  </Tooltip>
                </span>
              </p>
            )}

            <div className="flex flex-row items-center justify-between w-full">
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('send.estimatedGasFee')}
                <span className="text-brand-royalblue text-xs">
                  {removeScientificNotation(getCalculatedFee)}{' '}
                  {activeNetwork.currency.toUpperCase()}
                </span>
              </p>
              <span
                className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
                onClick={() => setIsOpen(true)}
              >
                {t('buttons.edit')}
              </span>
            </div>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Total ({t('send.amountAndFee')})
              {externalTx.decodedTx.method !== 'Contract Deployment' ? (
                <span className="text-brand-royalblue text-xs">
                  {`${
                    Number(tx.value ? tx.value : 0) / 10 ** 18 +
                    getCalculatedFee
                  } ${activeNetwork.currency.toLocaleUpperCase()}`}
                </span>
              ) : (
                <span className="text-brand-royalblue text-xs">
                  {`${getCalculatedFee} ${activeNetwork.currency.toLocaleUpperCase()}`}
                </span>
              )}
            </p>

            {transactionDataValidation ? (
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('send.data')}
                <div
                  className="scrollbar-styled h-fit mb-6 mt-2 px-2.5 py-1 max-w-full max-h-16 break-all text-xs rounded-xl overflow-x-hidden overflow-y-auto"
                  style={{
                    backgroundColor: 'rgba(22, 39, 66, 1)',
                    overflowWrap: 'break-word',
                  }}
                >
                  {tx.data}
                </div>
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-around py-8 w-full">
            <SecondaryButton
              type="button"
              onClick={() => {
                if (isExternal) window.close();
                else navigate('/home');
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
      ) : null}
    </>
  );
};
