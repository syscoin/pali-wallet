import { NATIVE_NETWORKS, getNativeSendContext } from '../../src/custody/networkContext';
import { createNativeChainCatalogue } from '../../src/custody/networkCatalogue';
import { EVM_CHAIN_CATALOGUE_URL } from '../../../../source/shared/chainCatalogueData';
// Public deterministic UI fixture. No storage, RPC or signing authority is loaded.
import React, { useLayoutEffect, useState } from 'react';
import type { NativeNetworkSnapshot, NativeNetworkView } from '../../src/custody/networkView';
import { NativeNetworks } from '../../src/screens/NativeNetworks';
import { Text } from '../../src/ui';

const networks: NativeNetworkSnapshot['networks'][number][] = NATIVE_NETWORKS.map((registration) => ({ id: registration.id, name: getNativeSendContext(registration).name,
  symbol: registration.symbol, testnet: registration.testnet, canSign: true, registration }));
const customUtxo = { id: 'custom-litecoin', name: 'Custom Litecoin', symbol: 'LTC', testnet: false,
  canSign: true, customUtxoEndpoint: 'https://litecoin.example/blockbook' };
if (new URLSearchParams(window.location.search).has('utxo')) networks.push(customUtxo);
let snapshot: NativeNetworkSnapshot | null = Object.freeze({ revision: 4, selectedId: 'ethereum', networks });
let contextRevision = 19;
let cancelled = 0;
let release: (() => void) | undefined;
let releaseReplacement: (() => void) | undefined;
let releaseCatalogue: (() => void) | undefined;
let releaseSave: (() => void) | undefined;
let catalogueRequests = 0;
let saveRequests = 0;
let swapController: ((restore?: boolean) => void) | undefined;
const listeners = new Set<() => void>();
const requests: { id: string; contextRevision: number; catalogueRevision: number }[] = [];
const notify = () => { for (const listener of listeners) listener(); };
const loadCatalogue = createNativeChainCatalogue(async (url) => {
  if (url !== EVM_CHAIN_CATALOGUE_URL) throw new Error('Unexpected catalogue URL');
  catalogueRequests++;
  const mode = new URLSearchParams(window.location.search).get('catalogue');
  if (mode === 'held') await new Promise<void>((resolve) => { releaseCatalogue = resolve; });
  if (mode === 'offline' || (mode === 'retry' && catalogueRequests === 1))
    return new Response('Forbidden', { status: 403 });
  return Response.json([
    { chainId: 31337, name: 'Example test network with an intentionally long label', isTestnet: true,
      nativeCurrency: { symbol: 'EX', decimals: 18 }, rpc: [
        { url: 'https://other.example/rpc' },
        { url: 'https://preferred.example/rpc', tracking: 'none', isOpenSource: true },
      ] },
    { chainId: 31338, name: 'Example incompatible network',
      nativeCurrency: { symbol: 'NOT18', decimals: 6 }, rpc: [{ url: 'https://other.example/rpc' }] },
  ]);
});
const controller: NativeNetworkView = {
  getSnapshot: () => snapshot,
  getContextRevision: () => contextRevision,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  cancel() { cancelled++; contextRevision++; },
  loadCatalogue,
  async verifyUtxoEndpoint(id, endpoint, expectedContextRevision, expectedCatalogueRevision) {
    if (id !== customUtxo.id || !snapshot || contextRevision !== expectedContextRevision ||
        snapshot.revision !== expectedCatalogueRevision || endpoint !== 'https://replacement.example/blockbook')
      throw Error('INVALID_INPUT');
  },
  async renameUtxo(id, name, expectedContextRevision, expectedCatalogueRevision) {
    if (id !== customUtxo.id || !snapshot || contextRevision !== expectedContextRevision ||
        snapshot.revision !== expectedCatalogueRevision) throw Error('CANCELLED');
    snapshot = Object.freeze({ ...snapshot, revision: snapshot.revision + 1,
      networks: snapshot.networks.map((network) => network.id === id ? { ...network, name } : network) });
    contextRevision++; notify();
  },
  async save(registration, expectedContextRevision, expectedCatalogueRevision) {
    if (!snapshot || contextRevision !== expectedContextRevision || snapshot.revision !== expectedCatalogueRevision) throw Error('CANCELLED');
    saveRequests++;
    if (new URLSearchParams(window.location.search).has('holdSave')) {
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      throw Error('CANCELLED');
    }
    snapshot = Object.freeze({ ...snapshot, revision: snapshot.revision + 1, networks: [...snapshot.networks.filter((network) => network.id !== registration.id),
      { id: registration.id, name: registration.name, symbol: registration.symbol, testnet: registration.testnet, canSign: true, registration }] });
    contextRevision++; notify();
  },
  async select(id, expectedContextRevision, expectedCatalogueRevision) {
    if (!snapshot || contextRevision !== expectedContextRevision || snapshot.revision !== expectedCatalogueRevision) throw Error('CANCELLED');
    requests.push({ id, contextRevision: expectedContextRevision, catalogueRevision: expectedCatalogueRevision });
    if (new URLSearchParams(window.location.search).has('busy')) throw Error('BUSY');
    if (new URLSearchParams(window.location.search).has('hold')) await new Promise<void>((resolve) => { release = resolve; });
    if (!snapshot || contextRevision !== expectedContextRevision || snapshot.revision !== expectedCatalogueRevision) throw Error('CANCELLED');
    snapshot = Object.freeze({ ...snapshot, selectedId: id, revision: snapshot.revision + 1 });
    contextRevision++; notify();
  },
};
let replacementSnapshot: NativeNetworkSnapshot = Object.freeze({ revision: 7, selectedId: 'ethereum', networks });
let replacementRevision = 41;
const replacementListeners = new Set<() => void>();
const replacementController: NativeNetworkView = {
  getSnapshot: () => replacementSnapshot,
  getContextRevision: () => replacementRevision,
  subscribe(listener) { replacementListeners.add(listener); return () => replacementListeners.delete(listener); },
  cancel() { replacementRevision++; cancelled++; },
  async select(id, context, revision) {
    if (context !== replacementRevision || revision !== replacementSnapshot.revision) throw Error('CANCELLED');
    requests.push({ id, contextRevision: context, catalogueRevision: revision });
    await new Promise<void>((resolve) => { releaseReplacement = resolve; });
    if (context !== replacementRevision || revision !== replacementSnapshot.revision) throw Error('CANCELLED');
    replacementSnapshot = Object.freeze({ ...replacementSnapshot, selectedId: id, revision: revision + 1 });
    replacementRevision++;
    for (const listener of replacementListeners) listener();
  },
};
declare global {
  interface Window {
    __nativeNetworksFixture: {
      requests(): readonly { id: string; contextRevision: number; catalogueRevision: number }[];
      cancelled(): number;
      release(): void;
      replace(): void;
      replaceController(): void;
      restoreController(): void;
      releaseReplacement(): void;
      releaseCatalogue(): void;
      releaseSave(): void;
      catalogueRequests(): number;
      saveRequests(): number;
      selected(): string | null;
      registration(id: string): import('../../src/custody/networkContext').NativeNetworkRegistration | undefined;
    };
  }
}
window.__nativeNetworksFixture = {
  requests: () => requests,
  cancelled: () => cancelled,
  release: () => release?.(),
  selected: () => snapshot?.selectedId ?? null,
  registration: (id) => snapshot?.networks.find((network) => network.id === id)?.registration,
  replaceController: () => swapController?.(),
  restoreController: () => swapController?.(true),
  releaseReplacement: () => releaseReplacement?.(),
  releaseCatalogue: () => releaseCatalogue?.(),
  releaseSave: () => releaseSave?.(),
  catalogueRequests: () => catalogueRequests,
  saveRequests: () => saveRequests,
  replace() {
    if (snapshot) snapshot = Object.freeze({ ...snapshot, selectedId: 'ethereum', revision: snapshot.revision + 1 });
    contextRevision++; notify();
  },
};
export function NetworkPickerFixture() {
  const [open, setOpen] = useState(true);
  const [activeController, setActiveController] = useState<NativeNetworkView>(controller);
  useLayoutEffect(() => {
    swapController = (restore) => setActiveController(restore ? controller : replacementController);
    return () => { swapController = undefined; };
  }, []);
  return open ? <NativeNetworks controller={activeController} onBack={() => setOpen(false)} /> : <Text>Picker closed</Text>;
}
