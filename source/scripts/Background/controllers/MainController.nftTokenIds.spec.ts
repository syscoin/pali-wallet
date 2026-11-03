jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import MainController from './MainController';

describe('NFT enumeration extension response', () => {
  const contract = `0x${'11'.repeat(20)}`;
  const owner = `0x${'22'.repeat(20)}`;
  let controller: MainController;
  let discover: jest.Mock;

  beforeEach(() => {
    controller = Object.create(MainController.prototype);
    discover = jest.fn();
    Object.assign(controller, {
      evmAssetsController: { fetchNftTokenIds: discover },
    });
  });

  it('preserves the capped exact IDs and continuation metadata through JSON messaging', async () => {
    const tokens = Array.from({ length: 10 }, (_, index) => ({
      tokenId: (BigInt('9007199254740993') + BigInt(index)).toString(),
      balance: 1,
    }));
    const discovery = Object.assign(tokens, {
      hasMore: true,
      requiresManualEntry: false,
    });
    discover.mockResolvedValue(discovery);
    // The prior array payload loses its continuation flag in Chrome's JSON transport.
    expect(JSON.parse(JSON.stringify(discovery)).hasMore).toBeUndefined();

    const response = JSON.parse(
      JSON.stringify(
        await controller.fetchNftTokenIds(contract, owner, 'ERC-721')
      )
    );
    expect(response).toEqual({
      tokens: [...tokens],
      hasMore: true,
      requiresManualEntry: false,
    });
    expect(response.tokens).toHaveLength(10);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(contract, owner, 'ERC-721');
  });

  it('retains manual-entry metadata when enumeration is unavailable', async () => {
    discover.mockResolvedValue(
      Object.assign([], { requiresManualEntry: true })
    );
    const response = JSON.parse(
      JSON.stringify(
        await controller.fetchNftTokenIds(contract, owner, 'ERC-1155')
      )
    );
    expect(response).toEqual({
      tokens: [],
      hasMore: false,
      requiresManualEntry: true,
    });
    expect(discover).toHaveBeenCalledWith(contract, owner, 'ERC-1155');
  });

  it('preserves a single owned token and does not invent continuation', async () => {
    const tokens = [{ tokenId: '0', balance: 1 }];
    discover.mockResolvedValue(tokens);
    expect(
      JSON.parse(
        JSON.stringify(
          await controller.fetchNftTokenIds(contract, owner, 'ERC-721')
        )
      )
    ).toEqual({ tokens, hasMore: false, requiresManualEntry: false });
  });
});
