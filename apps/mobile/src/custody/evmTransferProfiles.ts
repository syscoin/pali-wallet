import { getNativeNetwork, type EvmNetworkId } from './networkContext.ts';

export type EvmFeeModel = 'execution-only' | 'nitro-inclusive-gas' | 'op-jovian' | 'rollux-legacy' | 'unqualified';
export type EvmSettlementModel = 'ethereum-finalized' | 'nevm-depth-observation' | 'nevm-depth-12' | 'unqualified';
export type EvmTransferProfile = Readonly<{
  id: string;
  version: 1;
  networkId: EvmNetworkId;
  feeModel: EvmFeeModel;
  feeSourceQualified: boolean;
  settlement: EvmSettlementModel;
  newSendEnabled: boolean;
  oracle?: Readonly<{
    address: string;
    proxyCodeHash: string;
    implementation: string;
    implementationCodeHash: string;
    version: string;
  }>;
}>;
const proxyCodeHash = '0x1f958654ab06a152993e7a0ae7b6dbb0d4b19265cc9337b8789fe1353bd9dc35';
const profiles: readonly EvmTransferProfile[] = Object.freeze([
  { networkId: 'ethereum', id: 'ethereum-eip1559-v1', feeModel: 'execution-only', feeSourceQualified: true, settlement: 'ethereum-finalized' },
  { networkId: 'syscoin-nevm', id: 'nevm-execution-depth-v1', feeModel: 'execution-only', feeSourceQualified: true, settlement: 'nevm-depth-observation' },
  { networkId: 'syscoin-nevm-testnet', id: 'nevm-test-execution-depth12-v1', feeModel: 'execution-only', feeSourceQualified: true, settlement: 'nevm-depth-12' },
  { networkId: 'arbitrum', id: 'nitro-inclusive-gas-v1', feeModel: 'nitro-inclusive-gas', feeSourceQualified: true, settlement: 'unqualified' },
  { networkId: 'base', id: 'base-jovian-gpo-v1', feeModel: 'op-jovian', feeSourceQualified: true, settlement: 'unqualified',
    oracle: Object.freeze({ address: '0x420000000000000000000000000000000000000f', proxyCodeHash,
      implementation: '0x4f1db3c6abd250ba86e0928471a8f7db3afd88f1', implementationCodeHash: '0xe9fc7c96c4db0d6078e3d359d7e8c982c350a513cb2c31121adf5e1e8a446614', version: '1.6.0' }) },
  { networkId: 'rollux', id: 'rollux-legacy-gpo-v1', feeModel: 'rollux-legacy', feeSourceQualified: true, settlement: 'unqualified',
    oracle: Object.freeze({ address: '0x420000000000000000000000000000000000000f', proxyCodeHash,
      implementation: '0xf2ad472ade2009ef5eeb26b7fe27ba9fd27de46a', implementationCodeHash: '0xe6aa9feb138f683e03915040bea23c79437eba752f49d49bd0628e2edd2af1ad', version: '1.0.0' }) },
  { networkId: 'zksys-testnet', id: 'zksys-unqualified-v1', feeModel: 'unqualified', feeSourceQualified: false, settlement: 'unqualified' },
].map((profile) => Object.freeze({ ...profile, version: 1 as const, newSendEnabled: profile.networkId === 'syscoin-nevm-testnet' })) as EvmTransferProfile[]);

/** Fixed registrations only; callers cannot supply a policy or grant signing. */
export function getEvmTransferProfile(id: EvmNetworkId): EvmTransferProfile {
  getNativeNetwork(id);
  return profiles.find((profile) => profile.networkId === id)!;
}
