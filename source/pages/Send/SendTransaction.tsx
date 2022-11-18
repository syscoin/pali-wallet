import { Input } from 'antd';
import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { logError, ellipsis, removeScientificNotation } from 'utils/index';

const tabElements = [
  {
    id: 'detailsTab',
    tabName: 'Details',
  },
  {
    id: 'dataTab',
    tabName: 'Data',
  },
  {
    id: 'hexTab',
    tabName: 'Hex',
  },
];

const tabComponents = [
  {
    id: 'detailsTab',
    component: <p>Details</p>,
  },
  {
    id: 'dataTab',
    component: <p>Data</p>,
  },
  {
    id: 'hexTab',
    component: <p>Hex</p>,
  },
];

export const SendTransaction = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const { alert, navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const { host, ...externalTx } = useQueryData();
  console.log(externalTx);
  const isExternal = Boolean(externalTx.external);
  const datatx = isExternal
    ? externalTx.tx
    : state.external
    ? state.tx
    : state.tx;

  const decodedTxData = isExternal
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

  console.log('tabselected', tabSelected);

  const canGoBack = state?.external ? !state.external : !isExternal;

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      const txs = account.eth.tx;
      setTx({
        ...tx,
        nonce: customNonce,
        maxPriorityFeePerGas: txs.toBigNumber(
          fee.maxPriorityFeePerGas * 10 ** 18
        ),
        maxFeePerGas: txs.toBigNumber(fee.maxFeePerGas * 10 ** 18),
        gasLimit: txs.toBigNumber(fee.gasLimit),
      });
      try {
        const response = await txs.sendFormattedTransaction(tx);
        setConfirmed(true);
        setLoading(false);

        if (isExternal)
          dispatchBackgroundEvent(`txSend.${host}`, response.hash);
        return response.hash;
      } catch (error: any) {
        logError('error', 'Transaction', error);

        alert.removeAll();
        alert.error("Can't complete transaction. Try again later.");

        if (isExternal) setTimeout(window.close, 4000);
        else setLoading(false);
        return error;
      }
    }
  };
  useEffect(() => {
    const fetchGasAndDecodeFunction = async () => {
      const txs = account.eth.tx;
      const { maxFeePerGas, maxPriorityFeePerGas } =
        await txs.getFeeDataWithDynamicMaxPriorityFeePerGas(); // this details maxFeePerGas and maxPriorityFeePerGas need to be passed as an option
      const nonce = await txs.getRecommendedNonce(datatx.from); // This also need possibility for customization
      const formTx = {
        data: datatx.data,
        from: datatx.from,
        to: datatx.to,
        value: datatx?.value ? datatx.value : 0,
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
    <Layout title="Contract Interation" canGoBack={canGoBack}>
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
      {tx?.from && (
        <>
          <div className="mb-4 border-b border-gray-200 dark:border-gray-700">
            <ul
              className="flex flex-wrap -mb-px text-center dark:text-gray-400 text-gray-500 text-sm font-medium"
              id="tabExample"
              role="tablist"
            >
              {tabElements.map((tab) => (
                <li className="mr-2" role="presentation" key={tab.id}>
                  <button
                    className="dark:hover:text-gray-300 inline-block p-4 hover:text-gray-600 border-b-2 hover:border-gray-300 border-transparent rounded-t-lg"
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

          <div id="tabContentExample">
            {tabComponents.map((component) => (
              <div
                key={component.id}
                className={`${
                  component.id !== tabSelected ? 'hidden' : 'flex'
                } p-4`}
                id={component.id}
                role="tabpanel"
              >
                {component.component}
              </div>
            ))}
          </div>

          {/* <div className="flex flex-col items-center justify-center w-full">
            <p className="flex flex-col items-center justify-center text-center font-rubik">
              <span className="text-brand-royalblue font-poppins font-thin">
                Send
              </span>

              <span>
                {`${Number(tx.value) / 10 ** 18} ${' '} ${
                  tx.token
                    ? tx.token.symbol
                    : activeNetwork.currency?.toUpperCase()
                }`}
              </span>
            </p>
            <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                From
                <span className="text-brand-royalblue text-xs">
                  {ellipsis(tx.from, 7, 15)}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                To
                <span className="text-brand-royalblue text-xs">
                  {ellipsis(tx.to, 7, 15)}
                </span>
              </p>

              <div className="flex flex-row items-center justify-between w-full">
                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  Estimated GasFee
                  <span className="text-brand-royalblue text-xs">
                    Max Fee: {removeScientificNotation(fee.maxFeePerGas)}{' '}
                    {activeNetwork.currency?.toUpperCase()}
                  </span>
                </p>
                <span
                  className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
                  onClick={() =>
                    navigate('edit/priority', {
                      state: { tx: datatx, external: true, fee },
                    })
                  }
                >
                  EDIT
                </span>
              </div>

              <p className="flex flex-col pt-2 w-40 text-brand-white font-poppins font-thin">
                Custom Nonce
                <span className="text-brand-royalblue text-xs">
                  <Input
                    type="number"
                    className="input-medium outline-0 w-10 bg-bkg-2 rounded-sm focus:outline-none focus-visible:outline-none"
                    placeholder={tx.nonce}
                    defaultValue={tx.nonce}
                    onChange={(e) => setCustomNonce(Number(e.target.value))}
                  />
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Total (Amount + gas fee)
                <span className="text-brand-royalblue text-xs">
                  {Number(tx.value) / 10 ** 18 + fee.maxFeePerGas}
                </span>
              </p>
            </div>

            <div className="absolute bottom-12 md:static md:mt-10">
              <NeutralButton
                loading={loading}
                onClick={handleConfirm}
                type="button"
                id="confirm-btn"
              >
                Confirm
              </NeutralButton>
            </div>
            {/* Rejection button must be added <div className="absolute bottom-12 md:static md:mt-10">
            <NeutralButton
              loading={loading}
              onClick={handleReject}
              type="button"
              id="confirm-btn"
            >
              Reject
            </NeutralButton>
            </div> */}

          {/* </div> */}
        </>
      )}
    </Layout>
  );
};
