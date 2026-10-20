jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: jest.fn() },
}));
jest.mock('state/vault', () => ({ setAccountPropertyByIdAndType: jest.fn() }));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));

import store from 'state/store';
import { KeyringAccountType } from 'types/network';

import SmartAccountController from './index';

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const expectedContext = {
  account: {
    address: address(1),
    id: 0,
    type: KeyringAccountType.SmartAccount,
  },
  chainId: 57057,
  rpcUrl: 'https://fixture.invalid',
  sessionGeneration: 7,
  slip44: 60,
};
const record = {
  address: address(2),
  name: 'Reviewed module',
  moduleType: 1,
  initData: '0x',
};

describe.each(['add', 'remove'])(
  'acknowledged custom module %s metadata scope',
  (operation) => {
    let state: any;
    let generation: number;
    let controller: any;
    const persist = (withContext = true) =>
      operation === 'add'
        ? controller.addSmartAccountCustomModule({
            accountId: 0,
            record,
            ...(withContext ? { expectedContext } : {}),
          })
        : controller.removeSmartAccountCustomModule({
            accountId: 0,
            address: record.address,
            ...(withContext ? { expectedContext } : {}),
          });
    beforeEach(() => {
      generation = 7;
      state = {
        vault: {
          activeAccount: { id: 0, type: KeyringAccountType.SmartAccount },
          activeNetwork: { chainId: 57057, url: 'https://fixture.invalid' },
          isBitcoinBased: false,
          accounts: { SmartAccount: { 0: { address: address(1) } } },
        },
        vaultGlobal: { activeSlip44: 60 },
      };
      (store.getState as jest.Mock).mockImplementation(() => state);
      controller = new SmartAccountController({
        getWalletSessionGeneration: () => generation,
      } as any);
      controller.getSmartAccountById = jest.fn(() => ({
        account: { id: 0, address: address(1) },
        metadata: { customModules: [] },
      }));
      controller.persistSmartAccountMetadata = jest
        .fn()
        .mockResolvedValue(undefined);
      controller.invalidateHydratedMetadata = jest.fn();
    });

    it('persists a reviewed record for its unchanged account/session', async () => {
      await persist();
      expect(controller.persistSmartAccountMetadata).toHaveBeenCalledWith(
        0,
        expect.any(Function),
        expectedContext
      );
      const transform = controller.persistSmartAccountMetadata.mock.calls[0][1];
      expect(transform({ customModules: [] })).toEqual({
        customModules: operation === 'add' ? [record] : [],
      });
    });

    it('retains compatibility for existing internal callers without a context', async () => {
      await persist(false);
      expect(controller.persistSmartAccountMetadata).toHaveBeenCalledTimes(1);
    });

    it.each(['account', 'address', 'chain', 'rpc', 'slip44', 'session'])(
      'rejects a stale %s before writing without misreporting the accepted transaction',
      async (axis) => {
        // Exercise the real staged helper admission, not a mocked writer that
        // would bypass the expected-context guard now owned by that helper.
        controller.persistSmartAccountMetadata = (
          SmartAccountController.prototype as any
        ).persistSmartAccountMetadata;
        if (axis === 'account') state.vault.activeAccount.id = 1;
        if (axis === 'address')
          state.vault.accounts.SmartAccount[0].address = address(3);
        if (axis === 'chain') state.vault.activeNetwork.chainId++;
        if (axis === 'rpc')
          state.vault.activeNetwork.url = 'https://replacement.invalid';
        if (axis === 'slip44') state.vaultGlobal.activeSlip44++;
        if (axis === 'session') generation++;
        const error = await persist().catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('PALI_TRANSACTION_CONTEXT_CHANGED');
        expect(error.transactionNotBroadcast).not.toBe(true);
        expect(controller.getSmartAccountById).not.toHaveBeenCalled();
        expect(store.dispatch).not.toHaveBeenCalled();
      }
    );
  }
);
