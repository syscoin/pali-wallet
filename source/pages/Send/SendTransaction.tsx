import { ethers } from 'ethers';
import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Icon } from 'components/Icon';
import { Layout, DefaultModal, Button } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import {
  ICustomFeeParams,
  IDecodedTx,
  IFeeState,
  ITransactionParams,
  ITxState,
} from 'types/transactions';
import { getController, dispatchBackgroundEvent } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { logError } from 'utils/logger';
import { omitTransactionObjectData } from 'utils/transactions';
import { validateTransactionDataValue } from 'utils/validateTransactionDataValue';

import {
  TransactionDetailsComponent,
  TransactionDataComponent,
  TransactionHexComponent,
} from './components';
import { EditPriorityModal } from './EditPriorityModal';
import { tabComponents, tabElements } from './mockedComponentsData/mockedTabs';

export const SendTransaction = () => {
  const {
    wallet: { ethereumTransaction, sendAndSaveTransaction },
  } = getController();

  const { navigate, alert } = useUtils();

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
  const [confirmedTx, setConfirmedTx] = useState<any>();
  const [loading, setLoading] = useState<boolean>(false);
  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>();
  const [customNonce, setCustomNonce] = useState<number>();
  const [tabSelected, setTabSelected] = useState<string>(tabElements[0].id);
  const [haveError, setHaveError] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [customFee, setCustomFee] = useState<ICustomFeeParams>({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
  });

  const canGoBack = state?.external ? !state.external : !isExternal;

  const omitTransactionObject = omitTransactionObjectData(dataTx, ['type']);

  const validatedDataTxWithoutType = {
    ...omitTransactionObject,
    data: validateTransactionDataValue(dataTx.data),
  };

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      setTx({
        ...(validatedDataTxWithoutType as ITxState),
        nonce: customNonce,
        maxPriorityFeePerGas: ethers.utils.parseUnits(
          String(
            Boolean(customFee.isCustom && customFee.maxPriorityFeePerGas > 0)
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
          Boolean(customFee.isCustom && customFee.gasLimit > 0)
            ? customFee.gasLimit
            : fee.gasLimit
        ),
      });
      try {
        const response = await ethereumTransaction.sendFormattedTransaction({
          ...tx,
          nonce: customNonce,
          maxPriorityFeePerGas: ethers.utils.parseUnits(
            String(
              Boolean(customFee.isCustom && customFee.maxPriorityFeePerGas > 0)
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
            Boolean(customFee.isCustom && customFee.gasLimit > 0)
              ? customFee.gasLimit
              : fee.gasLimit
          ),
        });
        setConfirmed(true);
        setLoading(false);
        setConfirmedTx(response);

        if (isExternal)
          dispatchBackgroundEvent(`${eventName}.${host}`, response);
        return response.hash;
      } catch (error: any) {
        logError('error', 'Transaction', error);

        alert.removeAll();
        alert.error("Can't complete transaction. Try again later.");

        if (isExternal) setTimeout(window.close, 4000);
        else setLoading(false);
        return error;
      }
    } else {
      alert.removeAll();
      alert.error("You don't have enough funds for this transactions.");
      if (isExternal) setTimeout(window.close, 2000);
    }
  };

  useEffect(() => {
    const abortController = new AbortController();

    const getGasAndFunction = async () => {
      try {
        const { feeDetails, formTx, nonce } = await fetchGasAndDecodeFunction(
          validatedDataTxWithoutType as ITransactionParams,
          activeNetwork
        );
        setFee(feeDetails);
        setTx(formTx);
        setCustomNonce(nonce);
      } catch (e) {
        logError('error getting fees', 'Transaction', e);
        alert.removeAll();
        alert.error('The transaction will fail, fix it and try again!', e);
        setTimeout(window.close, 3000);
      }
    };

    getGasAndFunction();

    return () => {
      abortController.abort();
    };
  }, []); // TODO: add timer

  return (
    <Layout title="Transaction" canGoBack={canGoBack}>
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          sendAndSaveTransaction(confirmedTx);
          if (isExternal) {
            window.close();
          } else {
            navigate('/home');
          }
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
      />

      {tx?.from ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex flex-col items-center justify-center w-full text-center text-brand-white font-poppins font-thin">
            <span className="text-sm font-medium font-thin">{host}</span>

            <p className="flex flex-col my-8 text-center text-xl">
              Send:
              <span className="text-brand-royalblue">
                {`${Number(tx.value) / 10 ** 18} ${' '} ${
                  tx.token
                    ? tx.token.symbol
                    : activeNetwork.currency?.toUpperCase()
                }`}
              </span>
            </p>

            <p className="flex flex-col text-center text-base">
              Method:
              <span className="text-brand-royalblue">
                {decodedTxData?.method}
              </span>
            </p>
          </div>

          <div className="my-4 w-full">
            <ul
              className="flex flex-wrap justify-around -mb-px text-center text-brand-white text-sm font-medium"
              id="tabExample"
              role="tablist"
            >
              {tabElements.map((tab) => (
                <li
                  className={`${
                    tab.id === tabSelected
                      ? 'border-b border-brand-royalblue'
                      : ''
                  }`}
                  role="presentation"
                  key={tab.id}
                >
                  <button
                    className="inline-block p-4 hover:text-gray-200 border-b-2 hover:border-brand-royalblue border-transparent rounded-t-lg"
                    type="button"
                    role="tab"
                    onClick={() => setTabSelected(tab.id)}
                  >
                    {tab.tabName}
                  </button>
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
                    setHaveError={setHaveError}
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

          <div className="flex items-center justify-around py-8 w-full">
            <Button
              type="button"
              className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-full transition-all duration-300 xl:flex-none"
              id="send-btn"
              onClick={() => {
                if (isExternal) {
                  window.close();
                } else {
                  navigate('/home');
                }
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
              className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-full transition-all duration-300 xl:flex-none"
              id="receive-btn"
              loading={loading}
              onClick={handleConfirm}
            >
              <Icon
                name="arrow-down"
                className="w-4"
                wrapperClassname="mb-2 mr-2"
              />
              Confirm
            </Button>
          </div>
        </div>
      ) : null}
    </Layout>
  );
};
