import { ethers } from 'ethers';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import {
  Layout,
  DefaultModal,
  Button,
  Icon,
  LoadingComponent,
  Tooltip,
  IconButton,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ICustomFeeParams, IFeeState, ITxState } from 'types/transactions';
import { getController } from 'utils/browser';
import {
  truncate,
  logError,
  ellipsis,
  removeScientificNotation,
  omitTransactionObjectData,
  INITIAL_FEE,
  NETWORKS_INCOMPATIBLE_WITH_EIP1559,
} from 'utils/index';

import { EditPriorityModal } from './EditPriorityModal';

export const SendConfirm = () => {
  const { wallet, callGetLatestUpdateForAccount } = getController();

  const { alert, navigate, useCopyClipboard } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
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
  const [copied, copy] = useCopyClipboard();

  const basicTxValues = state.tx;

  const validateCustomGasLimit = Boolean(
    customFee.isCustom && customFee.gasLimit > 0
  );

  const getFormattedFee = (currentFee: number | string) =>
    `${removeScientificNotation(currentFee)} ${
      activeNetwork.currency
        ? activeNetwork.currency?.toUpperCase()
        : activeNetwork.label
    }`;

  const getGasCorrectlyGasPrice = async () => {
    const correctGasPrice = Boolean(
      customFee.isCustom && customFee.gasPrice > 0
    )
      ? customFee.gasPrice * 10 ** 9 // Calculate custom value to send to transaction because it comes without decimals, only 8 -> 10 -> 12
      : await wallet.ethereumTransaction.getRecommendedGasPrice();
    const gasLimit: any = await wallet.ethereumTransaction.getTxGasLimit(
      basicTxValues
    );

    setFee({ ...INITIAL_FEE, gasLimit });

    setGasPrice(Number(correctGasPrice));
    return Number(correctGasPrice);
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
            wallet.syscoinTransaction
              .sendTransaction(basicTxValues, activeAccount.isTrezorWallet)
              .then((response) => {
                setConfirmedTx(response);
                setConfirmed(true);
                setLoading(false);

                //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                setTimeout(() => {
                  callGetLatestUpdateForAccount();
                }, 3500);
              })
              .catch((error) => {
                alert.error("Can't complete transaction. Try again later.");
                setLoading(false);
                throw error;
              });

            return;
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

            setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS FOR NATIVE TOKENS
        case isBitcoinBased === false && basicTxValues.token === null:
          try {
            const restTx = omitTransactionObjectData(txObjectState, [
              'chainId',
              'maxFeePerGas',
              'maxPriorityFeePerGas',
              ,
            ]) as ITxState;

            const value = ethers.utils.parseUnits(
              String(basicTxValues.amount),
              'ether'
            );

            if (
              NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(activeNetwork.chainId)
            ) {
              try {
                await wallet.ethereumTransaction
                  .sendFormattedTransaction({
                    ...restTx,
                    gasPrice: ethers.utils.hexlify(gasPrice),
                    gasLimit: wallet.ethereumTransaction.toBigNumber(
                      validateCustomGasLimit ? customFee.gasLimit : fee.gasLimit
                    ),
                  })
                  .then((response) => {
                    if (activeAccountMeta.type === KeyringAccountType.Trezor)
                      wallet.sendAndSaveTransaction(response);
                    setConfirmedTx(response);
                    setConfirmed(true);
                    setLoading(false);
                  })
                  .catch((error) => {
                    alert.error("Can't complete transaction. Try again later.");
                    setLoading(false);
                    throw error;
                  });

                return;
              } catch (legacyError: any) {
                logError('error', 'Transaction', legacyError);
                console.log({ legacyError });
                alert.removeAll();
                alert.error("Can't complete transaction. Try again later.");

                setLoading(false);
                return legacyError;
              }
            }

            wallet.ethereumTransaction
              .sendFormattedTransaction({
                ...restTx,
                value,
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
                gasLimit: wallet.ethereumTransaction.toBigNumber(
                  validateCustomGasLimit
                    ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                    : fee.gasLimit
                ),
              })
              .then((response) => {
                if (activeAccountMeta.type === KeyringAccountType.Trezor)
                  wallet.sendAndSaveTransaction(response);
                setConfirmedTx(response);
                setConfirmed(true);
                setLoading(false);

                //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                setTimeout(() => {
                  callGetLatestUpdateForAccount();
                }, 3500);
              })
              .catch((error: any) => {
                alert.error("Can't complete transaction. Try again later.");
                setLoading(false);
                throw error;
              });

            return;
          } catch (error: any) {
            logError('error ETH', 'Transaction', error);

            alert.removeAll();
            alert.error("Can't complete transaction. Try again later.");

            setLoading(false);
          }
          break;

        // ETHEREUM TRANSACTIONS FOR ERC20 & ERC721 TOKENS
        case isBitcoinBased === false && basicTxValues.token !== null:
          //SWITCH CASE TO HANDLE DIFFERENT TOKENS TRANSACTION
          switch (basicTxValues.token.isNft) {
            //HANDLE ERC20 TRANSACTION
            case false:
              try {
                wallet.ethereumTransaction
                  .sendSignedErc20Transaction({
                    networkUrl: activeNetwork.url,
                    receiver: txObjectState.to,
                    tokenAddress: basicTxValues.token.contractAddress,
                    tokenAmount: basicTxValues.amount,
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
                    gasLimit: wallet.ethereumTransaction.toBigNumber(
                      validateCustomGasLimit
                        ? customFee.gasLimit * 10 ** 9 // Multiply gasLimit to reach correctly decimal value
                        : fee.gasLimit * 4
                    ),
                  })
                  .then(async (response) => {
                    if (activeAccountMeta.type === KeyringAccountType.Trezor)
                      wallet.sendAndSaveTransaction(response);
                    setConfirmed(true);
                    setLoading(false);
                    setConfirmedTx(response);

                    //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                    setTimeout(() => {
                      callGetLatestUpdateForAccount();
                    }, 3500);
                  })
                  .catch((error) => {
                    logError('error send ERC20', 'Transaction', error);

                    alert.removeAll();
                    alert.error("Can't complete transaction. Try again later.");
                    setLoading(false);
                  });

                return;
              } catch (_erc20Error) {
                logError('error send ERC20', 'Transaction', _erc20Error);

                alert.removeAll();
                alert.error("Can't complete transaction. Try again later.");

                setLoading(false);
              }
              break;

            //HANDLE ERC721 NFTS TRANSACTIONS
            case true:
              try {
                wallet.ethereumTransaction
                  .sendSignedErc721Transaction({
                    networkUrl: activeNetwork.url,
                    receiver: txObjectState.to,
                    tokenAddress: basicTxValues.token.contractAddress,
                    tokenId: Number(basicTxValues.amount), // Amount is the same field of TokenID at the SendEth Component
                  })
                  .then(async (response) => {
                    setConfirmed(true);
                    setLoading(false);
                    setConfirmedTx(response);

                    //CALL UPDATE TO USER CAN SEE UPDATED BALANCES / TXS AFTER SEND SOME TX
                    setTimeout(() => {
                      callGetLatestUpdateForAccount();
                    }, 3500);
                  })
                  .catch((error) => {
                    logError('error send ERC721', 'Transaction', error);

                    alert.removeAll();
                    alert.error("Can't complete transaction. Try again later.");
                    setLoading(false);
                  });

                return;
              } catch (_erc721Error) {
                logError('error send ERC721', 'Transaction', _erc721Error);

                alert.removeAll();
                alert.error("Can't complete transaction. Try again later.");

                setLoading(false);
              }

              break;
          }

          break;
      }
    }
  };

  useEffect(() => {
    if (isBitcoinBased) return;
    if (NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(activeNetwork.chainId)) {
      getGasCorrectlyGasPrice();

      return;
    }
    const abortController = new AbortController();

    const getFeeRecomendation = async () => {
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } =
          await wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas();

        const initialFeeDetails = {
          maxFeePerGas: Number(maxFeePerGas) / 10 ** 9,
          baseFee:
            (Number(maxFeePerGas) - Number(maxPriorityFeePerGas)) / 10 ** 9,
          maxPriorityFeePerGas: Number(maxPriorityFeePerGas) / 10 ** 9,
          gasLimit: wallet.ethereumTransaction.toBigNumber(0),
        };

        const formattedTxObject = {
          from: basicTxValues.sender,
          to: basicTxValues.receivingAddress,
          chainId: activeNetwork.chainId,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };

        setTxObjectState(formattedTxObject);

        const getGasLimit = await wallet.ethereumTransaction.getTxGasLimit(
          formattedTxObject
        );

        const finalFeeDetails = {
          ...initialFeeDetails,
          gasLimit: getGasLimit,
        };

        setFee(finalFeeDetails as any);
      } catch (error) {
        logError('error getting fees', 'Transaction', error);
        alert.error(
          'Error in the proccess to get fee values, please verify your balance and try again later.'
        );
        navigate(-1);
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

  useEffect(() => {
    if (!copied) return;
    alert.removeAll();
    alert.success('Address successfully copied');
  }, [copied]);

  return (
    <Layout title="CONFIRM" canGoBack={true}>
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          wallet.sendAndSaveTransaction(confirmedTx);
          navigate('/home');
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
      {Boolean(
        !isBitcoinBased &&
          basicTxValues &&
          fee &&
          !NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(activeNetwork.chainId)
      ) ||
      Boolean(
        !isBitcoinBased &&
          basicTxValues &&
          NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(activeNetwork.chainId)
      ) ||
      Boolean(isBitcoinBased && basicTxValues) ? (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              {`${basicTxValues.token?.isNft ? 'TokenID' : 'Send'}`}
            </span>

            <span>
              {!basicTxValues.token?.isNft ? (
                <>
                  {`${basicTxValues.amount} ${' '} ${
                    basicTxValues.token
                      ? basicTxValues.token.symbol
                      : activeNetwork.currency?.toUpperCase()
                  }`}
                </>
              ) : (
                <>{basicTxValues.amount}</>
              )}
            </span>
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              From
              <span className="text-brand-royalblue text-xs">
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
                  {isBitcoinBased
                    ? getFormattedFee(basicTxValues.fee)
                    : !isBitcoinBased &&
                      NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(
                        activeNetwork.chainId
                      )
                    ? getFormattedFee(gasPrice / 10 ** 18)
                    : getFormattedFee(getCalculatedFee)}
                </span>
              </p>
              {!isBitcoinBased && !basicTxValues.token?.isNft
                ? !isBitcoinBased &&
                  !NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(
                    activeNetwork.chainId
                  ) && (
                    <span
                      className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
                      onClick={() => setIsOpenEditFeeModal(true)}
                    >
                      EDIT
                    </span>
                  )
                : null}
            </div>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              {!basicTxValues.token?.isNft ? (
                <>
                  Total (Amount + gas fee)
                  <span className="text-brand-royalblue text-xs">
                    {isBitcoinBased
                      ? `${
                          Number(basicTxValues.fee) +
                          Number(basicTxValues.amount)
                        }`
                      : !isBitcoinBased &&
                        NETWORKS_INCOMPATIBLE_WITH_EIP1559.includes(
                          activeNetwork.chainId
                        )
                      ? `${removeScientificNotation(
                          Number(basicTxValues.amount) + gasPrice / 10 ** 18
                        )}`
                      : `${Number(basicTxValues.amount) + getCalculatedFee}`}
                    &nbsp;
                    {`${
                      activeNetwork.currency
                        ? activeNetwork.currency.toUpperCase()
                        : activeNetwork.label
                    }`}
                  </span>
                </>
              ) : (
                <>
                  Token ID
                  <span className="text-brand-royalblue text-xs">
                    {basicTxValues.amount}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center justify-around py-8 w-full">
            <Button
              type="button"
              className="xl:p-18 flex items-center justify-center h-8 text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-full transition-all duration-300 xl:flex-none"
              id="send-btn"
              onClick={() => {
                navigate('/home');
              }}
            >
              <Icon
                name="arrow-up"
                className="w-5"
                wrapperClassname="mr-2 flex items-center"
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
      ) : (
        <LoadingComponent />
      )}
    </Layout>
  );
};
