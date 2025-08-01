import { ethErrors } from 'helpers/errors';

import { Middleware } from '../request-pipeline';
import cleanErrorStack from 'utils/cleanErrorStack';
import { isValidEthereumAddress } from 'utils/validations';

/**
 * Validates EIP-712 typed data to ensure all address fields are in correct format
 * This prevents malicious dapps from using invalid address formats
 */
export const typedDataValidationMiddleware: Middleware = async (
  context,
  next
) => {
  const { method, params } = context.originalRequest;

  // Only validate typed data methods
  if (
    method !== 'eth_signTypedData' &&
    method !== 'eth_signTypedData_v3' &&
    method !== 'eth_signTypedData_v4'
  ) {
    return next();
  }

  try {
    // Extract typed data from params
    let typedData: any;

    // The params format is [address, typedData] or [typedData, address]
    if (params && params.length >= 2) {
      // Check both positions for the typed data
      if (typeof params[0] === 'object' && params[0] !== null) {
        typedData = params[0];
      } else if (typeof params[1] === 'object' && params[1] !== null) {
        typedData = params[1];
      } else if (typeof params[0] === 'string' && params[0].startsWith('{')) {
        typedData = JSON.parse(params[0]);
      } else if (typeof params[1] === 'string' && params[1].startsWith('{')) {
        typedData = JSON.parse(params[1]);
      }
    }

    if (!typedData) {
      // No typed data found, let it proceed (will fail later with proper error)
      return next();
    }

    // Validate domain fields
    if (typedData.domain) {
      // Check verifyingContract field
      if (typedData.domain.verifyingContract) {
        const verifyingContract = typedData.domain.verifyingContract;

        // Check if it's a valid address or if it's an invalid format (like integer string)
        if (!isValidEthereumAddress(verifyingContract)) {
          throw cleanErrorStack(
            ethErrors.rpc.invalidParams(
              `Invalid address format in domain.verifyingContract: "${verifyingContract}". Expected hex address starting with 0x`
            )
          );
        }
      }
    }

    // Validate message fields based on types
    if (typedData.types && typedData.message) {
      validateMessageFields(
        typedData.types,
        typedData.message,
        typedData.primaryType || 'EIP712Domain'
      );
    }

    // All validations passed, continue
    return next();
  } catch (error) {
    // Re-throw if it's already a clean error
    if (error.code && error.message) {
      throw error;
    }

    // Wrap other errors
    throw cleanErrorStack(
      ethErrors.rpc.invalidParams(`Invalid typed data: ${error.message}`)
    );
  }
};

/**
 * Recursively validates message fields based on their types
 */
function validateMessageFields(types: any, message: any, primaryType: string) {
  if (!types[primaryType]) {
    return;
  }

  const typeDefinition = types[primaryType];

  for (const field of typeDefinition) {
    const fieldName = field.name;
    const fieldType = field.type;
    const fieldValue = message[fieldName];

    // Check if this is an address field
    if (
      fieldType === 'address' &&
      fieldValue !== undefined &&
      fieldValue !== null
    ) {
      if (!isValidEthereumAddress(fieldValue)) {
        throw new Error(
          `Invalid address format in message.${fieldName}: "${fieldValue}". Expected hex address starting with 0x`
        );
      }
    }

    // Check for address arrays
    if (fieldType === 'address[]' && Array.isArray(fieldValue)) {
      for (let i = 0; i < fieldValue.length; i++) {
        if (!isValidEthereumAddress(fieldValue[i])) {
          throw new Error(
            `Invalid address format in message.${fieldName}[${i}]: "${fieldValue[i]}". Expected hex address starting with 0x`
          );
        }
      }
    }

    // Recursively check nested types
    if (
      types[fieldType] &&
      typeof fieldValue === 'object' &&
      fieldValue !== null
    ) {
      validateMessageFields(types, fieldValue, fieldType);
    }
  }
}
