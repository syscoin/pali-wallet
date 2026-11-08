import { isAddress } from 'ethers/address';

import cleanErrorStack from '../utils/cleanErrorStack.ts';
import { assertTypedDataParamsWorkBudget } from '../utils/typedDataWorkBudget.ts';

const invalidParams = (message: string): Error & { code: number } =>
  Object.assign(new Error(message), { code: -32602 });

/** Validate the same bounded typed-data semantics before either host opens approval. */
export const assertDappTypedDataValid = (
  method: string,
  params: unknown
): void => {
  const values = params as any;
  // Only validate typed data methods
  if (
    method !== 'eth_signTypedData' &&
    method !== 'eth_signTypedData_v3' &&
    method !== 'eth_signTypedData_v4'
  ) {
    return;
  }

  try {
    assertTypedDataParamsWorkBudget(method, params);
    // Extract typed data from params
    let typedData: any;

    // The params format is [address, typedData] or [typedData, address]
    if (values && values.length >= 2) {
      // Check both positions for the typed data
      if (typeof values[0] === 'object' && values[0] !== null) {
        typedData = values[0];
      } else if (typeof values[1] === 'object' && values[1] !== null) {
        typedData = values[1];
      } else if (typeof values[0] === 'string' && /^\s*[\[{]/.test(values[0])) {
        typedData = JSON.parse(values[0]);
      } else if (typeof values[1] === 'string' && /^\s*[\[{]/.test(values[1])) {
        typedData = JSON.parse(values[1]);
      }
    }

    if (
      !typedData ||
      typeof typedData !== 'object' ||
      (method !== 'eth_signTypedData' && Array.isArray(typedData))
    ) {
      throw invalidParams('Invalid typed data: expected an object');
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
          if (!isAddress(item.value)) {
            throw cleanErrorStack(
              invalidParams(`Invalid address format: ${item.value}`)
            );
          }
        }
      }
      // V1 validation uses the same address checks as the extension.
      return;
    }

    // Validate domain fields
    if (typedData.domain) {
      // Check verifyingContract field
      if (typedData.domain.verifyingContract) {
        const verifyingContract = typedData.domain.verifyingContract;

        // Check if it's a valid address or if it's an invalid format (like integer string)
        if (!isAddress(verifyingContract)) {
          throw cleanErrorStack(
            invalidParams(
              `Invalid address format in domain.verifyingContract: "${verifyingContract}". Expected hex address starting with 0x`
            )
          );
        }
      }
    }

    // Validate that types object exists and is valid
    if (!typedData.types || typeof typedData.types !== 'object') {
      throw cleanErrorStack(
        invalidParams('Invalid typed data: "types" must be an object')
      );
    }

    // Validate message exists if we have types
    if (typedData.types && !typedData.message) {
      throw cleanErrorStack(
        invalidParams(
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
          invalidParams(
            'Invalid typed data: Unable to determine primaryType. The typed data must specify a primaryType or have a clear root type.'
          )
        );
      }

      // Validate that the primaryType exists in types
      if (!typedData.types[actualPrimaryType]) {
        throw cleanErrorStack(
          invalidParams(
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

    // All validations passed.
    return;
  } catch (error: any) {
    // Re-throw if it's already a clean error
    if (error.code && error.message) {
      throw error;
    }

    // Wrap other errors
    throw cleanErrorStack(
      invalidParams(`Invalid typed data: ${error.message}`)
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
      if (!isAddress(fieldValue)) {
        throw new Error(
          `Invalid address format in message.${fieldName}: "${fieldValue}". Expected hex address starting with 0x`
        );
      }
    }

    // Check for address arrays
    if (fieldType === 'address[]' && Array.isArray(fieldValue)) {
      for (let i = 0; i < fieldValue.length; i++) {
        if (!isAddress(fieldValue[i])) {
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
