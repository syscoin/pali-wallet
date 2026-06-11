/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Start Here',
      items: [
        'start-here/what-is-pali',
        'start-here/install-and-connect',
        'start-here/security-model',
      ],
    },
    {
      type: 'category',
      label: 'For Users',
      items: [
        'users/getting-started',
        'users/evm-and-utxo-modes',
        'users/smart-account-validators',
        'users/recovery-and-backups',
        'users/privacy-and-safety',
        'users/upgrade-from-v1',
      ],
    },
    {
      type: 'category',
      label: 'For Dapp Developers',
      items: [
        'developers/provider-discovery',
        'developers/connect-accounts',
        'developers/events-and-state',
        'developers/network-switching',
        'developers/errors',
        'developers/testing-with-pali',
      ],
    },
    {
      type: 'category',
      label: 'EVM API',
      items: [
        'evm-api/overview',
        'evm-api/permissions',
        'evm-api/transactions-and-signing',
        'evm-api/wallet-send-calls',
        'evm-api/assets-and-chains',
      ],
    },
    {
      type: 'category',
      label: 'UTXO and Syscoin API',
      items: [
        'utxo-syscoin-api/overview',
        'utxo-syscoin-api/accounts-and-state',
        'utxo-syscoin-api/psbt-and-transactions',
        'utxo-syscoin-api/assets-spt-and-nft',
        'utxo-syscoin-api/bitcoin-style-dapps',
      ],
    },
    {
      type: 'category',
      label: 'Smart Accounts',
      items: [
        'passkeys-institutions/overview',
        'passkeys-institutions/create-recover',
        'passkeys-institutions/gas-funding',
        'passkeys-institutions/batched-execution',
        'passkeys-institutions/security-and-operations',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/method-matrix',
        'reference/events',
        'reference/eips-and-compatibility',
        'reference/error-codes',
        'reference/quirks-and-limitations',
        'reference/glossary',
      ],
    },
  ],
};

module.exports = sidebars;
