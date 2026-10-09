import { getChainId, provider } from '../../e2e/harness/chain';

jest.mock('utils/ethersV6Compat', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getNetwork: jest.fn(),
  })),
}));
jest.mock('../../source/utils/smartAccount/deployment', () => ({
  getPaliInfrastructureContracts: jest.fn(() => []),
}));

describe('visual prerequisite chain-ID read', () => {
  const getNetwork = provider.getNetwork as jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    getNetwork.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('recovers from a transient RPC failure through the existing retry policy', async () => {
    getNetwork
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({ chainId: 57057 });

    const result = expect(getChainId()).resolves.toBe(57057);
    await jest.runAllTimersAsync();
    await result;

    expect(getNetwork).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps retries bounded and reports persistent RPC failure', async () => {
    const failure = new Error('502 Bad Gateway');
    getNetwork.mockRejectedValue(failure);

    const result = expect(getChainId()).rejects.toBe(failure);
    await jest.runAllTimersAsync();
    await result;

    expect(getNetwork).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry a successful identity read or leave idle timers', async () => {
    getNetwork.mockResolvedValue({ chainId: 57057 });

    await expect(getChainId()).resolves.toBe(57057);

    expect(getNetwork).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves a reported wrong chain for the caller to reject', async () => {
    getNetwork.mockResolvedValue({ chainId: 1 });

    await expect(getChainId()).resolves.toBe(1);

    expect(getNetwork).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
