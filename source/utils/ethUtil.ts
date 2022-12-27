import InputDataDecoder from 'ethereum-input-data-decoder';

import { getErc20Abi } from '@pollum-io/sysweb3-utils';

import { ITransactionParams } from 'types/transactions';

import { pegasysABI } from './pegasys';
import { wrapABI } from './wrapABI';
export const erc20DataDecoder = () => new InputDataDecoder(getErc20Abi());

export const decodeTransactionData = (params: ITransactionParams) => {
  try {
    const { data, value } = params;
    if (data) {
      let decoderValue = erc20DataDecoder().decodeData(params.data); //First checking if method is defined on erc20ABI
      if (decoderValue.method !== null) return decoderValue;
      const decoderWrapInstance = new InputDataDecoder(JSON.stringify(wrapABI));
      decoderValue = decoderWrapInstance.decodeData(params.data);
      if (decoderValue.method !== null) return decoderValue;
      const decoderInstance = new InputDataDecoder(JSON.stringify(pegasysABI));
      decoderValue = decoderInstance.decodeData(params.data);
      if (decoderValue.method === null && (!value || value === 0)) {
        //TODO: This if needs to be changed we should check if its contract interaction by the address being of a contract or not
        decoderValue.method = 'Contract Interaction';
      }

      return decoderValue;
    }

    if (!data && value) {
      return {
        method: 'Contract Interaction',
        types: [],
        inputs: [],
        names: [],
      };
    }

    return;
  } catch (error) {
    console.log('error decode', error);

    return;
  }
};
