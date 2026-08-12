import { isAddress } from 'utils/ethersV6Compat';

import { EVM_TRANSACTION_HISTORY_SOURCE } from './evmNonce';
import {
  getERC1155Recipient,
  getERC20Recipient,
  getSmartAccountDisplayTransaction,
  isERC1155Transfer,
  isTokenTransfer,
} from './transactions';

const REQUIRED_MATCHING_HEX_CHARACTERS = 4;

const normalizeEvmAddress = (address: unknown): string | null => {
  if (typeof address !== 'string' || !isAddress(address)) return null;
  return address.toLowerCase();
};

const getCommonPrefixLength = (left: string, right: string) => {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[length] === right[length]
  ) {
    length += 1;
  }
  return length;
};

const getCommonSuffixLength = (left: string, right: string) => {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
};

const isFailedTransaction = (transaction: any) =>
  transaction?.isError === '1' || transaction?.txreceipt_status === '0';

export const getTrustedEvmRecipient = (
  transaction: any,
  accountAddress: string
): string | null => {
  const normalizedAccount = normalizeEvmAddress(accountAddress);
  if (
    !normalizedAccount ||
    !transaction ||
    isFailedTransaction(transaction) ||
    transaction.historySource ===
      EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer
  ) {
    return null;
  }

  const displayTransaction =
    getSmartAccountDisplayTransaction(transaction) || transaction;
  const normalizedSender = normalizeEvmAddress(displayTransaction?.from);
  const normalizedSmartAccount = normalizeEvmAddress(
    transaction?.smartAccountExecutionFrom
  );
  if (
    normalizedSender !== normalizedAccount &&
    normalizedSmartAccount !== normalizedAccount
  ) {
    return null;
  }

  let recipient: string | null = null;
  if (isTokenTransfer(displayTransaction)) {
    recipient = isERC1155Transfer(displayTransaction)
      ? getERC1155Recipient(displayTransaction)
      : getERC20Recipient(displayTransaction);
  } else {
    const input = String(
      displayTransaction?.input || displayTransaction?.data || '0x'
    );
    if (input === '0x') {
      recipient = displayTransaction?.to || null;
    }
  }

  return normalizeEvmAddress(recipient);
};

export const getTrustedEvmRecipients = (
  transactions: any[] | null | undefined,
  accountAddress: string
): string[] => {
  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const transaction of transactions || []) {
    const recipient = getTrustedEvmRecipient(transaction, accountAddress);
    if (recipient && !seen.has(recipient)) {
      seen.add(recipient);
      recipients.push(recipient);
    }
  }

  return recipients;
};

export interface IEvmAddressPoisoningCollision {
  candidate: string;
  matchingPrefixLength: number;
  matchingSuffixLength: number;
  trustedAddress: string;
}

export const findEvmAddressPoisoningCollision = (
  candidateAddress: string,
  trustedRecipients: string[],
  exemptAddresses: string[] = []
): IEvmAddressPoisoningCollision | null => {
  const candidate = normalizeEvmAddress(candidateAddress);
  if (!candidate) return null;

  const exemptions = new Set(
    exemptAddresses
      .map((address) => normalizeEvmAddress(address))
      .filter(Boolean) as string[]
  );
  if (exemptions.has(candidate)) return null;

  const candidateHex = candidate.slice(2);
  for (const trustedRecipient of trustedRecipients) {
    const trustedAddress = normalizeEvmAddress(trustedRecipient);
    if (!trustedAddress || trustedAddress === candidate) continue;

    const trustedHex = trustedAddress.slice(2);
    const matchingPrefixLength = getCommonPrefixLength(
      candidateHex,
      trustedHex
    );
    const matchingSuffixLength = getCommonSuffixLength(
      candidateHex,
      trustedHex
    );
    if (
      matchingPrefixLength >= REQUIRED_MATCHING_HEX_CHARACTERS &&
      matchingSuffixLength >= REQUIRED_MATCHING_HEX_CHARACTERS
    ) {
      return {
        candidate,
        matchingPrefixLength,
        matchingSuffixLength,
        trustedAddress,
      };
    }
  }

  return null;
};

export type EvmHistoryAddressCopyRisk =
  | {
      kind: 'lookalike';
      trustedAddress: string;
    }
  | { kind: 'untrusted-history' };

export const getEvmHistoryAddressCopyRisk = ({
  accountAddress,
  address,
  label,
  transaction,
  trustedRecipients,
}: {
  accountAddress: string;
  address: string;
  label: string;
  transaction: any;
  trustedRecipients: string[];
}): EvmHistoryAddressCopyRisk | null => {
  const normalizedAddress = normalizeEvmAddress(address);
  const normalizedAccount = normalizeEvmAddress(accountAddress);
  const normalizedLabel = String(label).toLowerCase();
  if (
    !normalizedAddress ||
    (normalizedLabel !== 'from' && normalizedLabel !== 'to') ||
    normalizedAddress === normalizedAccount ||
    trustedRecipients.some(
      (recipient) => normalizeEvmAddress(recipient) === normalizedAddress
    )
  ) {
    return null;
  }

  const collision = findEvmAddressPoisoningCollision(
    normalizedAddress,
    trustedRecipients
  );
  if (collision) {
    return {
      kind: 'lookalike',
      trustedAddress: collision.trustedAddress,
    };
  }

  if (
    transaction?.historySource ===
      EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer ||
    transaction?.direction === 'received' ||
    (normalizedLabel === 'from' &&
      normalizeEvmAddress(transaction?.from) !== normalizedAccount)
  ) {
    return { kind: 'untrusted-history' };
  }

  return null;
};
