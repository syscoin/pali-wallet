import { INetwork } from '@pollum-io/sysweb3-utils';

import { ITransactionParams } from 'types/transactions';

import { getController } from './browser';

export const fetchGasAndDecodeFunction = async (
  dataTx: ITransactionParams,
  activeNetwork: INetwork
) => {
  const {
    wallet: { account },
  } = getController();

  const txs = account.eth.tx;
  const { maxFeePerGas, maxPriorityFeePerGas } =
    await txs.getFeeDataWithDynamicMaxPriorityFeePerGas();
  const nonce = await txs.getRecommendedNonce(dataTx.from); // This also need possibility for customization
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
    gasLimit: txs.toBigNumber(0),
  };
  const getTxGasLimitResult = await txs.getTxGasLimit(formTx);
  formTx.gasLimit =
    (dataTx?.gas && Number(dataTx?.gas) > Number(getTxGasLimitResult)) ||
    (dataTx?.gasLimit && Number(dataTx?.gasLimit) > Number(getTxGasLimitResult))
      ? txs.toBigNumber(dataTx.gas || dataTx.gasLimit)
      : getTxGasLimitResult;
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
  };
};
