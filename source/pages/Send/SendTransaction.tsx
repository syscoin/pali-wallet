import { BigNumber, ethers } from 'ethers';
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { DefaultModal, PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  ICustomFeeParams,
  IDecodedTx,
  IFeeState,
  ITransactionParams,
  ITxState,
} from 'types/transactions';
import { dispatchBackgroundEvent } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
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
import { EditPriorityModal } from './EditPriority';
import { tabComponents, tabElements } from './mockedComponentsData/mockedTabs';

export const SendTransaction = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { navigate, alert } = useUtils();
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const url = chrome.runtime.getURL('app.html');
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

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
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

    if (activeAccount.isTrezorWallet) {
      await controllerEmitter(['wallet', 'trezorSigner', 'init'], [], false);
    }

    if (activeAccount && balance > 0) {
      setLoading(true);

      setTx({
        ...(validatedDataTxWithoutType as ITxState),
        nonce: customNonce,
        maxPriorityFeePerGas: ethers.utils.parseUnits(
          String(
            Boolean(customFee.isCustom && customFee.maxPriorityFeePerGas > 0)
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
            customFee.isCustom && customFee.gasLimit && customFee.gasLimit > 0
          )
            ? customFee.gasLimit
            : fee.gasLimit
        ),
      });
      try {
        const response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
          [
            {
              ...tx,
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
          ]
        )) as any;

        await controllerEmitter(
          ['wallet', 'sendAndSaveTransaction'],
          [response]
        );
        if (isExternal)
          dispatchBackgroundEvent(`${eventName}.${host}`, response.hash);
        setConfirmed(true);
        setLoading(false);
        return response.hash;
      } catch (error: any) {
        const isNecessaryReconnect = error.message.includes(
          'read properties of undefined'
        );
        const isNecessaryBlindSigning = error.message.includes(
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
        }
      } catch (e) {
        // Don't handle error if request was aborted
        if (e.name === 'AbortError') {
          return;
        }

        if (isMounted) {
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
        setTimeout(window.close, 2000);
      } else {
        navigate('/home');
      }
    }
  }, [confirmed, alert, t, navigate, isExternal]);

  // Clear navigation state when component unmounts or navigates away
  useEffect(
    () => () => {
      clearNavigationState();
    },
    []
  );

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

      {tx?.from ? (
        <div className="flex flex-col items-center justify-center w-full">
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
              <p>Local</p>
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

          <div
            id="buttons"
            className="flex items-center justify-around py-8 w-full"
          >
            <SecondaryButton
              type="button"
              onClick={() => {
                // Clear navigation state when user cancels/goes away
                clearNavigationState();
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
      ) : null}
    </>
  );
};
