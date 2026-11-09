import { executeDappRpcRequest, type DappPublicRpcRequest } from '../../../../source/shared/dappRpcReads.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';

export type NativeConnectionReadHost = Readonly<{
  read(request: DappPublicRpcRequest, signal: AbortSignal, assertCurrent: () => void): Promise<unknown>;
}>;
/** Public node queries/controls on one registration, with the existing wallet HTTP/owner fences. */
export function createNativeDappRpcReadHost(ports: Readonly<{
  registration(): NativeNetworkRegistration;
  fetch(url: string, init: RequestInit): Promise<Response>;
  verifyPersonalMessage(message: string, signature: string): string;
}>): NativeConnectionReadHost {
  return Object.freeze({ async read(request, signal, assertCurrent) {
    const selected = snapshotNativeNetwork(ports.registration());
    const check = () => { assertCurrent(); if (signal.aborted || ports.registration().registrationHash !== selected.registrationHash) throw new Error('CONTEXT_CHANGED'); };
    check();
    const result = await executeDappRpcRequest(request, { assertCurrent: check,
      verifyPersonalMessage: ports.verifyPersonalMessage,
      request: request => new EvmTransferReadRpc(selected, { fetch: ports.fetch }).dappRequest(request, signal, check) });
    check(); return result;
  } });
}
