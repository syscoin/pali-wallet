/** Typed protocol capabilities shared by extension discovery and native session admission. */
export const sentryDappCapabilities = () => ({
  version: 1,
  operations: [
    'register',
    'updateService',
    'updateRegistrar',
    'registerOperator',
    'rotateOperator',
    'revoke',
  ],
  linkNode: true,
  governanceVote: { scheme: 'secp256k1', signal: 'funding', maxNodes: 20 },
  eras: ['legacy-v3', 'pq-v4'],
  schemes: ['secp256k1', 'bls-basic', 'slh-dsa-shake-128s'],
  roles: ['owner', 'operator', 'collateral', 'voting'],
  keySelection: 'wallet-approval',
  result: 'operator-authorized-transaction',
  requiresFeeInputSignatures: true,
  feeSigning: 'same-origin-authorized-psbt-v1',
});
