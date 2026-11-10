import React, { useCallback, useState } from 'react';
import { KeyringAccountType } from '@sidhujag/sysweb3-keyring/cjs/types';
import type { NativePrivateWithdrawalView as View } from '../../src/custody/privateWithdrawal';
import type { NativeNoteInventory as Inventory } from '../../src/custody/noteBackupRuntime';
import { NativeNoteInventory } from '../../src/screens/NativeNoteInventory';
import { PRIVACY_POOLS } from '../../../../source/utils/privacy/registry';
import { Text } from '../../src/ui';

// Public presentation only. No note secret, proof worker, network or signer.
type Snapshot = ReturnType<View['getSnapshot']>;
const query = new URLSearchParams(window.location.search);
const events: string[] = [];
const noteId = '11111111-1111-4111-8111-111111111111';
const hash = `0x${'ab'.repeat(32)}`;
let release: (() => void) | undefined;
let revision = 0;
declare global {
  interface Window {
    __privateWithdrawalFixture: { events(): string[]; release(): void };
  }
}
window.__privateWithdrawalFixture = {
  events: () => [...events],
  release: () => release?.(),
};

export function NativePrivateWithdrawalFixture() {
  const [closed, setClosed] = useState(false);
  const readInventory = useCallback(
    async (assertInventory: () => void): Promise<Inventory> => {
      assertInventory();
      events.push('inventory');
      const note = Object.freeze({
        amount: '1',
        createdAt: 1762000000000,
        ...(query.has('history') ||
        events.some((event) => event.startsWith('confirm:'))
          ? { reconciliation: 'withdrawal-history' as const }
          : {}),
      });
      return {
        notes: [note],
        async revealNote() {
          throw new Error('This presentation never reveals a note');
        },
        async checkNote(selected, check) {
          if (selected !== note) throw new Error('Wrong fixture note');
          check();
          events.push('note:status');
          return {
            phase: query.has('spent') ? 'spent' : 'verified',
            blockNumber: 100,
          };
        },
        async openWithdrawal(selected, signal, assertCurrent) {
          if (selected !== note) throw new Error('Wrong fixture note');
          let disposed = false;
          let directoryReads = 0;
          let snapshot: Snapshot = Object.freeze<Snapshot>({
            phase: 'idle',
            canSign: !query.has('watch'),
            relayers: [],
            progress: null,
            review: null,
            result: null,
            status: query.has('history')
              ? {
                  phase: 'unknown',
                  noteId,
                  mode: 'direct',
                  transactionHash: hash,
                }
              : null,
            noteStatus: {
              phase: query.has('history') ? 'waiting' : 'verified',
              blockNumber: 100,
            },
            checking: false,
            restored: query.has('restored'),
            error: null,
          });
          const listeners = new Set<(snapshot: Snapshot) => void>();
          const check = () => {
            assertInventory();
            assertCurrent();
            if (disposed || signal.aborted) throw new Error('CANCELLED');
          };
          const publish = (update: Partial<Snapshot>) => {
            check();
            snapshot = Object.freeze({ ...snapshot, ...update });
            for (const listener of listeners) listener(snapshot);
          };
          const controller: View = {
            getSnapshot: () => snapshot,
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            async loadRelayers() {
              check();
              events.push('directory');
              directoryReads++;
              const changed =
                directoryReads > 1 &&
                (query.has('relayer-removed') || query.has('relayer-disabled'));
              publish({
                relayers: [
                  ...(changed && query.has('relayer-removed')
                    ? []
                    : [
                        {
                          id: 'fixture-relayer',
                          name: 'Fixture relayer',
                          health: changed
                            ? ('unavailable' as const)
                            : ('reported-healthy' as const),
                          supportedPools: ['eth-1' as const],
                          feePercent: '0.3',
                        },
                      ]),
                  {
                    id: 'unavailable-relayer',
                    name: 'Unavailable relayer',
                    health: 'unavailable',
                    supportedPools: ['eth-1'],
                  },
                ],
              });
            },
            async prepare(request) {
              check();
              events.push(`prepare:${request.mode}:${request.recipient}`);
              publish({
                phase: 'preparing',
                review: null,
                error: null,
                progress: { stage: 'proving' },
              });
              if (query.has('hold-proof'))
                await new Promise<void>((resolve) => {
                  release = resolve;
                });
              check();
              if (query.has('failed')) {
                publish({ phase: 'failed', progress: null, error: 'failed' });
                return;
              }
              const relayed = request.mode === 'relayed';
              publish({
                phase: 'review',
                progress: null,
                review: Object.freeze({
                  intentId: `00000000-0000-4000-8000-${String(
                    ++revision
                  ).padStart(12, '0')}`,
                  noteId,
                  poolId: 'eth-1',
                  amount: '1',
                  poolAddress: PRIVACY_POOLS.find(
                    (pool) => pool.id === 'eth-1'
                  )!.address,
                  mode: request.mode,
                  recipient: request.recipient,
                  account: {
                    id: 0,
                    type: KeyringAccountType.HDAccount,
                    address: `0x${'22'.repeat(20)}`,
                  },
                  chainId: 1,
                  expiresAt:
                    Date.now() +
                    (query.has('expire') && revision === 1 ? 250 : 60000),
                  gasLimit: '650000',
                  maxNetworkFeeWei: '13000000000000000',
                  serviceFeeWei: relayed ? '3000000000000000' : '0',
                  feeWei: relayed ? '16000000000000000' : '0',
                  receiveWei: relayed
                    ? '984000000000000000'
                    : '1000000000000000000',
                  ...(relayed
                    ? {
                        relayerId: 'fixture-relayer',
                        relayerName: 'Fixture relayer',
                        relayerEndpoint: 'https://relay.example/withdraw',
                      }
                    : {}),
                }),
              });
            },
            async confirm(intentId) {
              check();
              if (snapshot.review?.intentId !== intentId)
                throw new Error('Wrong fixture intent');
              events.push(`confirm:${intentId}`);
              if (
                query.has('not-broadcast') &&
                events.filter((event) => event.startsWith('confirm:'))
                  .length === 1
              ) {
                publish({ phase: 'failed', error: 'failed' });
                return;
              }
              const relayed = snapshot.review.mode === 'relayed';
              publish({
                phase: query.has('unknown') ? 'unknown' : 'submitted',
                result: {
                  intentId,
                  noteId,
                  phase: query.has('unknown') ? 'unknown' : 'submitted',
                  ...(relayed
                    ? { jobId: 'fixture-job' }
                    : { transactionHash: hash }),
                },
              });
            },
            async refresh() {
              check();
              events.push('status');
              publish({
                checking: false,
                ...(query.has('reconciled-submission')
                  ? {
                      status: {
                        phase: 'submitted' as const,
                        noteId,
                        mode: 'direct' as const,
                        transactionHash: `0x${'cd'.repeat(32)}`,
                      },
                    }
                  : {}),
                noteStatus: {
                  phase:
                    query.has('unknown') && !query.has('reconciled-spent')
                      ? 'verified'
                      : 'spent',
                  blockNumber: 101,
                },
              });
            },
            async reviewRestored(password) {
              check();
              events.push('restore:review');
              publish(
                password === '123456'
                  ? { restored: false, error: null }
                  : { error: 'restored' }
              );
            },
            async dispose() {
              if (!disposed) {
                disposed = true;
                events.push('dispose');
                listeners.clear();
                if (query.has('hold-dispose'))
                  await new Promise<void>((resolve) => {
                    release = resolve;
                  });
                events.push('disposed');
              }
            },
          };
          events.push('open');
          if (query.has('hold-open'))
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return controller;
        },
      };
    },
    []
  );
  if (closed) return <Text>Private notes</Text>;
  return (
    <NativeNoteInventory
      readInventory={readInventory}
      onBack={() => setClosed(true)}
      onLock={() => setClosed(true)}
    />
  );
}
