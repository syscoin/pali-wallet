import { defaultAbiCoder } from '@ethersproject/abi';
import InputDataDecoder from 'ethereum-input-data-decoder';

import { IDecodedTx, ITransactionParams } from 'types/transactions';
import {
  passkeyFactoryInterface,
  passkeySmartAccountInterface,
} from 'utils/passkey/contracts';
import { retryableFetch } from 'utils/retryableFetch';
import { getErc20Abi, getContractType } from 'utils/validations';

import { getMethodName } from './commonMethodSignatures';
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

const normalizeBytesValue = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : '0x';

const getPasskeyExecutionValue = (execution: any, key: string, index: number) =>
  execution?.[key] ?? execution?.[index];

const decodePasskeyExecutions = (method: string, executionsArg: any) => {
  const executions = Array.from(executionsArg || []);

  if (executions.length === 1) {
    const execution = executions[0];

    return {
      method,
      types: ['address', 'uint256', 'bytes', 'uint256', 'uint256'],
      inputs: [
        getPasskeyExecutionValue(execution, 'target', 0),
        getPasskeyExecutionValue(execution, 'value', 1),
        normalizeBytesValue(getPasskeyExecutionValue(execution, 'data', 2)),
        getPasskeyExecutionValue(execution, 'nonce', 3),
        getPasskeyExecutionValue(execution, 'deadline', 4),
      ],
      names: ['target', 'value', 'data', 'nonce', 'deadline'],
    };
  }

  return executions.reduce<IDecodedTx>(
    (decoded, execution: any, index) => {
      decoded.types.push('address', 'uint256', 'bytes', 'uint256', 'uint256');
      decoded.inputs.push(
        getPasskeyExecutionValue(execution, 'target', 0),
        getPasskeyExecutionValue(execution, 'value', 1),
        normalizeBytesValue(getPasskeyExecutionValue(execution, 'data', 2)),
        getPasskeyExecutionValue(execution, 'nonce', 3),
        getPasskeyExecutionValue(execution, 'deadline', 4)
      );
      decoded.names.push(
        `execution${index + 1}Target`,
        `execution${index + 1}Value`,
        `execution${index + 1}Data`,
        `execution${index + 1}Nonce`,
        `execution${index + 1}Deadline`
      );

      return decoded;
    },
    {
      method,
      inputs: [executions.length],
      names: ['executionCount'],
      types: ['uint256'],
    }
  );
};

const decodePasskeyTransactionData = (data: string) => {
  for (const passkeyInterface of [
    passkeySmartAccountInterface,
    passkeyFactoryInterface,
  ]) {
    try {
      const parsed = passkeyInterface.parseTransaction({ data });

      if (parsed.name === 'execute') {
        return decodePasskeyExecutions(parsed.name, parsed.args.executions);
      }

      if (parsed.name === 'createAccountAndExecute') {
        return decodePasskeyExecutions(parsed.name, parsed.args.executions);
      }

      if (parsed.name === 'setSponsor') {
        return {
          method: parsed.name,
          types: ['uint8', 'address', 'string'],
          inputs: [parsed.args.mode, parsed.args.signer, parsed.args.url],
          names: ['mode', 'signer', 'url'],
        };
      }

      return {
        method: parsed.name,
        types: [],
        inputs: [],
        names: [],
      };
    } catch {
      // Try the next passkey ABI before falling through to generic decoding.
    }
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
    const normalizedData = typeof data === 'string' ? data.toLowerCase() : data;
    const dataValidation = Boolean(
      data &&
        String(data).length > 0 &&
        normalizedData !== '0x' &&
        normalizedData !== '0x0'
    );

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
      if (decoderValue.method !== null) return decoderValue;
      const passkeyDecoderValue = decodePasskeyTransactionData(validatedData);
      if (passkeyDecoderValue) return passkeyDecoderValue;
      if (decoderValue.method === null) {
        const methodId = data.slice(0, 10); // Get first 4 bytes (0x + 8 chars)
        const knownMethodName = getMethodName(methodId);
        if (knownMethodName) {
          decoderValue.method = knownMethodName;
          return decoderValue;
        }

        // Try to fetch function signature from 4byte.directory
        const signature = await fetchFunctionSignature(methodId);
        if (signature) {
          decoderValue.method = signature;
        } else {
          decoderValue.method = 'Contract Interaction';
        }
      }
      return decoderValue;
    }

    // Return Send Method when there is a destination and no calldata.
    if (!dataValidation && params?.to && params?.to !== zeroAddress) {
      const emptyDecoderObject = {
        method: 'Send',
        types: [],
        inputs: [],
        names: [],
      };
      return emptyDecoderObject;
    }

    // Return Contract Interaction when calldata is absent and the tx is not a
    // normal transfer shape.
    if (!dataValidation) {
      const emptyDecoderObject = {
        method: 'Contract Interaction',
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
