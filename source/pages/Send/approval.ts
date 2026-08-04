import { IDecodedTx } from 'types/transactions';
import {
  formatUnits,
  Interface,
  isAddress,
  parseUnits,
  toEthersBigNumberish,
} from 'utils/ethersV6Compat';

export type ApprovalType = 'erc20-amount' | 'erc721-single' | 'nft-all';

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
  isValid: boolean;
  method: string;
  tokenContract: string;
}

const hasValidApprovalValue = (
  decodedTx: Pick<IDecodedTx, 'inputs'> | undefined,
  approvalType?: ApprovalType
): boolean => {
  const value = decodedTx?.inputs?.[1];
  if (value === null || value === undefined) return false;

  if (approvalType === 'nft-all') return typeof value === 'boolean';

  try {
    return toEthersBigNumberish(value) >= BigInt(0);
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

  return {
    approvalType,
    authority,
    authorityLabelKey: approvalType
      ? AUTHORITY_LABEL_KEYS[approvalType]
      : 'transactions.approvedTo',
    isValid:
      Boolean(approvalType) &&
      isAddress(authority) &&
      isAddress(tokenContract) &&
      expectedMethods.includes(method) &&
      hasValidApprovalValue(decodedTx, approvalType),
    method,
    tokenContract,
  };
};

export const canEditApprovalAmount = (
  approvalType: ApprovalType | undefined,
  method: string | null | undefined
): boolean => approvalType === 'erc20-amount' && method === 'approve';

export const formatApprovalTokenAmount = (
  rawAmount: unknown,
  decimals: number
): string =>
  formatUnits(toEthersBigNumberish(rawAmount as any), decimals).toString();

export const getApprovalAmountDisplay = ({
  canEdit,
  customAmount,
  formattedAmount,
  isCustom,
  isRequestedUnlimited,
}: {
  canEdit: boolean;
  customAmount?: string | null;
  formattedAmount?: string;
  isCustom: boolean;
  isRequestedUnlimited: boolean;
}): { amount?: string; isUnlimited: boolean } => {
  const hasCustomAmount =
    canEdit && isCustom && customAmount !== null && customAmount !== undefined;

  return {
    amount: hasCustomAmount ? String(customAmount) : formattedAmount,
    isUnlimited: !hasCustomAmount && isRequestedUnlimited,
  };
};

export const encodeCustomApprovalData = ({
  abi,
  approvalType,
  decimals,
  humanAmount,
  method,
  spender,
}: {
  abi: any[];
  approvalType?: ApprovalType;
  decimals: number;
  humanAmount: string;
  method: string | null | undefined;
  spender: string;
}): string | null => {
  if (!canEditApprovalAmount(approvalType, method) || !isAddress(spender)) {
    return null;
  }

  const parsedAmount = parseUnits(humanAmount, decimals);
  return new Interface(abi).encodeFunctionData(method, [
    spender,
    toEthersBigNumberish(parsedAmount),
  ]);
};
