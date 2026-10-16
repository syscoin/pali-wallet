const createPopupMock = jest.fn();
jest.mock('scripts/Background', () => ({
  getController: () => ({ createPopup: createPopupMock }),
}));

import { beginApprovalSubmission } from '../../handlers/approvalSubmission';
import { createExternalWalletView } from '../externalWalletCreation';
import { APPROVAL_CLIENT_READY, APPROVAL_REGISTER } from 'utils/approvalClient';

import { popupPromise } from './popup-promise';
import { MethodRoute } from './types';

describe('approval popup boundary', () => {
  let messageListener: (event: any) => void;
  let registrationListener: (message: any, sender: any, reply: any) => boolean;
  let windowRemovalListener: (id: number) => void;
  const getURL = (path: string) => `chrome-extension://pali/${path}`;

  beforeEach(() => {
    jest.clearAllMocks();
    createPopupMock.mockImplementation(() =>
      createExternalWalletView(async () => ({ id: 9 }))
    );
    (crypto as any).randomUUID = jest
      .fn()
      .mockReturnValueOnce('random-approval-id')
      .mockReturnValue('random-challenge');
    (chrome.runtime as any).getURL = getURL;
    (chrome.runtime as any).id = 'pali';
    (chrome.runtime as any).onMessage = {
      addListener: jest.fn((listener) => {
        registrationListener = listener;
      }),
      removeListener: jest.fn(),
    };
    (chrome.runtime as any).getContexts = jest.fn((_query, callback) =>
      callback([])
    );
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
    };
    (chrome.storage.local.get as jest.Mock).mockImplementation(
      (_keys, callback) => callback({})
    );
    (chrome.storage.local.set as jest.Mock).mockImplementation(
      (_data, callback) => callback?.()
    );
    (chrome.storage.local.remove as jest.Mock).mockImplementation(
      (_keys, callback) => callback?.()
    );
    (chrome as any).windows = {
      remove: jest.fn((_id, callback) => callback()),
      onRemoved: {
        addListener: jest.fn((listener) => {
          windowRemovalListener = listener;
        }),
        removeListener: jest.fn(),
      },
    };
    (self as any).addEventListener = jest.fn((_type, listener) => {
      messageListener = listener;
    });
    (self as any).removeEventListener = jest.fn();
  });

  afterEach(() => jest.useRealTimers());

  const source = (
    path = 'external.html',
    id = 'approval-client',
    data = createPopupMock.mock.calls[0][1]
  ) => ({
    id,
    url: `${getURL(path)}?data=${encodeURIComponent(JSON.stringify(data))}`,
  });
  const registration = (overrides: any = {}) => {
    const reply = jest.fn();
    registrationListener(
      { type: APPROVAL_REGISTER, approvalId: 'random-approval-id' },
      {
        id: 'pali',
        frameId: 0,
        documentId: 'approval-document',
        tab: { id: 19, windowId: 9 },
        url: source().url,
        ...overrides,
      },
      reply
    );
    return reply;
  };
  const bind = (id = 'approval-client', challenge = 'random-challenge') => {
    const port = { postMessage: jest.fn(), close: jest.fn() };
    messageListener({
      data: {
        eventName: APPROVAL_CLIENT_READY,
        approvalId: 'random-approval-id',
        challenge,
      },
      source: source('external.html', id),
      ports: [port],
    });
    return port;
  };

  const begin = async (
    signal?: AbortSignal,
    sender?: chrome.runtime.MessageSender,
    shouldBind = true,
    route = MethodRoute.EthSign
  ) => {
    const pending = popupPromise({
      host: 'https://site.test',
      eventName: 'personal_sign',
      route,
      data: { message: '#keep #all-hashes' },
      signal,
      sender,
    });
    await new Promise(setImmediate);
    if (shouldBind) {
      expect(registration()).toHaveBeenCalledWith({
        status: 'registered',
        approvalId: 'random-approval-id',
        challenge: 'random-challenge',
      });
      expect(bind().postMessage).toHaveBeenCalledWith({
        eventName: APPROVAL_CLIENT_READY,
        approvalId: 'random-approval-id',
        status: 'ready',
      });
    }
    return { pending };
  };

  const startSubmission = (
    senderOverrides: any = {},
    methods = ['wallet', 'sendAndSaveEthTransaction'],
    route = MethodRoute.SendEthTx
  ) =>
    beginApprovalSubmission(
      {
        id: 'pali',
        frameId: 0,
        documentId: 'approval-document',
        tab: { id: 19, windowId: 9 },
        url: source(`external/${route}`).url,
        ...senderOverrides,
      },
      methods
    );

  const submissionRoutes = [
    { method: 'sendAndSaveEthTransaction', route: MethodRoute.SendEthTx },
    { method: 'submitSmartAccountExecution', route: MethodRoute.SendEthTx },
    { method: 'signSendAndSaveTransaction', route: MethodRoute.SignTx },
  ];

  it.each(submissionRoutes)(
    'reports an unknown outcome when a submitting $method popup closes',
    async ({ method, route }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      const rejected = expect(pending).rejects.toMatchObject({
        code: -32603,
        message: expect.stringContaining('outcome is unknown'),
      });
      const finish = startSubmission({}, ['wallet', method], route);
      expect(typeof finish).toBe('function');
      // A timeout/error after invocation cannot establish non-publication.
      finish(new Error('Network request timed out'));
      windowRemovalListener(9);
      await rejected;
    }
  );

  it.each(submissionRoutes)(
    'does not turn submitting $method into a user rejection on document abort',
    async ({ method, route }) => {
      const abort = new AbortController();
      const { pending } = await begin(abort.signal, undefined, true, route);
      const rejected = expect(pending).rejects.toMatchObject({ code: -32603 });
      startSubmission({}, ['wallet', method], route);
      abort.abort();
      await rejected;
    }
  );

  it.each(submissionRoutes)(
    'recognizes native extension-page $method submission without tab/frame metadata',
    async ({ method, route }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      const rejected = expect(pending).rejects.toMatchObject({ code: -32603 });
      startSubmission(
        { tab: undefined, frameId: undefined },
        ['wallet', method],
        route
      );
      windowRemovalListener(9);
      await rejected;
    }
  );

  const invalidSubmissionSenders = [
    { documentId: 'another-document' },
    { documentId: undefined, tab: undefined, frameId: undefined },
    { id: 'another-extension' },
    { documentId: 'another-frame', frameId: 1 },
    { documentId: 'another-window', tab: { id: 20, windowId: 10 } },
    { url: 'https://site.test/' },
  ];
  it.each(
    submissionRoutes.flatMap(({ method, route }) =>
      invalidSubmissionSenders.map((sender) => ({ method, route, sender }))
    )
  )(
    'ignores another sender for $method: $sender',
    async ({ method, route, sender }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
      startSubmission(sender, ['wallet', method], route);
      windowRemovalListener(9);
      await rejected;
    }
  );

  it.each(submissionRoutes)(
    'restores pre-submission $method cancellation only after a definite controller failure',
    async ({ method, route }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      const finish = startSubmission(
        { tab: undefined, frameId: undefined },
        ['wallet', method],
        route
      );
      finish(
        Object.assign(Error('before broadcast'), {
          transactionNotBroadcast: true,
        })
      );
      const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
      windowRemovalListener(9);
      await rejected;
    }
  );

  it.each(submissionRoutes)(
    'does not clear another unresolved $method attempt on a definite failure',
    async ({ method, route }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      const first = startSubmission({}, ['wallet', method], route);
      startSubmission({}, ['wallet', method], route);
      first(
        Object.assign(Error('before broadcast'), {
          transactionNotBroadcast: true,
        })
      );
      const rejected = expect(pending).rejects.toMatchObject({ code: -32603 });
      windowRemovalListener(9);
      await rejected;
    }
  );

  it.each([
    { methods: ['wallet', 'refreshActiveAccountBalances'] },
    { methods: ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'] },
  ])(
    'does not mark a read or a different controller path as submission: %p',
    async ({ methods }) => {
      const { pending } = await begin(
        undefined,
        undefined,
        true,
        MethodRoute.SendEthTx
      );
      const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
      startSubmission({}, methods);
      windowRemovalListener(9);
      await rejected;
    }
  );

  it.each(submissionRoutes)(
    'still delivers the actual late $method result if the popup remains open',
    async ({ method, route }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      startSubmission({}, ['wallet', method], route);
      const result =
        method === 'signSendAndSaveTransaction'
          ? { txid: 'ab'.repeat(32) }
          : `0x${'ab'.repeat(32)}`;
      messageListener({
        source: source(`external/${route}`),
        data: {
          eventName: 'personal_sign.https://site.test',
          detail: JSON.stringify(result),
        },
      });
      await expect(pending).resolves.toEqual(result);
      windowRemovalListener(9);
    }
  );

  it.each([
    { route: MethodRoute.SignTx, methods: ['wallet', 'signSyscoinPsbt'] },
    { route: MethodRoute.SignPsbt, methods: ['wallet', 'signSyscoinPsbt'] },
    {
      route: MethodRoute.SignPsbt,
      methods: ['wallet', 'signSendAndSaveTransaction'],
    },
    {
      route: MethodRoute.SignTx,
      methods: ['wallet', 'syscoinTransaction', 'sendTransaction'],
    },
  ])(
    'does not track sign-only or a different UTXO controller path: $methods',
    async ({ route, methods }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      startSubmission({}, methods, route);
      const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
      windowRemovalListener(9);
      await rejected;
    }
  );

  it('allows a dapp approval while an ordinary main wallet tab is open', async () => {
    (chrome.runtime.getContexts as jest.Mock).mockImplementation(
      (_filter, reply) =>
        reply([
          {
            contextType: 'TAB',
            documentOrigin: 'chrome-extension://pali',
            documentUrl: getURL('app.html'),
          },
        ])
    );
    const abort = new AbortController();
    const { pending } = await begin(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(createPopupMock).toHaveBeenCalledTimes(1);
    abort.abort();
    await rejected;
  });

  it('does not open a second approval when another external wallet view is active', async () => {
    (chrome.runtime.getContexts as jest.Mock).mockImplementation(
      (_filter, reply) =>
        reply([
          {
            contextType: 'TAB',
            documentUrl: `${getURL('external.html')}?route=hardware`,
          },
        ])
    );
    await expect(
      popupPromise({
        host: 'https://site.test',
        eventName: 'personal_sign',
        route: MethodRoute.EthSign,
      })
    ).rejects.toMatchObject({ code: 4100 });
    expect(createPopupMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed within two seconds when window detection stalls', async () => {
    jest.useFakeTimers();
    const log = jest.spyOn(console, 'error').mockImplementation();
    (chrome.runtime.getContexts as jest.Mock).mockImplementation(
      () => undefined
    );
    const pending = popupPromise({
      host: 'https://site.test',
      eventName: 'personal_sign',
      route: MethodRoute.EthSign,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 4100 });
    await jest.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(createPopupMock).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('preserves signing data and ignores approval messages from another view', async () => {
    const { pending } = await begin();
    const popupData = createPopupMock.mock.calls[0][1];
    expect(popupData.message).toBe('#keep #all-hashes');
    const response = {
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: JSON.stringify('signed'),
      },
    };
    messageListener({ ...response, source: source('app.html') });
    messageListener({
      ...response,
      source: {
        id: 'approval-client',
        url: `${getURL('external.html')}?data=${encodeURIComponent(
          JSON.stringify({ approvalId: 'wrong' })
        )}`,
      },
    });
    expect(self.removeEventListener).not.toHaveBeenCalled();
    messageListener({
      ...response,
      source: {
        id: 'approval-client',
        url: `${getURL('external.html')}?data=${encodeURIComponent(
          JSON.stringify(popupData)
        )}`,
      },
    });
    await expect(pending).resolves.toBe('signed');
    expect(self.removeEventListener).toHaveBeenCalled();
  });

  it('rejects a result when the originating iframe document has disappeared', async () => {
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
      sendMessage: jest.fn().mockResolvedValue({ documentActive: true }),
    };
    const sender = {
      tab: { id: 7 },
      frameId: 3,
      documentId: 'original-document',
    } as chrome.runtime.MessageSender;
    const { pending } = await begin(undefined, sender);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    (chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(
      new Error('Document removed')
    );
    messageListener({
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: JSON.stringify('signed'),
      },
      source: {
        id: 'approval-client',
        url: `${getURL('external.html')}?data=${encodeURIComponent(
          JSON.stringify(createPopupMock.mock.calls[0][1])
        )}`,
      },
    });
    await rejected;
    expect(chrome.windows.remove).toHaveBeenCalledWith(9, expect.any(Function));
  });

  it('closes and rejects an approval when its requesting page goes away', async () => {
    const abort = new AbortController();
    const { pending } = await begin(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    abort.abort();
    await rejected;
    expect(chrome.windows.remove).toHaveBeenCalledWith(9, expect.any(Function));
    expect(self.removeEventListener).toHaveBeenCalled();
  });

  it.each([
    { path: 'external/tx/ethSign', route: MethodRoute.EthSign },
    { path: 'external/connect-wallet', route: MethodRoute.Connect },
    { path: '', route: MethodRoute.Login },
  ])(
    'accepts the bound document after SPA routing to $path',
    async ({ path, route }) => {
      const { pending } = await begin(undefined, undefined, true, route);
      const browserSource = source(path);
      if (!path) browserSource.url += `&externalRoute=${route}`;
      messageListener({
        source: browserSource,
        data: {
          eventName: 'personal_sign.https://site.test',
          detail: JSON.stringify('signed'),
        },
      });
      await expect(pending).resolves.toBe('signed');
    }
  );

  it('ignores another client and wrong nonce even on the expected routed path', async () => {
    const { pending } = await begin();
    const response = {
      eventName: 'personal_sign.https://site.test',
      detail: JSON.stringify('signed'),
    };
    messageListener({
      source: source('external/tx/ethSign', 'other-client'),
      data: response,
    });
    messageListener({
      source: source('external/tx/ethSign', 'approval-client', {
        approvalId: 'wrong',
      }),
      data: response,
    });
    messageListener({
      source: source('external/connect-wallet'),
      data: response,
    });
    expect(self.removeEventListener).not.toHaveBeenCalled();
    messageListener({ source: source('external/tx/ethSign'), data: response });
    await expect(pending).resolves.toBe('signed');
  });

  it.each([
    { id: 'another-extension' },
    { frameId: 2 },
    { documentId: undefined },
    { tab: { id: 20, windowId: 99 } },
    { url: 'https://site.test/external.html' },
    {
      url: `${getURL('app.html')}?data=${encodeURIComponent(
        JSON.stringify({ approvalId: 'random-approval-id' })
      )}`,
    },
  ])('does not register a forged initial document: %o', async (overrides) => {
    const { pending } = await begin(undefined, undefined, false);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(registration(overrides)).toHaveBeenCalledWith({
      status: 'unavailable',
      approvalId: 'random-approval-id',
    });
    expect(bind().postMessage).not.toHaveBeenCalled();
    windowRemovalListener(9);
    await rejected;
  });

  it('checks the created window before issuing a challenge to early registrations', async () => {
    let created!: (window: any) => void;
    createPopupMock.mockReturnValue(
      new Promise((resolve) => {
        created = resolve;
      })
    );
    const { pending } = await begin(undefined, undefined, false);
    const wrong = registration({
      tab: { id: 20, windowId: 99 },
      documentId: 'wrong-document',
    });
    const legitimate = registration();
    expect(wrong).not.toHaveBeenCalled();
    expect(legitimate).not.toHaveBeenCalled();
    expect(bind('wrong-client').postMessage).not.toHaveBeenCalled();
    created({ id: 9 });
    await new Promise(setImmediate);
    expect(wrong).toHaveBeenCalledWith({
      status: 'unavailable',
      approvalId: 'random-approval-id',
    });
    expect(legitimate).toHaveBeenCalledWith({
      status: 'registered',
      approvalId: 'random-approval-id',
      challenge: 'random-challenge',
    });
    expect(bind().postMessage).toHaveBeenCalledWith({
      eventName: APPROVAL_CLIENT_READY,
      approvalId: 'random-approval-id',
      status: 'ready',
    });
    messageListener({
      source: source('external/tx/ethSign'),
      data: { eventName: 'personal_sign.https://site.test', detail: 'null' },
    });
    await expect(pending).resolves.toBeNull();
  });

  it('does not let a reloaded document rebind an existing approval', async () => {
    const { pending } = await begin();
    expect(
      registration({ documentId: 'reloaded-document' })
    ).toHaveBeenCalledWith({
      status: 'unavailable',
      approvalId: 'random-approval-id',
    });
    expect(bind('reloaded-client').postMessage).toHaveBeenCalledWith({
      eventName: APPROVAL_CLIENT_READY,
      approvalId: 'random-approval-id',
      status: 'unavailable',
    });
    messageListener({
      source: source('external/tx/ethSign', 'reloaded-client'),
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: '"forged"',
      },
    });
    expect(self.removeEventListener).not.toHaveBeenCalled();
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    windowRemovalListener(9);
    await rejected;
  });

  it('requires the private challenge before binding a registered document', async () => {
    const { pending } = await begin(undefined, undefined, false);
    registration();
    expect(
      bind('wrong-client', 'wrong-challenge').postMessage
    ).not.toHaveBeenCalled();
    expect(bind().postMessage).toHaveBeenCalledWith({
      eventName: APPROVAL_CLIENT_READY,
      approvalId: 'random-approval-id',
      status: 'ready',
    });
    messageListener({
      source: source(),
      data: { eventName: 'personal_sign.https://site.test', detail: 'null' },
    });
    await expect(pending).resolves.toBeNull();
  });

  it('removes registration listeners and replies when creating the popup fails', async () => {
    const failure = new Error('Popup creation failed');
    createPopupMock.mockRejectedValue(failure);
    await expect(
      popupPromise({
        host: 'https://site.test',
        eventName: 'personal_sign',
        route: MethodRoute.EthSign,
      })
    ).rejects.toBe(failure);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(
      registrationListener
    );
    expect(self.removeEventListener).toHaveBeenCalledWith(
      'message',
      messageListener
    );
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      ['pali-popup-open', 'pali-popup-timestamp'],
      expect.any(Function)
    );
  });

  it('rejects a user close before any authenticated response starts', async () => {
    const { pending } = await begin();
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    windowRemovalListener(9);
    await rejected;
    messageListener({
      source: source(),
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: '"too late"',
      },
    });
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(
      registrationListener
    );
  });

  it('does not reject an authenticated response when the popup closes during liveness validation', async () => {
    let live!: (value: any) => void;
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
      sendMessage: jest.fn().mockResolvedValue({ documentActive: true }),
    };
    const { pending } = await begin(undefined, {
      tab: { id: 7 },
      frameId: 0,
      documentId: 'dapp-document',
    } as chrome.runtime.MessageSender);
    (chrome.tabs.sendMessage as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        live = resolve;
      })
    );
    messageListener({
      source: source('external/tx/ethSign'),
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: '"signed"',
      },
    });
    windowRemovalListener(9);
    live({ documentActive: true });
    await expect(pending).resolves.toBe('signed');
  });

  it('still rejects a stale response when the popup closes during liveness validation', async () => {
    let live!: (value: any) => void;
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
      sendMessage: jest.fn().mockResolvedValue({ documentActive: true }),
    };
    const { pending } = await begin(undefined, {
      tab: { id: 7 },
      frameId: 0,
      documentId: 'dapp-document',
    } as chrome.runtime.MessageSender);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    (chrome.tabs.sendMessage as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        live = resolve;
      })
    );
    messageListener({
      source: source('external/tx/ethSign'),
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: '"signed"',
      },
    });
    windowRemovalListener(9);
    live({ documentActive: false });
    await rejected;
  });

  it('closes an unbound popup at the hard deadline and removes flags/listeners', async () => {
    jest.useFakeTimers();
    const starting = begin(undefined, undefined, false);
    await jest.advanceTimersByTimeAsync(0);
    const { pending } = await starting;
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    await jest.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(chrome.windows.remove).toHaveBeenCalledWith(9, expect.any(Function));
    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      'pali-popup-open',
      'pali-popup-timestamp',
    ]);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(
      registrationListener
    );
    expect(self.removeEventListener).toHaveBeenCalledWith(
      'message',
      messageListener
    );
    expect(jest.getTimerCount()).toBe(0);
  });
});
