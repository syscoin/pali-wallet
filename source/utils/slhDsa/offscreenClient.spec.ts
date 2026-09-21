import { SLH_DSA_PARAMETER_SET } from './constants';
import {
  prepareSLHDSAKeypairInOffscreen,
  signSLHDSAInOffscreen,
} from './offscreenClient';

const deferred = <T>() => {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const prepared = {
  pkRoot: `0x${'11'.repeat(32)}`,
  pkSeed: `0x${'22'.repeat(32)}`,
  secretKeyHex: `0x${'33'.repeat(64)}`,
};
const signature = `0x${'44'.repeat(3856)}`;
const cases = [
  {
    name: 'signing',
    start: (assertSession: () => void) =>
      signSLHDSAInOffscreen(
        {
          ...prepared,
          actionHash: `0x${'55'.repeat(32)}`,
          keyId: 'key',
          parameterSet: SLH_DSA_PARAMETER_SET,
        },
        assertSession
      ),
    result: signature,
    response: { success: true, result: { signature } },
  },
  {
    name: 'key preparation',
    start: (assertSession: () => void) =>
      prepareSLHDSAKeypairInOffscreen(
        { setupSecretHex: `0x${'66'.repeat(32)}` },
        assertSession
      ),
    result: prepared,
    response: { success: true, result: prepared },
  },
];

describe.each(cases)(
  'SLH-DSA offscreen session boundary: $name',
  (testCase) => {
    const originalChrome = global.chrome;
    let current: boolean;
    let getContexts: jest.Mock;
    let createDocument: jest.Mock;
    let sendMessage: jest.Mock;
    const assertSession = () => {
      if (!current) {
        throw new Error('wallet session changed');
      }
    };

    beforeEach(() => {
      current = true;
      getContexts = jest.fn().mockResolvedValue([{}]);
      createDocument = jest.fn().mockResolvedValue(undefined);
      sendMessage = jest.fn().mockResolvedValue(testCase.response);
      global.chrome = {
        runtime: { getContexts, sendMessage },
        offscreen: { createDocument },
      } as unknown as typeof chrome;
    });

    afterEach(() => {
      global.chrome = originalChrome;
    });

    it.each(['context lookup', 'document creation'])(
      'does not send secret material if locked during %s',
      async (phase) => {
        const started = deferred<void>();
        const pending = deferred<any>();
        if (phase === 'context lookup') {
          getContexts.mockImplementationOnce(() => {
            started.resolve();
            return pending.promise;
          });
        } else {
          getContexts.mockResolvedValueOnce([]);
          createDocument.mockImplementationOnce(() => {
            started.resolve();
            return pending.promise;
          });
        }
        const result = testCase.start(assertSession);
        const rejected = expect(result).rejects.toThrow(
          'wallet session changed'
        );
        await started.promise;
        current = false;
        pending.resolve(phase === 'context lookup' ? [{}] : undefined);

        await rejected;
        expect(sendMessage).not.toHaveBeenCalled();
      }
    );

    it('does not release a worker response after the session changes', async () => {
      const sent = deferred<void>();
      const response = deferred<unknown>();
      sendMessage.mockImplementationOnce(() => {
        sent.resolve();
        return response.promise;
      });
      const result = testCase.start(assertSession);
      const rejected = expect(result).rejects.toThrow('wallet session changed');
      await sent.promise;
      current = false;
      response.resolve(testCase.response);

      await rejected;
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('returns the worker result for the current session', async () => {
      await expect(testCase.start(assertSession)).resolves.toEqual(
        testCase.result
      );
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
  }
);
