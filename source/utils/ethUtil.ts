import { defaultAbiCoder } from '@ethersproject/abi';
import InputDataDecoder from 'ethereum-input-data-decoder';

import { ITransactionParams } from 'types/transactions';
import { retryableFetch } from 'utils/retryableFetch';
import { getErc20Abi, getContractType } from 'utils/validations';

import { pegasysABI } from './pegasys';
import { validateTransactionDataValue } from './validateTransactionDataValue';
import { wrapABI } from './wrapABI';

// Shared approval method signatures for consistent detection across the app
export const APPROVAL_METHOD_SIGNATURES = {
  approve: '0x095ea7b3', // approve(address,uint256)
  increaseAllowance: '0x39509351', // increaseAllowance(address,uint256)
  decreaseAllowance: '0xa457c2d7', // decreaseAllowance(address,uint256)
  setApprovalForAll: '0xa22cb465', // setApprovalForAll(address,bool)
} as const;

// Create a cached instance of the decoder
let erc20DecoderInstance: InputDataDecoder | null = null;

export const erc20DataDecoder = async (controller?: any) => {
  if (!erc20DecoderInstance) {
    const abi = await getErc20Abi(controller);
    erc20DecoderInstance = new InputDataDecoder(abi);
  }
  return erc20DecoderInstance;
};
// Export approval detection for use in blacklist middleware and UI components
export const detectApprovalType = async (
  data: string,
  contractAddress: string,
  web3Provider: any,
  controller?: any
): Promise<{
  approvalType?: 'erc20-amount' | 'erc721-single' | 'nft-all';
  decodedData?: any;
  isApproval: boolean;
  method?: string;
  tokenStandard?: string;
}> => {
  try {
    // Get contract type using frontend detection
    const contractType = await getContractType(
      contractAddress,
      web3Provider,
      controller
    );

    if (
      data.startsWith(APPROVAL_METHOD_SIGNATURES.approve) ||
      data.startsWith(APPROVAL_METHOD_SIGNATURES.increaseAllowance) ||
      data.startsWith(APPROVAL_METHOD_SIGNATURES.decreaseAllowance)
    ) {
      // Determine method name
      let methodName = 'approve';
      if (data.startsWith(APPROVAL_METHOD_SIGNATURES.increaseAllowance)) {
        methodName = 'increaseAllowance';
      } else if (
        data.startsWith(APPROVAL_METHOD_SIGNATURES.decreaseAllowance)
      ) {
        methodName = 'decreaseAllowance';
      }

      // If we have approve/increaseAllowance/decreaseAllowance(address, uint256), it's obviously a token contract
      // Default to ERC-20 if contract type detection fails or returns unknown
      if (contractType?.type === 'ERC-721' && methodName === 'approve') {
        // Only special case: if we positively detect ERC-721 AND it's the basic approve method, treat as NFT approval
        // Note: increaseAllowance/decreaseAllowance don't exist for ERC-721, so they're always ERC-20
        const [to, tokenId] = defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + data.slice(10)
        );
        return {
          isApproval: true,
          approvalType: 'erc721-single',
          tokenStandard: 'ERC-721',
          decodedData: { to, tokenId },
          method: methodName,
        };
      } else {
        // Default to ERC-20 for approve/increaseAllowance/decreaseAllowance(address, uint256) - most common case
        // This includes: ERC-20, ERC-777, unknown tokens, failed detection, etc.
        const [spender, amount] = defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + data.slice(10)
        );
        return {
          isApproval: true,
          approvalType: 'erc20-amount',
          tokenStandard: contractType?.type || 'ERC-20', // Default to ERC-20 if unknown
          decodedData: { spender, amount },
          method: methodName,
        };
      }
    } else if (data.startsWith(APPROVAL_METHOD_SIGNATURES.setApprovalForAll)) {
      // Works for both ERC-721 and ERC-1155
      const [operator, approved] = defaultAbiCoder.decode(
        ['address', 'bool'],
        '0x' + data.slice(10)
      );
      return {
        isApproval: true,
        approvalType: 'nft-all',
        tokenStandard: contractType?.type || 'Unknown',
        decodedData: { operator, approved },
        method: 'setApprovalForAll',
      };
    }
  } catch (error) {
    console.error('Error detecting approval type:', error);
  }

  return { isApproval: false };
};

// Fetch function signature from 4byte.directory
export const fetchFunctionSignature = async (
  methodId: string
): Promise<string | null> => {
  try {
    const response = await retryableFetch(
      `https://www.4byte.directory/api/v1/signatures/?hex_signature=${methodId}`
    );
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].text_signature;
    }
  } catch (error) {
    console.error('Failed to fetch function signature:', error);
  }
  return null;
};

export const decodeTransactionData = async (
  params: ITransactionParams,
  web3Provider?: any,
  controller?: any
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
    if (dataValidation && web3Provider) {
      // First check if it's an approval transaction
      const approvalInfo = await detectApprovalType(
        validatedData,
        params.to,
        web3Provider,
        controller
      );
      if (approvalInfo.isApproval) {
        return {
          method: approvalInfo.method,
          types:
            approvalInfo.approvalType === 'erc20-amount' ||
            approvalInfo.approvalType === 'erc721-single'
              ? ['address', 'uint256']
              : ['address', 'bool'],
          inputs:
            approvalInfo.approvalType === 'erc20-amount'
              ? [
                  approvalInfo.decodedData.spender,
                  approvalInfo.decodedData.amount,
                ]
              : approvalInfo.approvalType === 'erc721-single'
              ? [approvalInfo.decodedData.to, approvalInfo.decodedData.tokenId]
              : [
                  approvalInfo.decodedData.operator,
                  approvalInfo.decodedData.approved,
                ],
          names:
            approvalInfo.approvalType === 'erc20-amount'
              ? ['spender', 'amount']
              : approvalInfo.approvalType === 'erc721-single'
              ? ['to', 'tokenId']
              : ['operator', 'approved'],
          approvalType: approvalInfo.approvalType,
          tokenStandard: approvalInfo.tokenStandard,
        };
      }

      // Continue with existing decoding logic
      const decoder = await erc20DataDecoder(controller);
      let decoderValue = decoder.decodeData(validatedData); //First checking if method is defined on erc20ABI
      if (decoderValue.method !== null) return decoderValue;
      const decoderWrapInstance = new InputDataDecoder(JSON.stringify(wrapABI));
      decoderValue = decoderWrapInstance.decodeData(validatedData);
      if (decoderValue.method !== null) return decoderValue;
      const decoderInstance = new InputDataDecoder(JSON.stringify(pegasysABI));
      decoderValue = decoderInstance.decodeData(validatedData);
      if (decoderValue.method === null) {
        // Try to fetch function signature from 4byte.directory
        const methodId = data.slice(0, 10); // Get first 4 bytes (0x + 8 chars)
        const signature = await fetchFunctionSignature(methodId);
        if (signature) {
          decoderValue.method = signature;
        } else {
          decoderValue.method = 'Contract Interaction';
        }
      }
      return decoderValue;
    }

    //Return Contract Interaction if address is contract but don't have Data
    if (!dataValidation) {
      const emptyDecoderObject = {
        method: 'Contract Interaction',
        types: [],
        inputs: [],
        names: [],
      };
      return emptyDecoderObject;
    }

    // Return Send Method if address is a wallet
    if (params?.to && params?.to !== zeroAddress) {
      const emptyDecoderObject = {
        method: 'Send',
        types: [],
        inputs: [],
        names: [],
      };
      return emptyDecoderObject;
    }

    // Handle contract deployment: no 'to' address + contract bytecode
    if (!params?.to) {
      if (
        dataValidation &&
        data.slice(0, 10) === contractCreationInitialBytes
      ) {
        return {
          method: 'Contract Deployment',
          types: [],
          inputs: [],
          names: [],
        };
      } else {
        // No 'to' address but not contract deployment - probably malformed
        return {
          method: 'Transaction',
          types: [],
          inputs: [],
          names: [],
        };
      }
    }

    // Handle explicit zero address (burning)
    if (params?.to === zeroAddress) {
      return {
        method: 'Burn',
        types: [],
        inputs: [],
        names: [],
      };
    }

    return;
  } catch (error) {
    return;
  }
};
