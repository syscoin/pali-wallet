import { AbiCoder, Interface } from 'ethers/abi';
import { isAddress } from 'ethers/address';
import { getBigInt } from 'ethers/utils';

import {
  formatTokenUnits,
  parseErc20Decimals,
  parseErc20Units,
  parseUnsignedTokenAmount,
  type Erc20Metadata,
} from './erc20.ts';
import type { IDecodedTx } from '../types/transactions';

const approvalInteger = (value: unknown): bigint => {
  if (value && typeof value === 'object') {
    const scalar = value as {
      _hex?: string;
      hex?: string;
      toString?(): string;
    };
    value = scalar._hex ?? scalar.hex ?? scalar.toString?.();
  }
  return BigInt(parseErc20Units(getBigInt(value as string | number | bigint)));
};

export type ApprovalType = 'erc20-amount' | 'erc721-single' | 'nft-all';

export const APPROVAL_METHOD_SIGNATURES = Object.freeze({
  approve: '0x095ea7b3',
  increaseAllowance: '0x39509351',
  decreaseAllowance: '0xa457c2d7',
  setApprovalForAll: '0xa22cb465',
});
type ApprovalMethod = keyof typeof APPROVAL_METHOD_SIGNATURES;
export type DecodedApprovalCall = Readonly<{
  approvalType: ApprovalType;
  decodedData: Readonly<{
    amount?: string;
    approved?: boolean;
    operator?: string;
    spender?: string;
    to?: string;
    tokenId?: string;
  }>;
  isApproval: true;
  method: ApprovalMethod;
  standardVerified: boolean;
  tokenStandard: string;
}>;
const approvalAbi = AbiCoder.defaultAbiCoder();

/** Describe calldata even when a contract-standard probe is unavailable. */
export function decodeApprovalData(
  data: unknown,
  tokenStandard = 'Unknown'
): DecodedApprovalCall | Readonly<{ isApproval: false }> {
  if (typeof data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(data))
    return { isApproval: false };
  const selector = data.slice(0, 10).toLowerCase();
  const method = (
    Object.keys(APPROVAL_METHOD_SIGNATURES) as ApprovalMethod[]
  ).find((key) => APPROVAL_METHOD_SIGNATURES[key] === selector);
  if (!method) return { isApproval: false };
  const standardVerified = ['ERC-20', 'ERC-721', 'ERC-1155'].includes(
    tokenStandard
  );
  try {
    if (method === 'setApprovalForAll') {
      const [operator, approved] = approvalAbi.decode(
        ['address', 'bool'],
        `0x${data.slice(10)}`
      );
      return Object.freeze({
        isApproval: true,
        approvalType: 'nft-all',
        method,
        tokenStandard,
        standardVerified,
        decodedData: Object.freeze({ operator, approved }),
      });
    }
    const [authority, value] = approvalAbi.decode(
      ['address', 'uint256'],
      `0x${data.slice(10)}`
    );
    const nft = tokenStandard === 'ERC-721' && method === 'approve';
    return Object.freeze({
      isApproval: true,
      approvalType: nft ? 'erc721-single' : 'erc20-amount',
      method,
      tokenStandard,
      standardVerified,
      decodedData: Object.freeze(
        nft
          ? { to: authority, tokenId: value.toString() }
          : { spender: authority, amount: value.toString() }
      ),
    });
  } catch {
    return { isApproval: false };
  }
}

export type ApprovalContractMetadata =
  | Readonly<{ standard: 'ERC-20'; token: Erc20Metadata }>
  | Readonly<{ standard: 'ERC-721' | 'ERC-1155' }>;

export type ApprovalSummary = Readonly<{
  amountUnits?: string;
  approvalType: ApprovalType;
  approved?: boolean;
  authority: string;
  canEditAmount: boolean;
  isRevocation: boolean;
  isUnlimited: boolean;
  method: ApprovalMethod;
  standardVerified: boolean;
  token?: Erc20Metadata;
  tokenContract: string;
  tokenId?: string;
  tokenStandard: string;
}>;

/** Metadata describes a probed interface. The exact authority/value comes from calldata. */
export function summarizeApproval(
  data: string,
  tokenContract: string,
  metadata?: ApprovalContractMetadata
): ApprovalSummary | null {
  if (!isAddress(tokenContract)) return null;
  const decoded = decodeApprovalData(data, metadata?.standard);
  if (!decoded.isApproval) return null;
  const { decodedData, approvalType, method, tokenStandard, standardVerified } =
    decoded;
  const authority =
    decodedData.spender ?? decodedData.to ?? decodedData.operator!;
  const token = metadata?.standard === 'ERC-20' ? metadata.token : undefined;
  if (
    token &&
    token.contractAddress.toLowerCase() !== tokenContract.toLowerCase()
  )
    throw new Error('Approval metadata contract mismatch');
  const isRevocation =
    approvalType === 'erc721-single'
      ? /^0x0{40}$/i.test(authority)
      : approvalType === 'nft-all'
      ? decodedData.approved === false
      : decodedData.amount === '0';
  return Object.freeze({
    tokenContract,
    authority,
    method,
    approvalType,
    tokenStandard,
    standardVerified,
    isRevocation,
    isUnlimited:
      standardVerified &&
      tokenStandard === 'ERC-20' &&
      method === 'approve' &&
      decodedData.amount ===
        ((BigInt(1) << BigInt(256)) - BigInt(1)).toString(),
    ...(decodedData.amount === undefined
      ? {}
      : { amountUnits: decodedData.amount }),
    ...(decodedData.tokenId === undefined
      ? {}
      : { tokenId: decodedData.tokenId }),
    ...(decodedData.approved === undefined
      ? {}
      : { approved: decodedData.approved }),
    ...(token ? { token } : {}),
    canEditAmount: metadata?.standard === 'ERC-20' && method === 'approve',
  });
}

const EXPECTED_APPROVAL_METHODS: Record<ApprovalType, string[]> = {
  'erc20-amount': ['approve', 'increaseAllowance', 'decreaseAllowance'],
  'erc721-single': ['approve'],
  'nft-all': ['setApprovalForAll'],
};

const AUTHORITY_LABEL_KEYS: Record<ApprovalType, string> = {
  'erc20-amount': 'transactions.spender',
  'erc721-single': 'transactions.approvedTo',
  'nft-all': 'transactions.operator',
};

export interface IApprovalAddressValues {
  approvalType?: ApprovalType;
  authority: string;
  authorityLabelKey: string;
  isNftRevocation?: boolean;
  isValid: boolean;
  method: string;
  tokenContract: string;
}

const hasValidApprovalValue = (
  decodedTx: Pick<IDecodedTx, 'inputs'> | undefined,
  approvalType?: ApprovalType
): boolean => {
  const value = decodedTx?.inputs?.[1];
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim())
  )
    return false;

  if (approvalType === 'nft-all') return typeof value === 'boolean';

  try {
    return approvalInteger(value) >= BigInt(0);
  } catch {
    return false;
  }
};

export const getApprovalAddressValues = (
  decodedTx: Pick<IDecodedTx, 'inputs' | 'method'> | undefined,
  tokenContract: string,
  approvalType?: ApprovalType
): IApprovalAddressValues => {
  const authority = String(decodedTx?.inputs?.[0] || '');
  const method = String(decodedTx?.method || '');
  const expectedMethods = approvalType
    ? EXPECTED_APPROVAL_METHODS[approvalType]
    : [];
  const isValid =
    Boolean(approvalType) &&
    isAddress(authority) &&
    isAddress(tokenContract) &&
    expectedMethods.includes(method) &&
    hasValidApprovalValue(decodedTx, approvalType);
  const isNftRevocation =
    isValid &&
    approvalType === 'erc721-single' &&
    authority.toLowerCase() === '0x0000000000000000000000000000000000000000';

  return {
    approvalType,
    authority,
    authorityLabelKey: isNftRevocation
      ? 'send.approvalResetAddress'
      : approvalType
      ? AUTHORITY_LABEL_KEYS[approvalType]
      : 'transactions.approvedTo',
    isNftRevocation,
    isValid,
    method,
    tokenContract,
  };
};

// Describe the requested operation, not an unverified contract outcome.
// Use the effective decoded calldata so edits and the heading stay aligned.
export const getErc20ApprovalHeadingKey = (
  decodedTx: Pick<IDecodedTx, 'inputs' | 'method'> | undefined
): string => {
  try {
    const value = decodedTx?.inputs?.[1];
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && !value.trim())
    )
      return 'send.erc20ApprovalRequest';
    const amount = approvalInteger(value);
    if (amount < BigInt(0) || amount >= BigInt(1) << BigInt(256))
      return 'send.erc20ApprovalRequest';
    if (decodedTx?.method === 'approve')
      return amount === BigInt(0)
        ? 'send.erc20SetAllowanceZero'
        : 'send.grantAccess';
    if (decodedTx?.method === 'increaseAllowance')
      return 'send.erc20IncreaseAllowance';
    if (decodedTx?.method === 'decreaseAllowance')
      return 'send.erc20DecreaseAllowance';
  } catch {
    // Invalid or unavailable calldata must not be described as a grant.
  }
  return 'send.erc20ApprovalRequest';
};

export const formatApprovalNftTokenId = (value: unknown): string => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim())
  )
    return '';
  try {
    const tokenId = approvalInteger(value);
    return tokenId >= BigInt(0) ? tokenId.toString() : '';
  } catch {
    return '';
  }
};

export const canEditApprovalAmount = (
  approvalType: ApprovalType | undefined,
  method: string | null | undefined,
  tokenStandard: string | undefined
): boolean =>
  approvalType === 'erc20-amount' &&
  method === 'approve' &&
  tokenStandard === 'ERC-20';

export const formatApprovalTokenAmount = (
  rawAmount: unknown,
  decimals: number
): string => formatTokenUnits(approvalInteger(rawAmount).toString(), decimals);

export const getApprovalAmountDisplay = ({
  canEdit,
  customAmount,
  formattedAmount,
  isCustom,
  isEffectiveUnlimited,
}: {
  canEdit: boolean;
  customAmount?: string | null;
  formattedAmount?: string;
  isCustom: boolean;
  isEffectiveUnlimited: boolean;
}): { amount?: string; isUnlimited: boolean } => {
  const hasCustomAmount =
    canEdit && isCustom && customAmount !== null && customAmount !== undefined;

  return {
    amount: hasCustomAmount ? String(customAmount) : formattedAmount,
    isUnlimited: isEffectiveUnlimited,
  };
};

export const encodeCustomApprovalData = ({
  abi,
  approvalType,
  decimals,
  humanAmount,
  method,
  spender,
  tokenStandard,
}: {
  abi: any[];
  approvalType?: ApprovalType;
  decimals: number;
  humanAmount: string;
  method: string | null | undefined;
  spender: string;
  tokenStandard: string | undefined;
}): string | null => {
  if (
    !canEditApprovalAmount(approvalType, method, tokenStandard) ||
    !isAddress(spender)
  ) {
    return null;
  }

  const parsedAmount = parseApprovalAmount(humanAmount, decimals);
  if (parsedAmount === null) return null;
  return new Interface(abi).encodeFunctionData('approve', [
    spender,
    parsedAmount,
  ]);
};

export const parseApprovalAmount = (
  humanAmount: string,
  decimals: number
): bigint | null => {
  try {
    parseErc20Decimals(decimals);
    if (
      typeof humanAmount !== 'string' ||
      humanAmount.length > 334 ||
      !/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(humanAmount)
    )
      return null;
    const [integer = '', fraction = ''] = humanAmount.split('.');
    const whole = integer.replace(/^0+(?=\d)/, '') || '0';
    const trimmedFraction = fraction.replace(/0+$/, '');
    return BigInt(
      parseUnsignedTokenAmount(
        trimmedFraction ? `${whole}.${trimmedFraction}` : whole,
        decimals
      )
    );
  } catch {
    return null;
  }
};

const ERC20_APPROVE_ABI = ['function approve(address spender,uint256 amount)'];

// Review, fee estimation and submission must consume this same transaction
// intent. Decode the encoded bytes for Data instead of formatting a second,
// potentially different copy of the edited amount.
export const getEffectiveApprovalData = ({
  approvalType,
  customAmount,
  data,
  decimals,
  decodedTx,
  isCustom,
  tokenStandard,
}: {
  approvalType?: ApprovalType;
  customAmount?: string | null;
  data: string;
  decimals?: number;
  decodedTx: IDecodedTx;
  isCustom: boolean;
  tokenStandard: string | undefined;
}): { data: string; decodedTx: IDecodedTx } | null => {
  if (!isCustom) return { data, decodedTx };
  if (
    decimals === undefined ||
    customAmount === null ||
    customAmount === undefined
  )
    return null;
  const encoded = encodeCustomApprovalData({
    abi: ERC20_APPROVE_ABI,
    approvalType,
    decimals,
    humanAmount: customAmount,
    method: decodedTx?.method,
    spender: String(decodedTx?.inputs?.[0] || ''),
    tokenStandard,
  });
  if (!encoded) return null;
  const values = new Interface(ERC20_APPROVE_ABI).decodeFunctionData(
    'approve',
    encoded
  );
  return {
    data: encoded,
    decodedTx: {
      ...decodedTx,
      inputs: [decodedTx.inputs[0], values[1].toString()],
    },
  };
};
