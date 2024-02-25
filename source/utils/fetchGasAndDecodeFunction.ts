import { INetwork } from '@pollum-io/sysweb3-network';

import { getController } from 'scripts/Background';
import { ITransactionParams } from 'types/transactions';

export const fetchGasAndDecodeFunction = async (
  dataTx: ITransactionParams,
  activeNetwork: INetwork
) => {
  const {
    wallet: { ethereumTransaction },
  } = getController();
  const currentBlock = await ethereumTransaction.contentScriptWeb3Provider.send(
    'eth_getBlockByNumber',
    ['latest', false]
  );
  const gasLimitFromCurrentBlock = Math.floor(
    Number(currentBlock.gasLimit) * 0.95
  ); //GasLimit from current block with 5% discount, whole limit from block is too much
  let gasLimitResult = ethereumTransaction.toBigNumber(
    gasLimitFromCurrentBlock
  );
  let isInvalidTxData = false;
  let gasLimitError = false;
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

  if (dataTx.gas) {
    gasLimitResult = ethereumTransaction.toBigNumber(0);
  } else {
    // verify tx data
    try {
      // if it run successfully, the contract data is all right.
      const clonedTx = { ...dataTx };
      delete clonedTx.gasLimit;
      delete clonedTx.gas;
      delete clonedTx.maxPriorityFeePerGas;
      delete clonedTx.maxFeePerGas;
      if (!dataTx.to) {
        delete clonedTx.to;
      }
      await ethereumTransaction.contentScriptWeb3Provider.send('eth_call', [
        clonedTx,
        'latest',
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
      gasLimitError = true;
    }
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
    gasLimitError,
  };
};
