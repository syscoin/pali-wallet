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
  const approvedContext = {
    account: { id: 0, type: 'HDAccount', address: `0x${'a'.repeat(40)}` },
    chainId: 743211,
    rpcUrl: 'https://rpc.invalid',
    slip44: 60,
    sessionGeneration: 6,
  };
  const utxoPsbt = {
    psbt: 'reviewed-psbt',
    assets: '[]',
    sentryFeeAuthorization: 'fee',
  };
  const utxoContext = {
    ...approvedContext,
    account: { ...approvedContext.account, xpub: 'approved-xpub' },
    kind: 'syscoin',
    slip44: 57,
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
    (chrome as any).tabs = {
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    };
    (chrome.storage.local.remove as jest.Mock).mockImplementation(
      (_keys, callback) => callback?.()
    );
    (self as any).addEventListener = jest.fn(
      (_type, listener) => (workerMessage = listener)
    );
    (self as any).removeEventListener = jest.fn();
    (self as any).clients = { get: jest.fn(async () => source()) };
    handleMasterControllerResponses({
      wallet: {
        sendAndSaveEthTransaction: send,
        submitSmartAccountExecution: send,
        registerSmartAccountOnChain: send,
        signSendAndSaveTransaction: send,
        signSyscoinPsbt: send,
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
      data: request.startsWith('sys_sign')
        ? { ...utxoPsbt, approvedContext: utxoContext }
        : { approvedContext },
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
  const submit = (
    method: string,
    sourceSender: any = sender(),
    params: any[] = [{}]
  ) =>
    new Promise<any>((resolve) => {
      controllerMessage(
        {
          type: 'CONTROLLER_ACTION',
          data: { methods: ['wallet', method], params },
        },
        sourceSender,
        resolve
      );
    });

  it('accepts an ordinary internal UTXO confirmation with no external approval', async () => {
    const input = { ordinaryWalletSend: true, psbt: utxoPsbt };
    await submit(
      'signSendAndSaveTransaction',
      { id: 'pali', url: 'chrome-extension://pali/send/confirm' },
      [input]
    );
    expect(send).toHaveBeenCalledWith(input);
  });

  it.each([
    ['UTXO_SUBMISSION_NOT_DISPATCHED', true],
    ['UTXO_SUBMISSION_UNKNOWN', false],
  ] as const)(
    'preserves the SDK %s classification and canonical txid',
    async (code, transactionNotBroadcast) => {
      const txid = 'ab'.repeat(32);
      send.mockRejectedValueOnce(
        Object.assign(new Error('Fixture submission'), {
          code,
          transactionNotBroadcast,
          txid,
        })
      );
      await expect(
        submit(
          'signSendAndSaveTransaction',
          { id: 'pali', url: 'chrome-extension://pali/app.html#/send/confirm' },
          [{ ordinaryWalletSend: true, psbt: utxoPsbt }]
        )
      ).resolves.toMatchObject({
        success: false,
        error: { code, transactionNotBroadcast, txid },
      });
    }
  );

  it('rejects changed PSBT, wrong mode and unbound external approval before a signer can start', async () => {
    const { pending } = await begin(undefined, 'sys_sign');
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    for (const request of [
      submit('signSyscoinPsbt', sender(), [
        { psbt: { ...utxoPsbt, assets: '[1]' } },
      ]),
      submit('signSendAndSaveTransaction', sender(), [
        { psbt: utxoPsbt, ordinaryWalletSend: true },
      ]),
      submit('signSyscoinPsbt', { ...sender(), documentId: 'other-document' }, [
        { psbt: utxoPsbt },
      ]),
    ])
      await expect(request).resolves.toMatchObject({
        success: false,
        error: { transactionNotBroadcast: true },
      });
    expect(send).not.toHaveBeenCalled();
    closeWindow(9);
    await rejected;
  });

  it('does not enter the signer when the approver reloads during its initial document check', async () => {
    const { pending } = await begin(undefined, 'sys_sign');
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    let finish!: (client: unknown) => void;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    const getClient = (self as any).clients.get as jest.Mock;
    getClient.mockReturnValueOnce(held).mockResolvedValueOnce(undefined);
    const submitting = submit('signSyscoinPsbt', sender(), [
      { psbt: utxoPsbt },
    ]);
    await new Promise(setImmediate);
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    const onNavigation = (chrome.tabs.onUpdated.addListener as jest.Mock).mock
      .calls[0][0];
    onNavigation(19, { status: 'loading', url: source().url });
    await rejected;
    finish(source());
    await expect(submitting).resolves.toMatchObject({
      success: false,
      error: { transactionNotBroadcast: true },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['sys_sign', 'signSyscoinPsbt', 4001],
    ['sys_signAndSend', 'signSendAndSaveTransaction', -32603],
  ] as const)(
    'retires the synchronous %s owner before held work can dispatch',
    async (request, method, code) => {
      const abort = new AbortController();
      const { pending } = await begin(abort.signal, request);
      const rejected = expect(pending).rejects.toMatchObject({ code });
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const dispatch = jest.fn();
      send.mockImplementation(async (input, { assertCurrent, signal }) => {
        expect(input).toEqual({ psbt: utxoPsbt, expectedContext: utxoContext });
        assertCurrent();
        enter();
        await held;
        expect(signal.aborted).toBe(true);
        assertCurrent();
        return dispatch();
      });
      const submitted = submit(method, sender(), [
        { psbt: utxoPsbt, expectedContext: { rpcUrl: 'attacker' } },
      ]);
      await entered;
      abort.abort();
      await rejected;
      release();
      await expect(submitted).resolves.toMatchObject({
        success: false,
        error: { transactionNotBroadcast: true },
      });
      expect(dispatch).not.toHaveBeenCalled();
    }
  );

  it('aborts the owned hardware lifetime when an approval window closes', async () => {
    const { pending } = await begin(undefined, 'sys_sign');
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    await submit('signSyscoinPsbt', sender(), [{ psbt: utxoPsbt }]);
    const authority = send.mock.calls[0][1];
    expect(authority?.signal?.aborted).toBe(false);
    closeWindow(9);
    await rejected;
    expect(authority.signal.aborted).toBe(true);
  });

  it('retires the old hardware operation before checking if the approval document survived navigation', async () => {
    const { pending } = await begin(undefined, 'sys_sign');
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    await submit('signSyscoinPsbt', sender(), [{ psbt: utxoPsbt }]);
    const first = send.mock.calls[0][1];

    let finishCheck!: (client: ReturnType<typeof source>) => void;
    (self as any).clients.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        })
    );
    const onNavigation = (chrome.tabs.onUpdated.addListener as jest.Mock).mock
      .calls[0][0];
    onNavigation(19, { status: 'loading', url: source().url });
    expect(first.signal.aborted).toBe(true);
    expect(first.assertCurrent).toThrow('no longer current');
    finishCheck(source());
    await new Promise(setImmediate);

    await submit('signSyscoinPsbt', sender(), [{ psbt: utxoPsbt }]);
    const second = send.mock.calls[1][1];
    expect(second.signal).not.toBe(first.signal);
    expect(second.signal.aborted).toBe(false);
    expect(first.assertCurrent).toThrow('no longer current');
    closeWindow(9);
    await rejected;
  });

  it.each([
    ['sys_sign', 'signSyscoinPsbt', 4001],
    ['sys_signAndSend', 'signSendAndSaveTransaction', -32603],
  ] as const)(
    'handles %s retirement after the signer or sender returns',
    async (request, method, code) => {
      const { pending } = await begin(undefined, request);
      const rejected = expect(pending).rejects.toMatchObject({ code });
      let enter!: () => void;
      let acknowledge!: (value: any) => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const result = new Promise<any>((resolve) => {
        acknowledge = resolve;
      });
      send.mockImplementation((_input, { assertCurrent }) => {
        assertCurrent();
        enter();
        return result;
      });
      const submitted = submit(method, sender(), [{ psbt: utxoPsbt }]);
      await entered;
      closeWindow(9);
      await rejected;
      const acknowledgement = { txid: 'ab'.repeat(32) };
      acknowledge(acknowledgement);
      if (request === 'sys_sign') {
        await expect(submitted).resolves.toMatchObject({ success: false });
      } else {
        await expect(submitted).resolves.toEqual(acknowledgement);
      }
    }
  );

  it('healthy control marks an admitted send as uncertain when its popup then closes', async () => {
    const { pending } = await begin();
    const rejected = expect(pending).rejects.toMatchObject({ code: -32603 });
    await submit('sendAndSaveEthTransaction');
    closeWindow(9);
    await rejected;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('binds the enrolled EVM approval to the captured wallet context and expires it on close', async () => {
    const { pending } = await begin();
    const rejected = expect(pending).rejects.toMatchObject({ code: -32603 });
    await submit('sendAndSaveEthTransaction');
    const admitted = send.mock.calls[0][4];
    expect(admitted.expectedContext).toEqual(approvedContext);
    expect(admitted.authorizeDapp).not.toThrow();
    closeWindow(9);
    await rejected;
    expect(admitted.authorizeDapp).toThrow('no longer current');
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
