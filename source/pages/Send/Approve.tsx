import { Form } from 'antd';
import { BigNumber, ethers } from 'ethers';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';
import { getErc20Abi } from '@pollum-io/sysweb3-utils';

import {
  Layout,
  DefaultModal,
  Button,
  Icon,
  IconButton,
} from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
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
import { dispatchBackgroundEvent } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { verifyZerosInBalanceAndFormat, ellipsis, logError } from 'utils/index';

import { EditApprovedAllowanceValueModal } from './EditApprovedAllowanceValueModal';
import { EditPriorityModal } from './EditPriority';

export const ApproveTransactionComponent = () => {
  const { controllerEmitter, web3Provider } = useController();
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
  const [haveError, setHaveError] = useState<boolean>(false);

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

  const dataTx: ITransactionParams = isExternal
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

  const [formControl] = Form.useForm();

  const openEthExplorer = () => {
    window.open(`${activeNetwork.explorer}address/${dataTx.to}`, '_blank');
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

        if (activeAccountMeta.type === KeyringAccountType.Trezor)
          controllerEmitter(['wallet', 'sendAndSaveTransaction'], [response]);

        setConfirmedDefaultModal(true);
        setLoading(false);
        if (isExternal)
          dispatchBackgroundEvent(`${eventName}.${host}`, response);
        return response.hash;
      } catch (error: any) {
        const isNecessaryReconnect = error.message.includes(
          'read properties of undefined'
        );
        const isNecessaryBlindSigning = error.message.includes(
          'Please enable Blind signing'
        );
        if (activeAccount.isLedgerWallet && isNecessaryBlindSigning) {
          alert.removeAll();
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

        alert.removeAll();
        alert.error(t('send.cantCompleteApprove'));

        if (isExternal) setTimeout(window.close, 4000);
        setLoading(false);
        return error;
      }
    }
  };

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
  }, [dataTx]);

  useEffect(() => {
    const abortController = new AbortController();

    const getTokenName = async (contractAddress: string) => {
      // const getProvider = wallet.ethereumTransaction.contentScriptWeb3Provider;

      const contractInstance = new ethers.Contract(
        contractAddress,
        getErc20Abi(),
        web3Provider
      );

      const [tokenSymbolByContract, tokenDecimalsByContract] =
        await Promise.all([
          await contractInstance?.callStatic?.symbol(),
          await contractInstance?.callStatic?.decimals(),
        ]);

      setApprovedTokenInfos({
        tokenSymbol: tokenSymbolByContract,
        tokenDecimals: tokenDecimalsByContract,
      });
    };

    getTokenName(dataTx.to);

    return () => {
      abortController.abort();
    };
  }, [dataTx?.to]);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success(t('home.addressCopied'));
  }, [copied]);

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
        (Number(customFee.maxFeePerGas.toFixed(9)) / 10 ** 9) *
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

  return (
    <Layout title={'send.approve'} canGoBack={canGoBack}>
      <DefaultModal
        show={confirmedDefaultModal}
        title={t('send.approveSuccessful')}
        description={t('send.approveSuccessfulMessage')}
        onClose={() => {
          if (isExternal) window.close();
          else navigate('/home');
        }}
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

      <EditPriorityModal
        showModal={isOpenPriority}
        setIsOpen={setIsOpenPriority}
        customFee={customFee}
        setCustomFee={setCustomFee}
        setHaveError={setHaveError}
        fee={fee}
      />

      <DefaultModal
        show={haveError}
        title={t('send.verifyFields')}
        description={t('send.changeFields')}
        onClose={() => setHaveError(false)}
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
                  {t('buttons.cancel')}
                </Button>

                <Button
                  type="submit"
                  className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-full transition-all duration-300 xl:flex-none"
                  id="receive-btn"
                  loading={loading}
                  onClick={async () => await handleConfirmApprove()}
                >
                  <Icon
                    name="arrow-down"
                    className="w-4"
                    wrapperClassname="mb-2 mr-2"
                  />
                  {t('buttons.confirm')}
                </Button>
              </div>
            </Form>
          </div>
        </>
      ) : null}
    </Layout>
  );
};
