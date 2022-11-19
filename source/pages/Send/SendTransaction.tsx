import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { IDecodedTx } from 'types/transactions';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { logError, ellipsis, removeScientificNotation } from 'utils/index';

import {
  TransactionDetailsComponent,
  TransactionDataComponent,
} from './components';
import { tabComponents, tabElements } from './mockedComponentsData/mockedTabs';

export const SendTransaction = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const { navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();

  const { host, ...externalTx } = useQueryData();

  const isExternal = Boolean(externalTx.external);

  const dataTx = isExternal
    ? externalTx.tx
    : state.external
    ? state.tx
    : state.tx;

  const decodedTxData: IDecodedTx = isExternal
    ? externalTx.decodedTx
    : state.external
    ? state.decodedTx
    : state.decodedTx;

  console.log('externalTx data', externalTx);

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [tx, setTx] = useState<any>();
  const [fee, setFee] = useState<any>();
  const [customNonce, setCustomNonce] = useState<any>();
  const [tabSelected, setTabSelected] = useState<string>(tabElements[0].id);

  const canGoBack = state?.external ? !state.external : !isExternal;

  useEffect(() => {
    const fetchGasAndDecodeFunction = async () => {
      const txs = account.eth.tx;
      const { maxFeePerGas, maxPriorityFeePerGas } =
        await txs.getFeeDataWithDynamicMaxPriorityFeePerGas(); // this details maxFeePerGas and maxPriorityFeePerGas need to be passed as an option
      const nonce = await txs.getRecommendedNonce(dataTx.from); // This also need possibility for customization
      const formTx = {
        data: dataTx.data,
        from: dataTx.from,
        to: dataTx.to,
        value: dataTx?.value ? dataTx.value : 0,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        maxFeePerGas: maxFeePerGas,
        nonce: nonce,
        chainId: activeNetwork.chainId,
        gasLimit: txs.toBigNumber(0),
      };
      formTx.gasLimit = await txs.getTxGasLimit(formTx);
      const feeDetails = {
        maxFeePerGas: maxFeePerGas.toNumber() / 10 ** 18,
        baseFee: maxFeePerGas.sub(maxPriorityFeePerGas).toNumber() / 10 ** 18,
        maxPriorityFeePerGas: maxPriorityFeePerGas.toNumber() / 10 ** 18,
        gasLimit: formTx.gasLimit.toNumber(),
      };
      setFee(feeDetails);
      setTx(formTx);
      setCustomNonce(nonce);
    };
    fetchGasAndDecodeFunction().catch(console.error);
  }, []); // TODO: add timer

  useEffect(() => {
    console.log(state?.customFee);
    if (state?.customFee) {
      setFee((prevState) => ({
        ...prevState,
        gasLimit:
          state.customFee.gasLimit !== '0'
            ? Number(state.customFee.gasLimit)
            : prevState?.gasLimit,
        maxPriorityFeePerGas:
          state.customFee.maxPriorityFeePerGas !== '0'
            ? Number(state.customFee.maxPriorityFeePerGas)
            : prevState?.maxPriorityFeePerGas,
        maxFeePerGas:
          state.customFee.maxFee !== '0'
            ? Number(state.customFee.maxFee)
            : prevState?.maxFeePerGas,
        feeByPriorityBar: state.customFee.feeByPriorityBar,
      }));
    }
  }, [state]);
  return (
    <Layout title="Transaction" canGoBack={canGoBack}>
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          refresh(false);
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />

      {tx?.from ? (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center w-full text-center text-brand-white font-poppins font-thin">
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
                {decodedTxData.method}
              </span>
            </p>
          </p>

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
                    setTx={setTx}
                    dataTx={dataTx}
                    isExternal={isExternal}
                    decodedTx={decodedTxData}
                    loading={loading}
                    setLoading={setLoading}
                    customNonce={customNonce}
                    setCustomNonce={setCustomNonce}
                    fee={fee}
                    setConfirmed={setConfirmed}
                    host={host}
                  />
                ) : component.component === 'data' ? (
                  <TransactionDataComponent decodedTx={decodedTxData} />
                ) : component.component === 'hex' ? (
                  <p>hex</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Layout>
  );
};
