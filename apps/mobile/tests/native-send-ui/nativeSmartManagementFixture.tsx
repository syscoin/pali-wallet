import React, { useCallback, useState } from 'react';
import type { ISmartAccountMetadata } from '../../../../source/types/network';
import { buildECDSAAuthenticator } from '../../../../source/utils/smartAccount/authenticators';
import { encodeCompositeValidatorInitData } from '../../../../source/utils/smartAccount/account';
import { getPaliModuleAddress } from '../../../../source/utils/smartAccount/contracts';
import { buildSmartAccountValidatorSwitch } from '../../../../source/utils/smartAccount/validatorSwitch';
import { getNativeNetwork } from '../../src/custody/networkContext';
import { NativeSmartAccountAuthenticator } from '../../src/screens/NativeSmartAccountAuthenticator';
import { NativeSmartAccountModulesScreen } from '../../src/screens/NativeSmartAccountModules';
import { buildNativeSmartModuleCommand } from '../../src/smartAccount/modules';
import type { NativeSmartModuleManagement } from '../../src/smartAccount/moduleManagement';
import type { NativeSmartAccountOperation, NativeSmartAccountOperationSnapshot, NativeSmartAccountResolvedIntent } from '../../src/smartAccount/operation';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const owner = '0x2222222222222222222222222222222222222222';
const independent = '0x3333333333333333333333333333333333333333';
const spare = '0x4444444444444444444444444444444444444444';
const built = buildECDSAAuthenticator({ chainId: 1, config: { owners: [owner], threshold: 1 } });
const composite = getPaliModuleAddress(1, 'composite');
const metadata: ISmartAccountMetadata = {
  chainId: 1, contractVersion: '1', deploymentSalt: '0x' + '00'.repeat(32),
  ...built.metadata, auth: built.auth, isDeployed: true,
  installedModules: [...built.metadata.installedModules!,
    { type: 'validator', id: 'custom', address: independent, data: '0x1234', config: { name: 'Independent approval service', moduleType: 1, compositeCompatible: true, initData: '0x1234' } },
    { type: 'validator', id: 'custom', address: spare, data: '0x', config: { name: 'Spare validator', moduleType: 1, compositeCompatible: false, initData: '0x' } },
    { type: 'validator', id: 'composite', address: composite, data: encodeCompositeValidatorInitData([built.auth.validator, independent], 1), config: { childValidators: [built.auth.validator, independent], threshold: 1 } },
  ],
};

/** Public presentation adapter only: no wallet, RPC, signature or broadcast exists in this gallery. */
function operation(intent: NativeSmartAccountResolvedIntent): NativeSmartAccountOperation {
  const listeners = new Set<() => void>();
  let snapshot: NativeSmartAccountOperationSnapshot = {
    intent, phase: 'authorize', revision: 1, account, network: getNativeNetwork('ethereum'),
    maximumPrefundUnits: '1023000000000000', userOperationHash: '0x' + 'ab'.repeat(32),
    authorization: { entryPoint: getPaliModuleAddress(1, 'ecdsa'), nonce: '7', initCode: '0x', callData: '0x1234' },
    payerReview: null, transactionHash: null, userOperationSubmissionStarted: false, error: null,
  };
  const publish = (change: Partial<NativeSmartAccountOperationSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...change, revision: snapshot.revision + 1 });
    for (const listener of listeners) listener();
  };
  const fee = () => publish({ phase: 'review-fee', payerReview: {
    id: 2, purpose: 'submit-operation', maximumFeeUnits: '420000000000000', coveredFeeUnits: '0', maximumTotalUnits: '420000000000000',
    transaction: { chainId: '1', from: owner, to: snapshot.authorization!.entryPoint, nonce: '3', value: '0', data: '0x1234', gasLimit: '210000', type: 2, maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000', accessList: [] },
  } });
  if (query.get('smart-phase') === 'fee') fee();
  if (query.get('smart-phase') === 'complete') publish({ phase: 'complete', metadataRefresh: 'complete', transactionHash: '0x' + 'cd'.repeat(32) });
  if (query.get('smart-phase') === 'failed') publish({ phase: 'failed', error: 'The network could not confirm this change. Refresh the account status before trying again.' });
  return {
    authorizationExpiresAt: Date.now() + 300000,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    async prepare() {},
    async authorize(revision: number) { if (revision === snapshot.revision && intent.kind !== 'modules') fee(); },
    async authorizeModuleChange(revision: number, consent: { kind: string; riskAcknowledged?: boolean }) {
      if (revision === snapshot.revision && intent.kind === 'modules' && consent.kind === intent.command.draft.kind && (consent.kind !== 'install-custom' || consent.riskAcknowledged === true)) fee();
    },
    confirmPayer(id: number) { if (snapshot.payerReview?.id === id) publish({ phase: 'waiting', payerReview: null, transactionHash: '0x' + 'cd'.repeat(32) }); },
    async retryMetadata() { publish({ phase: 'complete', metadataRefresh: 'complete' }); },
    background() {}, cancel() {}, async dispose() { listeners.clear(); },
  } as unknown as NativeSmartAccountOperation;
}

export function NativeSmartManagementFixture({ kind }: { kind: 'modules' | 'authenticator' }) {
  const [closed, setClosed] = useState(false);
  const openModules = useCallback(async (signal: AbortSignal, assertCurrent: () => void): Promise<NativeSmartModuleManagement> => {
    assertCurrent(); if (signal.aborted) throw new Error('CANCELLED');
    if (query.get('modules-mode') === 'unavailable') throw new Error('Preview unavailable state');
    return {
      accountAddress: account, networkName: 'Ethereum', passkeysAvailable: false,
      async openPasskey() { throw Error('Native credentials are outside this browser fixture'); },
      async read() { assertCurrent(); return query.get('modules-mode') === 'empty' ? { ...metadata, installedModules: [] } : metadata; },
      async preflightCustom() { assertCurrent(); return { ok: true, failures: [], compositeCompatible: true }; },
      async openChange(draft, nextSignal, check) {
        check(); if (nextSignal.aborted) throw new Error('CANCELLED');
        return operation({ kind: 'modules', command: buildNativeSmartModuleCommand({ accountAddress: account, metadata, draft, isAlgorithmAvailable: module => module.id === 'ecdsa', removalPolicy: 'all-installed-composites', deploymentAdmission: 'deployed-only' }) });
      },
    };
  }, []);
  const openAuthenticator = useCallback(async (signal: AbortSignal, assertCurrent: () => void) => {
    assertCurrent(); if (signal.aborted) throw new Error('CANCELLED');
    const target = buildECDSAAuthenticator({ chainId: 1, config: { owners: [owner, spare], threshold: 1 } });
    return operation({ kind: 'authenticator', command: buildSmartAccountValidatorSwitch({ accountAddress: account, chainId: 1, metadata, target }) });
  }, []);
  if (closed) return <Text>Simulated Smart account preview closed</Text>;
  return kind === 'modules'
    ? <NativeSmartAccountModulesScreen open={openModules} onBack={() => setClosed(true)} />
    : <NativeSmartAccountAuthenticator open={openAuthenticator} onBack={() => setClosed(true)} />;
}
