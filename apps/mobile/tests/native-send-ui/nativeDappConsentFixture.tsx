import React, { useEffect, useRef, useState } from 'react';
import type { NativeSentryReview as SentryReview } from '../../src/connections/sentryRequests';
import type { NativeDappControlReview as ControlReview } from '../../src/connections/controlRequests';
import { NativeSentryReview } from '../../src/screens/NativeSentryReview';
import { NativeDappControlReview } from '../../src/screens/NativeDappControlReview';
import { NativeOperationAuthentication } from '../../src/screens/NativeOperationAuthentication';
import { nativeOperationAuthentication } from '../../src/platform/operationAuthentication';
import { Screen, Text } from '../../src/ui';

// Public presentation fixture only. No transport, keyring, secrets or signing capability.
const base = { id: 'consent-fixture', revision: 1, appName: 'Example staking app', origin: 'https://app.example.test',
  accountLabel: 'Daily wallet', address: 'sys1qexamplepublicaddress', networkLabel: 'Syscoin', chainId: '57',
  expiresAt: Date.now() + 300_000, busy: false, error: null,
  verification: { validation: 'UNKNOWN' as const, isScam: false } };
const operation: SentryReview = { ...base, details: { kind: 'operation', approval: {
  id: 'operation-fixture', network: 'mainnet', origin: base.origin, serviceUrl: 'https://state.example.test',
  keys: [{ id: 'operator', label: 'My operator key', network: 'mainnet', scheme: 'bls-basic', role: 'operator', publicKey: '11'.repeat(48) }],
  request: { version: 1, operation: 'updateService', chain: { genesisHash: '22'.repeat(32), era: 'legacy-v3' }, transactionHex: '00' },
  review: { operation: 'updateService', scheme: 'bls-basic', chain: { genesisHash: '22'.repeat(32), era: 'legacy-v3' },
    proTxHash: '33'.repeat(32), changes: { service: { previous: 'old.example.test:8369', next: 'new.example.test:8369' },
      nevmAddress: { previous: `0x${'44'.repeat(20)}`, next: `0x${'55'.repeat(20)}` }, operatorPayoutScript: { previous: '0014' + '66'.repeat(20), next: '0014' + '77'.repeat(20) } },
    feeSatoshis: '1000', inputCount: 1, authorizationHash: '88'.repeat(32),
    outputs: [{ valueSatoshis: '50000', scriptHex: '0014' + '99'.repeat(20), isPayload: false }] },
} } };
const control: ControlReview = { ...base, originSource: 'peer-metadata', details: { kind: 'network-add', name: 'Example network',
  chainId: '12345', symbol: 'COIN', rpcUrl: 'https://rpc.example.test' } };

export function NativeDappConsentFixture() {
  const [result, setResult] = useState('');
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const owner = new AbortController(); lifetime.current = owner;
    return () => owner.abort();
  }, []);
  if (result) return <Screen><Text>{result}</Text></Screen>;
  const done = async () => { setResult('Fixture approved'); };
  const reject = async () => { setResult('Fixture rejected'); };
  const approveSentry = async () => {
    const current = () => { if (lifetime.current.signal.aborted) throw Error('CANCELLED'); };
    await nativeOperationAuthentication.request({ id: 'fixture-sentry-authentication', purpose: 'transaction', biometricsEnabled: false },
      lifetime.current.signal, current, async (credential, guard) => {
        guard();
        return credential.method === 'pin' && credential.pin === '123456'
          ? { accepted: true } : { accepted: false, reason: 'INVALID_CREDENTIAL' };
      });
    current(); await done();
  };
  return new URLSearchParams(location.search).has('control-consent')
    ? <NativeDappControlReview review={control} controller={{ approveControl: done, rejectControl: reject }} />
    : <><NativeSentryReview review={operation} controller={{ approveSentry, rejectSentry: reject }} />
      <NativeOperationAuthentication isProtectedPromptActive={() => false} /></>;
}
