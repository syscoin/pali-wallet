import type { NativeNetworkSelectionReceipt } from '../src/custody/accounts.ts';
/** Explicit public proof for presentation/adapter fixtures; no SDK or signing authority. */
export function networkSelectionReceiptFixture(
  target: NativeNetworkSelectionReceipt['target'], selection: NativeNetworkSelectionReceipt['selection'],
  sourceContextRevision: number, sourceCatalogueRevision: number, assertCurrent: () => void,
): NativeNetworkSelectionReceipt {
  return Object.freeze({ target, selection: Object.freeze({ ...selection }), sourceContextRevision, sourceCatalogueRevision,
    contextRevision: sourceContextRevision + 1, catalogueRevision: sourceCatalogueRevision + 1, assertCurrent });
}
