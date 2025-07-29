import InputDataDecoder from 'ethereum-input-data-decoder';
import { ethers } from 'ethers';

import { ITransactionParams } from 'types/transactions';
import { retryableFetch } from 'utils/retryableFetch';
import { getErc20Abi, getContractType } from 'utils/validations';

import { pegasysABI } from './pegasys';
import { validateTransactionDataValue } from './validateTransactionDataValue';
import { wrapABI } from './wrapABI';

// Create a cached instance of the decoder
let erc20DecoderInstance: InputDataDecoder | null = null;

export const erc20DataDecoder = async (controller?: any) => {
  if (!erc20DecoderInstance) {
    const abi = await getErc20Abi(controller);
    erc20DecoderInstance = new InputDataDecoder(abi);
  }
  return erc20DecoderInstance;
};
// Helper function to detect approval type
const detectApprovalType = async (
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

    // Method signatures
    const signatures = {
      approve: ethers.utils.id('approve(address,uint256)').slice(0, 10),
      setApprovalForAll: ethers.utils
        .id('setApprovalForAll(address,bool)')
        .slice(0, 10),
    };

    if (data.startsWith(signatures.approve)) {
      if (contractType?.type === 'ERC-20' || contractType?.type === 'ERC-777') {
        // ERC-20/777 amount approval (default assumption for approve() calls)
        const [spender, amount] = ethers.utils.defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + data.slice(10)
        );
        return {
          isApproval: true,
          approvalType: 'erc20-amount',
          tokenStandard: contractType.type,
          decodedData: { spender, amount },
          method: 'approve',
        };
      } else if (contractType?.type === 'ERC-721') {
        // ERC-721 single NFT approval
        const [to, tokenId] = ethers.utils.defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + data.slice(10)
        );
        return {
          isApproval: true,
          approvalType: 'erc721-single',
          tokenStandard: 'ERC-721',
          decodedData: { to, tokenId },
          method: 'approve',
        };
      }
    } else if (data.startsWith(signatures.setApprovalForAll)) {
      // Works for both ERC-721 and ERC-1155
      const [operator, approved] = ethers.utils.defaultAbiCoder.decode(
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
  validateTxToAddress: {
    contract: boolean | undefined;
    wallet: boolean | undefined;
  },
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
    if (validateTxToAddress.contract && dataValidation && web3Provider) {
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
