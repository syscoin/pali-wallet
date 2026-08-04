import { defaultAbiCoder, getAddress, isAddress } from 'utils/ethersV6Compat';
import { getContractType } from 'utils/validations';

export type EvmCallBlacklistTargetType =
  | 'approval'
  | 'recipient'
  | 'target'
  | 'token-recipient';

export interface IEvmCallBlacklistTarget {
  address: string;
  method?: string;
  type: EvmCallBlacklistTargetType;
}

const normalizeAddress = (address?: string | null): string | null => {
  if (!address) return null;
  if (isAddress(address)) return getAddress(address);
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return getAddress(address.toLowerCase());
  }
  return null;
};

const isZeroIntegerValue = (value: unknown): boolean =>
  value !== null && value !== undefined && value.toString() === '0';

export const shouldResolveEvmCallBlacklistContractType = (data?: string) =>
  data?.slice(0, 10).toLowerCase() === '0x095ea7b3';

const decodeAddressTargets = (
  data?: string,
  tokenStandard?: string
): IEvmCallBlacklistTarget[] => {
  if (!data || data === '0x' || data.length < 10) return [];

  const selector = data.slice(0, 10).toLowerCase();
  const calldata = `0x${data.slice(10)}`;

  try {
    switch (selector) {
      case '0x095ea7b3': {
        const [spender, amount] = defaultAbiCoder.decode(
          ['address', 'uint256'],
          calldata
        );
        if (tokenStandard === 'ERC-20' && isZeroIntegerValue(amount)) {
          return [];
        }
        return [
          { address: getAddress(spender), method: 'approve', type: 'approval' },
        ];
      }
      case '0x39509351': {
        const [spender, addedValue] = defaultAbiCoder.decode(
          ['address', 'uint256'],
          calldata
        );
        if (isZeroIntegerValue(addedValue)) return [];
        return [
          {
            address: getAddress(spender),
            method: 'increaseAllowance',
            type: 'approval',
          },
        ];
      }
      case '0xa457c2d7': {
        return [];
      }
      case '0xa22cb465': {
        const [operator, approved] = defaultAbiCoder.decode(
          ['address', 'bool'],
          calldata
        );
        return approved
          ? [
              {
                address: getAddress(operator),
                method: 'setApprovalForAll',
                type: 'approval',
              },
            ]
          : [];
      }
      case '0xa9059cbb': {
        const [to] = defaultAbiCoder.decode(['address', 'uint256'], calldata);
        return [
          {
            address: getAddress(to),
            method: 'transfer',
            type: 'token-recipient',
          },
        ];
      }
      case '0x23b872dd': {
        const [, to] = defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          calldata
        );
        return [
          {
            address: getAddress(to),
            method: 'transferFrom',
            type: 'token-recipient',
          },
        ];
      }
      case '0x42842e0e': {
        const [, to] = defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          calldata
        );
        return [
          {
            address: getAddress(to),
            method: 'safeTransferFrom',
            type: 'token-recipient',
          },
        ];
      }
      case '0xb88d4fde': {
        const [, to] = defaultAbiCoder.decode(
          ['address', 'address', 'uint256', 'bytes'],
          calldata
        );
        return [
          {
            address: getAddress(to),
            method: 'safeTransferFrom',
            type: 'token-recipient',
          },
        ];
      }
      case '0xf242432a': {
        const [, to] = defaultAbiCoder.decode(
          ['address', 'address', 'uint256', 'uint256', 'bytes'],
          calldata
        );
        return [
          {
            address: getAddress(to),
            method: 'safeTransferFrom',
            type: 'token-recipient',
          },
        ];
      }
      case '0x2eb2c2d6': {
        const [, to] = defaultAbiCoder.decode(
          ['address', 'address', 'uint256[]', 'uint256[]', 'bytes'],
          calldata
        );
        return [
          {
            address: getAddress(to),
            method: 'safeBatchTransferFrom',
            type: 'token-recipient',
          },
        ];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
};

export const getBlacklistTargetsForEvmCall = ({
  data,
  tokenStandard,
  to,
}: {
  data?: string;
  to?: string;
  tokenStandard?: string;
}): IEvmCallBlacklistTarget[] => {
  const targets = decodeAddressTargets(data, tokenStandard);
  const normalizedTo = normalizeAddress(to);

  if (normalizedTo) {
    targets.unshift({ address: normalizedTo, type: 'target' });
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.type}:${target.address.toLowerCase()}:${
      target.method ?? ''
    }`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const getBlacklistTargetsForEvmCallWithContractType = async ({
  controller,
  data,
  to,
  web3Provider,
}: {
  controller?: any;
  data?: string;
  to?: string;
  web3Provider?: any;
}): Promise<IEvmCallBlacklistTarget[]> => {
  let tokenStandard: string | undefined;

  if (to && web3Provider && shouldResolveEvmCallBlacklistContractType(data)) {
    try {
      tokenStandard = (await getContractType(to, web3Provider, controller))
        ?.type;
    } catch {
      tokenStandard = undefined;
    }
  }

  return getBlacklistTargetsForEvmCall({
    data,
    to,
    tokenStandard,
  });
};
