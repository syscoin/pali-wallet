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
  const currentBlock = await ethereumTransaction.web3Provider.send(
    'eth_getBlockByNumber',
    ['latest', false]
  );
  const gasLimitFromCurrentBlock = Number(currentBlock.gasLimit);
  let gasLimitResult = ethereumTransaction.toBigNumber(
    gasLimitFromCurrentBlock
  );
  let isInvalidTxData = false;

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

  // verify tx data
  try {
    // if it run successfully, the contract data is all right.
    await ethereumTransaction.web3Provider.send('eth_call', [
      { to: dataTx.to, data: dataTx.data },
      currentBlock.number,
    ]);
  } catch (error) {
    if (!error.message.includes('reverted')) {
      isInvalidTxData = true;
    }
  }

  try {
    // if tx data is valid, Pali is able to estimate gas.
    if (!isInvalidTxData) {
      gasLimitResult = await ethereumTransaction.getTxGasLimit(baseTx);
    }
  } catch (error) {
    console.error(error);
  }
  formTx.gasLimit =
    (dataTx?.gas && Number(dataTx?.gas) > Number(gasLimitResult)) ||
    (dataTx?.gasLimit && Number(dataTx?.gasLimit) > Number(gasLimitResult))
      ? ethereumTransaction.toBigNumber(dataTx.gas || dataTx.gasLimit)
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
    isInvalidTxData,
  };
};
