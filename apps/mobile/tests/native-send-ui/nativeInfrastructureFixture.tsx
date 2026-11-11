import React, { useCallback, useState } from 'react';
import { PALI_CREATE2_DEPLOYER_ADDRESS, PALI_INFRASTRUCTURE_METADATA, type PaliInfrastructureContractId } from '../../../../source/utils/smartAccount/deploymentMetadata';
import { projectSmartAccountInfrastructureObservation } from '../../../../source/utils/smartAccount/infrastructureObservation';
import { NativeInfrastructure } from '../../src/screens/NativeInfrastructure';
import { NativeInfrastructureController, type NativeInfrastructureStatus } from '../../src/smartAccount/infrastructure';
import { Text } from '../../src/ui';

const mode = new URLSearchParams(window.location.search).get('infrastructure-mode') ?? 'missing';
const payer = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32);

/** Real presentation coordinator, with public deterministic observations and no custody or network access. */
export function NativeInfrastructureFixture() {
  const [closed, setClosed] = useState(false);
  const open = useCallback(async (signal: AbortSignal, assertCurrent: () => void) => {
    let pending: NativeInfrastructureStatus['pending'] = mode === 'pending' ? { contractId: 'ecdsaValidator', transactionHash: hash } : null;
    const deployed = new Set<PaliInfrastructureContractId>(PALI_INFRASTRUCTURE_METADATA.filter(entry => mode === 'healthy' || entry.id === 'entryPoint').map(entry => entry.id));
    const observation = () => {
      const result = projectSmartAccountInfrastructureObservation(11155111, [mode === 'no-deployer' ? '0x' : '0x01', ...PALI_INFRASTRUCTURE_METADATA.map(entry => deployed.has(entry.id) ? '0x01' : '0x')]);
      if (!result) throw new Error('Invalid fixture observation');
      return result;
    };
    return new NativeInfrastructureController({
      origin: {kind:'new'}, background() {},
      networkLabel: 'Ethereum Sepolia', currencySymbol: 'ETH', payerLabel: 'Deployment fee wallet', payerAddress: payer,
      assertCurrent, dispose() {},
      async observe() {
        assertCurrent();
        if (mode === 'unavailable') throw new Error('Simulated read failure');
        return { observation: observation(), pending };
      },
      async prepare(contractId) {
        assertCurrent();
        return {
          transaction: { chainId: '11155111', from: payer, to: PALI_CREATE2_DEPLOYER_ADDRESS, nonce: '7', value: '0', data: '0x' + 'ab'.repeat(80), gasLimit: '314159', type: 2, maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', accessList: [] },
          feeComparison: { recommendationOnly: false }, maximumFeeUnits: '942477000000000', coveredFeeUnits: '0', maximumTotalUnits: '942477000000000', approval: null,
          expiresAtMonotonicMilliseconds: performance.now() + 120000,
          async submit(check, onBroadcast) {
            check(); pending = { contractId, transactionHash: hash }; onBroadcast(hash); return hash;
          },
        };
      },
      submissionFailure() { return undefined; },
    }, signal);
  }, []);
  return closed ? <Text>Simulated infrastructure preview closed</Text>
    : <NativeInfrastructure mode={{kind:"new"}} open={open} onBack={() => setClosed(true)} />;
}
