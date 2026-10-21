import { expect as playwrightExpect } from '@playwright/test';

import {
  type RpcObservation,
  approve,
} from '../../e2e/harness/testDappConformance';

jest.mock('@playwright/test', () => ({ expect: jest.fn() }));

describe('approval popup closure preserves original request settlement', () => {
  const requestId = 37;
  const closedTarget = () =>
    new Error(
      'locator.click: Target page, context or browser has been closed\nCall log:'
    );

  function setup() {
    let closed = false;
    let evaluateError: Error | undefined;
    const events: string[] = [];
    const params = [
      '0x0000000000000000000000000000000000000001',
      '{"fixture":"original typed request"}',
    ];
    const original: RpcObservation = {
      id: requestId,
      method: 'eth_signTypedData_v4',
      params,
      started: 1,
      settled: false,
    };
    const approved = { ...original, settled: true, result: 'signed-fixture' };
    const requests: RpcObservation[] = [];
    requests[requestId] = original;
    // A different request's successful response must never satisfy this one.
    requests[requestId + 1] = {
      ...approved,
      id: requestId + 1,
      params: ['wrong account', 'wrong payload'],
    };
    const button = {
      click: jest.fn(async () => {
        events.push('click');
      }),
      isEnabled: jest.fn(async () => true),
    };
    const popup = {
      url: () => 'chrome-extension://fixture/external.html',
      isClosed: () => closed,
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn(() => ({
        waitFor: jest.fn().mockResolvedValue(undefined),
      })),
      getByRole: jest.fn(() => ({ last: () => button })),
    };
    const page = {
      evaluate: jest.fn(async (read: (id: number) => unknown, id: number) => {
        if (evaluateError) throw evaluateError;
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: { __paliConformance: { requests } },
        });
        try {
          // Execute the actual rpcObservation callback, not a replacement
          // approve/settle implementation or an unconditional success result.
          return read(id);
        } finally {
          if (previous) Object.defineProperty(globalThis, 'window', previous);
          else Reflect.deleteProperty(globalThis, 'window');
        }
      }),
    };
    const polls: { timeout?: number; values: unknown[] }[] = [];
    let beforePollRead: (
      timeout: number | undefined,
      attempt: number
    ) => void = () => undefined;
    (playwrightExpect as unknown as jest.Mock).mockReturnValue({
      toBeVisible: jest.fn().mockResolvedValue(undefined),
      toBeEnabled: jest.fn().mockResolvedValue(undefined),
      toHaveCSS: jest.fn().mockResolvedValue(undefined),
    });
    (playwrightExpect as any).poll = jest.fn(
      (read: () => Promise<unknown>, options: { timeout?: number }) => {
        const poll = { timeout: options.timeout, values: [] as unknown[] };
        polls.push(poll);
        return {
          toBe: async (expected: unknown) => {
            // A bounded native scheduling model: no real browser or timer wait.
            // Preserve and inspect the actual production-requested timeouts.
            for (let attempt = 0; attempt < 4; attempt++) {
              beforePollRead(options.timeout, attempt);
              const value = await read();
              poll.values.push(value);
              if (value === expected) return;
            }
            throw new Error('Original request did not settle');
          },
        };
      }
    );
    const capture = jest.fn(async () => {
      events.push('capture');
    });
    return {
      approved,
      button,
      capture,
      events,
      page,
      params,
      polls,
      popup,
      requests,
      close: () => {
        closed = true;
      },
      failEvaluate: (error: Error) => {
        evaluateError = error;
      },
      beforePoll: (callback: typeof beforePollRead) => {
        beforePollRead = callback;
      },
      run: () =>
        approve(
          { pages: () => [popup] } as any,
          page as any,
          requestId,
          capture
        ),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('keeps an ordinary successful approval and exact original params', async () => {
    const fixture = setup();
    fixture.button.click.mockImplementation(async () => {
      fixture.events.push('click');
      fixture.requests[requestId] = fixture.approved;
    });
    await expect(fixture.run()).resolves.toBe(fixture.approved);
    expect(fixture.approved.params).toBe(fixture.params);
    expect(fixture.events).toEqual(['capture', 'click']);
    expect(fixture.popup.isClosed()).toBe(false);
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(
      fixture.page.evaluate.mock.calls.every(([, id]) => id === requestId)
    ).toBe(true);
  });

  it('accepts a self-close acknowledgement only after the original request later settles', async () => {
    const fixture = setup();
    fixture.button.click.mockImplementation(async () => {
      fixture.events.push('click');
      fixture.close();
      throw closedTarget();
    });
    fixture.beforePoll((timeout, attempt) => {
      if (timeout === 30_000 && attempt === 1)
        fixture.requests[requestId] = fixture.approved;
    });
    await expect(fixture.run()).resolves.toBe(fixture.approved);
    expect(fixture.events).toEqual(['capture', 'click']);
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(fixture.polls.at(-1)).toEqual({
      timeout: 30_000,
      values: [false, true],
    });
    expect(
      fixture.page.evaluate.mock.calls.every(([, id]) => id === requestId)
    ).toBe(true);
    expect(fixture.approved.params).toBe(fixture.params);
  });

  it('does not use a different settled request when the closed original remains pending', async () => {
    const fixture = setup();
    fixture.button.click.mockImplementation(async () => {
      fixture.close();
      throw closedTarget();
    });
    await expect(fixture.run()).rejects.toThrow(
      'Original request did not settle'
    );
    expect(fixture.requests[requestId + 1].settled).toBe(true);
    expect(fixture.polls.at(-1)).toEqual({
      timeout: 30_000,
      values: [false, false, false, false],
    });
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(
      fixture.page.evaluate.mock.calls.every(([, id]) => id === requestId)
    ).toBe(true);
  });

  it('preserves a closed-target click failure while the popup remains open', async () => {
    const fixture = setup();
    const error = closedTarget();
    fixture.button.click.mockRejectedValue(error);
    await expect(fixture.run()).rejects.toBe(error);
    expect(fixture.popup.isClosed()).toBe(false);
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(fixture.polls.some(({ timeout }) => timeout === 30_000)).toBe(false);
  });

  it('preserves other click errors even after the popup closes', async () => {
    const fixture = setup();
    const error = new Error('locator.click: Timeout 30000ms exceeded');
    fixture.button.click.mockImplementation(async () => {
      fixture.close();
      throw error;
    });
    await expect(fixture.run()).rejects.toBe(error);
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(fixture.polls.some(({ timeout }) => timeout === 30_000)).toBe(false);
  });

  it('preserves an original request rejection after the popup self-closes', async () => {
    const fixture = setup();
    fixture.button.click.mockImplementation(async () => {
      fixture.close();
      fixture.requests[requestId] = {
        ...fixture.approved,
        result: undefined,
        error: { code: 4001, message: 'User rejected the request' },
      };
      throw closedTarget();
    });
    await expect(fixture.run()).rejects.toThrow(
      '{"code":4001,"message":"User rejected the request"}'
    );
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(fixture.polls.at(-1)).toEqual({ timeout: 30_000, values: [true] });
    expect(
      fixture.page.evaluate.mock.calls.every(([, id]) => id === requestId)
    ).toBe(true);
  });

  it('does not swallow a page/context failure while settling the original request', async () => {
    const fixture = setup();
    const error = new Error(
      'page.evaluate: Target page, context or browser has been closed'
    );
    fixture.button.click.mockImplementation(async () => {
      fixture.close();
      fixture.failEvaluate(error);
      throw closedTarget();
    });
    await expect(fixture.run()).rejects.toBe(error);
    expect(fixture.button.click).toHaveBeenCalledTimes(1);
    expect(fixture.polls.at(-1)?.timeout).toBe(30_000);
  });

  it('retains the second confirmation flow without replacing or retrying the request', async () => {
    const fixture = setup();
    fixture.button.click
      .mockImplementationOnce(async () => {
        fixture.events.push('click first confirmation');
      })
      .mockImplementationOnce(async () => {
        fixture.events.push('click final confirmation');
        fixture.close();
        fixture.requests[requestId] = fixture.approved;
      });
    await expect(fixture.run()).resolves.toBe(fixture.approved);
    expect(fixture.events).toEqual([
      'capture',
      'click first confirmation',
      'capture',
      'click final confirmation',
    ]);
    expect(fixture.button.click).toHaveBeenCalledTimes(2);
    expect(
      fixture.page.evaluate.mock.calls.every(([, id]) => id === requestId)
    ).toBe(true);
  });
});
