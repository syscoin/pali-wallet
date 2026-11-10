import {
  _TypedDataEncoder,
  arrayify,
  defaultAbiCoder,
  getAddress,
  hashMessage,
  hexlify,
  hexConcat,
  isHexString,
  keccak256,
  toBeHex,
  toUtf8Bytes,
} from '../ethersV6Compat.ts';

import {
  createSmartAccountRawSigningIntent,
  createSmartAccountTypedSigningIntent,
  type SmartAccountOwnerSigningIntent,
} from './ownerSigningIntent.ts';

export const PALI_ERC7739_DOMAIN_NAME = 'pali.smart-account.erc1271';
export const PALI_ERC7739_DOMAIN_VERSION = '1';

const PERSONAL_SIGN_TYPEHASH = keccak256(
  toUtf8Bytes('PersonalSign(bytes prefixed)')
);
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export type PaliErc7739TypedData = {
  domain?: Record<string, unknown>;
  message?: Record<string, unknown>;
  primaryType?: string;
  types?: Record<string, Array<{ name: string; type: string }>>;
};

export type PaliErc7739TypedDataRequest = {
  actionHash: string;
  appDomainSeparator: string;
  contentsDescription: string;
  contentsHash: string;
  originalHash: string;
  ownerSigningIntent: SmartAccountOwnerSigningIntent;
};

const getTypedDataBaseType = (type: string) => type.replace(/\[.*\]$/, '');

/** Reject typed-data RPC methods whose semantics are not ERC-7739 V4. */
export const assertPaliErc7739TypedDataV4Method = (method: string): void => {
  if (method !== 'eth_signTypedData_v4') {
    throw new Error(
      'Smart accounts support only eth_signTypedData_v4 typed-data signing'
    );
  }
};

/** Keep only types reachable from primaryType and exclude EIP712Domain. */
export const getReachablePaliTypedDataTypes = (
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType?: string
) => {
  const sanitizedTypes = { ...types };
  delete sanitizedTypes.EIP712Domain;

  if (!primaryType || !sanitizedTypes[primaryType]) {
    return sanitizedTypes;
  }

  const reachableTypes: typeof sanitizedTypes = {};
  const visit = (typeName: string) => {
    if (!sanitizedTypes[typeName] || reachableTypes[typeName]) return;

    reachableTypes[typeName] = sanitizedTypes[typeName];
    for (const field of sanitizedTypes[typeName]) {
      visit(getTypedDataBaseType(field.type));
    }
  };

  visit(primaryType);
  return reachableTypes;
};

export const getPaliErc7739DomainSeparator = (params: {
  accountAddress: string;
  chainId: number;
}): string =>
  _TypedDataEncoder.hashDomain({
    chainId: params.chainId,
    name: PALI_ERC7739_DOMAIN_NAME,
    verifyingContract: getAddress(params.accountAddress),
    version: PALI_ERC7739_DOMAIN_VERSION,
  });

/** Apply EIP-191 to the same decoded bytes used by the personal-sign review. */
export const hashPersonalSignMessage = (message: string): string =>
  hashMessage(isHexString(message) ? arrayify(message) : message);

/** Preserve the actual EIP-191 preimage; a hash used as bytes would sign a different digest. */
export const buildPaliErc7739PersonalSigningIntent = (params: {
  accountAddress: string;
  chainId: number;
  message: string;
}): SmartAccountOwnerSigningIntent => {
  const bytes = isHexString(params.message)
    ? arrayify(params.message)
    : toUtf8Bytes(params.message);
  const prefixed = hexlify(
    hexConcat([
      toUtf8Bytes(`\x19Ethereum Signed Message:\n${bytes.length}`),
      bytes,
    ])
  );
  const domain = {
    chainId: params.chainId,
    name: PALI_ERC7739_DOMAIN_NAME,
    verifyingContract: getAddress(params.accountAddress),
    version: PALI_ERC7739_DOMAIN_VERSION,
  };
  return createSmartAccountTypedSigningIntent(
    'erc7739-personal',
    {
      domain,
      types: { PersonalSign: [{ name: 'prefixed', type: 'bytes' }] },
      message: { prefixed },
    },
    getPaliErc7739PersonalSignHash({
      ...params,
      hash: hashPersonalSignMessage(params.message),
    })
  );
};

/** Hash signed by the active validator for personal_sign / eth_sign. */
export const getPaliErc7739PersonalSignHash = (params: {
  accountAddress: string;
  chainId: number;
  hash: string;
}): string => {
  const structHash = keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32'],
      [PERSONAL_SIGN_TYPEHASH, params.hash]
    )
  );
  return keccak256(
    hexConcat(['0x1901', getPaliErc7739DomainSeparator(params), structHash])
  );
};

/** Build the nested ERC-7739 typed-data request signed by the validator. */
export const buildPaliErc7739TypedDataRequest = (params: {
  accountAddress: string;
  chainId: number;
  typedData: PaliErc7739TypedData;
}): PaliErc7739TypedDataRequest => {
  const {
    domain = {},
    message = {},
    primaryType,
    types = {},
  } = params.typedData;
  const reachableTypes = getReachablePaliTypedDataTypes(types, primaryType);
  if (!primaryType || !reachableTypes[primaryType]) {
    throw new Error('ERC-7739 typed data requires a valid primaryType');
  }

  const encoder = _TypedDataEncoder.from(reachableTypes);
  const contentsDescription = encoder.encodeType(primaryType);
  const contentsHash = encoder.hashStruct(primaryType, message);
  const appDomainSeparator = _TypedDataEncoder.hashDomain(domain);
  const originalHash = keccak256(
    hexConcat(['0x1901', appDomainSeparator, contentsHash])
  );

  const nestedTypeHash = keccak256(
    toUtf8Bytes(
      `TypedDataSign(${primaryType} contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)${contentsDescription}`
    )
  );
  const nestedStructHash = keccak256(
    defaultAbiCoder.encode(
      [
        'bytes32',
        'bytes32',
        'bytes32',
        'bytes32',
        'uint256',
        'address',
        'bytes32',
      ],
      [
        nestedTypeHash,
        contentsHash,
        keccak256(toUtf8Bytes(PALI_ERC7739_DOMAIN_NAME)),
        keccak256(toUtf8Bytes(PALI_ERC7739_DOMAIN_VERSION)),
        params.chainId,
        getAddress(params.accountAddress),
        ZERO_BYTES32,
      ]
    )
  );

  const actionHash = keccak256(
    hexConcat(['0x1901', appDomainSeparator, nestedStructHash])
  );
  // Do not rename dapp types or replace its domain to make a device payload fit.
  // Existing raw software proofs remain valid for graphs the wrapper cannot represent.
  let ownerSigningIntent = createSmartAccountRawSigningIntent(
    'erc7739-typed-data',
    actionHash,
    'unrepresentable-types'
  );
  if (!Object.hasOwn(reachableTypes, 'TypedDataSign')) {
    const nestedTypes = {
      ...reachableTypes,
      TypedDataSign: [
        { name: 'contents', type: primaryType },
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' },
      ],
    };
    // Solidity's contentsDescription ordering is authoritative, including unusual
    // dependency names. Unsupported hardware graphs are not silently re-hashed.
    if (
      _TypedDataEncoder.from(nestedTypes).encodeType('TypedDataSign') ===
      `TypedDataSign(${primaryType} contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)${contentsDescription}`
    ) {
      ownerSigningIntent = createSmartAccountTypedSigningIntent(
        'erc7739-typed-data',
        {
          domain,
          types: nestedTypes,
          message: {
            contents: message,
            name: PALI_ERC7739_DOMAIN_NAME,
            version: PALI_ERC7739_DOMAIN_VERSION,
            chainId: params.chainId,
            verifyingContract: getAddress(params.accountAddress),
            salt: ZERO_BYTES32,
          },
        },
        actionHash
      );
    }
  }
  return {
    actionHash,
    ownerSigningIntent,
    appDomainSeparator,
    contentsDescription,
    contentsHash,
    originalHash,
  };
};

/** Append the ERC-7739 typed-data proof to Pali's module-prefixed signature. */
export const encodePaliErc7739TypedDataSignature = (
  moduleSignature: string,
  request: Pick<
    PaliErc7739TypedDataRequest,
    'appDomainSeparator' | 'contentsDescription' | 'contentsHash'
  >
): string => {
  const descriptionBytes = toUtf8Bytes(request.contentsDescription);
  if (descriptionBytes.length === 0 || descriptionBytes.length > 0xffff) {
    throw new Error('ERC-7739 contents description has an invalid length');
  }

  return hexConcat([
    moduleSignature,
    request.appDomainSeparator,
    request.contentsHash,
    descriptionBytes,
    toBeHex(descriptionBytes.length, 2),
  ]);
};
