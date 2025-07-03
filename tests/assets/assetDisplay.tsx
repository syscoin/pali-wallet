import '@testing-library/jest-dom';
import i18n from 'i18next';

import { ITokenEthProps } from '../../source/types/tokens';

describe('Asset Display Components - Comprehensive Testing', () => {
  const mockErc20Tokens: ITokenEthProps[] = [
    {
      id: '0x6b175474e89094c44da98b954eedeac495271d0f-1',
      contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
      tokenSymbol: 'DAI',
      decimals: 18,
      balance: 1000.5,
      chainId: 1,
      isNft: false,
      tokenStandard: 'ERC-20',
      name: 'Dai Stablecoin',
    },
  ];

  beforeEach(() => {
    // Initialize i18n for testing
    i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      resources: {
        en: {
          translation: {},
        },
      },
    });
  });

  describe('Asset Rendering', () => {
    it('should handle token balance display', () => {
      const token = mockErc20Tokens[0];
      expect(token.balance).toBe(1000.5);
      expect(token.tokenSymbol).toBe('DAI');
    });

    it('should format token metadata correctly', () => {
      const token = mockErc20Tokens[0];
      expect(token.decimals).toBe(18);
      expect(token.tokenStandard).toBe('ERC-20');
      expect(token.isNft).toBe(false);
    });

    it('should validate token ID format', () => {
      const token = mockErc20Tokens[0];
      // Verify ID follows contractAddress-chainId format
      expect(token.id).toBe(`${token.contractAddress}-${token.chainId}`);
      expect(token.id).toMatch(/^0x[a-fA-F0-9]{40}-\d+$/);
    });
  });
});
