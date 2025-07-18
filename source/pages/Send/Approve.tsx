import { Form } from 'antd';
import { BigNumber, ethers } from 'ethers';
import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { getErc20Abi } from '@pollum-io/sysweb3-utils';

import {
  DefaultModal,
  Icon,
  IconButton,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { useQueryData } from 'hooks/useQuery';
import { RootState } from 'state/store';
import {
  IApprovedTokenInfos,
  ICustomApprovedAllowanceAmount,
  IDecodedTx,
  IFeeState,
  ITransactionParams,
  ITxState,
} from 'types/transactions';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { logError } from 'utils/index';
import { verifyZerosInBalanceAndFormat, ellipsis } from 'utils/index';
import { clearNavigationState } from 'utils/navigationState';

import { EditApprovedAllowanceValueModal } from './EditApprovedAllowanceValueModal';
import { EditPriorityModal } from './EditPriority';

export const ApproveTransactionComponent = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { getFiatAmount } = usePrice();

  const url = chrome.runtime.getURL('app.html');
  const { navigate, alert, useCopyClipboard } = useUtils();

  const [copied, copy] = useCopyClipboard();
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>({
    baseFee: 0,
    gasLimit: 0,
    maxFeePerGas: 0,
    maxPriorityFeePerGas: 0,
  });
  const [customNonce, setCustomNonce] = useState<number>();
  const [approvedTokenInfos, setApprovedTokenInfos] =
    useState<IApprovedTokenInfos>();
  const [fiatPriceValue, setFiatPriceValue] = useState<string>('');

  const [confirmedDefaultModal, setConfirmedDefaultModal] =
    useState<boolean>(false);
  const [openEditFeeModal, setOpenEditFeeModal] = useState<boolean>(false);
  const [isOpenPriority, setIsOpenPriority] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [detailsOpened, setDetailsOpened] = useState<boolean>(false);

  const [customApprovedAllowanceAmount, setCustomApprovedAllowanceAmount] =
    useState<ICustomApprovedAllowanceAmount>({
      isCustom: false,
      defaultAllowanceValue: 0,
      customAllowanceValue: null,
    });

  const [customFee, setCustomFee] = useState({
    isCustom: false,
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
  });

  // Helper function to safely convert fee values to numbers and format them
  const safeToFixed = (value: any, decimals = 9): string => {
    const numValue = Number(value);
    return isNaN(numValue) ? '0' : numValue.toFixed(decimals);
  };

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  const { asset: fiatAsset, price: fiatPrice } = useSelector(
    (state: RootState) => state.price.fiat
  );

  const { state }: { state: any } = useLocation();

  const { host, eventName, ...externalTx } = useQueryData();

  const isExternal = Boolean(externalTx.external);

  // Memoize dataTx to prevent unnecessary re-renders
  const dataTx: ITransactionParams = useMemo(
    () => (isExternal ? externalTx.tx : state.external ? state.tx : state.tx),
    [isExternal, externalTx.tx, state?.external, state?.tx]
  );

  const decodedTx: IDecodedTx = useMemo(
    () =>
      isExternal
        ? externalTx.decodedTx
        : state.external
        ? state.decodedTx
        : state.decodedTx,
    [isExternal, externalTx.decodedTx, state?.external, state?.decodedTx]
  );

  const [formControl] = Form.useForm();

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const openEthExplorer = () => {
    window.open(`${adjustedExplorer}address/${dataTx.to}`, '_blank');
  };

  const setFiatPrice = () => {
    const amount = getFiatAmount(
      calculatedFeeValue || 0,
      4,
      String(fiatAsset).toUpperCase(),
      false
    );

    setFiatPriceValue(amount);
  };

  const validatedEncodedData = () => {
    const erc20AbiInstance = new ethers.utils.Interface(getErc20Abi());
    const encodedDataWithCustomValue =
      customApprovedAllowanceAmount.isCustom === true
        ? erc20AbiInstance.encodeFunctionData('approve', [
            decodedTx?.inputs[0],
            ethers.utils.parseUnits(
              String(customApprovedAllowanceAmount.customAllowanceValue),
              approvedTokenInfos.tokenDecimals
            ),
          ])
        : tx.data;
    return encodedDataWithCustomValue;
  };

  const handleConfirmApprove = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount.isTrezorWallet) {
      await controllerEmitter(['wallet', 'trezorSigner', 'init'], [], false);
    }

    if (activeAccount && balance > 0) {
      setLoading(true);

      const newDataEncoded = validatedEncodedData();
      const newTxValue = {
        ...tx,
        data: newDataEncoded,
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
          Boolean(customFee.isCustom && customFee.gasLimit > 0)
            ? customFee.gasLimit
            : fee.gasLimit
        ),
      };

      try {
        const response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
          [newTxValue]
        )) as { hash: string };

        await controllerEmitter(
          ['wallet', 'sendAndSaveTransaction'],
          [response]
        );
        if (isExternal) {
          dispatchBackgroundEvent(`${eventName}.${host}`, response);
        }
        setConfirmedDefaultModal(true);
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
          alert.error(t('settings.ledgerBlindSigning'));
          setLoading(false);
          return;
        }
        if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
          setIsReconectModalOpen(true);
          setLoading(false);
          return;
        }
        logError('error', 'Transaction', error);

        alert.error(t('send.cantCompleteApprove'));

        if (isExternal)
          createTemporaryAlarm({
            delayInSeconds: 4,
            callback: () => {
              clearNavigationState();
              window.close();
            },
          });
        setLoading(false);
        return error;
      }
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const getGasAndFunction = async () => {
      try {
        const { feeDetails, formTx, nonce } = await fetchGasAndDecodeFunction(
          dataTx,
          activeNetwork
        );

        if (isMounted) {
          setFee(feeDetails);
          setTx(formTx);
          setCustomNonce(nonce);
        }
      } catch (error) {
        if (isMounted) {
          console.error('Error fetching gas data:', error);
        }
      }
    };

    getGasAndFunction();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [dataTx, activeNetwork.chainId]); // Only depend on chainId, not the whole network object

  // Clear navigation state when component unmounts or navigates away
  useEffect(
    () => () => {
      clearNavigationState();
    },
    []
  );

  useEffect(() => {
    const abortController = new AbortController();

    const getTokenName = async (contractAddress: string) => {
      try {
        const tokenInfo = (await controllerEmitter(
          ['wallet', 'getERC20TokenInfo'],
          [contractAddress, activeAccount.address]
        )) as {
          balance: string;
          decimals: number;
          name: string;
          symbol: string;
        };

        setApprovedTokenInfos({
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: tokenInfo.decimals,
        });
      } catch (error) {
        console.error('Failed to get token info:', error);
      }
    };

    getTokenName(dataTx.to);

    return () => {
      abortController.abort();
    };
  }, [dataTx?.to]);

  useEffect(() => {
    if (!copied) return;

    alert.success(t('home.addressCopied'));
  }, [copied, alert, t]);

  useMemo(() => {
    if (!decodedTx || !approvedTokenInfos?.tokenDecimals) return;
    const decodeHexInputValue = parseInt(decodedTx?.inputs[1]?.hex, 16);

    const calculatedAllowanceValue = approvedTokenInfos?.tokenDecimals
      ? decodeHexInputValue / 10 ** approvedTokenInfos.tokenDecimals
      : decodeHexInputValue;

    setCustomApprovedAllowanceAmount({
      isCustom: false,
      defaultAllowanceValue: calculatedAllowanceValue,
      customAllowanceValue: null,
    });
  }, [decodedTx, approvedTokenInfos?.tokenDecimals]);

  const calculatedFeeValue = useMemo(() => {
    if (!fee?.maxFeePerGas || !fee?.gasLimit) return 0;

    if (customFee.isCustom) {
      return (
        (Number(safeToFixed(customFee.maxFeePerGas)) / 10 ** 9) *
        (customFee.gasLimit > 0 ? customFee.gasLimit : fee.gasLimit)
      );
    }

    return (fee.maxFeePerGas / 10 ** 9) * fee.gasLimit;
  }, [
    fee?.gasLimit,
    fee?.maxFeePerGas,
    customFee?.maxFeePerGas,
    customFee?.gasLimit,
    customFee?.isCustom,
  ]);

  useEffect(() => {
    if (!calculatedFeeValue) return;
    setFiatPrice();
  }, [fiatPrice, calculatedFeeValue]);

  // Navigate when transaction is confirmed
  useEffect(() => {
    if (confirmedDefaultModal) {
      // Clear navigation state when actually navigating or closing
      clearNavigationState();

      alert.success(t('send.approveSuccessful'));

      if (isExternal) {
        window.close();
      } else {
        navigate('/home');
      }
    }
  }, [confirmedDefaultModal, alert, t, navigate, isExternal]);

  return (
    <>
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

      <EditPriorityModal
        showModal={isOpenPriority}
        setIsOpen={setIsOpenPriority}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={() => {
          // No-op function since haveError is not used
        }}
        fee={fee}
        defaultGasLimit={60000} // ERC20 approvals typically need ~50-60k gas
      />

      <EditApprovedAllowanceValueModal
        showModal={openEditFeeModal}
        host={host}
        approvedTokenInfos={approvedTokenInfos}
        customApprovedAllowanceAmount={customApprovedAllowanceAmount}
        setCustomApprovedAllowanceAmount={setCustomApprovedAllowanceAmount}
        setOpenEditFeeModal={setOpenEditFeeModal}
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
                  {t('send.grantAccess')}{' '}
                  <span className="text-brand-royalblue font-semibold">
                    {approvedTokenInfos?.tokenSymbol}
                  </span>
                </span>
                <span className="text-brand-graylight text-sm">
                  {t('send.byGrantingPermission')}
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
                      wrapperClassname="flex items-center justify-center"
                    />
                  </IconButton>

                  <IconButton onClick={openEthExplorer}>
                    <Icon
                      name="select"
                      className="text-brand-white hover:text-fields-input-borderfocus"
                      wrapperClassname="flex items-center justify-center"
                    />
                  </IconButton>
                </div>
                <div>
                  <button
                    type="button"
                    className="text-blue-300 text-sm"
                    onClick={() => setOpenEditFeeModal(true)}
                  >
                    {t('send.editPermission')}
                  </button>
                </div>
              </div>
            </div>

            <Form form={formControl}>
              <div className="items-center justify-center py-4 w-full">
                <div className="grid gap-y-3 grid-cols-1 auto-cols-auto">
                  <div className="grid grid-cols-2 items-center">
                    <div className="flex items-center">
                      <Icon
                        name="tag"
                        className="flex items-center justify-center w-4"
                        wrapperClassname="flex items-center justify-center mr-2"
                      />
                      <h1 className="text-base font-bold">
                        {t('send.transactionFee')}
                      </h1>
                    </div>

                    <button
                      type="button"
                      className="justify-self-end text-blue-300 text-xs"
                      onClick={() => setIsOpenPriority(true)}
                    >
                      {t('buttons.edit')}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 items-center">
                    <span className="text-brand-graylight text-xs font-thin">
                      {t('send.thereIsAFee')}
                    </span>

                    <p className="flex flex-col items-end text-brand-white text-lg font-bold">
                      $ {parseFloat(fiatPriceValue).toFixed(2)}
                      <span className="text-gray-500 text-base font-medium">
                        {verifyZerosInBalanceAndFormat(calculatedFeeValue, 2)}
                        &nbsp;
                        <strong>{activeNetwork.currency.toUpperCase()}</strong>
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
                    {detailsOpened ? t('buttons.hide') : t('buttons.show')}{' '}
                    {t('send.fullTxDetails')}
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
                        wrapperClassname="flex items-center justify-center mr-2"
                      />
                      <h2 className="text-base font-bold">
                        {t('send.permissionRequest')}
                      </h2>
                    </div>

                    <button
                      type="button"
                      className="self-start justify-self-end text-blue-300 text-xs"
                      onClick={() => setOpenEditFeeModal(true)}
                    >
                      {t('buttons.edit')}
                    </button>
                  </div>

                  <p className="text-brand-graylight text-xs font-thin">
                    {host} {t('send.canAccess')}
                  </p>

                  <div className="grid grid-cols-2 items-center text-sm">
                    <p className="font-bold">{t('send.approvedAmount')}:</p>
                    <span>
                      {!customApprovedAllowanceAmount?.isCustom
                        ? customApprovedAllowanceAmount?.defaultAllowanceValue
                        : customApprovedAllowanceAmount?.customAllowanceValue}
                      <span className="ml-1 text-brand-royalblue font-semibold">
                        {approvedTokenInfos?.tokenSymbol}
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 items-center text-sm">
                    <p className="font-bold">{t('send.grantedTo')}:</p>
                    <div className="flex items-center justify-start">
                      <span>{ellipsis(dataTx.to)}</span>
                      <IconButton onClick={() => copy(dataTx?.to)}>
                        <Icon
                          name="copy"
                          className="text-brand-white hover:text-fields-input-borderfocus"
                          wrapperClassname="flex items-center justify-center ml-2.5"
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
                        wrapperClassname="flex items-center justify-center mr-2"
                      />
                      <h3 className="text-base font-bold">{t('send.data')}</h3>
                    </div>
                  </div>

                  <p className="text-brand-graylight text-xs font-thin">
                    {t('send.method')}: {decodedTx?.method}
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
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    // Clear navigation state when exiting send flow
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
                  type="submit"
                  loading={loading}
                  onClick={async () => await handleConfirmApprove()}
                >
                  {t('buttons.confirm')}
                </PrimaryButton>
              </div>
            </Form>
          </div>
        </>
      ) : null}
    </>
  );
};
