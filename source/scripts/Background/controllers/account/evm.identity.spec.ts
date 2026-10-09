let state: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => state,
    dispatch: (action: any) => {
      state.vault.accountAssets.HD[0].ethereum = action.payload.value;
    },
  },
}));
jest.mock('state/vault', () => ({
  setAccountAssets: (payload: any) => ({ payload }),
}));

import { validateAndManageUserAssets } from '../assets/utils';

import EthAccountController from './evm';

const TOKEN = `0x${'ab'.repeat(20)}`;
const asset = (chainId: number, tokenId?: string) => ({
  contractAddress: TOKEN,
  chainId,
  decimals: 0,
  balance: 4,
  tokenSymbol: 'T',
  isNft: !!tokenId,
  tokenStandard: tokenId ? 'ERC-1155' : 'ERC-20',
  tokenId,
});
beforeEach(() => {
  state = {
    vault: {
      activeAccount: { id: 0, type: 'HD' },
      activeNetwork: { chainId: 2 },
      accountAssets: { HD: { 0: { ethereum: [asset(1)], syscoin: [] } } },
    },
  };
});

it('imports the same address on a different chain, but rejects a same-chain duplicate', async () => {
  const controller = EthAccountController();
  await controller.saveTokenInfo(asset(2) as any);
  const list = state.vault.accountAssets.HD[0].ethereum;
  expect(list).toHaveLength(2);
  expect(list[1].id).toBe(`${TOKEN}-2`);
  await expect(controller.saveTokenInfo(asset(2) as any)).rejects.toThrow(
    'already exists'
  );
});

it('keeps ERC1155 IDs distinct per chain and within one contract', async () => {
  const controller = EthAccountController();
  state.vault.accountAssets.HD[0].ethereum = [asset(1, '1')];
  await controller.saveTokenInfo(asset(2, '1') as any);
  await controller.saveTokenInfo(asset(2, '2') as any);
  expect(state.vault.accountAssets.HD[0].ethereum).toHaveLength(3);
  await expect(controller.saveTokenInfo(asset(2, '1') as any)).rejects.toThrow(
    'already exists'
  );
});

it('deduplicates within a chain without collapsing another chain address', () => {
  const updated = [asset(1), { ...asset(2), balance: 3 }];
  const result = validateAndManageUserAssets(true, updated as any, []);
  expect(result).toHaveLength(2);
});
