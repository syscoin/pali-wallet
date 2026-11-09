import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeSlhDsaManagementScreen } from '../../src/screens/NativeSlhDsaManagement';
import { NativeSmartAccountOperationContent } from '../../src/screens/NativeSmartAccountOperation';
import type { NativeSlhDsaManagement } from '../../src/smartAccount/slhDsaManagement';
import type { NativeSlhPublicState } from '../../src/smartAccount/slhDsaRuntime';
import type { NativeSmartAccountOperationSnapshot } from '../../src/smartAccount/operation';
import { getNativeNetwork } from '../../src/custody/networkContext';
import { getSLHDSAKeyId, SLH_DSA_PARAMETER_SET, SLH_DSA_SIGNATURE_LIMIT } from '../../../../source/utils/slhDsa/constants';
import { Button, Screen, Text } from '../../src/ui';

// Public presentation only. No SDK, secret material, signature, or RPC port.
const pkSeed = `0x${'33'.repeat(16)}${'00'.repeat(16)}`, pkRoot = `0x${'44'.repeat(16)}${'00'.repeat(16)}`;
const key: NativeSlhPublicState = Object.freeze({ accountIndex: 0, derivationLabel: 'Public presentation fixture',
  keyId: getSLHDSAKeyId({pkSeed,pkRoot}), parameterSet: SLH_DSA_PARAMETER_SET, pkRoot, pkSeed, signatureCount: 7, signatureLimit: SLH_DSA_SIGNATURE_LIMIT });
const account = `0x${'11'.repeat(20)}`, validator = `0x${'22'.repeat(20)}`, hash = `0x${'ab'.repeat(32)}`;
const reviewed: NativeSmartAccountOperationSnapshot = {
  phase: 'authorize', revision: 1, account, network: getNativeNetwork('ethereum'), maximumPrefundUnits: '1023000', userOperationHash: hash,
  authorization: { entryPoint: validator, nonce: '1', initCode: '0x', callData: '0x' }, payerReview: null, transactionHash: null, userOperationSubmissionStarted: false, error: null,
  intent: { kind: 'authenticator', command: { accountAddress: account, chainId: 1, sourceAuthHash: hash, sourceModule: 'ecdsa', executions: [],
    target: { module: 'slh-dsa', validator, data: '0x' }, targetModule: { type: 'validator', id: 'slh-dsa', address: validator, config: key } } },
};
const held = new Set<() => void>();
const wait = () => new Promise<void>(resolve => { held.add(resolve); });
let prepared = 0, rebuilt = 0;
declare global { interface Window { __slhManagementFixture: { release(): void; counts(): { prepared: number; rebuilt: number } } } }
window.__slhManagementFixture = { release() { const values = [...held]; held.clear(); values.forEach(resolve => resolve()); }, counts: () => ({ prepared, rebuilt }) };
const mode = new URLSearchParams(window.location.search).get('slh-fixture');
const open: Parameters<typeof NativeSlhDsaManagementScreen>[0]['open'] = async (signal, check) => {
  if (mode === 'loading') await wait();
  check(); if (signal.aborted) throw Error('CANCELLED');
  if (mode === 'failed') throw Error('Fixed presentation refusal');
  let ready = mode !== 'fresh';
  const progress = async (report: Parameters<NativeSlhDsaManagement['prepareFresh']>[0]) => {
    report({completed: 1, total: 4, level: 0, phase: 'xmss-cache'}); await wait(); check(); report({completed: 4, total: 4, level: 23, phase: 'xmss-cache'}); return key;
  };
  return Object.freeze({ accountAddress: account, networkName: 'Ethereum', isDeployed: true, installedKeys: mode === 'installed' ? [key] : [],
    async readPrepared() { check(); return ready && mode !== 'installed' ? [key] : []; },
    async prepareFresh(report) { prepared++; const value = await progress(report); ready = true; return value; },
    async hydrateInstalled() { check(); return key; },
    async rebuildInstalled(_id, report) { rebuilt++; return progress(report); },
    async rebuildPrepared(_id, report) { rebuilt++; return progress(report); },
    async openInstall() { if (mode === 'closing') await wait(); check(); throw Error('Use the explicit public review fixture'); },
  });
};
function SlhManagementFixtureContent() {
  const [closed, setClosed] = useState(false), [state, setState] = useState(reviewed);
  if (closed) return <Screen><Text>Public fixture closed</Text><Button title="Done" onPress={() => undefined} /></Screen>;
  if (mode === 'review') return <NativeSmartAccountOperationContent state={state} onBack={() => setClosed(true)} confirmPayer={() => undefined}
    authorize={() => setState({...reviewed, phase:'failed', transactionHash:hash, userOperationSubmissionStarted:true, error:'Authorization ended. Check the account and Activity before starting again.'})} />;
  return <NativeSlhDsaManagementScreen open={open} onBack={() => setClosed(true)} />;
}
export function SlhManagementFixture() {
  return <SafeAreaProvider><SlhManagementFixtureContent /></SafeAreaProvider>;
}
