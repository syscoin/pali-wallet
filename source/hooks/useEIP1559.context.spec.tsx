/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';

import { useEIP1559 } from './useEIP1559';

let mockVault: any;
const mockEmitter = jest.fn();
let nextChainId = 81000;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select({ vault: mockVault }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));

const OLD_RPC = 'https://old-rpc.invalid';
const NEW_RPC = 'https://new-rpc.invalid';
const setup = (compatible: boolean) => {
  mockVault = {
    isBitcoinBased: false,
    activeNetwork: {
      chainId: ++nextChainId,
      kind: 'ethereum',
      url: OLD_RPC,
    },
  };
  mockEmitter.mockImplementation(async (methods: string[]) => {
    expect(methods).toEqual(['wallet', 'getCurrentBlock']);
    return compatible ? { baseFeePerGas: '1000000000' } : {};
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('reuses a successful capability result only while the endpoint stays the same', async () => {
  setup(true);
  const first = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(first.result.current.isEIP1559Compatible).toBe(true)
  );
  first.unmount();
  const second = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(second.result.current.isEIP1559Compatible).toBe(true)
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('reads the replacement custom endpoint even when its chain ID is unchanged and the page remounts', async () => {
  setup(false);
  const first = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(first.result.current.isEIP1559Compatible).toBe(false)
  );
  first.unmount();
  mockVault.activeNetwork = { ...mockVault.activeNetwork, url: NEW_RPC };
  mockEmitter.mockResolvedValue({ baseFeePerGas: '1000000000' });
  const second = renderHook(() => useEIP1559());
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(second.result.current.isEIP1559Compatible).toBe(true)
  );
});

it('rechecks a changed endpoint on the mounted page instead of retaining its prior EIP1559 result', async () => {
  setup(true);
  const rendered: Array<{ url: string; value: boolean | undefined }> = [];
  const view = renderHook(() => {
    const value = useEIP1559();
    rendered.push({
      url: mockVault.activeNetwork.url,
      value: value.isEIP1559Compatible,
    });
    return value;
  });
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(true)
  );
  mockVault.activeNetwork = { ...mockVault.activeNetwork, url: NEW_RPC };
  mockEmitter.mockResolvedValue({});
  view.rerender();
  expect(rendered.find((item) => item.url === NEW_RPC)?.value).toBeUndefined();
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(false)
  );
});

it('checks a genuinely different chain and keeps its independently cached result', async () => {
  setup(true);
  const view = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(true)
  );
  mockVault.activeNetwork = {
    ...mockVault.activeNetwork,
    chainId: ++nextChainId,
    url: NEW_RPC,
  };
  mockEmitter.mockResolvedValue({});
  await act(async () => view.rerender());
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(false)
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('explicitly rechecks a cached endpoint and uses its fresh result', async () => {
  setup(true);
  const view = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(true)
  );
  mockEmitter.mockResolvedValue({});
  await act(async () => view.result.current.forceRecheck());
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(false)
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  view.unmount();
  const restored = renderHook(() => useEIP1559());
  expect(restored.result.current.isEIP1559Compatible).toBe(false);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('does not cache a failed endpoint read and recovers on the next visit', async () => {
  setup(true);
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic endpoint failure'));
  const first = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(first.result.current.isEIP1559Compatible).toBe(false)
  );
  expect(first.result.current.isLoading).toBe(false);
  first.unmount();
  const second = renderHook(() => useEIP1559());
  await waitFor(() =>
    expect(second.result.current.isEIP1559Compatible).toBe(true)
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('discards an EVM read after switching to UTXO and checks again after returning', async () => {
  setup(true);
  const evm = mockVault.activeNetwork;
  let finish!: (value: any) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = renderHook(() => useEIP1559());
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  mockVault = {
    ...mockVault,
    isBitcoinBased: true,
    activeNetwork: {
      kind: 'syscoin',
      chainId: evm.chainId,
      url: 'https://blockbook.invalid',
    },
  };
  view.rerender();
  expect(view.result.current.isEIP1559Compatible).toBe(false);
  await act(async () => finish({ baseFeePerGas: '1000000000' }));
  expect(view.result.current.isEIP1559Compatible).toBe(false);
  mockVault = { ...mockVault, isBitcoinBased: false, activeNetwork: evm };
  view.rerender();
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(true)
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('invalidates an in-flight read when explicit recheck starts a newer one', async () => {
  setup(true);
  let finish!: (value: any) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = renderHook(() => useEIP1559());
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  mockEmitter.mockResolvedValue({});
  await act(async () => view.result.current.forceRecheck());
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(false)
  );
  await act(async () => finish({ baseFeePerGas: '1000000000' }));
  expect(view.result.current.isEIP1559Compatible).toBe(false);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('does not publish an old endpoint result over the replacement endpoint while both reads are in flight', async () => {
  setup(true);
  let resolveOld!: (value: any) => void;
  let resolveNew!: (value: any) => void;
  const oldRead = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const newRead = new Promise((resolve) => {
    resolveNew = resolve;
  });
  mockEmitter.mockImplementation(() =>
    mockVault.activeNetwork.url === OLD_RPC ? oldRead : newRead
  );
  const view = renderHook(() => useEIP1559());
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  mockVault.activeNetwork = { ...mockVault.activeNetwork, url: NEW_RPC };
  view.rerender();
  await act(async () => resolveNew({}));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(view.result.current.isEIP1559Compatible).toBe(false)
  );
  await act(async () => resolveOld({ baseFeePerGas: '1000000000' }));
  expect(view.result.current.isEIP1559Compatible).toBe(false);
  view.unmount();
  const remounted = renderHook(() => useEIP1559());
  expect(remounted.result.current.isEIP1559Compatible).toBe(false);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});
