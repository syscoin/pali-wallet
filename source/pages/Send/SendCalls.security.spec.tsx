import React from 'react';

import { SendCalls } from './SendCalls';

const HASH = `0x${'a'.repeat(64)}`;
const OTHER_HASH = `0x${'b'.repeat(64)}`;
const mockControllerEmitter = jest.fn();
const mockSmartSubmit = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
let mockQuery: any;
let mockState: any;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockControllerEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/index', () => ({
  Button: 'button',
  Icon: 'span',
  Tooltip: 'span',
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: 'loading',
  PqSigningOverlay: 'pq-signing',
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({ clearNavigationState: jest.fn() }));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  signAndSubmitSmartAccountExecutions: (params: any) => mockSmartSubmit(params),
}));

const findElement = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = findElement(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('sendCalls submission lifecycle', () => {
  let hookStates: any[];
  let hookIndex: number;
  let hookRefs: any[];
  let refIndex: number;
  let effects: Array<() => any>;
  const render = () => {
    hookIndex = 0;
    refIndex = 0;
    effects = [];
    return SendCalls();
  };
  const initialize = () => {
    render();
    effects[0]();
    return render();
  };
  const signButton = (view = render()) =>
    findElement(
      view,
      (element) =>
        element.type === 'button' && element.props.variant === 'primary'
    )!;
  const sends = () =>
    mockControllerEmitter.mock.calls.filter(
      ([method]) => method[1] === 'sendAndSaveEthTransaction'
    );
  const records = () =>
    mockControllerEmitter.mock.calls
      .filter(([method]) => method[1] === 'recordSendCallsBundle')
      .map(([, params]) => params[2]);
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const makeSmart = () => {
    const account = mockState.vault.accounts.HDAccount[0];
    account.isSmartAccount = true;
    account.smartAccount = { chainId: 1 };
  };

  beforeEach(() => {
    hookStates = [];
    hookRefs = [];
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = hookIndex++;
      if (!(index in hookStates))
        hookStates[index] = typeof initial === 'function' ? initial() : initial;
      return [
        hookStates[index],
        (value: any) => {
          hookStates[index] =
            typeof value === 'function' ? value(hookStates[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useRef').mockImplementation((initial: any) => {
      const index = refIndex++;
      if (!(index in hookRefs)) hookRefs[index] = { current: initial };
      return hookRefs[index];
    });
    jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      effects.push(effect);
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockAlert.error.mockClear();
    mockAlert.success.mockClear();
    mockState = {
      vault: {
        activeNetwork: { chainId: 1, currency: 'ETH' },
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: { 0: { id: 0, address: `0x${'1'.repeat(40)}` } },
        },
      },
    };
    mockQuery = {
      host: 'https://dapp.example',
      eventName: 'sendCalls',
      bundleId: 'bundle-id',
      reservationId: 'reservation-id',
      chainId: '0x1',
      approvedContext: {
        account: { address: `0x${'1'.repeat(40)}`, id: 0, type: 'HDAccount' },
        chainId: 1,
        rpcUrl: 'rpc-a',
        slip44: 60,
      },
      version: '2.0.0',
      atomicRequired: false,
      calls: [{ to: `0x${'2'.repeat(40)}` }, { to: `0x${'3'.repeat(40)}` }],
    };
    mockControllerEmitter.mockReset().mockImplementation(async ([, method]) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'sendAndSaveEthTransaction') return { hash: HASH };
      return undefined;
    });
    mockSmartSubmit.mockReset().mockImplementation(async (params) => {
      await params.onBeforeSubmit();
      return { hash: HASH };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, false])(
    'blocks same-popup retry and later calls after an unknown send (marker %s)',
    async (transactionNotBroadcast) => {
      mockControllerEmitter.mockImplementation(async ([, method]) => {
        if (method === 'getRecommendedNonceForBatch') return 5;
        if (method === 'sendAndSaveEthTransaction')
          throw Object.assign(new Error('RPC response lost after broadcast'), {
            transactionNotBroadcast,
          });
        return undefined;
      });
      const firstSign = signButton(initialize());
      await firstSign.props.onClick();
      const view = render();
      expect(sends()).toHaveLength(1);
      expect(signButton(view).props.disabled).toBe(true);
      expect(
        findElement(view, (element) => element.props.role === 'status')?.props
          .children
      ).toBe('send.submissionStatusUnknown');
      await signButton(view).props.onClick();
      expect(sends()).toHaveLength(1);
      expect(records().some((record) => record.submissionStarted)).toBe(true);
      expect(records().some((record) => record.submissionCompleted)).toBe(
        false
      );
    }
  );

  it('waits for the durable begin marker before invoking the sender', async () => {
    const begun = deferred<void>();
    mockControllerEmitter.mockImplementation(async ([, method], params) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'recordSendCallsBundle' && params[2].submissionStarted)
        return begun.promise;
      if (method === 'sendAndSaveEthTransaction') return { hash: HASH };
      return undefined;
    });
    const attempt = signButton(initialize()).props.onClick();
    await settle();
    expect(sends()).toHaveLength(0);
    begun.resolve();
    await attempt;
    expect(sends()).toHaveLength(2);
  });

  it('does not send when the durable begin marker fails', async () => {
    mockQuery.calls = [mockQuery.calls[0]];
    mockControllerEmitter.mockImplementation(async ([, method], params) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'recordSendCallsBundle' && params[2].submissionStarted)
        throw new Error('Storage failed');
      return undefined;
    });
    await signButton(initialize()).props.onClick();
    expect(sends()).toHaveLength(0);
    expect(mockAlert.error).toHaveBeenCalledWith('send.allTransactionsFailed');
  });

  it('persists the first acknowledged hash before starting the next sender', async () => {
    const persisted = deferred<void>();
    mockControllerEmitter.mockImplementation(async ([, method], params) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'recordSendCallsBundle' && params[2].txHashes.length)
        return persisted.promise;
      if (method === 'sendAndSaveEthTransaction') return { hash: HASH };
      return undefined;
    });
    const attempt = signButton(initialize()).props.onClick();
    await settle();
    expect(sends()).toHaveLength(1);
    expect(records().filter((record) => record.submissionStarted)).toHaveLength(
      1
    );
    persisted.resolve();
    await attempt;
    const starts = records().filter((record) => record.submissionStarted);
    expect(starts).toHaveLength(2);
    expect(starts[1].submissionId).not.toBe(starts[0].submissionId);
    expect(starts[1].previousSubmissionId).toBe(starts[0].submissionId);
  });

  it('passes the originally approved account and chain after the visible wallet changes', async () => {
    initialize();
    mockState.vault.activeNetwork = { chainId: 2, currency: 'OTHER' };
    mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
    mockState.vault.accounts.HDAccount[1] = {
      id: 1,
      address: `0x${'4'.repeat(40)}`,
    };
    await signButton().props.onClick();
    for (const [, params] of sends()) {
      expect(params[0]).toMatchObject({
        chainId: 1,
        from: mockQuery.approvedContext.account.address,
      });
      expect(params[4]).toEqual({ expectedContext: mockQuery.approvedContext });
    }
    expect(records().every((record) => record.chainId === 1)).toBe(true);
  });

  it('keeps a last acknowledged call successful if context changes after its broadcast', async () => {
    mockQuery.calls = [mockQuery.calls[0]];
    mockControllerEmitter.mockImplementation(async ([, method]) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'sendAndSaveEthTransaction')
        throw Object.assign(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
          transactionNotBroadcast: false,
          transactionHash: HASH,
        });
      return undefined;
    });
    await signButton(initialize()).props.onClick();
    expect(records()).toContainEqual(
      expect.objectContaining({
        failed: false,
        submissionCompleted: true,
        txHashes: [HASH],
      })
    );
  });

  it.each([false, true])(
    'stops later calls on context change while preserving acknowledged hash=%s',
    async (acknowledged) => {
      mockQuery.calls.push({ to: `0x${'4'.repeat(40)}` });
      let sendCount = 0;
      mockControllerEmitter.mockImplementation(async ([, method]) => {
        if (method === 'getRecommendedNonceForBatch') return 5;
        if (method === 'sendAndSaveEthTransaction') {
          sendCount++;
          if (sendCount === 2)
            throw Object.assign(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
              transactionNotBroadcast: !acknowledged,
              ...(acknowledged ? { transactionHash: OTHER_HASH } : {}),
            });
          return { hash: HASH };
        }
        return undefined;
      });
      await signButton(initialize()).props.onClick();
      expect(sends()).toHaveLength(2);
      expect(records()).toContainEqual(
        expect.objectContaining({
          failed: true,
          submissionCompleted: true,
          txHashes: acknowledged ? [HASH, OTHER_HASH] : [HASH],
        })
      );
    }
  );

  it('stops safely if an acknowledged hash cannot be persisted', async () => {
    mockControllerEmitter.mockImplementation(async ([, method], params) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'recordSendCallsBundle' && params[2].txHashes.length)
        throw new Error('Storage failed');
      if (method === 'sendAndSaveEthTransaction') return { hash: HASH };
      return undefined;
    });
    await signButton(initialize()).props.onClick();
    expect(sends()).toHaveLength(1);
    expect(signButton().props.disabled).toBe(true);
    expect(mockAlert.error).toHaveBeenCalledWith(
      'send.submissionStatusUnknown'
    );
    expect(records().some((record) => record.txHashes.includes(HASH))).toBe(
      true
    );
  });

  it('retries only a definitely rejected call and preserves acknowledged calls', async () => {
    let sendCount = 0;
    mockControllerEmitter.mockImplementation(async ([, method]) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'sendAndSaveEthTransaction') {
        sendCount++;
        if (sendCount === 2)
          throw Object.assign(new Error('Device rejected'), {
            transactionNotBroadcast: true,
          });
        return { hash: sendCount === 1 ? HASH : OTHER_HASH };
      }
      return undefined;
    });
    await signButton(initialize()).props.onClick();
    expect(sends()).toHaveLength(2);
    expect(signButton().props.disabled).toBe(false);
    expect(records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failed: true,
          submissionCompleted: true,
          txHashes: [HASH],
        }),
      ])
    );
    await signButton().props.onClick();
    expect(sends()).toHaveLength(3);
    expect(sends()[2][1][0].to).toBe(mockQuery.calls[1].to);
    const starts = records().filter((record) => record.submissionStarted);
    expect(starts[2].previousSubmissionId).toBe(starts[1].submissionId);
  });

  it('keeps an acknowledged EOA hash even if an error claims no broadcast', async () => {
    mockQuery.calls = [mockQuery.calls[0]];
    mockControllerEmitter.mockImplementation(async ([, method]) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'sendAndSaveEthTransaction')
        throw Object.assign(new Error('Saved response failed'), {
          transactionHash: HASH,
          transactionNotBroadcast: true,
        });
      return undefined;
    });
    await signButton(initialize()).props.onClick();
    expect(signButton().props.disabled).toBe(true);
    expect(records()).toContainEqual(
      expect.objectContaining({
        failed: false,
        submissionCompleted: true,
        txHashes: [HASH],
      })
    );
    expect(records().some((record) => record.submissionNotBroadcast)).toBe(
      false
    );
    expect(sends()).toHaveLength(1);
  });

  it.each([
    ['isTrezorWallet', 300000],
    ['isLedgerWallet', 300000],
    [undefined, 10000],
  ])(
    'uses the appropriate %s signer timeout without transport replay',
    async (hardwareFlag, timeout) => {
      if (hardwareFlag)
        mockState.vault.accounts.HDAccount[0][hardwareFlag] = true;
      mockQuery.calls = [mockQuery.calls[0]];
      await signButton(initialize()).props.onClick();
      expect(sends()[0][2]).toBe(timeout);
      expect(sends()[0][3]).toBe(false);
    }
  );

  it.each(['not-an-address', 'unresolved.eth'])(
    'records definitive validation failure for %s without entering submission',
    async (to) => {
      mockQuery.calls = [{ to }];
      await signButton(initialize()).props.onClick();
      expect(sends()).toHaveLength(0);
      expect(records()).toContainEqual(
        expect.objectContaining({
          failed: true,
          submissionCompleted: true,
          txHashes: [],
        })
      );
    }
  );

  it('keeps a smart-account submission unknown after the sender boundary', async () => {
    makeSmart();
    mockSmartSubmit.mockImplementation(async (params) => {
      await params.onBeforeSubmit();
      throw new Error('RPC response lost after broadcast');
    });
    await signButton(initialize()).props.onClick();
    expect(signButton().props.disabled).toBe(true);
    await signButton().props.onClick();
    expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
    expect(records().some((record) => record.submissionStarted)).toBe(true);
    expect(records().some((record) => record.submissionCompleted)).toBe(false);
  });

  it('allows smart-account preparation failures to retry before the sender boundary', async () => {
    makeSmart();
    mockSmartSubmit.mockRejectedValue(new Error('Authenticator unavailable'));
    await signButton(initialize()).props.onClick();
    expect(signButton().props.disabled).toBe(false);
    expect(records().some((record) => record.submissionStarted)).toBe(false);
    await signButton().props.onClick();
    expect(mockSmartSubmit).toHaveBeenCalledTimes(2);
  });

  it('blocks smart-account retry when an acknowledged hash completion write fails', async () => {
    makeSmart();
    mockSmartSubmit.mockImplementation(async (params) => {
      await params.onBeforeSubmit();
      throw Object.assign(new Error('Saved response failed'), {
        transactionHash: HASH,
        transactionNotBroadcast: true,
      });
    });
    mockControllerEmitter.mockImplementation(async ([, method], params) => {
      if (method === 'getRecommendedNonceForBatch') return 5;
      if (method === 'recordSendCallsBundle' && params[2].submissionCompleted)
        throw new Error('Storage failed');
      return undefined;
    });
    await signButton(initialize()).props.onClick();
    expect(signButton().props.disabled).toBe(true);
    expect(records().some((record) => record.submissionNotBroadcast)).toBe(
      false
    );
    await signButton().props.onClick();
    expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
  });
});
