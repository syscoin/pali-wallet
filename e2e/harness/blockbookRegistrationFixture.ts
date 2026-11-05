// Fixed chain identities for the offline Blockbook registration fixtures.
const genesis = {
  Bitcoin: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  Litecoin: '12a765e31ffd4059bada1e25190f6e98c99d9714d334efa41a195a7e7e04bfe2',
  Syscoin: '0000022642db0346b6e01c2a397471f4f12e65d4f4251ec96c1f85367a61a7ab',
};

export const blockbookRegistrationProof = (coin: keyof typeof genesis) =>
  new Map<string, unknown>([
    [
      '/api/v2/',
      {
        blockbook: { coin, inSync: true, bestHeight: 1 },
        backend: { chain: 'main', blocks: 1 },
      },
    ],
    ['/api/v2/block-index/0', { blockHash: genesis[coin] }],
  ]);
