import assert from 'node:assert/strict';
import { TypedDataEncoder, hashMessage } from 'ethers/hash';
import { Wallet } from 'ethers/wallet';
import type { KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import type { NativeLedgerTransport } from '../src/hardware/ownedLedgerTransport.ts';

/** Disposable semantic device I/O. SDK derivation, context and signing paths stay real. */
export function nativeSmartLedgerDevice() {
  const wallets = [new Wallet('0x' + '31'.repeat(32)), new Wallet('0x' + '32'.repeat(32))];
  const addressReads: number[] = [], signatures: {index: number; digest: string}[] = [];
  let wrongIndex: number | undefined, wrongProof = false, heldAddress: (() => Promise<void>) | undefined;
  let heldSignature: (() => Promise<void>) | undefined;
  const factory: NonNullable<KeyringRuntimeDependencies['createLedgerTransport']> = async scope => {
    let connected = false, disposed = false;
    const listeners = new Set<() => void>();
    const check = () => {scope.assertCurrent(); assert(!scope.signal.aborted && !disposed, 'CANCELLED');};
    const unavailable = async () => {throw Error('Unexpected Ledger operation');};
    const candidate = {id: 'disposable-ledger', transport: 'RN_BLE', name: 'Ledger fixture', deviceModel: {name: 'Nano X'}};
    const transport: NativeLedgerTransport = {
      host: {
        getStatus: () => ({connected: connected && !disposed}),
        subscribeStatus(listener) {listeners.add(listener); return () => listeners.delete(listener);},
        connect: async () => {check(); assert(connected);},
        disconnect: async () => {connected = false;},
        retire: async () => () => undefined,
        beginDeviceSelection: () => async device => {check(); assert.equal(device, candidate); connected = true;},
        evm: {
          async getAddress(request) {
            check(); addressReads.push(request.accountIndex); await heldAddress?.(); check();
            const wallet = wallets[request.accountIndex === wrongIndex ? 1 - request.accountIndex : request.accountIndex];
            assert(wallet); return {address: wallet.address, publicKey: wallet.signingKey.publicKey};
          },
          async signTypedData(request, authority) {
            check(); authority.assertCurrent(); await heldSignature?.(); check(); authority.assertCurrent();
            const types = {...request.data.types}; delete types.EIP712Domain;
            const digest = TypedDataEncoder.hash(request.data.domain, types, request.data.message);
            signatures.push({index: request.accountIndex, digest});
            return wallets[request.accountIndex]!.signingKey.sign(wrongProof ? hashMessage(digest) : digest).serialized;
          },
          signPersonalMessage: unavailable, signTransaction: unavailable,
        },
        utxo: {getXpub: unavailable, getAddress: unavailable, getAccount: unavailable, signMessage: unavailable, signPsbt: unavailable},
      },
      async observeDevices(receive) {check(); receive([candidate as never]); return async () => undefined;},
      async dispose() {disposed = true; connected = false; for (const listener of listeners) listener();},
    };
    return transport;
  };
  return {factory, wallets, addressReads, signatures,
    wrongKey(index: number) {wrongIndex = index;}, wrongProof() {wrongProof = true;},
    holdAddress(hook: () => Promise<void>) {heldAddress = hook;}, holdSignature(hook: () => Promise<void>) {heldSignature = hook;}};
}
