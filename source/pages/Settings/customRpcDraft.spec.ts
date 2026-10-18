import {
  clearCustomRpcDrafts,
  readCustomRpcDraft,
  writeCustomRpcDraft,
} from './customRpcDraft';

let mockScope = { account: 'a', network: 'n' };
let mockUnlocked = true;
let mockStoreChange: (() => void) | undefined;
let mockStatusChange: (() => void) | undefined;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    subscribe: (callback: () => void) => {
      mockStoreChange = callback;
      return () => {
        mockStoreChange = undefined;
      };
    },
  },
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: mockUnlocked }),
  subscribeControllerStatus: (callback: () => void) => {
    mockStatusChange = callback;
    return () => {
      mockStatusChange = undefined;
    };
  },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
const scope = () => JSON.stringify(mockScope);
const draft = {
  isSyscoinRpc: false,
  values: {
    label: 'Draft',
    url: 'https://rpc.test/private-api-key',
    chainId: '42',
    password: 'not-allowlisted',
  },
};
beforeEach(() => {
  clearCustomRpcDrafts();
  mockScope = { account: 'a', network: 'n' };
  mockUnlocked = true;
});
afterEach(clearCustomRpcDrafts);

it('retains bounded field values only in the matching account/network/editor', () => {
  writeCustomRpcDraft('id', scope(), 'new', draft);
  expect(readCustomRpcDraft('id', scope(), 'new')).toEqual({
    isSyscoinRpc: false,
    values: {
      label: 'Draft',
      url: 'https://rpc.test/private-api-key',
      chainId: '42',
    },
  });
  expect(readCustomRpcDraft('id', scope(), 'edit-other')).toBeUndefined();
  expect(readCustomRpcDraft('id', 'other-scope', 'new')).toBeUndefined();
});

it.each(['account', 'network'])(
  'clears all retained values on a %s change, even if that context returns later',
  (field) => {
    writeCustomRpcDraft('id', scope(), 'new', draft);
    const original = { ...mockScope };
    mockScope = { ...mockScope, [field]: 'changed' };
    mockStoreChange?.();
    mockScope = original;
    expect(readCustomRpcDraft('id', scope(), 'new')).toBeUndefined();
  }
);

it('clears on lock and cannot restore the previous authenticated session', () => {
  writeCustomRpcDraft('id', scope(), 'new', draft);
  mockUnlocked = false;
  mockStatusChange?.();
  mockUnlocked = true;
  expect(readCustomRpcDraft('id', scope(), 'new')).toBeUndefined();
});

it('bounds field lengths, lifetime and retained entry count', () => {
  for (let index = 0; index < 9; index++)
    writeCustomRpcDraft(String(index), scope(), 'new', {
      ...draft,
      values: { label: 'x'.repeat(5000) },
    });
  expect(readCustomRpcDraft('0', scope(), 'new')).toBeUndefined();
  expect(readCustomRpcDraft('8', scope(), 'new')?.values.label).toHaveLength(
    4096
  );
  const clock = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.now() + 16 * 60 * 1000);
  expect(readCustomRpcDraft('8', scope(), 'new')).toBeUndefined();
  clock.mockRestore();
});
