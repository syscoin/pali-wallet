import { AbiCoder } from 'ethers/abi';
import { Contract } from 'ethers/contract';
import { hexlify, isCallException, isHexString } from 'ethers/utils';

type ContractRunner = NonNullable<Contract['runner']>;
export type NftReadRunner = Required<Pick<ContractRunner, 'call'>> &
  Pick<ContractRunner, 'resolveName'>;

const MAX_REVERT_HEX_LENGTH = 2 + 4096 * 2;

/** Normalize an explicit raw eth_call execution revert for the ethers ABI. */
export function normalizeNftExecutionRevert(
  error: unknown,
  tx: Parameters<NftReadRunner['call']>[0]
): Error | undefined {
  if (
    error === null ||
    typeof error !== 'object' ||
    !('code' in error) ||
    (error.code !== 3 && error.code !== -32000) ||
    !('message' in error) ||
    typeof error.message !== 'string' ||
    !/^execution reverted(?:$|:)/i.test(error.message) ||
    !('data' in error) ||
    typeof error.data !== 'string' ||
    error.data.length > MAX_REVERT_HEX_LENGTH ||
    !isHexString(error.data, true) ||
    typeof tx.to !== 'string' ||
    typeof tx.data !== 'string'
  ) {
    return undefined;
  }
  return AbiCoder.getBuiltinCallException(
    'call',
    { to: tx.to, data: tx.data },
    error.data
  );
}

const readContract = (address: string, abi: string[], runner: NftReadRunner) =>
  new Contract(address, abi, {
    provider: null,
    async call(tx) {
      try {
        return await runner.call(tx);
      } catch (error) {
        // CustomJsonRpcProvider preserves RPC code and data on plain Errors.
        throw normalizeNftExecutionRevert(error, tx) ?? error;
      }
    },
    resolveName: runner.resolveName?.bind(runner),
  });

// ERC-721 ABI fragments
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];

// ERC-1155 ABI fragments (standard functions only)
const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
];

// Interface IDs
const INTERFACE_ID_ERC721_ENUMERABLE = '0x780e9d63';

const isExplicitOwnerOfRevert = (error: unknown): boolean => {
  // Ethers also labels RPC errors without revert evidence CALL_EXCEPTION.
  if (
    !isCallException(error) ||
    error.action !== 'call' ||
    error.invocation?.signature !== 'ownerOf(uint256)' ||
    typeof error.data !== 'string'
  ) {
    return false;
  }
  if (error.data === '0x') return true;
  if (error.data.length % 64 !== 10) return false;
  const selector = error.data.slice(0, 10);
  if (selector === '0x08c379a0')
    return error.revert?.signature === 'Error(string)';
  return selector !== '0x4e487b71'; // Panic(uint256)
};

/** Require a usable negative response from an independent token ID. */
async function hasNegativeNftProbe(
  contract: Contract,
  tokenStandard: 'ERC-721' | 'ERC-1155',
  ownerAddress: string,
  tokenIds: string[]
): Promise<boolean> {
  let invalidTokenId: string | undefined;
  try {
    const requested = new Set(tokenIds.map((id) => BigInt(id).toString()));
    // Every fixed uint256 is a legal NFT ID. Use fresh entropy, excluding the
    // requested holdings, as a negative probe; this remains a heuristic only.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const candidate = BigInt(hexlify(bytes)).toString();
      if (!requested.has(candidate)) {
        invalidTokenId = candidate;
        break;
      }
    }
  } catch {
    // Without a usable independent probe, do not claim verified ownership.
    return false;
  }
  if (invalidTokenId === undefined) return false;
  try {
    if (tokenStandard === 'ERC-1155') {
      return (
        (await contract.balanceOf!(ownerAddress, invalidTokenId)) === BigInt(0)
      );
    }
    await contract.ownerOf!(invalidTokenId);
    return false;
  } catch (error) {
    return tokenStandard === 'ERC-721' && isExplicitOwnerOfRevert(error);
  }
}

export interface INftTokenInfo {
  balance: number; // Display balance (decimals already applied, 0 for NFTs)
  rawBalance?: string; // Exact raw balance for ERC-1155 quantities
  tokenId: string;
  verified: boolean;
}

const unverifiedHoldings = (tokenIds: string[]): INftTokenInfo[] =>
  tokenIds.map((tokenId) => ({ tokenId, balance: 0, verified: false }));

const verifiedErc1155Holding = (
  tokenId: string,
  balance: bigint
): INftTokenInfo => ({
  tokenId,
  balance: Math.min(Number(balance), Number.MAX_SAFE_INTEGER),
  rawBalance: balance.toString(),
  verified: true,
});

/**
 * Check if a contract supports a specific interface
 */
async function supportsInterface(
  contract: Contract,
  interfaceId: string
): Promise<boolean> {
  try {
    return await contract.supportsInterface!(interfaceId);
  } catch {
    return false;
  }
}

/**
 * Verify ownership of specific ERC-721 tokens
 */
export async function verifyERC721OwnershipHelper(
  contractAddress: string,
  ownerAddress: string,
  tokenIds: string[],
  runner: NftReadRunner
): Promise<INftTokenInfo[]> {
  try {
    const contract = readContract(contractAddress, ERC721_ABI, runner);

    if (
      !(await hasNegativeNftProbe(contract, 'ERC-721', ownerAddress, tokenIds))
    ) {
      return unverifiedHoldings(tokenIds);
    }

    const results: INftTokenInfo[] = [];

    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      const promises = batch.map(async (tokenId) => {
        try {
          const owner = await contract.ownerOf!(tokenId);
          return {
            tokenId,
            isOwner: owner.toLowerCase() === ownerAddress.toLowerCase(),
            verified: true,
          };
        } catch {
          // A reverted, unavailable or malformed read does not attest ownership.
          return {
            tokenId,
            isOwner: false,
            verified: false,
          };
        }
      });

      const batchResults = await Promise.all(promises);

      batchResults.forEach((result) => {
        results.push({
          tokenId: result.tokenId,
          balance: result.isOwner ? 1 : 0,
          verified: result.verified,
        });
      });
    }

    return results;
  } catch {
    console.error('[NFT Utils] ERC-721 ownership check failed');
    return unverifiedHoldings(tokenIds);
  }
}

/**
 * Verify ownership of specific ERC-1155 tokens
 */
export async function verifyERC1155OwnershipHelper(
  contractAddress: string,
  ownerAddress: string,
  tokenIds: string[],
  runner: NftReadRunner
): Promise<INftTokenInfo[]> {
  try {
    const contract = readContract(contractAddress, ERC1155_ABI, runner);

    if (
      !(await hasNegativeNftProbe(contract, 'ERC-1155', ownerAddress, tokenIds))
    ) {
      return unverifiedHoldings(tokenIds);
    }

    try {
      const accounts = new Array(tokenIds.length).fill(ownerAddress);
      const balances = await contract.balanceOfBatch!(accounts, tokenIds);
      if (balances.length !== tokenIds.length) {
        throw new Error('Invalid ERC-1155 batch balance length');
      }

      return tokenIds.map((tokenId, index) =>
        verifiedErc1155Holding(tokenId, balances[index])
      );
    } catch {
      console.error('[NFT Utils] ERC-1155 batch balance read failed');
    }

    // Only a failed batch after the negative probe can fall back.
    const results: INftTokenInfo[] = [];
    for (const tokenId of tokenIds) {
      try {
        const balance = await contract.balanceOf!(ownerAddress, tokenId);
        results.push(verifiedErc1155Holding(tokenId, balance));
      } catch {
        results.push({ tokenId, balance: 0, verified: false });
      }
    }
    return results;
  } catch {
    console.error('[NFT Utils] ERC-1155 ownership check failed');
    return unverifiedHoldings(tokenIds);
  }
}

/**
 * Try to discover NFT tokens using various methods
 * Limited to first 10 tokens to avoid performance issues
 */
export async function discoverNftTokens(
  contractAddress: string,
  ownerAddress: string,
  tokenStandard: 'ERC-721' | 'ERC-1155',
  runner: NftReadRunner
): Promise<{
  hasMore?: boolean;
  method: 'enumeration' | 'manual' | 'api';
  requiresManualEntry: boolean;
  tokens?: INftTokenInfo[];
}> {
  // For ERC-721, try enumeration first
  if (tokenStandard === 'ERC-721') {
    try {
      const contract = readContract(contractAddress, ERC721_ABI, runner);

      // Check if contract supports enumeration
      const isEnumerable = await supportsInterface(
        contract,
        INTERFACE_ID_ERC721_ENUMERABLE
      );
      if (isEnumerable) {
        // Get balance first
        const balance = await contract.balanceOf!(ownerAddress);
        const tokenCount = Number(balance);

        if (tokenCount === 0) {
          return {
            method: 'enumeration',
            tokens: [],
            requiresManualEntry: true, // Still allow manual entry
          };
        }

        // Limit to first 10 tokens
        const limit = Math.min(tokenCount, 10);
        const tokens: INftTokenInfo[] = [];

        // Fetch tokens in parallel (up to limit)
        const promises = [];
        for (let i = 0; i < limit; i++) {
          promises.push(contract.tokenOfOwnerByIndex!(ownerAddress, i));
        }

        const tokenIds = await Promise.all(promises);
        tokenIds.forEach((tokenId) => {
          tokens.push({
            tokenId: tokenId.toString(),
            balance: 1, // ERC-721 tokens always have balance of 1
            verified: true,
          });
        });

        console.log(
          `[NFT Utils] Enumerated ${tokens.length} of ${tokenCount} ERC-721 tokens`
        );

        return {
          method: 'enumeration',
          tokens,
          requiresManualEntry: true, // Always allow manual entry
          hasMore: tokenCount > limit,
        };
      }
    } catch {
      console.error('[NFT Utils] ERC-721 enumeration failed');
    }
  }

  // ERC-1155 does NOT support enumeration in the standard
  // The core ERC-1155 standard only provides:
  // - balanceOf(address account, uint256 id) - requires knowing the token ID
  // - balanceOfBatch() - for multiple known token IDs
  //
  // There is no standard way to enumerate owned token IDs
  console.log(
    `[NFT Utils] ${tokenStandard} requires manual token ID entry - no standard enumeration available`
  );

  return {
    method: 'manual',
    tokens: [],
    requiresManualEntry: true,
  };
}
