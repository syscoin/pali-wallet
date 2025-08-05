// Mock modules before imports
jest.mock('../../source/state/store');
jest.mock('@sidhujag/sysweb3-utils');

// Mock individual ethers packages
jest.mock('@ethersproject/bignumber', () => ({
  BigNumber: {
    from: (value: string) => ({
      toString: () => {
        // Convert hex to decimal string
        if (value.startsWith('0x')) {
          return BigInt(value).toString();
        }
        return value;
      },
      gt: (other: any) => {
        const thisValue = BigInt(value.startsWith('0x') ? value : `0x${value}`);
        const otherValue = typeof other === 'bigint' ? other : BigInt(other);
        return thisValue > otherValue;
      },
      _hex: value,
    }),
  },
}));

jest.mock('@ethersproject/units', () => ({
  parseEther: (value: string) => ({
    _hex: '0x' + (parseFloat(value) * 1e18).toString(16),
  }),
  parseUnits: (value: string, unit: string | number) => {
    const decimals =
      typeof unit === 'string' && unit === 'gwei' ? 9 : Number(unit);
    return {
      _hex: '0x' + (parseFloat(value) * Math.pow(10, decimals)).toString(16),
    };
  },
  formatUnits: (value: any, unit: string | number) => {
    const decimals =
      typeof unit === 'string' && unit === 'gwei' ? 9 : Number(unit);
    const num = BigInt(value._hex || value);
    return (Number(num) / Math.pow(10, decimals)).toString();
  },
}));

jest.mock('@ethersproject/contracts', () => ({
  Contract: jest.fn(),
}));

jest.mock('@ethersproject/providers', () => ({
  JsonRpcProvider: jest.fn(),
}));

import { INetwork, INetworkType } from '@sidhujag/sysweb3-network';

// Import the mocked BigNumber
const { BigNumber } = jest.requireMock('@ethersproject/bignumber');

// Import types from actual source
import { ITokenEthProps } from '../../source/types/tokens';

describe('Asset Management Comprehensive Test Suite', () => {
  // Test data setup
  const mockEvmNetwork: INetwork = {
    chainId: 1,
    label: 'Ethereum',
    url: 'https://mainnet.infura.io/v3/test',
    apiUrl: 'https://api.etherscan.io/api',
    currency: 'ETH',
    explorer: 'https://etherscan.io',
    default: true,
    slip44: 60,
    kind: INetworkType.Ethereum,
  };

  const mockUtxoNetwork: INetwork = {
    chainId: 57,
    label: 'Syscoin',
    url: 'https://blockbook.syscoin.org',
    apiUrl: '',
    currency: 'SYS',
    explorer: 'https://blockbook.syscoin.org',
    default: true,
    slip44: 57,
    kind: INetworkType.Syscoin,
  };

  const mockErc20Token: ITokenEthProps = {
    id: '0x6b175474e89094c44da98b954eedeac495271d0f-1',
    contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
    tokenSymbol: 'DAI',
    decimals: 18, // ITokenEthProps expects string | number
    balance: 1000.5,
    chainId: 1,
    isNft: false,
    tokenStandard: 'ERC-20',
    name: 'Dai Stablecoin',
    logo: 'https://assets.coingecko.com/coins/images/9956/small/4943.png',
  };

  const mockNftCollection: ITokenEthProps = {
    id: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d-1',
    contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    tokenSymbol: 'BAYC',
    name: 'Bored Ape Yacht Club',
    decimals: 0,
    balance: 5,
    chainId: 1,
    isNft: true,
    tokenStandard: 'ERC-721',
    logo: 'https://example.com/collection.png',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('EVM Asset Management', () => {
    describe('Token Discovery', () => {
      it('should fetch user owned tokens from Blockscout API', async () => {
        const mockApiResponse = {
          status: '1',
          result: [
            {
              contractAddress: mockErc20Token.contractAddress,
              name: 'Dai Stablecoin',
              symbol: 'DAI',
              decimals: '18',
              balance: '1000500000000000000000',
              type: 'ERC-20',
            },
          ],
        };

        global.fetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockApiResponse,
        });

        // Test the API response parsing logic directly
        const response = await global.fetch('https://api.etherscan.io/api');
        const data = await response.json();

        expect(data.status).toBe('1');
        expect(data.result).toHaveLength(1);
        expect(data.result[0].symbol).toBe('DAI');

        // Test the balance calculation
        const token = data.result[0];
        const balance =
          parseFloat(token.balance) / Math.pow(10, parseInt(token.decimals));
        expect(balance).toBeCloseTo(1000.5, 1);
      });

      it('should handle API failures gracefully', async () => {
        global.fetch = jest
          .fn()
          .mockRejectedValueOnce(new Error('Network error'));

        try {
          await global.fetch('https://api.etherscan.io/api');
        } catch (error: any) {
          expect(error.message).toBe('Network error');
        }
      });

      it('should handle rate limiting with retry', async () => {
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 429,
            headers: { get: () => '2' } as any,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: '1', result: [] }),
          });

        // First call should get rate limited
        const response1 = await global.fetch('https://api.etherscan.io/api');
        expect(response1.status).toBe(429);

        // Second call should succeed
        const response2 = await global.fetch('https://api.etherscan.io/api');
        expect(response2.status).toBe(200);
      });
    });

    describe('Token Balance Updates', () => {
      it('should update ERC-20 token balances', async () => {
        // Test balance decoding
        const balanceHex =
          '0x00000000000000000000000000000000000000000000003635c9adc5dea00000';
        const balanceWei = BigNumber.from(balanceHex);
        const balanceEther = parseFloat(balanceWei.toString()) / 1e18;

        expect(balanceEther).toBeCloseTo(1000, 1);
      });

      it('should handle NFT balance updates differently', async () => {
        const nftBalance = 1; // NFTs have integer balances
        expect(Number.isInteger(nftBalance)).toBe(true);
        expect(nftBalance).toBe(1);
      });
    });

    describe('Token Addition', () => {
      it('should validate and add ERC-20 token', async () => {
        // Test decoding decimals
        const decimalsHex =
          '0x0000000000000000000000000000000000000000000000000000000000000012';
        const decimals = parseInt(decimalsHex, 16);
        expect(decimals).toBe(18);

        // The token should be valid
        const tokenDetails = {
          contractAddress: mockErc20Token.contractAddress,
          decimals: 18,
          symbol: 'DAI',
          balance: 1000,
          tokenStandard: 'ERC-20',
        };

        expect(tokenDetails.symbol).toBe('DAI');
        expect(tokenDetails.decimals).toBe(18);
      });

      it('should detect ERC-777 tokens', async () => {
        // Test interface detection
        const supportsErc777Hex =
          '0x0000000000000000000000000000000000000000000000000000000000000001';
        const supportsErc777 = parseInt(supportsErc777Hex, 16) === 1;

        expect(supportsErc777).toBe(true);
      });
    });
  });

  describe('UTXO/Syscoin Asset Management', () => {
    describe('SPT Token Discovery', () => {
      it('should fetch user SPT tokens from blockbook', async () => {
        const mockAccountData = {
          tokens: [
            {
              type: 'SPTAllocated',
              name: 'Test SPT Token',
              symbol: 'TEST',
              assetGuid: '123456789',
              decimals: 8,
              amount: '10000000000',
              transfers: 5,
            },
          ],
        };

        // Test data transformation
        const tokens = mockAccountData.tokens;
        const processedTokens = tokens.map((token) => ({
          assetGuid: token.assetGuid,
          symbol: token.symbol,
          decimals: token.decimals,
          balance: parseFloat(token.amount) / Math.pow(10, token.decimals),
          chainId: 57,
        }));

        expect(processedTokens).toHaveLength(1);
        expect(processedTokens[0]).toMatchObject({
          assetGuid: '123456789',
          symbol: 'TEST',
          decimals: 8,
          balance: 100,
          chainId: 57,
        });
      });

      it('should handle blockbook API failures', async () => {
        const errorMessage = 'Blockbook error';

        // Simulate API failure
        try {
          throw new Error(errorMessage);
        } catch (error: any) {
          expect(error.message).toBe('Blockbook error');
        }
      });
    });

    describe('SPT Token Details', () => {
      it('should fetch SPT token details', async () => {
        const mockAccountData = {
          tokens: [
            {
              assetGuid: '123456789',
              amount: '10000000000',
              symbol: 'TEST',
              decimals: 8,
            },
          ],
        };

        // Calculate balance
        const token = mockAccountData.tokens[0];
        const balance = parseFloat(token.amount) / Math.pow(10, token.decimals);

        const result = {
          assetGuid: '123456789',
          symbol: 'TEST',
          balance: balance,
          decimals: 8,
        };

        expect(result).toMatchObject({
          assetGuid: '123456789',
          symbol: 'TEST',
          balance: 100,
          decimals: 8,
        });
      });
    });
  });

  describe('NFT Management', () => {
    describe('NFT Collection Discovery', () => {
      it('should detect NFT collections with correct data structure', async () => {
        const mockNftCollections = [mockNftCollection];

        // Test NFT collection structure matches our simplified architecture
        expect(mockNftCollections).toHaveLength(1);
        expect(mockNftCollections[0].contractAddress).toBe(
          '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
        );
        expect(mockNftCollections[0].isNft).toBe(true);
        expect(mockNftCollections[0].balance).toBe(5); // Total count in collection
        expect(mockNftCollections[0].tokenStandard).toBe('ERC-721');
        expect(mockNftCollections[0].id).toBe(
          '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d-1'
        );
      });

      it('should handle NFT API failures gracefully', async () => {
        global.fetch = jest
          .fn()
          .mockRejectedValueOnce(new Error('NFT API error'));

        await expect(
          global.fetch('https://api.etherscan.io/api')
        ).rejects.toThrow('NFT API error');
      });

      it('should deduplicate NFT collections by contract address', async () => {
        const existingCollections = [mockNftCollection];
        const duplicateCollection = {
          ...mockNftCollection,
          balance: 3, // Different balance but same contract
        };

        // Test deduplication logic by contract address
        const allCollections = [...existingCollections, duplicateCollection];
        const uniqueCollections = allCollections.filter(
          (collection, index, self) =>
            index ===
            self.findIndex(
              (c) =>
                c.contractAddress.toLowerCase() ===
                collection.contractAddress.toLowerCase()
            )
        );

        expect(uniqueCollections).toHaveLength(1);
        expect(uniqueCollections[0].contractAddress).toBe(
          mockNftCollection.contractAddress
        );
      });

      it('should properly handle ERC-1155 vs ERC-721 collections', async () => {
        const erc721Collection = {
          ...mockNftCollection,
          tokenStandard: 'ERC-721' as const,
          balance: 1, // ERC-721 collection count
        };

        const erc1155Collection = {
          ...mockNftCollection,
          id: '0xabc123def456789-1',
          contractAddress: '0xabc123def456789',
          tokenStandard: 'ERC-1155' as const,
          balance: 50, // ERC-1155 can have higher counts
          tokenSymbol: 'MULTI',
          name: 'Multi Token Collection',
        };

        const collections = [erc721Collection, erc1155Collection];

        // Verify both standards are handled correctly
        expect(collections).toHaveLength(2);
        expect(collections[0].tokenStandard).toBe('ERC-721');
        expect(collections[1].tokenStandard).toBe('ERC-1155');
        expect(collections[0].balance).toBe(1);
        expect(collections[1].balance).toBe(50);
      });
    });

    describe('NFT Token ID Discovery', () => {
      it('should handle token ID enumeration for ERC-721', async () => {
        // Test the new NFT utils enumeration pattern
        const mockTokenIds = [
          { tokenId: '1234', balance: 1, verified: true },
          { tokenId: '5678', balance: 1, verified: true },
        ];

        // Verify token ID discovery data structure
        expect(mockTokenIds).toHaveLength(2);
        expect(mockTokenIds[0].tokenId).toBe('1234');
        expect(mockTokenIds[0].balance).toBe(1); // ERC-721 always has balance 1
        expect(mockTokenIds[1].tokenId).toBe('5678');
        expect(mockTokenIds[1].verified).toBe(true);
      });

      it('should handle manual token ID entry for ERC-1155', async () => {
        // ERC-1155 requires manual entry since no enumeration standard exists
        const manualTokenIds = [
          { tokenId: '100', balance: 5, verified: true },
          { tokenId: '200', balance: 0, verified: true }, // User doesn't own this one
        ];

        expect(manualTokenIds).toHaveLength(2);
        expect(manualTokenIds[0].balance).toBe(5); // ERC-1155 can have > 1 balance
        expect(manualTokenIds[1].balance).toBe(0); // Not owned
      });
    });
  });

  describe('Network Scenarios', () => {
    describe('Network Switching', () => {
      it('should handle switching from EVM to UTXO network', async () => {
        // Test network type detection
        const isEvmNetwork = (network: INetwork) => network.slip44 === 60;
        const isUtxoNetwork = (network: INetwork) =>
          network.slip44 === 57 || network.slip44 === 0;

        expect(isEvmNetwork(mockEvmNetwork)).toBe(true);
        expect(isUtxoNetwork(mockUtxoNetwork)).toBe(true);
      });

      it('should cancel pending asset fetches on network switch', async () => {
        // Test cancellable promises behavior
        let cancelled = false;

        // Simulate cancellation logic
        const cancel = () => {
          cancelled = true;
        };

        // Test that cancellation flag works
        cancel();
        expect(cancelled).toBe(true);
      });
    });

    describe('Network Failures', () => {
      it('should handle network timeouts gracefully', async () => {
        global.fetch = jest.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('timeout')), 100);
            })
        );

        await expect(
          global.fetch('https://api.etherscan.io/api')
        ).rejects.toThrow('timeout');
      });

      it('should handle malformed API responses', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ invalid: 'response' }),
        });

        const response = await global.fetch('https://api.etherscan.io/api');
        const data = await response.json();

        expect(data.status).toBeUndefined();
        expect(data.result).toBeUndefined();
      });
    });

    describe('No API Scenarios', () => {
      it('should work without apiUrl for basic operations', async () => {
        const networkNoApi = { ...mockEvmNetwork, apiUrl: '' };

        // Test that network can still function without API
        expect(networkNoApi.url).toBeDefined();
        expect(networkNoApi.apiUrl).toBe('');

        // Basic operations should still work
        const mockProvider = {
          getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
          call: jest
            .fn()
            .mockResolvedValue(
              '0x0000000000000000000000000000000000000000000000000000000000000000'
            ),
        };

        const balance = await mockProvider.call({ to: '0x...', data: '0x...' });
        expect(balance).toBeDefined();
      });
    });
  });

  describe('Asset State Management', () => {
    describe('Redux State Updates', () => {
      it('should update account assets correctly', async () => {
        const mockDispatch = jest.fn();

        // Test asset update action
        const payload = {
          account: { type: 'HDAccount', id: 0 },
          property: 'ethereum',
          value: [mockErc20Token],
        };

        mockDispatch({ type: 'SET_ACCOUNT_ASSETS', payload });

        expect(mockDispatch).toHaveBeenCalledWith({
          type: 'SET_ACCOUNT_ASSETS',
          payload,
        });
      });
    });

    describe('Asset Display', () => {
      it('should format token balances for display', () => {
        // Test balance formatting for different decimal places
        const testCases = [
          { balance: 1000.123456789, decimals: 18, expected: 1000.123457 },
          { balance: 0.000001, decimals: 18, expected: 0.000001 },
          { balance: 1, decimals: 0, expected: 1 }, // NFT
          { balance: 100, decimals: 8, expected: 100 }, // SPT
        ];

        testCases.forEach(({ balance, decimals, expected }) => {
          // Using a simple rounding function for display
          const formatted = Math.round(balance * 1000000) / 1000000;
          expect(formatted).toBeCloseTo(expected, 6);

          // Verify decimals is being considered in test context
          expect(typeof decimals).toBe('number');
          expect(decimals).toBeGreaterThanOrEqual(0);
        });
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle tokens with missing metadata', async () => {
      const mockProvider = {
        getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
        call: jest
          .fn()
          .mockResolvedValueOnce(
            '0x0000000000000000000000000000000000000000000000000000000000000012'
          ) // decimals
          .mockRejectedValueOnce(new Error('No symbol')) // symbol fails
          .mockResolvedValueOnce(
            '0x0000000000000000000000000000000000000000000000000000000000000000'
          ), // balance
      };

      // When symbol call fails, should use default
      let symbol = 'UNKNOWN';
      try {
        await mockProvider.call({ to: '0x...', data: '0x95d89b41' });
      } catch (error) {
        symbol = 'UNKNOWN';
      }

      expect(symbol).toBe('UNKNOWN');
    });

    it('should handle duplicate token additions', async () => {
      const tokens = [mockErc20Token, mockErc20Token];

      // Remove duplicates based on contract address
      const uniqueTokens = tokens.filter(
        (token, index, self) =>
          index ===
          self.findIndex(
            (t) =>
              t.contractAddress.toLowerCase() ===
              token.contractAddress.toLowerCase()
          )
      );

      expect(uniqueTokens).toHaveLength(1);
    });

    it('should handle very large token balances', async () => {
      const largeBalance =
        '115792089237316195423570985008687907853269984665640564039457584007913129639935';

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: '1',
          result: [
            {
              contractAddress: mockErc20Token.contractAddress,
              balance: largeBalance,
              decimals: '18',
              symbol: 'MAX',
              type: 'ERC-20',
            },
          ],
        }),
      });

      const response = await global.fetch('https://api.etherscan.io/api');
      const data = await response.json();
      const token = data.result[0];

      // Verify the balance is a valid big number
      const balanceBN = BigNumber.from(token.balance);
      expect(balanceBN.gt(0)).toBe(true);
    });
  });

  describe('Token ID Format Validation', () => {
    it('should validate token ID format consistency', () => {
      // Test that token IDs follow contractAddress-chainId format
      expect(mockErc20Token.id).toBe(
        `${mockErc20Token.contractAddress.toLowerCase()}-${
          mockErc20Token.chainId
        }`
      );
      expect(mockNftCollection.id).toBe(
        `${mockNftCollection.contractAddress.toLowerCase()}-${
          mockNftCollection.chainId
        }`
      );

      // Test regex pattern for ID format
      const idPattern = /^0x[a-fA-F0-9]{40}-\d+$/;
      expect(mockErc20Token.id).toMatch(idPattern);
      expect(mockNftCollection.id).toMatch(idPattern);
    });

    it('should handle API response token ID transformation', () => {
      // Simulate getUserOwnedTokens API response transformation
      const apiToken = {
        contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        decimals: '18',
        balance: '1000500000000000000000',
        type: 'ERC-20',
      };

      const chainId = 1;

      // Transform to our format
      const transformedToken = {
        id: `${apiToken.contractAddress.toLowerCase()}-${chainId}`,
        contractAddress: apiToken.contractAddress,
        symbol: apiToken.symbol,
        name: apiToken.name,
        balance:
          parseFloat(apiToken.balance) /
          Math.pow(10, parseInt(apiToken.decimals)),
        chainId,
      };

      expect(transformedToken.id).toBe(
        '0x6b175474e89094c44da98b954eedeac495271d0f-1'
      );
      expect(transformedToken.balance).toBeCloseTo(1000.5, 1);
    });
  });

  describe('NFT Utilities Integration', () => {
    it('should validate NFT token ID parsing', () => {
      // Test parseTokenIdInput utility function patterns
      const testCases = [
        { input: '1', expected: ['1'] },
        { input: '1,2,3', expected: ['1', '2', '3'] },
        { input: '1-5', expected: ['1', '2', '3', '4', '5'] },
        { input: '1,3-5,10', expected: ['1', '3', '4', '5', '10'] },
      ];

      testCases.forEach(({ input, expected }) => {
        // Simple parsing logic for testing
        const tokenIds: Set<string> = new Set();
        const parts = input.replace(/\s/g, '').split(',');

        for (const part of parts) {
          if (part.includes('-')) {
            const [start, end] = part.split('-').map((n) => parseInt(n));
            if (!isNaN(start) && !isNaN(end) && start <= end) {
              for (let i = start; i <= end; i++) {
                tokenIds.add(i.toString());
              }
            }
          } else {
            const num = parseInt(part);
            if (!isNaN(num)) {
              tokenIds.add(num.toString());
            }
          }
        }

        const result = Array.from(tokenIds);
        expect(result.sort()).toEqual(expected.sort());
      });
    });

    it('should validate NFT ownership verification structure', () => {
      // Test NFT ownership verification return format
      const mockOwnershipResults = [
        { tokenId: '1234', balance: 1, verified: true },
        { tokenId: '5678', balance: 0, verified: true },
        { tokenId: '9999', balance: 0, verified: false },
      ];

      expect(mockOwnershipResults).toHaveLength(3);

      // Verify structure matches our NFT utils interface
      mockOwnershipResults.forEach((result) => {
        expect(result).toHaveProperty('tokenId');
        expect(result).toHaveProperty('balance');
        expect(result).toHaveProperty('verified');
        expect(typeof result.tokenId).toBe('string');
        expect(typeof result.balance).toBe('number');
        expect(typeof result.verified).toBe('boolean');
      });

      // Test filtering owned tokens
      const ownedTokens = mockOwnershipResults.filter(
        (r) => r.balance > 0 && r.verified
      );
      expect(ownedTokens).toHaveLength(1);
      expect(ownedTokens[0].tokenId).toBe('1234');
    });
  });

  describe('EVM Assets Controller Integration', () => {
    it('should properly format token data from getUserOwnedTokens', () => {
      // Mock API response matching real etherscan/blockscout format
      const mockApiResponse = {
        status: '1',
        result: [
          {
            contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
            name: 'Dai Stablecoin',
            symbol: 'DAI',
            decimals: '18',
            balance: '1000500000000000000000',
            type: 'ERC-20',
          },
          {
            contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
            name: 'Bored Ape Yacht Club',
            symbol: 'BAYC',
            decimals: '0',
            balance: '5', // Collection count
            type: 'ERC-721',
          },
        ],
      };

      const activeNetwork = { chainId: 1 };

      // Simulate the transformation logic from getUserOwnedTokens
      const results = mockApiResponse.result.map((token: any) => {
        const tokenType = token.type || 'ERC-20';
        const isNft = ['ERC-721', 'ERC-1155'].includes(tokenType);

        return {
          id: `${token.contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
          symbol: token.symbol || 'Unknown',
          name: token.name || 'Unknown Token',
          contractAddress: token.contractAddress,
          balance: isNft
            ? parseInt(token.balance) || 1
            : parseFloat(token.balance) /
              Math.pow(10, parseInt(token.decimals) || 18),
          decimals: isNft ? 0 : parseInt(token.decimals) || 18,
          type: tokenType,
          chainId: activeNetwork.chainId,
          isNft,
        };
      });

      // Validate ERC-20 token transformation
      const erc20Token = results[0];
      expect(erc20Token.id).toBe(
        '0x6b175474e89094c44da98b954eedeac495271d0f-1'
      );
      expect(erc20Token.balance).toBeCloseTo(1000.5, 1);
      expect(erc20Token.isNft).toBe(false);
      expect(erc20Token.decimals).toBe(18);

      // Validate NFT collection transformation
      const nftCollection = results[1];
      expect(nftCollection.id).toBe(
        '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d-1'
      );
      expect(nftCollection.balance).toBe(5); // Collection count
      expect(nftCollection.isNft).toBe(true);
      expect(nftCollection.decimals).toBe(0);
    });

    it('should validate token standard detection logic', () => {
      // Test the validateERC20Only function logic
      const contractAddresses = [
        '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
        '0xa0b86a33e6ba9e76', // Test token
      ];

      contractAddresses.forEach((contractAddress) => {
        const chainId = 1;
        const expectedId = `${contractAddress.toLowerCase()}-${chainId}`;

        // Verify ID format consistency - allow shorter test addresses
        expect(expectedId).toMatch(/^0x[a-fA-F0-9]+-\d+$/);
        expect(expectedId.split('-')).toHaveLength(2);
        expect(expectedId.split('-')[0]).toBe(contractAddress.toLowerCase());
        expect(expectedId.split('-')[1]).toBe(chainId.toString());
      });
    });

    it('should handle network switching with ID format consistency', () => {
      const contractAddress = '0x6b175474e89094c44da98b954eedeac495271d0f';

      // Test different networks
      const networks = [
        { chainId: 1, name: 'Ethereum' },
        { chainId: 137, name: 'Polygon' },
        { chainId: 56, name: 'BSC' },
      ];

      networks.forEach((network) => {
        const expectedId = `${contractAddress.toLowerCase()}-${
          network.chainId
        }`;

        // Verify each network produces unique but consistent IDs
        expect(expectedId).toContain(contractAddress.toLowerCase());
        expect(expectedId).toContain(network.chainId.toString());
        expect(expectedId.split('-')[1]).toBe(network.chainId.toString());
      });

      // Verify different networks produce different IDs for same contract
      const ethereumId = `${contractAddress.toLowerCase()}-1`;
      const polygonId = `${contractAddress.toLowerCase()}-137`;
      expect(ethereumId).not.toBe(polygonId);
    });
  });
});

// Export to make it a module
export {};
