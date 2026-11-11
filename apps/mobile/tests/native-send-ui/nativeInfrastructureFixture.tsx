import React, { useCallback, useState } from 'react';
import { PALI_CREATE2_DEPLOYER_ADDRESS, PALI_INFRASTRUCTURE_METADATA, type PaliInfrastructureContractId } from '../../../../source/utils/smartAccount/deploymentMetadata';
import { projectSmartAccountInfrastructureObservation } from '../../../../source/utils/smartAccount/infrastructureObservation';
import { NativeInfrastructure } from '../../src/screens/NativeInfrastructure';
import { NativeInfrastructureController, type NativeInfrastructureStatus } from '../../src/smartAccount/infrastructure';
import { Text } from '../../src/ui';

const mode = new URLSearchParams(window.location.search).get('infrastructure-mode') ?? 'missing';
const payer = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32);
const resumeId = 'fixture-infrastructure-suite-return';
const suiteResume = mode === 'suite-resume';

/** Real presentation coordinator, with public deterministic observations and no custody or network access. */
export function NativeInfrastructureFixture() {
  const [closed, setClosed] = useState(false);
  const [resuming, setResuming] = useState(suiteResume);
  const open = useCallback(async (signal: AbortSignal, assertCurrent: () => void) => {
    let pending: NativeInfrastructureStatus['pending'] = resuming
      ? {contractId:'ecdsaValidator', transactionHash:null}
      : mode === 'pending' ? { contractId: 'ecdsaValidator', transactionHash: hash } : null;
    const deployed = new Set<PaliInfrastructureContractId>(PALI_INFRASTRUCTURE_METADATA.filter(entry => mode === 'healthy' || entry.id === 'entryPoint').map(entry => entry.id));
    const observation = () => {
      const result = projectSmartAccountInfrastructureObservation(11155111, [mode === 'no-deployer' ? '0x' : '0x01', ...PALI_INFRASTRUCTURE_METADATA.map(entry => deployed.has(entry.id) ? '0x01' : '0x')]);
      if (!result) throw new Error('Invalid fixture observation');
      return result;
    };
    const prepare = async (contractId: PaliInfrastructureContractId) => {
      assertCurrent();
      return {
        transaction: { chainId: '11155111', from: payer, to: PALI_CREATE2_DEPLOYER_ADDRESS, nonce: '7', value: '0', data: '0x' + 'ab'.repeat(80), gasLimit: '314159', type: 2 as const, maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', accessList: [] },
        feeComparison: { recommendationOnly: false as const }, maximumFeeUnits: '942477000000000', coveredFeeUnits: '0', maximumTotalUnits: '942477000000000', approval: null,
        expiresAtMonotonicMilliseconds: performance.now() + 120000,
        async submit(check: () => void, onBroadcast: (hash: string) => void) {
          check(); pending = { contractId, transactionHash: hash }; onBroadcast(hash); return hash;
        },
      };
    };
    const controller = new NativeInfrastructureController({
      origin: resuming ? {kind:'suite-resume',id:resumeId,async prepare(requestSignal) {
        assertCurrent(); if (requestSignal.aborted) throw new Error('CANCELLED');
        return {status:{observation:observation(),pending},contractId:'ecdsaValidator',prepared:await prepare('ecdsaValidator')};
      }} : {kind:'new'}, background() {},
      networkLabel: 'Ethereum Sepolia', currencySymbol: 'ETH', payerLabel: suiteResume ? 'Trezor fee wallet' : 'Deployment fee wallet', payerAddress: payer,
      assertCurrent, dispose() {},
      async observe() {
        assertCurrent();
        if (mode === 'unavailable') throw new Error('Simulated read failure');
        return { observation: observation(), pending };
      },
      prepare,
      submissionFailure() { return undefined; },
    }, signal);
    if (resuming) await controller.reviewResume(controller.getSnapshot().revision);
    return controller;
  }, [resuming]);
  return closed ? <Text>Simulated infrastructure preview closed</Text>
    : <NativeInfrastructure mode={resuming ? {kind:'suite-resume',id:resumeId,onContinue:() => setResuming(false)} : {kind:'new',reviewNext:suiteResume}} open={open} onBack={() => setClosed(true)} />;
}
