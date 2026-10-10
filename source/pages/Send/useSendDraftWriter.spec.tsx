/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';

import { getScopedSendDraft, useSendDraftWriter } from './useSendDraftWriter';

let mockScope = { account: 'account-a', network: 'network-a' };
let mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockSave = jest.fn();
const mockNavigate = jest.fn();
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({}) },
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  getWalletNavigationScope: () => mockScope,
  captureNavigationScroll: () => ({ 'wallet-main': 81 }),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));

const options = (path: string) => ({
  enabled: true,
  scopeKey: JSON.stringify(mockScope),
  form: {
    getFieldsValue: jest.fn(() => ({ receiver: 'recipient', amount: '1' })),
  },
  navigate: mockNavigate,
  state: { isMaxSend: false, RBF: true },
  location: {
    pathname: path,
    search: '?view=draft',
    hash: '#form',
    state: { walletScope: mockScope, returnContext: { returnRoute: '/home' } },
  },
});

describe('live send draft persistence', () => {
  beforeEach(() => {
    mockScope = { account: 'account-a', network: 'network-a' };
    mockStatus = {
      isUnlocked: true,
      isLoading: false,
      connectionUnavailable: false,
    };
    mockSave.mockReset().mockResolvedValue(undefined);
    mockNavigate.mockReset();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['/send/eth', '/send/sys'])(
    'saves %s typing before blur and flushes current live fields on quick close',
    async (path) => {
      const opts = options(path);
      const hook = renderHook((props) => useSendDraftWriter(props), {
        initialProps: opts,
      });
      mockSave.mockClear();
      const typed = {
        receiver: 'latest-recipient',
        amount: '2.75',
        nftTokenId: '0',
      };
      await act(async () => {
        await hook.result.current(typed);
      });
      expect(mockSave).toHaveBeenLastCalledWith(
        path + '?view=draft#form',
        undefined,
        { formValues: typed, RBF: true, isMaxSend: false },
        opts.location.state.returnContext
      );
      expect(mockNavigate).toHaveBeenLastCalledWith(
        path + '?view=draft#form',
        expect.objectContaining({
          replace: true,
          state: expect.objectContaining({
            formValues: typed,
            walletScope: mockScope,
            returnContext: opts.location.state.returnContext,
          }),
        })
      );

      opts.form.getFieldsValue.mockReturnValue({
        receiver: 'programmatic-recipient',
        amount: '3',
      });
      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(mockSave).toHaveBeenLastCalledWith(
        path + '?view=draft#form',
        undefined,
        expect.objectContaining({
          formValues: { receiver: 'programmatic-recipient', amount: '3' },
        }),
        opts.location.state.returnContext
      );
    }
  );

  it('does not mirror the same sanitized snapshot repeatedly after replace navigation', () => {
    const opts = options('/send/eth');
    const hook = renderHook((props) => useSendDraftWriter(props), {
      initialProps: opts,
    });
    const mirrored = mockNavigate.mock.calls.at(-1)![1].state;
    mockNavigate.mockClear();
    hook.rerender({ ...opts, location: { ...opts.location, state: mirrored } });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('flushes hidden visibility without replacing the router entry', async () => {
    const opts = options('/send/sys');
    renderHook(() => useSendDraftWriter(opts));
    mockSave.mockClear();
    mockNavigate.mockClear();
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it.each(['account', 'network'])(
    'rejects the old mounted draft after its %s changes before a render',
    async (part) => {
      const hook = renderHook(() => useSendDraftWriter(options('/send/eth')));
      mockSave.mockClear();
      mockNavigate.mockClear();
      mockScope = { ...mockScope, [part]: 'changed' };
      await act(async () => {
        await hook.result.current({ receiver: 'old', amount: '9' });
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    }
  );

  it.each(['lock', 'loading', 'disconnection'])(
    'cannot recreate a cleared snapshot after %s arrives before React rerenders',
    async (reason) => {
      const hook = renderHook(() => useSendDraftWriter(options('/send/sys')));
      mockSave.mockClear();
      mockNavigate.mockClear();
      if (reason === 'lock') mockStatus.isUnlocked = false;
      else if (reason === 'loading') mockStatus.isLoading = true;
      else mockStatus.connectionUnavailable = true;
      await act(async () => {
        await hook.result.current({ receiver: 'old' });
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    }
  );

  it('ignores a stale callback after unmount and a departed HashRouter URL before unmount', async () => {
    const hook = renderHook(() => useSendDraftWriter(options('/send/eth')));
    const stale = hook.result.current;
    mockSave.mockClear();
    window.history.replaceState(null, '', '/#/send/confirm');
    await act(async () => {
      await stale({ amount: '9' });
    });
    expect(mockSave).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
    hook.unmount();
    await stale({ amount: '9' });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('keeps the latest live NFT token ID and discards verification and private fields', async () => {
    const opts = {
      ...options('/send/eth'),
      state: {
        selectedAsset: {
          isNft: true,
          contractAddress: '0xcontract',
          xprv: 'secret',
        },
        selectedNftTokenId: 'old',
        verifiedTokenBalance: 999,
        nftTokenIds: [{ tokenId: 'old', balance: 999 }],
      },
    };
    const hook = renderHook(() => useSendDraftWriter(opts));
    await act(async () => {
      await hook.result.current({
        nftTokenId: '0',
        amount: '1',
        privateKey: 'secret',
        fee: 5,
      });
    });
    expect(mockSave.mock.calls.at(-1)![2]).toEqual({
      formValues: { nftTokenId: '0', amount: '1' },
      selectedAsset: { isNft: true, contractAddress: '0xcontract' },
      selectedNftTokenId: '0',
    });
  });

  it('hydrates only an exact stamped scope and never trusts saved ownership results', () => {
    const state = {
      walletScope: mockScope,
      formValues: { receiver: 'recipient', amount: '1' },
      selectedAsset: { contractAddress: '0xcontract', isNft: true },
      nftTokenIds: [{ tokenId: '1', balance: 50 }],
      verifiedTokenBalance: 50,
    };
    expect(
      getScopedSendDraft('/send/eth', state, JSON.stringify(mockScope))
    ).toEqual({
      formValues: state.formValues,
      selectedAsset: state.selectedAsset,
    });
    for (const foreign of [
      undefined,
      { account: 'other', network: 'network-a' },
      { account: 'account-a', network: 'other' },
    ]) {
      expect(
        getScopedSendDraft(
          '/send/eth',
          { ...state, walletScope: foreign },
          JSON.stringify(mockScope)
        )
      ).toEqual({});
    }
  });
});
