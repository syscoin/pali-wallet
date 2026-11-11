import React, { useCallback, useState } from 'react';
import { KeyringAccountType } from '@sidhujag/sysweb3-keyring/cjs/types';
import { NativePrivateDeposit as DepositController } from '../../src/custody/privateDeposit';
import { NativePrivateDeposit } from '../../src/screens/NativePrivateDeposit';
import { NativeNoteInventory } from '../../src/screens/NativeNoteInventory';
import { PRIVACY_POOLS } from '../../../../source/utils/privacy/registry';
import type { IPrivacyDepositReview } from '../../../../source/utils/privacy/transactionTypes';
import type { NativeNoteInventory as NoteInventory } from '../../src/custody/noteBackupRuntime';
import type { NativePrivateAuthenticationScope } from '../../src/custody/privateAuthentication';
import { Button, Screen, Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const account = '0x2222222222222222222222222222222222222222';
const noteId = '11111111-1111-4111-8111-111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const events: string[] = [];
let reviews = 0;
let releaseOpen: (() => void) | undefined;
let releaseStatus: (() => void) | undefined;
let releaseClose: (() => void) | undefined;
declare global {
  interface Window {
    __privateDepositFixture: {
      events(): string[];
      releaseOpen(): void;
      releaseStatus(): void;
      releaseClose(): void;
    };
  }
}
window.__privateDepositFixture = {
  events: () => [...events],
  releaseOpen: () => releaseOpen?.(),
  releaseStatus: () => releaseStatus?.(),
  releaseClose: () => releaseClose?.(),
};
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

export function NativePrivateDepositFixture() {
  const [closed, setClosed] = useState('');
  const open = useCallback(async (signal: AbortSignal, check: () => void, _authentication: NativePrivateAuthenticationScope) => {
    events.push('open');
    check();
    const controller = new DepositController(
      {
        assertCurrent: check,
        transactions: {
          async prepareDeposit(request) {
            events.push(`review:${request.poolId}:${request.noteId ?? 'new'}`);
            await wait();
            check();
            if (query.has('failed'))
              throw Error('Synthetic provider diagnostic must stay hidden');
            const pool = PRIVACY_POOLS.find(
              (candidate) => candidate.id === request.poolId
            )!;
            const value =
              BigInt(pool.amount.replace('.', '')) *
              10n ** BigInt(18 - (pool.amount.split('.')[1]?.length ?? 0));
            const review: IPrivacyDepositReview = {
              intentId: `00000000-0000-4000-8000-${String(++reviews).padStart(
                12,
                '0'
              )}`,
              noteId,
              poolId: pool.id,
              amount: pool.amount,
              poolAddress: pool.address,
              account: {
                id: 0,
                type: KeyringAccountType.HDAccount,
                address: account,
              },
              chainId: 1,
              createdAt: Date.now(),
              expiresAt:
                Date.now() +
                (query.has('expire') && reviews === 1 ? 450 : 60000),
              feeMode: 'eip1559',
              gasLimit: '210000',
              maxFeePerGas: '20000000000',
              maxPriorityFeePerGas: '1000000000',
              nonce: '3',
              valueWei: value.toString(),
              maxNetworkFeeWei: '4200000000000000',
              maxTotalWei: (value + 4200000000000000n).toString(),
            };
            return review;
          },
          async submitDeposit(intentId) {
            events.push(`submit:${intentId}`);
            await wait();
            check();
            return {
              intentId,
              noteId,
              phase: query.has('unknown') ? 'unknown' : 'submitted',
              transactionHash: hash,
            };
          },
          async discardDeposit() {
            events.push('discard');
          },
          close() {
            events.push('transactions:close');
          },
        },
        async readStatus() {
          events.push('status');
          if (query.has('hold-status'))
            await new Promise<void>((resolve) => {
              releaseStatus = resolve;
            });
          check();
          return {
            phase: query.has('unknown') ? 'not-found' : 'verified',
            blockNumber: 100,
          };
        },
        async close() {
          events.push('close');
          if (query.has('hold-close'))
            await new Promise<void>((resolve) => {
              releaseClose = resolve;
            });
          events.push('closed');
        },
      },
      query.has('hold-open') ? new AbortController().signal : signal
    );
    // Deliberately return a late object without the host's usual abort check.
    // The screen must retire it independently of the backend's lifecycle.
    if (query.has('hold-open'))
      await new Promise<void>((resolve) => {
        releaseOpen = resolve;
      });
    return controller;
  }, []);
  if (closed)
    return (
      <Screen>
        <Text accessibilityRole="header">{closed}</Text>
        <Button title="Open deposit" onPress={() => setClosed('')} />
      </Screen>
    );
  return (
    <NativePrivateDeposit
      open={open}
      onBack={() => {
        events.push('back');
        setClosed('Private notes');
      }}
      onBackup={() => {
        events.push('backup');
        setClosed('Encrypted note backup');
      }}
      onActivity={(selected) => {
        events.push(`activity:${selected}`);
        setClosed('Saved Activity');
      }}
    />
  );
}

export function NativeNoteStatusFixture() {
  const [closed, setClosed] = useState(false);
  const read = useCallback(
    async (check: () => void, _authentication: NativePrivateAuthenticationScope): Promise<NoteInventory> => {
      check();
      const note = Object.freeze({ amount: '1', createdAt: 1762000000000 });
      return {
        notes: [note],
        async revealNote() {
          throw Error('This fixture never reveals a private note');
        },
        async checkNote(selected, assertCurrent) {
          if (selected !== note) throw Error('Wrong note selection');
          events.push('note:status');
          if (query.has('hold-status'))
            await new Promise<void>((resolve) => {
              releaseStatus = resolve;
            });
          assertCurrent();
          if (query.has('status-failed'))
            throw Error('Synthetic provider diagnostic must stay hidden');
          return {
            phase: query.has('spent') ? 'spent' : 'verified',
            blockNumber: 100,
          };
        },
      };
    },
    []
  );
  if (closed) return <Text>Private notes</Text>;
  return (
    <NativeNoteInventory
      readInventory={read}
      onBack={() => setClosed(true)}
      onLock={() => setClosed(true)}
    />
  );
}
