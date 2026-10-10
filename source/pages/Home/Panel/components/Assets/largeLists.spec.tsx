import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EvmNftsList } from '../Nfts/EvmNftsList';

import { EvmAssetsList } from './EvmList';
import { SyscoinAssetsList } from './SyscoinList';

let mockState: any;
const mockTokenIcon = jest.fn((props: any) => (
  <span data-asset-icon={props.symbol || 'true'} />
));

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  useLocation: () => ({ state: null }),
  useNavigate: () => jest.fn(),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.account,
  selectActiveAccountAssets: (state: any) => state.assets,
  selectActiveAccountTransactions: () => ({ syscoin: {} }),
  selectActiveAccountRef: (state: any) => state.account,
  selectActiveAccountWithAssets: (state: any) => ({
    account: state.account,
    assets: state.assets,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({ navigate: jest.fn() }) }));
jest.mock('components/Icon/Icon', () => ({
  HiTrash: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/index', () => ({
  IconButton: ({ children }: any) => <button>{children}</button>,
  TokenIcon: (props: any) => mockTokenIcon(props),
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('./AssetsHeader', () => ({ AssetsHeader: () => null }));
jest.mock('utils/index', () => ({
  navigateWithContext: jest.fn(),
  truncate: (value: any) => String(value),
  ellipsis: (value: any) => String(value),
  formatCurrency: (value: any) => String(value),
  formatFullPrecisionBalance: (value: any) => String(value),
  getTokenLogo: () => '',
}));
jest.mock('utils/navigationState', () => ({ navigateWithContext: jest.fn() }));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));
jest.mock('utils/syscoinAssetAmount', () => ({
  hasNonZeroAssetDelta: () => false,
}));

const nftState = { isCoinSelected: false, searchValue: '', sortByValue: '' };
const assets = (isNft = false) =>
  Array.from({ length: 1000 }, (_, id) => ({
    id,
    assetGuid: String(id),
    chainId: 1,
    decimals: 8,
    balance: id,
    name: `Asset ${id}`,
    tokenSymbol: `T${id}`,
    symbol: `T${id}`,
    contractAddress: `0x${String(id).padStart(40, '0')}`,
    logo: 'https://example.com/token.png',
    isNft,
  }));

beforeEach(() => {
  mockTokenIcon.mockClear();
  mockState = {
    account: { type: 'HDAccount', id: 0, address: '0xaccount' },
    assets: { ethereum: [], syscoin: [] },
    vault: { activeNetwork: { chainId: 1 } },
    vaultGlobal: { networkStatus: 'idle' },
  };
});

describe('large asset list rendering budget', () => {
  it.each(['erc20', 'nft', 'spt'])(
    'mounts only 50 icons for 1000 %s assets',
    (kind) => {
      mockState.assets = {
        ethereum: assets(kind === 'nft'),
        syscoin: assets(),
      };
      const view =
        kind === 'nft' ? (
          <EvmNftsList state={nftState} />
        ) : kind === 'spt' ? (
          <SyscoinAssetsList />
        ) : (
          <EvmAssetsList />
        );
      const markup = renderToStaticMarkup(view);
      expect(mockTokenIcon).toHaveBeenCalledTimes(50);
      expect(markup).toContain('50/1000');
    }
  );

  it('searches all NFT assets before limiting displayed results', () => {
    mockState.assets.ethereum = assets(true);
    const markup = renderToStaticMarkup(
      <EvmNftsList state={{ ...nftState, searchValue: 'Asset 999' }} />
    );
    expect(mockTokenIcon).toHaveBeenCalledTimes(1);
    expect(markup).toContain('T999');
  });
});
