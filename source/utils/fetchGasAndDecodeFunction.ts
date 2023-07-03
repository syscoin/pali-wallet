import { INetwork } from '@pollum-io/sysweb3-network';

import { ITransactionParams } from 'types/transactions';

import { getController } from './browser';

export const fetchGasAndDecodeFunction = async (
  dataTx: ITransactionParams,
  activeNetwork: INetwork
) => {
  const {
    wallet: { ethereumTransaction },
  } = getController();
  let gasError = false;
  let gasLimitResult = ethereumTransaction.toBigNumber(21000);

  const { maxFeePerGas, maxPriorityFeePerGas } =
    await ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas(); //todo: adjust to get from new keyringmanager
  const nonce = await ethereumTransaction.getRecommendedNonce(dataTx.from); // This also need possibility for customization //todo: adjust to get from new keyringmanager
  const formTx = {
    data: dataTx.data,
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value ? dataTx.value : 0,
    maxPriorityFeePerGas: dataTx?.maxPriorityFeePerGas
      ? dataTx.maxPriorityFeePerGas
      : maxPriorityFeePerGas,
    maxFeePerGas: dataTx?.maxFeePerGas ? dataTx?.maxFeePerGas : maxFeePerGas,
    nonce: nonce,
    chainId: activeNetwork.chainId,
    gasLimit: ethereumTransaction.toBigNumber(0), //todo: adjust to get from new keyringmanager
  };
  const baseTx = {
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value ? dataTx.value : 0,
    data: dataTx.data,
    nonce: nonce,
  } as any;

  try {
    gasLimitResult = await ethereumTransaction.getTxGasLimit(baseTx); //todo: adjust to get from new keyringmanager
  } catch (error) {
    console.error(error);
    gasError = true;
  }
  formTx.gasLimit =
    (dataTx?.gas && Number(dataTx?.gas) > Number(gasLimitResult)) ||
    (dataTx?.gasLimit && Number(dataTx?.gasLimit) > Number(gasLimitResult))
      ? ethereumTransaction.toBigNumber(dataTx.gas || dataTx.gasLimit) //todo: adjust to get from new keyringmanager
      : gasLimitResult;
  const feeDetails = {
    maxFeePerGas: maxFeePerGas.toNumber() / 10 ** 9,
    baseFee: maxFeePerGas.sub(maxPriorityFeePerGas).toNumber() / 10 ** 9,
    maxPriorityFeePerGas: maxPriorityFeePerGas.toNumber() / 10 ** 9,
    gasLimit: formTx.gasLimit.toNumber(),
  };

  return {
    feeDetails,
    formTx,
    nonce,
    gasError,
  };
};
