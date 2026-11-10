import {
  localPasskeyBase64,
  type LocalPasskeyPrompt,
} from '../../wallet/localPasskeyTypes';

import {
  localPasskeySupport,
  runLocalPasskeyCeremony,
} from './localUnlockCeremony';

const origin = `chrome-extension://${'a'.repeat(32)}`;
const encode = (length: number) =>
  localPasskeyBase64(new Uint8Array(length).fill(1));
const prompt = (): LocalPasskeyPrompt => ({
  kind: 'get',
  operationId: 'a'.repeat(32),
  ceremonyId: 'b'.repeat(32),
  challenge: encode(32),
  prfSalt: encode(32),
  credentialId: encode(16),
  origin,
  expiresAt: Date.now() + 60_000,
});
class Credential {
  static getClientCapabilities = jest
    .fn()
    .mockResolvedValue({ 'extension:prf': true });
  type = 'public-key';
  rawId = new Uint8Array(16).fill(2).buffer;
  response = {
    clientDataJSON: new Uint8Array(40).buffer,
    authenticatorData: new Uint8Array(37).buffer,
    signature: new Uint8Array(64).buffer,
  };
  output = new Uint8Array(32).fill(3);
  getClientExtensionResults() {
    return { prf: { results: { first: this.output.buffer } } };
  }
}
const previous = Object.fromEntries(
  ['window', 'navigator', 'PublicKeyCredential'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
);
let get: jest.Mock;
beforeEach(() => {
  get = jest.fn();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      document: { visibilityState: 'visible' },
      location: { origin },
      isSecureContext: true,
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { credentials: { get, create: jest.fn() } },
  });
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    configurable: true,
    value: Credential,
  });
});
afterAll(() => {
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it('requests exact credential, UV and PRF, then clears the borrowed PRF bytes', async () => {
  const credential = new Credential();
  get.mockResolvedValue(credential);
  expect(await localPasskeySupport()).toBe('supported');
  const response = await runLocalPasskeyCeremony(
    prompt(),
    new AbortController().signal,
    () => undefined
  );
  const options = get.mock.calls[0][0].publicKey;
  expect(options.rpId).toBe('a'.repeat(32));
  expect(options.userVerification).toBe('required');
  expect(options.allowCredentials).toHaveLength(1);
  expect(response.prfOutput).toBe(
    localPasskeyBase64(new Uint8Array(32).fill(3))
  );
  expect([...credential.output]).toEqual(Array(32).fill(0));
  expect([...options.extensions.prf.eval.first]).toEqual(Array(32).fill(0));
});

it('does not substitute an assertion when PRF output is missing', async () => {
  const credential = new Credential();
  Object.assign(credential, { getClientExtensionResults: () => ({}) });
  get.mockResolvedValue(credential);
  await expect(
    runLocalPasskeyCeremony(
      prompt(),
      new AbortController().signal,
      () => undefined
    )
  ).rejects.toThrow('LOCAL_PASSKEY_UNAVAILABLE');
});

it('discards a native credential that completes after cancellation', async () => {
  let resolve!: (value: Credential) => void;
  get.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const abort = new AbortController();
  const pending = runLocalPasskeyCeremony(
    prompt(),
    abort.signal,
    () => undefined
  );
  abort.abort();
  resolve(new Credential());
  await expect(pending).rejects.toThrow('LOCAL_PASSKEY_UNAVAILABLE');
  expect(get.mock.calls[0][0].signal.aborted).toBe(true);
});

it('rejects expired or wrong-origin prompts before contacting the browser', async () => {
  await expect(
    runLocalPasskeyCeremony(
      { ...prompt(), expiresAt: Date.now() - 1 },
      new AbortController().signal,
      () => undefined
    )
  ).rejects.toThrow();
  await expect(
    runLocalPasskeyCeremony(
      { ...prompt(), origin: `chrome-extension://${'b'.repeat(32)}` },
      new AbortController().signal,
      () => undefined
    )
  ).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
