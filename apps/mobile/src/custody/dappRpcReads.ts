import type { DappRpcReadRequest } from '../../../../source/shared/dappRpcReads.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';

export type NativeConnectionReadHost = Readonly<{
  read(request: DappRpcReadRequest, signal: AbortSignal, assertCurrent: () => void): Promise<unknown>;
}>;
/** One selected registration, with the same HTTP, chain, byte and time fences as wallet reads. */
export function createNativeDappRpcReadHost(ports: Readonly<{
  registration(): NativeNetworkRegistration;
  fetch(url: string, init: RequestInit): Promise<Response>;
}>): NativeConnectionReadHost {
  return Object.freeze({ async read(request, signal, assertCurrent) {
    const selected = snapshotNativeNetwork(ports.registration());
    const check = () => { assertCurrent(); if (signal.aborted || ports.registration().registrationHash !== selected.registrationHash) throw new Error('CONTEXT_CHANGED'); };
    check();
    const result = await new EvmTransferReadRpc(selected, { fetch: ports.fetch }).dappRead(request, signal, check);
    check(); return result;
  } });
}
