const SYS_NETWORK = {
  main: {
    id: 'main',
    label: 'Mainnet',
    beUrl: 'https://blockbook.elint.services/',
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    beUrl: 'https://blockbook-dev.elint.services/',
  },
};

const defaultMockState = {
  status: 0,
  accounts: [],
  activeAccountId: 0,
  activeNetwork: SYS_NETWORK.main.id,
  encriptedMnemonic: null,
  confirmingTransaction: false,
  changingNetwork: false,
  signingTransaction: false,
  signingPSBT: false,
  walletTokens: [],
  tabs: {
    currentSenderURL: '',
    currentURL: '',
    canConnect: false,
    connections: [],
  },
  timer: 5,
  currentBlockbookURL: 'https://blockbook.elint.services/',
  networks: {
    main: {
      id: 'main',
      label: 'Main Network',
      beUrl: 'https://blockbook.elint.services/',
    },
    testnet: {
      id: 'testnet',
      label: 'Test Network',
      beUrl: 'https://blockbook-dev.elint.services/',
    },
  },
  trustedApps: {
    'app.uniswap.org': 'app.uniswap.org',
    'trello.com': 'https://trello.com/b/0grd7QPC/dev',
    'twitter.com': 'https://twitter.com/home',
    'maps.google.com': 'https://maps.google.com/',
    'facebook.com': 'https://accounts.google.com/b/0/AddMailService',
    'sysmint.paliwallet.com': 'sysmint.paliwallet.com',
  },
  temporaryTransactionState: {
    executing: false,
    type: '',
  },
};

module.exports = { defaultMockState };
