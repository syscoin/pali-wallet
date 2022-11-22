import { BigNumber, ethers, FixedNumber } from 'ethers';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { browser } from 'webextension-polyfill-ts';

import { getErc20Abi } from '@pollum-io/sysweb3-utils';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Layout, DefaultModal, NeutralButton, Button } from 'components/index';
import { useQueryData } from 'hooks/useQuery';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { IDecodedTx, IFeeState, ITxState } from 'types/transactions';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { ellipsis } from 'utils/format';
import { logError } from 'utils/logger';

export const ApproveTransactionComponent = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const { navigate, alert, useCopyClipboard } = useUtils();

  const [copied, copy] = useCopyClipboard();

  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>();
  const [customNonce, setCustomNonce] = useState<number>();
  const [tokenSymbol, setTokenSymbol] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [detailsOpened, setDetailsOpened] = useState<boolean>(false);

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { state }: { state: any } = useLocation();

  const { host, ...externalTx } = useQueryData();

  const isExternal = Boolean(externalTx.external);

  const dataTx = isExternal
    ? externalTx.tx
    : state.external
    ? state.tx
    : state.tx;

  const decodedTx: IDecodedTx = isExternal
    ? externalTx.decodedTx
    : state.external
    ? state.decodedTx
    : state.decodedTx;

  const canGoBack = state?.external ? !state.external : !isExternal;

  const parseApprovedValue = parseInt(decodedTx.inputs[1].hex, 16);

  console.log('fee', fee);
  console.log('tx', tx);
  console.log('decodedTx', decodedTx);

  const openEthExplorer = () => {
    browser.windows.create({
      url: `${activeNetwork.explorer}address/${dataTx.to}`,
    });
  };

  const handleConfirmApprove = async () => {
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
          dispatchBackgroundEvent(`txApprove.${host}`, response.hash);
        return response.hash;
      } catch (error: any) {
        logError('error', 'Transaction', error);

        alert.removeAll();
        alert.error("Can't complete approve. Try again later.");

        if (isExternal) setTimeout(window.close, 4000);
        else setLoading(false);
        return error;
      }
    }
  };

  // const calculateGasFee = (
  //   gasLimit: number,
  //   maxFeePerGas: BigNumber | number
  // ) => {
  //   const transformMaxFeeToEth = ethers.utils.formatEther(maxFeePerGas);

  //   const fixedNumber = FixedNumber.from(transformMaxFeeToEth);
  //   const fixedGasLimit = FixedNumber.from(gasLimit);

  //   const convertGas = BigNumber.from(fixedGasLimit._hex);
  //   console.log('convertGas', convertGas);

  //   const convertToBigNumber = BigNumber.from(fixedNumber._hex);

  //   const multiply = convertToBigNumber.mul(convertGas);

  //   console.log('multiply', multiply);

  //   // const multiply = convertToBigNumber.mul(BigNumber.from(gasLimit));
  // };

  useEffect(() => {
    const abortController = new AbortController();

    const getGasAndFunction = async () => {
      const { feeDetails, formTx, nonce } = await fetchGasAndDecodeFunction(
        dataTx,
        activeNetwork
      );

      setFee(feeDetails);
      setTx(formTx);
      setCustomNonce(nonce);
    };

    getGasAndFunction();

    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    const getTokenName = async (contractAddress: string) => {
      const getProvider = new ethers.providers.JsonRpcProvider(
        activeNetwork.url
      );

      const contractInstance = new ethers.Contract(
        contractAddress,
        getErc20Abi(),
        getProvider
      );

      const tokenSymbol = await contractInstance?.callStatic?.symbol();

      setTokenSymbol(tokenSymbol);
    };

    getTokenName(dataTx.to);

    return () => {
      abortController.abort();
    };
  }, [dataTx.to]);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Address successfully copied!');
  }, [copied]);

  return (
    <Layout title="Approve" canGoBack={canGoBack}>
      <DefaultModal
        show={confirmed}
        title="Approve successful"
        description="Your approve has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          refresh(false);
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />

      {tx?.from ? (
        <>
          <div className="flex flex-col items-center justify-center w-full divide-bkg-3 divide-dashed divide-y">
            <div className="pb-4 w-full">
              <div className="flex flex-col gap-4 items-center justify-center w-full text-center text-brand-white font-poppins font-thin">
                <div
                  className="mb-1.5 p-3 text-xs rounded-xl"
                  style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
                >
                  <span className="text-sm font-medium font-thin">{host}</span>
                </div>

                <span className="text-brand-white text-lg">
                  You grant access to your{' '}
                  <span className="text-brand-royalblue font-semibold">
                    {tokenSymbol}
                  </span>
                </span>
                <span className="text-brand-graylight text-sm">
                  By granting permission, you are authorizing the following
                  contract to access your funds
                </span>
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
                    />
                  </IconButton>

                  <IconButton onClick={openEthExplorer}>
                    <Icon
                      name="select"
                      className="text-brand-white hover:text-fields-input-borderfocus"
                    />
                  </IconButton>
                </div>
                <div>
                  <button type="button" className="text-blue-300 text-sm">
                    Edit permission
                  </button>
                </div>
              </div>
            </div>

            <div className="items-center justify-center py-4 w-full">
              <div className="grid gap-y-3 grid-cols-1 auto-cols-auto">
                <div className="grid grid-cols-2 items-center">
                  <div className="flex items-center">
                    <Icon
                      name="tag"
                      className="flex items-center justify-center w-4"
                      wrapperClassname="mr-3"
                    />
                    <h1 className="text-base font-bold">Transaction Fee</h1>
                  </div>

                  <button
                    type="button"
                    className="justify-self-end text-blue-300 text-xs"
                  >
                    Edit
                  </button>
                </div>

                <div className="grid grid-cols-2 items-center">
                  <span className="text-brand-graylight text-xs font-thin">
                    There is a fee associated with this request.
                  </span>

                  <p className="flex flex-col items-end text-brand-white text-lg font-bold">
                    $0.00
                    <span className="text-gray-500 text-base font-medium">
                      0.00028 SYS
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-center mt-6">
                <button
                  type="button"
                  className="text-blue-300 text-sm"
                  onClick={() => setDetailsOpened(!detailsOpened)}
                >
                  {detailsOpened ? 'Hide' : 'Show'} full transaction details
                </button>
              </div>
            </div>

            <div
              className={`${
                detailsOpened ? 'flex' : 'hidden'
              } flex-col w-full  divide-bkg-3 divide-dashed divide-y`}
            >
              <div className="grid gap-y-4 grid-cols-1 py-4 auto-cols-auto">
                <div className="grid grid-cols-2 items-center">
                  <div className="flex items-center">
                    <Icon
                      name="user"
                      className="flex items-center justify-center w-4"
                      wrapperClassname="mr-3"
                    />
                    <h2 className="text-base font-bold">Permission Request</h2>
                  </div>

                  <button
                    type="button"
                    className="self-start justify-self-end text-blue-300 text-xs"
                  >
                    Edit
                  </button>
                </div>

                <p className="text-brand-graylight text-xs font-thin">
                  {host} can access and spend up to this maximum amount.
                </p>

                <div className="grid grid-cols-2 items-center text-sm">
                  <p className="font-bold">Approved amount:</p>
                  <span>
                    {parseApprovedValue}
                    <span className="ml-1 text-brand-royalblue font-semibold">
                      {tokenSymbol}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-2 items-center text-sm">
                  <p className="font-bold">Granted to:</p>
                  <div className="flex items-center justify-between">
                    <span>{ellipsis(dataTx.to)}</span>
                    <IconButton onClick={() => copy(dataTx.to)}>
                      <Icon
                        name="copy"
                        className="text-brand-white hover:text-fields-input-borderfocus"
                      />
                    </IconButton>
                  </div>
                </div>
              </div>

              <div className="grid gap-y-2 grid-cols-1 py-4 auto-cols-auto">
                <div className="grid items-center">
                  <div className="flex items-center">
                    <Icon
                      name="file"
                      className="flex items-center justify-center w-4"
                      wrapperClassname="mr-3"
                    />
                    <h3 className="text-base font-bold">Data</h3>
                  </div>
                </div>

                <p className="text-brand-graylight text-xs font-thin">
                  Method: {decodedTx.method}
                </p>

                <div
                  className="mb-3 p-2 w-full text-xs rounded-xl"
                  style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
                >
                  <p
                    className="w-full"
                    style={{
                      overflowWrap: 'break-word',
                      wordBreak: 'break-all',
                    }}
                  >
                    {tx?.data}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-around py-4 w-full">
              <Button
                type="button"
                className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-full transition-all duration-300 xl:flex-none"
                id="send-btn"
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
                onClick={handleConfirmApprove}
              >
                <Icon
                  name="arrow-down"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                />
                Receive
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );
};