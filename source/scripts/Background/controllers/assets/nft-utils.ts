import { Contract } from '@ethersproject/contracts';
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

// ERC-721 ABI fragments
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];

// ERC-1155 ABI fragments (standard functions only)
const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
];

// Interface IDs
const INTERFACE_ID_ERC721_ENUMERABLE = '0x780e9d63';

/**
 * Detect fake NFT contracts by testing with invalid token ID
 * Fake contracts often return positive balances for any token ID
 */
async function detectFakeNftContract(
  contract: Contract,
  tokenStandard: 'ERC-721' | 'ERC-1155',
  ownerAddress: string
): Promise<boolean> {
  try {
    // Use a random high token ID that shouldn't exist
    const invalidTokenId = '999999999999999999999999999999';

    let balance: any;
    if (tokenStandard === 'ERC-721') {
      // For ERC-721, try ownerOf first (should throw for non-existent tokens)
      try {
        await contract.ownerOf(invalidTokenId);
        // If ownerOf doesn't throw, this token ID exists (suspicious)
        return true;
      } catch {
        // Good - token doesn't exist, contract behaves normally
        return false;
      }
    } else {
      // For ERC-1155, check balance of invalid token ID
      balance = await contract.balanceOf(ownerAddress, invalidTokenId);
      return Number(balance) > 0; // If balance > 0 for invalid ID, it's fake
    }
  } catch {
    // If validation fails, assume contract is legitimate
    return false;
  }
}

export interface INftTokenInfo {
  balance: number; // Display balance (decimals already applied, 0 for NFTs)
  tokenId: string;
  verified: boolean;
}

/**
 * Check if a contract supports a specific interface
 */
async function supportsInterface(
  contract: Contract,
  interfaceId: string
): Promise<boolean> {
  try {
    return await contract.supportsInterface(interfaceId);
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
  provider: CustomJsonRpcProvider
): Promise<INftTokenInfo[]> {
  try {
    const contract = new Contract(contractAddress, ERC721_ABI, provider);

    // Check if this is a fake contract first
    const isFake = await detectFakeNftContract(
      contract,
      'ERC-721',
      ownerAddress
    );
    if (isFake) {
      console.warn(
        `[NFT Utils] Detected fake ERC-721 contract: ${contractAddress}`
      );
      return tokenIds.map((tokenId) => ({
        tokenId,
        balance: 0,
        verified: false,
      }));
    }

    const results: INftTokenInfo[] = [];

    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      const promises = batch.map(async (tokenId) => {
        try {
          const owner = await contract.ownerOf(tokenId);
          return {
            tokenId,
            isOwner: owner.toLowerCase() === ownerAddress.toLowerCase(),
          };
        } catch {
          // Token doesn't exist or other error
          return {
            tokenId,
            isOwner: false,
          };
        }
      });

      const batchResults = await Promise.all(promises);

      batchResults.forEach((result) => {
        results.push({
          tokenId: result.tokenId,
          balance: result.isOwner ? 1 : 0,
          verified: true,
        });
      });
    }

    return results;
  } catch (error) {
    console.error('[NFT Utils] Error verifying ERC-721 ownership:', error);
    return tokenIds.map((tokenId) => ({
      tokenId,
      balance: 0,
      verified: false,
    }));
  }
}

/**
 * Verify ownership of specific ERC-1155 tokens
 */
export async function verifyERC1155OwnershipHelper(
  contractAddress: string,
  ownerAddress: string,
  tokenIds: string[],
  provider: CustomJsonRpcProvider
): Promise<INftTokenInfo[]> {
  try {
    const contract = new Contract(contractAddress, ERC1155_ABI, provider);

    // Check if this is a fake contract first
    const isFake = await detectFakeNftContract(
      contract,
      'ERC-1155',
      ownerAddress
    );
    if (isFake) {
      console.warn(
        `[NFT Utils] Detected fake ERC-1155 contract: ${contractAddress}`
      );
      return tokenIds.map((tokenId) => ({
        tokenId,
        balance: 0,
        verified: false,
      }));
    }

    // Use balanceOfBatch for efficiency
    const accounts = new Array(tokenIds.length).fill(ownerAddress);
    const balances = await contract.balanceOfBatch(accounts, tokenIds);

    return tokenIds.map((tokenId, index) => {
      // ERC-1155 NFTs have 0 decimals, so display balance = raw balance
      // Use toNumber() safely, checking for overflow
      const balance = balances[index];
      const displayBalance = balance.lte(Number.MAX_SAFE_INTEGER)
        ? balance.toNumber()
        : Number.MAX_SAFE_INTEGER; // Cap at max safe integer for display

      return {
        tokenId,
        balance: displayBalance,
        verified: true,
      };
    });
  } catch (error) {
    console.error('[NFT Utils] Error verifying ERC-1155 ownership:', error);

    // Fallback to individual calls
    try {
      const contract = new Contract(contractAddress, ERC1155_ABI, provider);
      const results: INftTokenInfo[] = [];
      for (const tokenId of tokenIds) {
        try {
          const balance = await contract.balanceOf(ownerAddress, tokenId);
          // Safe conversion to number for display
          const displayBalance = balance.lte(Number.MAX_SAFE_INTEGER)
            ? balance.toNumber()
            : Number.MAX_SAFE_INTEGER;

          results.push({
            tokenId,
            balance: displayBalance,
            verified: true,
          });
        } catch {
          results.push({
            tokenId,
            balance: 0,
            verified: false,
          });
        }
      }
      return results;
    } catch {
      return tokenIds.map((tokenId) => ({
        tokenId,
        balance: 0,
        verified: false,
      }));
    }
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
  provider: CustomJsonRpcProvider
): Promise<{
  hasMore?: boolean;
  method: 'enumeration' | 'manual' | 'api';
  requiresManualEntry: boolean;
  tokens?: INftTokenInfo[];
}> {
  // For ERC-721, try enumeration first
  if (tokenStandard === 'ERC-721') {
    try {
      const contract = new Contract(contractAddress, ERC721_ABI, provider);

      // Check if contract supports enumeration
      const isEnumerable = await supportsInterface(
        contract,
        INTERFACE_ID_ERC721_ENUMERABLE
      );
      if (isEnumerable) {
        // Get balance first
        const balance = await contract.balanceOf(ownerAddress);
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
          promises.push(contract.tokenOfOwnerByIndex(ownerAddress, i));
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
    } catch (error) {
      console.error('[NFT Utils] ERC-721 enumeration failed:', error);
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

/**
 * Parse user input for token IDs
 * Supports formats: "1", "1,2,3", "1-5", "1,3-5,10"
 */
export function parseTokenIdInput(input: string): string[] {
  const tokenIds: Set<string> = new Set();

  // Remove whitespace and split by comma
  const parts = input.replace(/\s/g, '').split(',');

  for (const part of parts) {
    if (part.includes('-')) {
      // Handle range
      const [start, end] = part.split('-').map((n) => parseInt(n));
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          tokenIds.add(i.toString());
        }
      }
    } else {
      // Handle single number
      const num = parseInt(part);
      if (!isNaN(num)) {
        tokenIds.add(num.toString());
      }
    }
  }

  return Array.from(tokenIds);
}
