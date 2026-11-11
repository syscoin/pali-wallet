import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NativeNoteExport, type NativeNoteExportStep } from '../../src/screens/NativeNoteExport';
import { NativeNoteRestore } from '../../src/screens/NativeNoteRestore';
import { NativeNoteMaintenance } from '../../src/screens/NativeNoteMaintenance';
import { FixtureDeviceAuthorization, fixtureDeviceAuthorization } from './fixtureDeviceAuthorization';
import { bindNativePrivateAuthentication, withNativePrivateAuthentication, type NativePrivateAuthenticationScope } from '../../src/custody/privateAuthentication';
import type { NativeNoteMaintenanceRuntime } from '../../src/custody/noteBackupRuntime';
import { Screen, Text } from '../../src/ui';
const preview = Object.freeze({ id: 'public-preview', added: 2, duplicates: 1, guarded: 1, expiresAt: performance.now() + 300_000 });

/** Actual note screens with public presentation adapters. No file, key, storage, or RPC access. */
export function NativeNoteAuthFixture() {
  const kind = new URLSearchParams(location.search).get('note-auth-leaf');
  const owner = useRef<AbortController | null>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [closed, setClosed] = useState(false);
  const [exportStep, setExportStep] = useState<NativeNoteExportStep>({ phase: 'passwords' });
  useEffect(() => {
    const lifetime = new AbortController(); owner.current = lifetime;
    return () => { lifetime.abort(); if (owner.current === lifetime) owner.current = null; };
  }, []);
  const authorize = useCallback(async (signal: AbortSignal, check: () => void) => {
    await fixtureDeviceAuthorization.request('secret-read', signal, check);
    check();
  }, []);
  const complete = async () => {
    const lifetime = owner.current;
    if (!lifetime || working.current) return;
    const check = () => { if (owner.current !== lifetime || lifetime.signal.aborted) throw Error('CANCELLED'); };
    working.current = true; setBusy(true); setError('');
    try { await authorize(lifetime.signal, check); setClosed(true); }
    catch { if (owner.current === lifetime && !lifetime.signal.aborted) setError('Authorization cancelled.'); }
    finally { working.current = false; if (owner.current === lifetime) setBusy(false); }
  };
  const back = () => { owner.current?.abort(); setClosed(true); };
  const openMaintenance = useCallback(async (signal: AbortSignal, guard: () => void, scope: NativePrivateAuthenticationScope): Promise<NativeNoteMaintenanceRuntime> => {
    let disposed = false;
    const current = () => { if (signal.aborted || disposed) throw Error('CANCELLED'); };
    const binding = bindNativePrivateAuthentication(scope, { assertCurrent: current, isPromptActive: owner => fixtureDeviceAuthorization.isActive(owner) });
    return {
      async getNotes(check) { current(); guard(); check(); return { notes: [{ id: 'public-note', poolId: 'eth-1', amount: '1', createdAt: 1762000000000,
        phase: 'verified', withdrawal: { canCheckRecovery: true, mode: 'direct', phase: 'submitted', transactionHash: '0x' + 'ab'.repeat(32) } }] }; },
      async recoverFailedWithdrawal(id, check) {
        current(); guard(); check(); if (id !== 'public-note') throw Error('Wrong presentation note');
        await withNativePrivateAuthentication(binding, signal, current, proof => authorize(proof, check));
      },
      async clearCompletedNote() { throw Error('No note mutation in this presentation fixture'); },
      async dispose() { disposed = true; },
    };
  }, [authorize]);
  if (closed) return <Screen><Text>Note presentation closed. No private data or files were changed.</Text></Screen>;
  return <>
    {kind === 'maintenance' ? <NativeNoteMaintenance open={openMaintenance} onBack={back} /> : kind === 'restore' ?
      <NativeNoteRestore step={{ phase: 'review', preview }} busy={busy} error={error}
        onChoose={() => {}} onOpen={() => {}} onRestore={id => { if (id === 'public-preview') void complete(); }} onBack={back} /> :
      <NativeNoteExport step={exportStep} busy={busy} error={error} onChoose={() => setExportStep({ phase: 'passwords' })}
        onSave={password => { if (password.length >= 12) void complete(); }} onShowVerify={() => setExportStep({ phase: 'verify', noteCount: 2 })}
        onVerify={() => {}} onBack={back} />}
    <FixtureDeviceAuthorization />
  </>;
}
