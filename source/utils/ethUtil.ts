import InputDataDecoder from 'ethereum-input-data-decoder';

import { getErc20Abi } from '@pollum-io/sysweb3-utils';

import { ITransactionParams } from 'types/transactions';

import { pegasysABI } from './pegasys';
import { validateTransactionDataValue } from './validateTransactionDataValue';
import { wrapABI } from './wrapABI';
export const erc20DataDecoder = () => new InputDataDecoder(getErc20Abi());

export const decodeTransactionData = (
  params: ITransactionParams,
  validateTxToAddress: IValidateEOAAddressResponse
) => {
  const contractCreationInitialBytes = '0x60806040';
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  try {
    const { data } = params;
    const dataValidation = Boolean(data && String(data).length > 0);

    // Validate the Data as same as in the SendTransaction Component. If we let the data come as normal string will break all the decode Validation,
    // so we need to transform it on Bytes32.
    const validatedData = dataValidation
      ? validateTransactionDataValue(data)
      : null; //Data might as well be null or undefined in which case the validateTransactionDataValue will fail

    //Try to decode if address is contract and have Data
    if (validateTxToAddress.contract && dataValidation) {
      let decoderValue = erc20DataDecoder().decodeData(validatedData); //First checking if method is defined on erc20ABI
      if (decoderValue.method !== null) return decoderValue;
      const decoderWrapInstance = new InputDataDecoder(JSON.stringify(wrapABI));
      decoderValue = decoderWrapInstance.decodeData(validatedData);
      if (decoderValue.method !== null) return decoderValue;
      const decoderInstance = new InputDataDecoder(JSON.stringify(pegasysABI));
      decoderValue = decoderInstance.decodeData(validatedData);
      if (decoderValue.method === null) {
        decoderValue.method = 'Contract Interaction';
      }
      return decoderValue;
    }

    //Return Contract Interaction if address is contract but don't have Data
    if (validateTxToAddress.contract && !dataValidation) {
      const emptyDecoderObject = {
        method: 'Contract Interaction',
        types: [],
        inputs: [],
        names: [],
      };
      return emptyDecoderObject;
    }

    // Return Send Method if address is a wallet
    if (validateTxToAddress.wallet) {
      const emptyDecoderObject = {
        method: 'Send',
        types: [],
        inputs: [],
        names: [],
      };
      return emptyDecoderObject;
    }

    if (dataValidation) {
      const initialBytes = data.slice(0, 10); //Get the first four bytes of data + 0x
      if (initialBytes === contractCreationInitialBytes) {
        const emptyDecoderObject = {
          method: 'Contract Deployment',
          types: [],
          inputs: [],
          names: [],
        };
        return emptyDecoderObject;
      }
    }

    if (!params?.to || params?.to === zeroAddress) {
      const emptyDecoderObject = {
        method: 'Burn',
        types: [],
        inputs: [],
        names: [],
      };
      return emptyDecoderObject;
    }

    return;
  } catch (error) {
    return;
  }
};

interface IValidateEOAAddressResponse {
  contract: boolean | undefined;
  wallet: boolean | undefined;
}
