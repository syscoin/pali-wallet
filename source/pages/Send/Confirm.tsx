import { ethers } from 'ethers';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  Layout,
  DefaultModal,
  NeutralButton,
  Button,
  Icon,
  LoadingComponent,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ICustomFeeParams, IFeeState } from 'types/transactions';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import {
  truncate,
  logError,
  ellipsis,
  removeScientificNotation,
} from 'utils/index';

import { EditPriorityModal } from './EditPriorityModal';

export const SendConfirm = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const { alert, navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const { host, ...externalTx } = useQueryData();

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
  const [txObjectState, setTxObjectState] = useState<any>();
  const [isOpenEditFeeModal, setIsOpenEditFeeModal] = useState<boolean>(false);
  const [haveError, setHaveError] = useState<boolean>(false);

  const isExternal = Boolean(externalTx.amount);
  const basicTxValues = isExternal ? externalTx : state.tx;

  const ethereumTxsController = account.eth.tx;
  const sysTxsController = account.sys.tx;

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit > 0
  );

  const handleConfirm = async () => {
    const {
      balances: { syscoin, ethereum },
    } = activeAccount;

    const balance = isBitcoinBased ? syscoin : ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      //Handle with Syscoin and Ethereum transactions with differentes fee values.
      switch (isBitcoinBased) {
        //SYSCOIN TRANSACTIONS
        case true:
          try {
            const response = await sysTxsController.sendTransaction(
              basicTxValues
            );

            setConfirmed(true);
            setLoading(false);

            if (isExternal) dispatchBackgroundEvent(`txSend.${host}`, response);

            return response;
          } catch (error) {
            logError('error SYS', 'Transaction', error);

            if (error && basicTxValues.fee > 0.00001) {
              alert.removeAll();
              alert.error(
                `${truncate(
                  String(error.message),
                  166
                )} Please, reduce fees to send transaction.`
              );
            }

            alert.removeAll();
            alert.error("Can't complete transaction. Try again later.");

            if (isExternal) setTimeout(window.close, 4000);
            else setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS
        case false:
          try {
            const { chainId, ...restTx } = txObjectState;

            console.log('CONFIRM ETHEREUM OBJECT', {
              ...restTx,
              value: ethereumTxsController.toBigNumber(
                Number(ethers.utils.parseEther(basicTxValues.amount))
              ),

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
              gasLimit: ethereumTxsController.toBigNumber(
                validateCustomGasLimit
                  ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                  : fee.gasLimit
              ),
            });

            const response =
              await ethereumTxsController.sendFormattedTransaction({
                ...restTx,
                value: ethers.utils.hexlify(
                  ethereumTxsController.toBigNumber(
                    Number(ethers.utils.parseEther(basicTxValues.amount))
                  )
                ),
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
                gasLimit: ethereumTxsController.toBigNumber(
                  validateCustomGasLimit
                    ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                    : fee.gasLimit
                ),
              });

            setConfirmed(true);
            setLoading(false);

            if (isExternal) dispatchBackgroundEvent(`txSend.${host}`, response);

            return response;
          } catch (error: any) {
            logError('error ETH', 'Transaction', error);

            alert.removeAll();
            alert.error("Can't complete transaction. Try again later.");

            if (isExternal) setTimeout(window.close, 4000);
            else setLoading(false);
          }

          break;
      }
    }
  };

  useEffect(() => {
    if (isBitcoinBased) return;
    const abortController = new AbortController();

    const getFeeRecomendation = async () => {
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } =
          await ethereumTxsController.getFeeDataWithDynamicMaxPriorityFeePerGas();

        const initialFeeDetails = {
          maxFeePerGas: Number(maxFeePerGas) / 10 ** 9,
          baseFee:
            (Number(maxFeePerGas) - Number(maxPriorityFeePerGas)) / 10 ** 9,
          maxPriorityFeePerGas: Number(maxPriorityFeePerGas) / 10 ** 9,
          gasLimit: ethereumTxsController.toBigNumber(0),
        };

        const formattedTxObject = {
          from: basicTxValues.sender,
          to: basicTxValues.receivingAddress,
          chainId: activeNetwork.chainId,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };

        setTxObjectState(formattedTxObject);

        const getGasLimit = await ethereumTxsController.getTxGasLimit(
          formattedTxObject
        );

        const finalFeeDetails = {
          ...initialFeeDetails,
          gasLimit: getGasLimit,
        };

        setFee(finalFeeDetails as any);
      } catch (error) {
        console.log('ERROR', error);
      }
    };

    getFeeRecomendation();

    return () => {
      abortController.abort();
    };
  }, [basicTxValues, isBitcoinBased]);

  const getCalculatedFee = useMemo(() => {
    const arrayValidation = [
      !fee?.gasLimit,
      !fee?.maxFeePerGas,
      !fee?.baseFee,
      !fee?.maxPriorityFeePerGas,
      isBitcoinBased,
    ];

    if (arrayValidation.some((validation) => validation === true)) return;

    return (
      (Number(customFee.isCustom ? customFee.maxFeePerGas : fee?.maxFeePerGas) *
        Number(validateCustomGasLimit ? customFee.gasLimit : fee?.gasLimit)) /
      10 ** 9
    );
  }, [
    fee?.maxPriorityFeePerGas,
    fee?.gasLimit,
    fee?.maxFeePerGas,
    customFee,
    isBitcoinBased,
  ]);

  return (
    <Layout title="CONFIRM" canGoBack={!isExternal}>
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

      <DefaultModal
        show={haveError}
        title="Verify Fields"
        description="Change fields values and try again."
        onClose={() => setHaveError(false)}
      />

      <EditPriorityModal
        showModal={isOpenEditFeeModal}
        setIsOpen={setIsOpenEditFeeModal}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={setHaveError}
        fee={fee}
      />
      {Boolean(!isBitcoinBased && basicTxValues && fee) ||
      Boolean(isBitcoinBased && basicTxValues) ? (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Send
            </span>

            <span>
              {`${basicTxValues.amount} ${' '} ${
                basicTxValues.token
                  ? basicTxValues.token.symbol
                  : activeNetwork.currency?.toUpperCase()
              }`}
            </span>
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              From
              <span className="text-brand-royalblue text-xs">
                {ellipsis(basicTxValues.sender, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              To
              <span className="text-brand-royalblue text-xs">
                {ellipsis(basicTxValues.receivingAddress, 7, 15)}
              </span>
            </p>

            <div className="flex flex-row items-center justify-between w-full">
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Estimated GasFee
                <span className="text-brand-royalblue text-xs">
                  {isBitcoinBased
                    ? `${basicTxValues.fee * 10 ** 9} GWEI`
                    : `${removeScientificNotation(
                        getCalculatedFee
                      )} ${activeNetwork.currency?.toUpperCase()}`}
                </span>
              </p>
              {!isBitcoinBased ? (
                <span
                  className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
                  onClick={() => setIsOpenEditFeeModal(true)}
                >
                  EDIT
                </span>
              ) : null}
            </div>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Total (Amount + gas fee)
              <span className="text-brand-royalblue text-xs">
                {isBitcoinBased
                  ? `${
                      Number(basicTxValues.fee) + Number(basicTxValues.amount)
                    }`
                  : `${Number(basicTxValues.amount) + getCalculatedFee}`}
                &nbsp;{`${activeNetwork.currency?.toUpperCase()}`}
              </span>
            </p>
          </div>

          <div className="flex items-center justify-around py-8 w-full">
            <Button
              type="button"
              className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-full transition-all duration-300 xl:flex-none"
              id="send-btn"
              onClick={() => {
                if (isExternal) {
                  refresh(false);
                  window.close();
                } else navigate('/home');
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
      ) : (
        <LoadingComponent />
      )}
    </Layout>
  );
};
