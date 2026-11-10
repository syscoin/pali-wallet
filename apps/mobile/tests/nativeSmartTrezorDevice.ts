import assert from 'node:assert/strict';
import { Wallet } from 'ethers/wallet';
import { createTrezorSessions } from '../src/hardware/trezorSessions.ts';
import type { NativeTrezorClient } from '../src/hardware/trezorHost.ts';

type TypedData = Parameters<Wallet['signTypedData']>;
export type NativeSmartTrezorRequest = Readonly<{
  method: string;
  params: Record<string, any>;
  callbackUrl: string;
  response: { success: true; payload: Record<string, unknown> };
}>;

/** Disposable Suite I/O; derivation, typed-data conversion and ownership stay in the SDK. */
export function nativeSmartTrezorDevice() {
  const wallets = [new Wallet('0x' + '31'.repeat(32)), new Wallet('0x' + '32'.repeat(32))];
  const requests: NativeSmartTrezorRequest[] = [], urls: string[] = [];
  const signatures: { index: number; data: Record<string, any>; signature: string }[] = [];
  const callbackErrors: unknown[] = [], accepted: boolean[] = [];
  let loads = 0, inits = 0, cancels = 0, disposals = 0, randomness = 0;
  let beforeCallback: ((request: NativeSmartTrezorRequest) => void | Promise<void>) | undefined;
  let beforeDispose: (() => void | Promise<void>) | undefined;
  let wrongIndex: number | undefined, wrongProof = false;
  const indexOf = (path: unknown) => {
    assert.equal(typeof path, 'string');
    const index = Number((path as string).split('/').at(-1));
    assert(Number.isSafeInteger(index) && index >= 0 && wallets[index], 'Unexpected Trezor fixture index');
    return index;
  };
  const sessions = createTrezorSessions({
    randomBytes: length => new Uint8Array(length).fill(++randomness),
    async loadClient() {
      const id = ++loads;
      let settings!: Parameters<NativeTrezorClient['init']>[0];
      let settle!: (value: unknown) => void;
      const vendor = new Promise<unknown>(resolve => { settle = resolve; });
      return {
        async init(value) { inits++; settings = value; },
        call({ method, ...params }) {
          const callback = new URL(settings.deeplinkCallbackUrl);
          callback.searchParams.set('id', `fixture-${id}`);
          const url = new URL(settings.connectSrc + 'deeplink/1/');
          url.searchParams.set('method', String(method));
          url.searchParams.set('params', JSON.stringify(params));
          url.searchParams.set('callback', callback.toString());
          url.searchParams.set('appName', settings.manifest.appName);
          settings.deeplinkOpen(url.toString());
          return vendor;
        },
        cancel() { cancels++; settle(undefined); },
        async dispose() { disposals++; await beforeDispose?.(); },
      } satisfies NativeTrezorClient;
    },
    async openURL(text) {
      urls.push(text);
      const url = new URL(text), method = url.searchParams.get('method')!;
      const params = JSON.parse(url.searchParams.get('params')!) as Record<string, any>;
      const callbackUrl = url.searchParams.get('callback')!;
      let payload: Record<string, unknown>;
      if (method === 'getFeatures') {
        payload = { model: 'T', initialized: true, unlocked: true };
      } else {
        const index = indexOf(params.path), wallet = wallets[index === wrongIndex ? 1 - index : index]!;
        if (method === 'ethereumGetPublicKey') {
          payload = { publicKey: wallet.signingKey.publicKey.slice(2) };
        } else if (method === 'ethereumGetAddress') {
          payload = { address: wallet.address };
        } else if (method === 'ethereumSignTypedData') {
          const data = params.data, types = { ...data.types };
          delete types.EIP712Domain;
          const signature = wrongProof
            ? await wallet.signMessage('Unrelated Trezor fixture proof')
            : await wallet.signTypedData(data.domain as TypedData[0], types as TypedData[1], data.message);
          signatures.push({ index, data, signature });
          payload = { address: wallet.address, signature };
        } else {
          throw new Error(`Unexpected Trezor fixture method: ${method}`);
        }
      }
      const request = { method, params, callbackUrl, response: { success: true as const, payload } };
      requests.push(request);
      // Let openURL finish before delivering the app callback, as the platform does.
      setImmediate(() => {
        void Promise.resolve().then(() => beforeCallback?.(request)).then(() => {
          const callback = new URL(request.callbackUrl);
          callback.searchParams.set('response', JSON.stringify(request.response));
          accepted.push(sessions.receiveCallback(callback.toString()));
        }).catch(error => callbackErrors.push(error));
      });
    },
  });
  return {
    wallets, sessions, requests, urls, signatures, callbackErrors, accepted,
    counts: () => ({ loads, inits, cancels, disposals }),
    onBeforeCallback(hook: typeof beforeCallback) { beforeCallback = hook; },
    onBeforeDispose(hook: typeof beforeDispose) { beforeDispose = hook; },
    wrongKey(index: number) { wrongIndex = index; },
    wrongSignature() { wrongProof = true; },
    dispose: () => sessions.dispose(),
  };
}
