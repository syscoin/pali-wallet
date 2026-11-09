import React from 'react';
import { NativeSentryNodes } from '../../src/screens/NativeSentryNodes';
import type {
  NativeSentryNodeManagement,
  SentryNodeLinkReview,
} from '../../src/custody/sentryNodeManagement';
import type { SentryCollateralReservation } from '../../../../source/wallet/sentryCollateral';

// Public screen fixture only: native storage, authority and network validation are tested separately.
const node = Object.freeze({
  proTxHash: '11'.repeat(32),
  service: 'sentry.example:8369',
  nevmAddress: '0x' + '22'.repeat(20),
  collateralOutpoint: Object.freeze({ txid: '33'.repeat(32), vout: 0 }),
});
const options = new URLSearchParams(location.search);
let linked = options.has('linked');
let protectedCollateral = linked;
let releaseLookup: (() => void) | undefined;
const calls: string[] = [];
declare global {
  interface Window {
    __nativeSentryNodesFixture: {
      calls(): readonly string[];
      releaseLookup(): void;
    };
  }
}
window.__nativeSentryNodesFixture = {
  calls: () => calls,
  releaseLookup: () => releaseLookup?.(),
};
const open = async (
  signal: AbortSignal,
  assertCurrent: () => void
): Promise<NativeSentryNodeManagement> => {
  let disposed = false;
  let review: SentryNodeLinkReview | undefined;
  const check = () => {
    assertCurrent();
    if (disposed || signal.aborted) throw new Error('CANCELLED');
  };
  const reservation = (): SentryCollateralReservation => ({
    ...node.collateralOutpoint,
    proTxHash: node.proTxHash,
  });
  return {
    async list() {
      check();
      return {
        network: 'mainnet',
        serviceUrl: 'https://sentry.example',
        linkedNodes: linked ? [node] : [],
        collateral: protectedCollateral ? [reservation()] : [],
      };
    },
    async prepareLink(value) {
      check();
      calls.push('lookup');
      if (options.has('hold'))
        await new Promise<void>((resolve) => {
          releaseLookup = resolve;
        });
      check();
      if (options.has('error') || value !== node.proTxHash)
        throw new Error('Fixture lookup failed');
      return (review = Object.freeze({
        id: 'public-review',
        network: 'mainnet',
        node,
        origin: 'Pali Wallet',
        serviceUrl: 'https://sentry.example',
      }));
    },
    async confirmLink(value) {
      check();
      if (value !== review) throw new Error('Review changed');
      calls.push('link');
      linked = protectedCollateral = true;
      return {
        version: 1,
        linked: true,
        proTxHash: node.proTxHash,
        genesisHash: '44'.repeat(32),
      };
    },
    cancelLink() {
      review = undefined;
    },
    async releaseCollateral(input) {
      check();
      if (
        !input.acknowledgeNodeStops ||
        input.password !== 'Fixture password 1!'
      )
        throw new Error('Invalid fixture confirmation');
      calls.push('release');
      protectedCollateral = false;
      return input.reservation;
    },
    dispose() {
      disposed = true;
      review = undefined;
    },
  };
};
export function NativeSentryNodesFixture() {
  return (
    <NativeSentryNodes
      networkLabel="Syscoin"
      open={open}
      onBack={() => calls.push('close')}
    />
  );
}
