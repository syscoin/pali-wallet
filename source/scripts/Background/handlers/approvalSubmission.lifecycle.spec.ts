const mockCreatePopup = jest.fn();
jest.mock('scripts/Background', () => ({
  getController: () => ({ createPopup: mockCreatePopup }),
}));

import { getMethodConfig } from '../controllers/message-handler/method-registry';
import { popupPromise } from '../controllers/message-handler/popup-promise';
import { APPROVAL_CLIENT_READY, APPROVAL_REGISTER } from 'utils/approvalClient';

import { handleMasterControllerResponses } from './handleMasterControllerResponses';

describe('transaction approval submission lifetime', () => {
  let messages: any[];
  let workerMessage: (event: any) => void;
  let closeWindow: (id: number) => void;
  let controllerMessage: any;
  let send: jest.Mock;
  const data = {
    host: 'https://synthetic.invalid',
    approvalId: 'approval-lifecycle',
  };
  const source = () => ({
    id: 'approval-client',
    url: `chrome-extension://pali/external.html?data=${encodeURIComponent(
      JSON.stringify(mockCreatePopup.mock.calls[0][1])
    )}`,
  });
  const sender = () => ({
    id: 'pali',
    frameId: 0,
    documentId: 'approval-document',
    tab: { id: 19, windowId: 9 },
    url: source().url,
  });
  const requests = [
    { request: 'wallet_sendCalls', submission: 'sendAndSaveEthTransaction' },
    { request: 'wallet_sendCalls', submission: 'submitSmartAccountExecution' },
    {
      request: 'wallet_requestSmartAccountModuleInstall',
      submission: 'submitSmartAccountExecution',
    },
    {
      request: 'wallet_requestSmartAccountModuleUninstall',
      submission: 'submitSmartAccountExecution',
    },
    {
      request: 'wallet_prepareSmartAccount',
      submission: 'registerSmartAccountOnChain',
    },
    {
      request: 'wallet_prepareSmartAccount',
      submission: 'submitSmartAccountExecution',
    },
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    messages = [];
    send = jest.fn(async () => ({ hash: `0x${'1'.repeat(64)}` }));
    mockCreatePopup.mockResolvedValue({ id: 9 });
    (crypto as any).randomUUID = jest
      .fn()
      .mockReturnValueOnce(data.approvalId)
      .mockReturnValue('challenge');
    (chrome.runtime as any).id = 'pali';
    (chrome.runtime as any).getURL = (path: string) =>
      `chrome-extension://pali/${path}`;
    (chrome.runtime as any).onMessage = {
      addListener: jest.fn((listener) => messages.push(listener)),
      removeListener: jest.fn(),
    };
    (chrome as any).windows = {
      remove: jest.fn((_id, callback) => callback?.()),
      onRemoved: {
        addListener: jest.fn((listener) => (closeWindow = listener)),
        removeListener: jest.fn(),
      },
    };
    (chrome.storage.local.remove as jest.Mock).mockImplementation(
      (_keys, callback) => callback?.()
    );
    (self as any).addEventListener = jest.fn(
      (_type, listener) => (workerMessage = listener)
    );
    (self as any).removeEventListener = jest.fn();
    handleMasterControllerResponses({
      wallet: {
        sendAndSaveEthTransaction: send,
        submitSmartAccountExecution: send,
        registerSmartAccountOnChain: send,
      },
    } as any);
    controllerMessage = messages.at(-1);
  });
  const begin = async (
    signal?: AbortSignal,
    request = 'eth_sendTransaction'
  ) => {
    // Use the same registry as the production request pipeline, so each case
    // exercises the route actually chosen for its public provider method.
    const config = getMethodConfig(request)!;
    const pending = popupPromise({
      host: data.host,
      eventName: config.popupEventName!,
      route: config.popupRoute!,
      data: {},
      signal,
    });
    await new Promise(setImmediate);
    const reply = jest.fn();
    messages.at(-1)(
      { type: APPROVAL_REGISTER, approvalId: data.approvalId },
      sender(),
      reply
    );
    expect(reply).toHaveBeenCalledWith({
      status: 'registered',
      approvalId: data.approvalId,
      challenge: 'challenge',
    });
    const port = { postMessage: jest.fn(), close: jest.fn() };
    workerMessage({
      data: {
        eventName: APPROVAL_CLIENT_READY,
        approvalId: data.approvalId,
        challenge: 'challenge',
      },
      source: source(),
      ports: [port],
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' })
    );
    return { pending };
  };
  const submit = (method: string, sourceSender: any = sender()) =>
    new Promise<any>((resolve) => {
      controllerMessage(
        {
          type: 'CONTROLLER_ACTION',
          data: { methods: ['wallet', method], params: [{}] },
        },
        sourceSender,
        resolve
      );
    });

  it('healthy control marks an admitted send as uncertain when its popup then closes', async () => {
    const { pending } = await begin();
    const rejected = expect(pending).rejects.toMatchObject({ code: -32603 });
    await submit('sendAndSaveEthTransaction');
    closeWindow(9);
    await rejected;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a website sender while a batch approval is live', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation();
    try {
      const { pending } = await begin(undefined, 'wallet_sendCalls');
      await expect(
        submit('sendAndSaveEthTransaction', {
          ...sender(),
          url: 'https://synthetic.invalid',
        })
      ).resolves.toMatchObject({ success: false });
      expect(send).not.toHaveBeenCalled();
      const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
      closeWindow(9);
      await rejected;
    } finally {
      log.mockRestore();
    }
  });

  it.each(
    [...new Set(requests.map(({ request }) => request))].flatMap((request) =>
      ['close', 'abort'].map((kind) => ({ request, kind }))
    )
  )(
    'retains definite rejection before $request submission by $kind',
    async ({ kind, request }) => {
      const abort = new AbortController();
      const { pending } = await begin(abort.signal, request);
      const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
      if (kind === 'close') closeWindow(9);
      else abort.abort();
      await rejected;
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('does not attribute another approval document submission to the current batch', async () => {
    const { pending } = await begin(undefined, 'wallet_sendCalls');
    await submit('sendAndSaveEthTransaction', {
      ...sender(),
      documentId: 'another-document',
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    closeWindow(9);
    await rejected;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(
    requests.flatMap((request) =>
      ['close', 'abort'].map((kind) => ({ ...request, kind }))
    )
  )(
    'retains an uncertain $request result after $kind during $submission',
    async ({ kind, request, submission }) => {
      const abort = new AbortController();
      const { pending } = await begin(abort.signal, request);
      let finish!: (value: unknown) => void;
      send.mockImplementation(
        () => new Promise((resolve) => (finish = resolve))
      );
      const submitted = submit(submission);
      await Promise.resolve();
      expect(send).toHaveBeenCalledTimes(1);
      const rejected = expect(pending).rejects.toMatchObject({
        code: -32603,
        message: expect.stringContaining('outcome is unknown'),
      });
      if (kind === 'close') closeWindow(9);
      else abort.abort();
      await rejected;
      const acknowledged = { hash: `0x${'1'.repeat(64)}` };
      finish(acknowledged);
      await expect(submitted).resolves.toEqual(acknowledged);
      expect(send).toHaveBeenCalledTimes(1);
    }
  );
});
