import { ethErrors } from 'helpers/errors';

import { Middleware } from '../request-pipeline';
import cleanErrorStack from 'utils/cleanErrorStack';
import { isValidEthereumAddress } from 'utils/validations';

/**
 * Validates EIP-712 typed data to ensure all address fields are in correct format
 * and that the typed data structure is valid and complete.
 *
 * Security validations include:
 * - Primary type must exist in types definition
 * - All required fields must be present in message
 * - Address fields must be valid Ethereum addresses
 * - Array fields must contain valid elements
 * - Nested structures are recursively validated
 *
 * This prevents malicious dapps from:
 * - Using invalid address formats to trick users
 * - Crafting incomplete typed data to bypass validation
 * - Using non-existent types to cause errors
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

    // Handle v1 format (array of typed values)
    if (method === 'eth_signTypedData' && Array.isArray(typedData)) {
      // V1 format validation - just check address fields in the array
      for (const item of typedData) {
        if (
          item &&
          typeof item === 'object' &&
          item.type === 'address' &&
          item.value
        ) {
          if (!isValidEthereumAddress(item.value)) {
            throw cleanErrorStack(
              ethErrors.rpc.invalidParams(
                `Invalid address format: ${item.value}`
              )
            );
          }
        }
      }
      // V1 format is valid, continue to next middleware
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

    // Validate that types object exists and is valid
    if (!typedData.types || typeof typedData.types !== 'object') {
      throw cleanErrorStack(
        ethErrors.rpc.invalidParams(
          'Invalid typed data: "types" must be an object'
        )
      );
    }

    // Validate message exists if we have types
    if (typedData.types && !typedData.message) {
      throw cleanErrorStack(
        ethErrors.rpc.invalidParams(
          'Invalid typed data: "message" is required when types are defined'
        )
      );
    }

    // Validate message fields based on types
    if (typedData.types && typedData.message) {
      // Determine the actual primaryType from the typed data
      // The primaryType should be the root type being signed, not the domain
      let actualPrimaryType = typedData.primaryType;

      // If primaryType is not specified, try to determine it
      if (!actualPrimaryType && typedData.types) {
        // Find types that are not referenced by other types (root types)
        const allTypes = Object.keys(typedData.types);
        const referencedTypes = new Set<string>();

        // Collect all referenced types
        for (const typeName of allTypes) {
          if (typeName !== 'EIP712Domain') {
            const fields = typedData.types[typeName];
            for (const field of fields) {
              if (allTypes.includes(field.type)) {
                referencedTypes.add(field.type);
              }
            }
          }
        }

        // Find non-referenced types (excluding EIP712Domain)
        const rootTypes = allTypes.filter(
          (type) => type !== 'EIP712Domain' && !referencedTypes.has(type)
        );

        // Use the first root type found, or fall back to the first non-domain type
        actualPrimaryType =
          rootTypes[0] || allTypes.find((type) => type !== 'EIP712Domain');
      }

      // Validate that we have a primaryType
      if (!actualPrimaryType) {
        throw cleanErrorStack(
          ethErrors.rpc.invalidParams(
            'Invalid typed data: Unable to determine primaryType. The typed data must specify a primaryType or have a clear root type.'
          )
        );
      }

      // Validate that the primaryType exists in types
      if (!typedData.types[actualPrimaryType]) {
        throw cleanErrorStack(
          ethErrors.rpc.invalidParams(
            `Invalid typed data: primaryType "${actualPrimaryType}" is not defined in types`
          )
        );
      }

      validateMessageFields(
        typedData.types,
        typedData.message,
        actualPrimaryType
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
    throw new Error(
      `Invalid typed data: primaryType "${primaryType}" is not defined in types`
    );
  }

  const typeDefinition = types[primaryType];

  for (const field of typeDefinition) {
    const fieldName = field.name;
    const fieldType = field.type;
    const fieldValue = message[fieldName];

    // Check if required field is missing (all fields in EIP-712 are required unless explicitly optional)
    if (
      fieldValue === undefined &&
      fieldType !== 'bytes' &&
      fieldType !== 'string'
    ) {
      // bytes and string can be empty, but other types should be present
      throw new Error(
        `Invalid typed data: Required field "${fieldName}" is missing from message`
      );
    }

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

    // Handle array types (e.g., "uint256[]", "MyStruct[]")
    if (
      fieldType.endsWith('[]') &&
      fieldValue !== undefined &&
      fieldValue !== null
    ) {
      if (!Array.isArray(fieldValue)) {
        throw new Error(
          `Invalid typed data: Field "${fieldName}" must be an array but got ${typeof fieldValue}`
        );
      }

      // For struct arrays, validate each element
      const baseType = fieldType.slice(0, -2); // Remove '[]'
      if (types[baseType]) {
        for (let i = 0; i < fieldValue.length; i++) {
          if (typeof fieldValue[i] !== 'object' || fieldValue[i] === null) {
            throw new Error(
              `Invalid typed data: ${fieldName}[${i}] must be an object`
            );
          }
          validateMessageFields(types, fieldValue[i], baseType);
        }
      }
    }

    // Recursively check nested types (non-array custom types)
    if (
      types[fieldType] &&
      !fieldType.endsWith('[]') &&
      typeof fieldValue === 'object' &&
      fieldValue !== null
    ) {
      validateMessageFields(types, fieldValue, fieldType);
    }
  }
}
