import { PrivacyPool } from './types';

// Tornado Classic ETH pools, pinned to the original deployment registry:
// tornadocash/tornado-cli@378ddf8b8b92a4924037d7b64a94dbfd5a7dd6e8/config.js
// Server metadata can never replace these addresses or select another chain.
export const PRIVACY_CHAIN_ID = 1;
export const PRIVACY_TREE_LEVELS = 20;
export const PRIVACY_MAX_LEAVES = 2 ** PRIVACY_TREE_LEVELS;
export const PRIVACY_POOLS: readonly PrivacyPool[] = [
  {
    address: '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc',
    amount: '0.1',
    deploymentBlock: 9116966,
    id: 'eth-0.1',
  },
  {
    address: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936',
    amount: '1',
    deploymentBlock: 9117609,
    id: 'eth-1',
  },
  {
    address: '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf',
    amount: '10',
    deploymentBlock: 9117720,
    id: 'eth-10',
  },
  {
    address: '0xa160cdab225685da1d56aa342ad8841c3b53f291',
    amount: '100',
    deploymentBlock: 9161895,
    id: 'eth-100',
  },
];

export function getPrivacyPool(poolId: string): PrivacyPool {
  const pool = PRIVACY_POOLS.find(({ id }) => id === poolId);
  if (!pool) throw new Error('Unknown privacy pool');
  return pool;
}
