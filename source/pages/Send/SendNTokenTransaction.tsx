import { ethers } from 'ethers';
import omit from 'lodash/omit';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { IconButton } from 'components/IconButton';
import { Layout, DefaultModal, Button, Icon } from 'components/index';
import { Tooltip } from 'components/Tooltip';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ICustomFeeParams, IFeeState, ITxState } from 'types/transactions';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import {
  logError,
  ellipsis,
  removeScientificNotation,
  omitTransactionObjectData,
} from 'utils/index';

import { EditPriorityModal } from './EditPriorityModal';

export const SendNTokenTransaction = () => {
  const {
    wallet: { ethereumTransaction, sendAndSaveTransaction }, //TODO: validates this gets doesn't leads into bugs
  } = getController();

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
  const [haveError, setHaveError] = useState<boolean>(false);
  const [customFee, setCustomFee] = useState<ICustomFeeParams>({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
    gasPrice: 0,
  });
  const [confirmedTx, setConfirmedTx] = useState<any>();

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

  const isLegacyTransaction = Boolean(tx.type === '0x0');

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit > 0
  );

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);
      let txToSend = tx;
      if (tx?.gas) txToSend = omit(txToSend, ['gas']); //Paliative solution until we figure out how to enhance useEffect so its not constantly called
      const txWithoutType = omitTransactionObjectData(txToSend, [
        'type',
      ]) as ITxState;
      if (isLegacyTransaction) {
        try {
          const getGasCorrectlyGasPrice = Boolean(
            customFee.isCustom && customFee.gasPrice > 0
          )
            ? customFee.gasPrice * 10 ** 9 // Calculate custom value to send to transaction because it comes without decimals, only 8 -> 10 -> 12
            : await ethereumTransaction.getRecommendedGasPrice();

          await ethereumTransaction
            .sendFormattedTransaction(
              {
                ...txWithoutType,
                gasPrice: ethers.utils.hexlify(Number(getGasCorrectlyGasPrice)),
                gasLimit: ethereumTransaction.toBigNumber(
                  validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
                ),
              },
              sendAndSaveTransaction
            )
            .then((response) => {
              setConfirmedTx(response);
              setConfirmed(true);
              setLoading(false);
              if (isExternal)
                dispatchBackgroundEvent(`${eventName}.${host}`, response);
            })
            .catch((error) => {
              alert.error("Can't complete transaction. Try again later.");
              setLoading(false);
              throw error;
            });

          return;
        } catch (legacyError: any) {
          logError('error', 'Transaction', legacyError);

          alert.removeAll();
          alert.error("Can't complete transaction. Try again later.");

          if (isExternal) setTimeout(window.close, 4000);
          else setLoading(false);
          return legacyError;
        }
      } else {
        try {
          await ethereumTransaction
            .sendFormattedTransaction({
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
              gasLimit: ethereumTransaction.toBigNumber(
                validateCustomGasLimit
                  ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                  : fee.gasLimit
              ),
            })
            .then((response) => {
              setConfirmedTx(response);
              setConfirmed(true);
              setLoading(false);
              if (isExternal)
                dispatchBackgroundEvent(`${eventName}.${host}`, response);
            })
            .catch((error) => {
              alert.error("Can't complete transaction. Try again later.");
              setLoading(false);
              throw error;
            });

          return;
        } catch (notLegacyError) {
          logError('error', 'Transaction', notLegacyError);

          alert.removeAll();
          alert.error("Can't complete transaction. Try again later.");

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
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } =
          await ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas();

        const getTxGasLimitResult = await ethereumTransaction.getTxGasLimit(tx);

        tx.gasLimit =
          (tx?.gas && Number(tx?.gas) > Number(getTxGasLimitResult)) ||
          (tx?.gasLimit && Number(tx?.gasLimit) > Number(getTxGasLimitResult))
            ? ethereumTransaction.toBigNumber(tx.gas || tx.gasLimit)
            : getTxGasLimitResult;

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
          gasLimit: tx?.gasLimit ? tx.gasLimit : getTxGasLimitResult,
          gasPrice: tx?.gasPrice ? Number(tx.gasPrice) / 10 ** 9 : 0,
        };

        setFee(feeRecomendation);
      } catch (error) {
        logError('error getting fees', 'Transaction', error);
        alert.removeAll();
        alert.error(
          'Error in the proccess to get fee values,  please verify your balance and try again later.'
        );

        //Wait enough time to te error be showed to later close the window
        setTimeout(window.close, 3000);
      }
    };

    getInitialFeeRecomendation();

    return () => {
      abortController.abort();
    };
  }, [tx]);

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
    alert.removeAll();
    alert.success('Address successfully copied');
  }, [copied]);
  return (
    <Layout title="SEND" canGoBack={!isExternal}>
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          sendAndSaveTransaction(confirmedTx);
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />

      <DefaultModal
        show={haveError}
        title="Verify Fields"
        description="Change fields values and try again."
        onClose={() => setHaveError(false)}
      />

      <EditPriorityModal
        showModal={isOpen}
        setIsOpen={setIsOpen}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={setHaveError}
        fee={fee}
        isSendLegacyTransaction={isLegacyTransaction}
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
                  Number(tx.value) / 10 ** 18
                } ${' '} ${activeNetwork.currency?.toUpperCase()}`}
              </span>
            ) : (
              <span>
                {`${0} ${' '} ${activeNetwork.currency?.toUpperCase()}`}
              </span>
            )}
          </p>

          <div className="flex flex-col gap-3 items-start justify-center w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              From
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

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              To
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

            <div className="flex flex-row items-center justify-between w-full">
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Estimated GasFee
                <span className="text-brand-royalblue text-xs">
                  {removeScientificNotation(getCalculatedFee)}{' '}
                  {activeNetwork.currency?.toUpperCase()}
                </span>
              </p>
              <span
                className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
                onClick={() => setIsOpen(true)}
              >
                EDIT
              </span>
            </div>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Total (Amount + gas fee)
              {externalTx.decodedTx.method !== 'Contract Deployment' ? (
                <span className="text-brand-royalblue text-xs">
                  {`${
                    Number(tx.value) / 10 ** 18 + getCalculatedFee
                  } ${activeNetwork.currency?.toLocaleUpperCase()}`}
                </span>
              ) : (
                <span className="text-brand-royalblue text-xs">
                  {`${getCalculatedFee} ${activeNetwork.currency?.toLocaleUpperCase()}`}
                </span>
              )}
            </p>

            {transactionDataValidation ? (
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Data
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
            <Button
              type="button"
              className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-full transition-all duration-300 xl:flex-none"
              id="send-btn"
              onClick={() => {
                if (isExternal) window.close();
                else navigate('/home');
              }}
            >
              <Icon
                name="arrow-up"
                className="w-4"
                wrapperClassname="mb-2 mr-2"
                rotate={45}
              />
              Cancel
            </Button>

            <Button
              type="button"
              className={`${
                loading
                  ? 'opacity-60 cursor-not-allowed'
                  : 'opacity-100 hover:opacity-90'
              } xl:p-18 h-8 flex items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-full transition-all duration-300 xl:flex-none`}
              id="receive-btn"
              loading={loading}
              onClick={handleConfirm}
            >
              {!loading ? (
                <Icon
                  name="arrow-down"
                  className="w-5"
                  wrapperClassname="flex items-center mr-2"
                />
              ) : (
                <Icon
                  name="loading"
                  color="#fff"
                  className="w-5 animate-spin-slow"
                  wrapperClassname="mr-2 flex items-center"
                />
              )}
              Confirm
            </Button>
          </div>
        </div>
      ) : null}
    </Layout>
  );
};
