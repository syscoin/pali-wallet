/** Planned mobile screens. Static sample data only; no wallet authority imports. */
export type FamilyId =
  | 'wallet'
  | 'onboarding'
  | 'accounts'
  | 'transfer'
  | 'activity'
  | 'connections'
  | 'smart'
  | 'privacy'
  | 'sentry'
  | 'settings';
export type LayoutKind =
  | 'welcome'
  | 'portfolio'
  | 'form'
  | 'list'
  | 'review'
  | 'phrase'
  | 'verify'
  | 'receive'
  | 'success'
  | 'scan'
  | 'hub';
export type DesignRow = {
  title: string;
  detail?: string;
  value?: string;
  icon?: string;
  to?: string;
  tone?: 'blue' | 'amber' | 'red' | 'green';
};
export type DesignField = {
  label: string;
  value: string;
  hint?: string;
  secret?: boolean;
  multiline?: boolean;
};
export type ScreenSpec = {
  id: string;
  family: FamilyId;
  title: string;
  subtitle?: string;
  layout: LayoutKind;
  headline?: string;
  amount?: string;
  unit?: string;
  description?: string;
  fields?: DesignField[];
  rows?: DesignRow[];
  scope?: 'extension-parity' | 'shared-enhancement';
  hiddenInCatalog?: boolean;
  authorization?: boolean;
  deviceConfirmation?: boolean;
  requiresAccountSigner?: boolean;
  notice?: { title: string; body: string; tone?: 'blue' | 'amber' | 'red' };
  primary?: { label: string; to: string };
  secondary?: { label: string; to: string };
  source: string;
  purpose: string;
  accountContext?: boolean;
  approval?: boolean;
};
export const families: {
  id: FamilyId;
  label: string;
  icon: string;
  entry: string;
}[] = [
  {
    id: 'wallet',
    label: 'Wallet & assets',
    icon: 'wallet',
    entry: 'wallet.home',
  },
  {
    id: 'onboarding',
    label: 'Create & recover',
    icon: 'lock',
    entry: 'onboarding.welcome',
  },
  {
    id: 'accounts',
    label: 'Accounts & hardware',
    icon: 'eye',
    entry: 'accounts.list',
  },
  {
    id: 'transfer',
    label: 'Send & receive',
    icon: 'arrow-up-right',
    entry: 'transfer.asset',
  },
  {
    id: 'activity',
    label: 'Activity & status',
    icon: 'activity',
    entry: 'activity.list',
  },
  {
    id: 'connections',
    label: 'Connections & approvals',
    icon: 'globe',
    entry: 'connections.home',
  },
  { id: 'smart', label: 'Smart accounts', icon: 'shield', entry: 'smart.hub' },
  {
    id: 'privacy',
    label: 'Private assets',
    icon: 'lock',
    entry: 'privacy.home',
  },
  { id: 'sentry', label: 'Sentry', icon: 'shield', entry: 'sentry.home' },
  {
    id: 'settings',
    label: 'Settings & networks',
    icon: 'settings',
    entry: 'settings.home',
  },
];
const src = {
  wallet: 'source/pages/Home; source/pages/Tokens; source/pages/Receive',
  onboarding:
    'source/pages/Start; source/pages/CreatePass; source/pages/Import; source/pages/SeedConfirm; source/scripts/Background/controllers/walletRecovery.ts',
  accounts:
    'source/pages/Settings/ManageAccounts.tsx; ImportAccount.tsx; CreateAccount.tsx; ConnectHardwareWallet.tsx; EditAccount.tsx',
  transfer:
    'source/pages/Send/SendEth.tsx; SendSys.tsx; Confirm.tsx; SendCalls.tsx; useSendDraftWriter.ts',
  activity:
    'source/pages/Transactions; source/pages/Home/TxsPanel.tsx; source/pages/Home/Panel/components/Details',
  connections:
    'source/routers/index.tsx (external routes); source/pages/Connections; source/pages/Transactions/SignEth.tsx; source/scripts/Background/controllers/message-handler',
  smart:
    'source/pages/SmartAccount/Hub.tsx; source/pages/Settings/SmartAccountPolicy.tsx; source/utils/passkey; source/utils/slhDsa',
  privacy:
    'source/pages/Privacy; source/scripts/Background/controllers/privateVault.ts; privacyWithdrawals.ts',
  sentry:
    'source/pages/Settings/SentryKeys.tsx; source/pages/Transactions/SentryOperation.tsx; SentryLink.tsx; SentryVote.tsx',
  settings:
    'source/pages/Settings; source/hooks/useOnboardingSecrets.tsx; source/state/paliStorage.ts',
};
const make = (
  family: FamilyId,
  id: string,
  title: string,
  layout: LayoutKind,
  rest: Omit<ScreenSpec, 'id' | 'family' | 'title' | 'layout' | 'source'>
): ScreenSpec => ({ family, id, title, layout, source: src[family], ...rest });
const row = (
  title: string,
  detail?: string,
  to?: string,
  icon?: string,
  value?: string
): DesignRow => ({ title, detail, to, icon, value });
// One immutable sample inventory is carried through export and read-back review.
const sampleNoteBackupInventory = (): DesignRow[] => [
  row('Snapshot', 'PN-0941 · 2 Nov 2026, 09:41 · sample'),
  row('Retained inventory', '2 notes · 1 private-vault profile'),
  row('Pools', 'Ethereum Mainnet · one 0.1 ETH note and one 1 ETH note'),
];
const baseScreens: ScreenSpec[] = [
  make('wallet', 'wallet.home', 'Wallet', 'portfolio', {
    purpose:
      'Home keeps account identity distinct from network scope; fiat, native balances and loading are separate.',
    primary: { label: 'Send', to: 'transfer.asset' },
    secondary: { label: 'Receive', to: 'transfer.receive-network' },
    accountContext: true,
  }),
  make('wallet', 'wallet.asset', 'Syscoin', 'hub', {
    purpose:
      'Asset identity includes network and immutable identifier; token symbols never establish trust.',
    amount: '24,810.42',
    unit: 'SYS',
    subtitle: 'Syscoin UTXO · Native asset',
    rows: [
      row(
        'Send',
        'Choose recipient and amount',
        'transfer.details',
        'arrow-up-right'
      ),
      row(
        'Receive',
        'Show this network’s address',
        'transfer.receive',
        'arrow-down-left'
      ),
      row('Asset identity', 'Native SYS · Syscoin UTXO', undefined, 'info'),
      row(
        'Recent activity',
        'All transactions for this asset',
        'activity.list',
        'activity'
      ),
    ],
    accountContext: true,
  }),
  make('wallet', 'wallet.tokens', 'Manage assets', 'list', {
    purpose:
      'Native, contract and Syscoin asset identities stay explicit; asset capabilities depend on network.',
    rows: [
      row(
        'Your assets',
        'Search, hide or remove an asset',
        'wallet.token-detail',
        'wallet'
      ),
      row(
        'Import a token',
        'Verify its network and identifier',
        'wallet.import-token',
        'plus'
      ),
      row(
        'Collectibles',
        'NFTs on supported EVM networks',
        'wallet.nfts',
        'wallet'
      ),
    ],
    accountContext: true,
  }),
  make('wallet', 'wallet.import-token', 'Import token', 'form', {
    purpose:
      'Resolve token metadata from the selected network, then require explicit review. A symbol is not verification.',
    fields: [
      { label: 'Network', value: 'Ethereum' },
      {
        label: 'Contract address / asset GUID',
        value: 'Sample identifier',
        hint: 'EVM contracts and Syscoin GUIDs are different inputs.',
      },
    ],
    notice: {
      title: 'Check the asset',
      body: 'Anyone can create an asset with a familiar name or symbol.',
    },
    primary: { label: 'Review asset', to: 'wallet.token-detail' },
    accountContext: true,
  }),
  make('wallet', 'wallet.token-detail', 'Asset details', 'review', {
    purpose:
      'Show immutable contract/GUID before adding or hiding; never apply a trusted logo by ticker alone.',
    headline: 'Example token',
    rows: [
      row('Network', 'Ethereum'),
      row('Contract', 'Sample contract identifier'),
      row('Symbol', 'EXAMPLE'),
      row('Decimals', '18'),
      row('Source', 'Custom token · unverified'),
    ],
    primary: { label: 'Add asset', to: 'wallet.tokens' },
    secondary: { label: 'Cancel', to: 'wallet.tokens' },
    accountContext: true,
  }),
  make('wallet', 'wallet.nfts', 'Collectibles', 'list', {
    purpose:
      'Collectible identity includes chain, contract and token ID; unsupported networks show a capability state.',
    rows: [
      row(
        'Example collection',
        'Ethereum · Sample contract · #104',
        'wallet.nft-detail',
        'wallet'
      ),
    ],
    accountContext: true,
  }),
  make('wallet', 'wallet.nft-detail', 'Collectible', 'hub', {
    purpose:
      'NFT details and transfer use the same contextual review boundary as other assets.',
    headline: 'Example collection #104',
    description:
      'Artwork preview is optional and cannot establish ownership or trust.',
    rows: [
      row('Network', 'Ethereum'),
      row('Contract', 'Sample contract identifier'),
      row('Token ID', '104'),
    ],
    primary: { label: 'Send collectible', to: 'transfer.nft-review' },
    accountContext: true,
  }),
  make('onboarding', 'onboarding.welcome', 'Welcome to Pali', 'welcome', {
    purpose:
      'Create a new wallet or restore an existing one. Keep watch-only and hardware entry visible without pretending they hold local keys.',
    headline: 'Your wallet.\nYour control.',
    description: 'A private home for your crypto, across networks.',
    primary: { label: 'Create a wallet', to: 'onboarding.password' },
    secondary: {
      label: 'I already have a wallet',
      to: 'onboarding.restore-options',
    },
  }),
  make('onboarding', 'onboarding.restore-options', 'Add your wallet', 'list', {
    purpose:
      'Separate full seed restore, one imported account, hardware ownership and watch-only observation.',
    rows: [
      row(
        'Recovery phrase',
        'Restore seed-derived accounts',
        'onboarding.import',
        'wallet'
      ),
      row('Private key', 'Import one account', 'accounts.import-key', 'lock'),
      row(
        'Hardware wallet',
        'Connect a supported device',
        'accounts.hardware',
        'shield'
      ),
      row(
        'Watch-only',
        'View a public address or extended key',
        'accounts.watch',
        'eye'
      ),
    ],
  }),
  make('onboarding', 'onboarding.password', 'Protect your wallet', 'form', {
    purpose:
      'Preserve an app-password path; native biometrics gate established key access. A six-digit UI PIN is not a new vault encryption scheme.',
    fields: [
      {
        label: 'Wallet password',
        value: 'Password field',
        secret: true,
        hint: 'Use a strong password you do not use elsewhere.',
      },
      { label: 'Confirm password', value: 'Confirm password', secret: true },
    ],
    primary: { label: 'Continue', to: 'onboarding.backup-intro' },
  }),
  make('onboarding', 'onboarding.backup-intro', 'Back up your wallet', 'hub', {
    purpose:
      'Explain what the phrase restores and why separate imported accounts/private notes need separate backups.',
    headline: 'A backup you control.',
    rows: [
      row(
        'Write it down',
        'Keep an offline copy somewhere private',
        undefined,
        'wallet'
      ),
      row(
        'Never share it',
        'Pali support will never ask for it',
        undefined,
        'shield'
      ),
      row(
        'More than one backup',
        'Imported keys and private notes need their own backups',
        undefined,
        'info'
      ),
    ],
    primary: { label: 'Show recovery phrase', to: 'onboarding.phrase' },
  }),
  make('onboarding', 'onboarding.phrase', 'Recovery phrase', 'phrase', {
    purpose:
      'Device-protected reveal, screenshot/app-switcher handling, no automatic clipboard, no logging, and no valid mnemonic in design fixtures.',
    notice: {
      title: 'Keep these words private',
      body: 'Anyone with your recovery phrase can control the accounts it restores.',
      tone: 'amber',
    },
    primary: { label: 'I wrote it down', to: 'onboarding.verify' },
    secondary: { label: 'Back', to: 'onboarding.backup-intro' },
  }),
  make('onboarding', 'onboarding.verify', 'Check your backup', 'verify', {
    purpose:
      'Verify selected word positions without unnecessary exposure; accessible alternative to drag-and-drop.',
    description:
      'Confirm the words in positions 3, 7 and 11 from your written backup.',
    primary: { label: 'Confirm backup', to: 'onboarding.biometrics' },
    secondary: { label: 'View phrase again', to: 'onboarding.phrase' },
  }),
  make(
    'onboarding',
    'onboarding.biometrics',
    'Unlock with your device',
    'hub',
    {
      purpose:
        'Only offer supported OS authentication after durable vault creation. Password remains available for backup and secret export.',
      headline: 'A familiar way to unlock.',
      description:
        'Use your device’s authentication to open Pali. You can still use your wallet password.',
      primary: { label: 'Enable device unlock', to: 'wallet.home' },
      secondary: { label: 'Not now', to: 'wallet.home' },
    }
  ),
  make('onboarding', 'onboarding.import', 'Restore a wallet', 'form', {
    purpose:
      'Only a trusted native secret-entry surface receives real phrases; the design has inert fields.',
    fields: [
      {
        label: 'Recovery phrase',
        value: 'Recovery phrase entry — hidden in design',
        secret: true,
        multiline: true,
      },
    ],
    notice: {
      title: 'Keep the phrase private',
      body: 'Enter the recovery phrase only when restoring your own wallet.',
    },
    primary: { label: 'Check wallet', to: 'onboarding.match' },
  }),
  make('onboarding', 'onboarding.match', 'Confirm your wallet', 'review', {
    purpose:
      'Show independently checkable public account identities before committing an imported vault.',
    headline: 'Is this your wallet?',
    rows: [
      row('Syscoin UTXO', 'Sample restored address'),
      row('Ethereum', 'Sample restored address'),
    ],
    notice: {
      title: 'Check a known address',
      body: 'Confirm this matches the wallet you intended to restore.',
    },
    primary: { label: 'Continue', to: 'onboarding.password' },
    secondary: { label: 'Go back', to: 'onboarding.import' },
  }),
  make('onboarding', 'onboarding.unlock', 'Welcome back', 'form', {
    purpose:
      'Locked, inaccessible storage and empty wallet are distinct. No stale UI unlocked flag can authorize operations.',
    fields: [
      { label: 'Wallet password', value: 'Enter your password', secret: true },
    ],
    primary: { label: 'Unlock', to: 'wallet.home' },
    secondary: { label: 'Restore access', to: 'onboarding.recover' },
  }),
  make('onboarding', 'onboarding.recover', 'Restore access', 'hub', {
    purpose:
      'Existing-vault recovery requires identity matching and durable journal reconciliation; this is not destructive arbitrary import.',
    headline: 'Recover access carefully.',
    description:
      'Use the recovery phrase for this wallet. Other records may need separate backups.',
    rows: [
      row('Seed-derived accounts', 'Restored by the matching recovery phrase'),
      row(
        'Imported keys and private notes',
        'Keep their separate backups before making changes'
      ),
    ],
    primary: { label: 'Verify recovery phrase', to: 'onboarding.import' },
    secondary: { label: 'Cancel', to: 'onboarding.unlock' },
  }),
  make('accounts', 'accounts.list', 'Your accounts', 'list', {
    purpose:
      'Account types keep their own authority and backup semantics; selection invalidates drafts and pending reviews.',
    rows: [
      row(
        'Personal wallet',
        'Recovery phrase · selected',
        'accounts.details',
        'wallet'
      ),
      row('Imported account', 'Private key backup', 'accounts.details', 'lock'),
      row(
        'Ledger account',
        'Hardware device required',
        'accounts.hardware',
        'shield'
      ),
      row('Smart account', 'Owners and recovery policy', 'smart.hub', 'shield'),
      row('Watch-only', 'Cannot sign or send', 'accounts.watch', 'eye'),
    ],
    primary: { label: 'Add account', to: 'accounts.add' },
  }),
  make('accounts', 'accounts.add', 'Add an account', 'list', {
    purpose:
      'Explicit account-kind selection prevents importing one private key from being described as a wallet restore.',
    rows: [
      row('New account', 'Derived from this wallet', 'accounts.create', 'plus'),
      row(
        'Import private key',
        'One externally created account',
        'accounts.import-key',
        'lock'
      ),
      row(
        'Connect hardware',
        'Use a supported device',
        'accounts.hardware',
        'shield'
      ),
      row(
        'Watch-only',
        'Public address, extended key or descriptor',
        'accounts.watch',
        'eye'
      ),
      row(
        'Smart account',
        'Create or manage an on-chain account',
        'smart.create',
        'wallet'
      ),
    ],
  }),
  make('accounts', 'accounts.create', 'Create account', 'form', {
    purpose:
      'Derivation and durable account creation remain under one wallet authority, with SLIP-44 scope.',
    fields: [
      { label: 'Account name', value: 'Savings' },
      { label: 'Account type', value: 'Seed-derived account' },
      { label: 'Network family', value: 'Syscoin UTXO' },
    ],
    primary: { label: 'Create account', to: 'accounts.list' },
  }),
  make('accounts', 'accounts.import-key', 'Import private key', 'form', {
    purpose:
      'Password-confirmed trusted native entry and separate backup notice; never store key in a UI snapshot.',
    fields: [
      { label: 'Account name', value: 'Imported account' },
      {
        label: 'Private key',
        value: 'Private-key entry — hidden in design',
        secret: true,
      },
    ],
    notice: {
      title: 'A separate backup',
      body: 'Your Pali recovery phrase will not restore this imported key.',
      tone: 'amber',
    },
    primary: { label: 'Review account', to: 'accounts.details' },
  }),
  make('accounts', 'accounts.watch', 'Watch an account', 'form', {
    purpose:
      'Support chain-specific public address, xpub and descriptors where the extension does; do not imply spend authority.',
    fields: [
      { label: 'Account name', value: 'Treasury watch' },
      { label: 'Network', value: 'Bitcoin' },
      {
        label: 'Address / public key / descriptor',
        value: 'Sample public identifier',
      },
    ],
    notice: {
      title: 'Watch-only',
      body: 'You can view this account. Its signing wallet is required to spend.',
    },
    primary: { label: 'Add watch-only account', to: 'accounts.list' },
  }),
  make('accounts', 'accounts.details', 'Account details', 'hub', {
    purpose:
      'Show public identity, account type and relevant backup/export options; hardware secrets are never exportable from Pali.',
    rows: [
      row('Name', 'Personal wallet', 'accounts.rename'),
      row('Account type', 'Seed-derived account'),
      row(
        'Receive address',
        'View on the selected network',
        'transfer.receive'
      ),
      row('Backup options', 'Review recovery coverage', 'settings.backups'),
      row('Remove account', 'Review consequences', 'accounts.remove', 'trash'),
    ],
    accountContext: true,
  }),
  make('accounts', 'accounts.rename', 'Rename account', 'form', {
    purpose: 'Public label edit remains separate from account identity.',
    fields: [{ label: 'Account name', value: 'Long-term savings' }],
    primary: { label: 'Save name', to: 'accounts.details' },
  }),
  make('accounts', 'accounts.remove', 'Remove account', 'review', {
    purpose:
      'Differentiate removing a reference from deleting the last recovery path; display affected backup coverage.',
    headline: 'Remove this account?',
    rows: [
      row('Account', 'Imported account'),
      row('Backup required', 'Separate private-key backup'),
    ],
    notice: {
      title: 'Make sure you can restore it',
      body: 'The Pali recovery phrase does not restore separately imported keys.',
      tone: 'amber',
    },
    primary: { label: 'Confirm with password', to: 'settings.authorize' },
    secondary: { label: 'Keep account', to: 'accounts.details' },
  }),
  make('accounts', 'accounts.hardware', 'Connect hardware wallet', 'list', {
    purpose:
      'Only tested model/firmware/app combinations become available. Current devices are candidates, not security endorsements.',
    rows: [
      row(
        'Ledger',
        'Supported Bluetooth models; USB on Android',
        'accounts.hardware-pair',
        'shield'
      ),
      row(
        'Trezor',
        'Supported Bluetooth model; USB on Android',
        'accounts.hardware-pair',
        'shield'
      ),
    ],
    notice: {
      title: 'Your device stays in control',
      body: 'Never enter its recovery phrase into Pali.',
    },
  }),
  make('accounts', 'accounts.hardware-pair', 'Connect your device', 'hub', {
    purpose:
      'Native transport pairing, firmware/app compatibility, permissions and cancellation are checked before address discovery.',
    headline: 'Confirm on your device.',
    description:
      'Unlock your hardware wallet and open the appropriate coin app if required.',
    rows: [
      row('Connection', 'Bluetooth / USB · sample'),
      row('Compatibility', 'Model, firmware and coin app checked'),
      row('Address verification', 'Compare the full address on the device'),
    ],
    primary: {
      label: 'Verify account address',
      to: 'accounts.hardware-address',
    },
    secondary: { label: 'Cancel', to: 'accounts.hardware' },
  }),
  make(
    'accounts',
    'accounts.hardware-address',
    'Verify hardware account',
    'review',
    {
      purpose:
        'The phone display cannot substitute for the hardware device display; bind device, derivation and account.',
      headline: 'Compare both screens.',
      rows: [
        row('Account', 'Hardware account 1'),
        row('Network', 'Ethereum'),
        row('Derivation', 'Sample BIP44 path'),
        row('Address', 'Sample full public address'),
      ],
      primary: { label: 'Addresses match', to: 'accounts.list' },
      secondary: { label: 'They don’t match', to: 'accounts.hardware' },
    }
  ),
  make('transfer', 'transfer.asset', 'Send', 'list', {
    purpose:
      'Choose asset and network together, with available funds and account type. Unsupported combinations cannot progress.',
    rows: [
      row(
        'SYS',
        'Syscoin UTXO · 24,810.42 available',
        'transfer.details',
        'wallet'
      ),
      row(
        'SYS',
        'Syscoin NEVM · 4,815.30 available',
        'transfer.nevm-details',
        'wallet'
      ),
      row('ETH', 'Ethereum · 1.82 available', 'transfer.eth-details', 'wallet'),
      row(
        'BTC',
        'Bitcoin · 0.0842 available',
        'transfer.btc-details',
        'wallet'
      ),
    ],
    accountContext: true,
  }),
  make('transfer', 'transfer.details', 'Send SYS', 'form', {
    purpose:
      'Exact integer amounts, destination network, memo/data requirements and keyboard-aware controls precede fee review.',
    fields: [
      { label: 'Asset & network', value: 'SYS · Syscoin UTXO' },
      {
        label: 'To',
        value: 'Sample recipient',
        hint: 'Paste, scan or choose a saved address.',
      },
      {
        label: 'Amount',
        value: '125.00 SYS',
        hint: 'Available: 24,810.42 SYS · Max leaves the network fee.',
      },
    ],
    primary: { label: 'Review send', to: 'transfer.review' },
    secondary: { label: 'Fee & transaction options', to: 'transfer.options' },
    accountContext: true,
  }),
  make('transfer', 'transfer.fee', 'Network fee', 'list', {
    purpose:
      'Different fee models: EVM gas limits/base/priority versus UTXO fee rate. Fiat is advisory; policy caps are authoritative.',
    rows: [
      row(
        'Standard',
        'Sample network estimate',
        undefined,
        'activity',
        'Recommended'
      ),
      row('Fast', 'Sample higher fee'),
      row(
        'Custom fee',
        'Review the exact network fields',
        'transfer.custom-fee',
        'settings'
      ),
    ],
    primary: { label: 'Use standard fee', to: 'transfer.review' },
    accountContext: true,
  }),
  make('transfer', 'transfer.custom-fee', 'Custom fee', 'form', {
    purpose:
      'Show chain-specific fields and explicit maximum cost; validate units and upper bounds, not float-formatted values.',
    fields: [
      { label: 'Network fee model', value: 'Syscoin UTXO' },
      {
        label: 'Fee rate',
        value: '2 sat/vB',
        hint: 'EVM uses gas limit and fee-per-gas fields instead.',
      },
    ],
    notice: {
      title: 'Review the maximum fee',
      body: 'A higher fee cannot guarantee confirmation.',
    },
    primary: { label: 'Review fee', to: 'transfer.review' },
    accountContext: true,
  }),
  make('transfer', 'transfer.review', 'Review send', 'review', {
    purpose:
      'Freeze account, full recipient, asset, chain, amount and maximum debit into one expiring review.',
    amount: '125.00',
    unit: 'SYS',
    rows: [
      row('From', 'Personal wallet · Syscoin UTXO'),
      row('To', 'Sample full destination address'),
      row('Amount', undefined, undefined, undefined, '125.00 SYS'),
      row(
        'Maximum network fee',
        undefined,
        undefined,
        undefined,
        '0.000042 SYS'
      ),
      row('Maximum total', undefined, undefined, undefined, '125.000042 SYS'),
    ],
    notice: {
      title: 'Check every detail',
      body: 'Confirm the recipient, network, amount and fee before approving.',
    },
    primary: { label: 'Confirm and send', to: 'transfer.authorize' },
    secondary: { label: 'Edit details', to: 'transfer.details' },
    accountContext: true,
  }),
  make('transfer', 'transfer.authorize', 'Authorize transfer', 'form', {
    purpose:
      'Use the reviewed transfer in the current unlocked session. External signing needs the account’s device or policy approval.',
    description:
      'Hardware accounts ask for confirmation on the device. Watch-only accounts cannot authorize.',
    primary: { label: 'Confirm transfer', to: 'transfer.submitted' },
    secondary: { label: 'Cancel', to: 'transfer.review' },
    accountContext: true,
    deviceConfirmation: true,
    hiddenInCatalog: true,
  }),
  make('transfer', 'transfer.submitted', 'Transaction submitted', 'success', {
    purpose:
      'Submission is not confirmation. Show exact chain and transaction hash; polling survives interruption without a blind resend.',
    headline: 'Submitted to the network',
    description:
      'Waiting for confirmation. You can follow progress in Activity.',
    rows: [
      row('Network', 'Syscoin UTXO'),
      row('Transaction ID', 'Sample transaction identifier'),
    ],
    primary: { label: 'View transaction', to: 'activity.utxo-detail' },
    secondary: { label: 'Back to wallet', to: 'wallet.home' },
    accountContext: true,
  }),
  make('transfer', 'transfer.unknown', 'Checking transaction status', 'hub', {
    purpose:
      'Ambiguous submission is not a failed send. Reconcile status before offering any retry.',
    headline: 'Submission status unknown',
    description:
      'The connection ended before Pali received a response. The transaction may already be on the network.',
    notice: {
      title: 'Do not send again yet',
      body: 'Pali will check the existing transaction before offering a retry.',
      tone: 'amber',
    },
    primary: { label: 'Check status', to: 'activity.detail' },
    secondary: { label: 'Back to wallet', to: 'wallet.home' },
    accountContext: true,
  }),
  make('transfer', 'transfer.receive-network', 'Receive', 'list', {
    purpose:
      'Every displayed address is tied to one network and one account, including hardware verification availability.',
    rows: [
      row(
        'Syscoin UTXO',
        'Receive native SYS and supported assets',
        'transfer.receive',
        'wallet'
      ),
      row(
        'Syscoin NEVM',
        'Receive SYS on the EVM network',
        'transfer.receive-nevm',
        'wallet'
      ),
      row(
        'Ethereum',
        'Receive ETH and Ethereum tokens',
        'transfer.receive-eth',
        'wallet'
      ),
      row('Bitcoin', 'Receive BTC', 'transfer.receive-btc', 'wallet'),
    ],
    accountContext: true,
  }),
  make('transfer', 'transfer.receive', 'Receive SYS', 'receive', {
    purpose:
      'QR matches the complete public address; copy/share confirmations occur only after successful OS action. Backup warning is contextual.',
    subtitle: 'Syscoin UTXO',
    notice: {
      title: 'Use the correct network',
      body: 'Only send assets supported by this address on Syscoin UTXO.',
    },
    primary: { label: 'Copy address', to: 'transfer.receive' },
    secondary: { label: 'Share address', to: 'transfer.receive' },
    accountContext: true,
  }),
  make(
    'transfer',
    'transfer.nft-review',
    'Review collectible transfer',
    'review',
    {
      purpose:
        'ERC-721 versus ERC-1155 quantity and token identity remain distinct; review includes contract, token ID and network fee.',
      headline: 'Example collection #104',
      rows: [
        row('Network', 'Ethereum'),
        row('Contract', 'Sample full contract identifier'),
        row('Token ID', '104'),
        row('Quantity', '1'),
        row('Recipient', 'Sample full address'),
        row('Maximum network fee', 'Shown in ETH'),
      ],
      primary: { label: 'Confirm and send', to: 'transfer.nft-authorize' },
      accountContext: true,
    }
  ),
  make('transfer', 'transfer.psbt', 'Review PSBT', 'review', {
    purpose:
      'Present all external outputs, identified change, fee and signing completeness; do not treat a partial signature as broadcast.',
    headline: 'Review transaction outputs',
    rows: [
      row('Output 1', 'Sample recipient · 125 SYS'),
      row('Change', 'Verified change output · this wallet'),
      row('Network fee', '0.000042 SYS'),
      row('Raw request', 'Inspect exact payload', 'connections.raw-data'),
      row('Signing scope', 'This wallet’s inputs only'),
      row('Result', 'May be partially signed'),
    ],
    primary: { label: 'Sign reviewed PSBT', to: 'transfer.psbt-authorize' },
    secondary: { label: 'Reject', to: 'connections.home' },
    accountContext: true,
  }),
  make('activity', 'activity.list', 'Activity', 'list', {
    purpose:
      'Filter by account/network, keep pending visible, distinguish dropped/replaced/unknown and preserve list position.',
    rows: [
      row(
        'Received',
        'Ethereum · +0.25 ETH · confirmed',
        'activity.eth-detail',
        'arrow-down-left'
      ),
      row(
        'Sent',
        'Syscoin NEVM · −125 SYS · pending',
        'activity.detail',
        'arrow-up-right'
      ),
      row(
        'Checking status',
        'Submission acknowledgement missing',
        'transfer.unknown',
        'activity'
      ),
      row(
        'Replaced transaction',
        'Open replacement chain',
        'activity.replacement',
        'refresh'
      ),
    ],
    accountContext: true,
  }),
  make('activity', 'activity.detail', 'Transaction', 'review', {
    purpose:
      'Transaction details use authoritative identity, replacement history and independently sourced fee/status information.',
    amount: '125.00',
    unit: 'SYS',
    rows: [
      row('Status', 'Pending confirmation'),
      row('Network', 'Syscoin NEVM'),
      row('From', 'Sample full source address'),
      row('To', 'Sample full recipient address'),
      row('Transaction ID', 'Sample complete hash'),
      row('Network fee', '0.000042 SYS'),
    ],
    primary: { label: 'Open network explorer', to: 'activity.detail' },
    secondary: { label: 'Replacement options', to: 'activity.replacement' },
    accountContext: true,
  }),
  make(
    'activity',
    'activity.replacement',
    'Manage pending transaction',
    'list',
    {
      purpose:
        'Only chain/account-supported authenticated replacements; cancelled or replaced transactions remain linked in history.',
      rows: [
        row(
          'Speed up',
          'Review a replacement with a higher fee',
          'activity.replacement-review',
          'refresh'
        ),
        row(
          'Cancel transfer',
          'Review a cancellation attempt',
          'activity.cancel-review',
          'close'
        ),
      ],
      notice: {
        title: 'Confirmation may race your request',
        body: 'A replacement or cancellation is not guaranteed to be accepted.',
        tone: 'amber',
      },
      accountContext: true,
    }
  ),
  make(
    'activity',
    'activity.replacement-review',
    'Review replacement',
    'review',
    {
      purpose:
        'Show original versus replacement, fee increase and maximum debit; authenticate the original before signing replacement.',
      rows: [
        row('Network', 'Syscoin NEVM'),
        row('Original transaction', 'Sample full transaction hash'),
        row('Action', 'Speed up'),
        row('Recipient & amount', 'Unchanged'),
        row('New maximum fee', '0.000084 SYS'),
        row('Fee increase', '0.000042 SYS'),
      ],
      primary: { label: 'Authorize replacement', to: 'transfer.authorize' },
      secondary: { label: 'Keep original', to: 'activity.detail' },
      accountContext: true,
    }
  ),
  make('connections', 'connections.home', 'Connections', 'list', {
    purpose:
      'Mobile connection transport is a native project; preserve per-origin/account/network permissions and contextual approvals.',
    rows: [
      row(
        'Connect an app',
        'Scan a connection code or paste a link',
        'connections.scan',
        'scan'
      ),
      row(
        'Example app',
        'example.invalid · Ethereum · Personal wallet',
        'connections.session',
        'globe'
      ),
      row(
        'Site lookup',
        'Check the trusted-origin list',
        'connections.trusted',
        'shield'
      ),
    ],
    primary: { label: 'Connect an app', to: 'connections.scan' },
  }),
  make('connections', 'connections.scan', 'Connect an app', 'scan', {
    purpose:
      'Camera permission is requested in context; scanning parses an untrusted request and cannot execute a privileged action.',
    description:
      'Scan a wallet connection QR code, or paste a connection link.',
    primary: { label: 'Use sample connection', to: 'connections.proposal' },
    secondary: { label: 'Paste connection link', to: 'connections.link' },
  }),
  make('connections', 'connections.link', 'Connection link', 'form', {
    purpose:
      'Connection metadata is untrusted until transport/origin checks succeed; never use a deep link as authorization.',
    fields: [
      {
        label: 'Wallet connection link',
        value: 'Sample connection request — not a live URI',
      },
    ],
    primary: { label: 'Review request', to: 'connections.proposal' },
  }),
  make(
    'connections',
    'connections.proposal',
    'Connect to this app?',
    'review',
    {
      purpose:
        'Origin, requested accounts, networks and permitted methods are shown before permission is persisted.',
      headline: 'Example app',
      approval: true,
      rows: [
        row('Origin', 'https://example.invalid'),
        row('Account', 'Personal wallet · selected address'),
        row('Networks', 'Ethereum'),
        row('Permissions', 'View address and request approvals'),
      ],
      notice: {
        title: 'Only connect to an app you recognize',
        body: 'A connection does not authorize a transaction.',
      },
      primary: { label: 'Connect', to: 'connections.session' },
      secondary: { label: 'Reject', to: 'connections.home' },
      accountContext: true,
    }
  ),
  make('connections', 'connections.session', 'Connected app', 'hub', {
    purpose:
      'Review and revoke session-specific grants, identify account and scope, and keep site metadata separate from verified transport origin.',
    headline: 'Example app',
    rows: [
      row('Origin', 'https://example.invalid'),
      row('Account', 'Personal wallet'),
      row('Network', 'Ethereum'),
      row('Permissions', 'View address · request approval'),
      row('Connection', 'Active · sample'),
    ],
    primary: { label: 'Disconnect', to: 'connections.home' },
    secondary: { label: 'Change account', to: 'connections.account' },
    accountContext: true,
  }),
  make('connections', 'connections.trusted', 'Site lookup', 'form', {
    purpose:
      'The source trusted-sites feature is an allowlist lookup. Granted and revocable account permissions belong to connected sessions.',
    fields: [{ label: 'Site origin', value: 'https://example.invalid' }],
    notice: {
      title: 'A listing is not permission',
      body: 'Site lookup and wallet connection permissions are separate.',
    },
    primary: { label: 'Check listing', to: 'connections.trusted' },
    secondary: { label: 'Manage granted access', to: 'connections.home' },
  }),
  make('connections', 'connections.account', 'Share an account', 'list', {
    purpose:
      'Account changes requested by a dapp need explicit authorization; never silently switch the wallet’s active account.',
    approval: true,
    rows: [
      row(
        'Personal wallet',
        'Ethereum · sample public address',
        'connections.session',
        'wallet'
      ),
      row('Watch-only', 'View address only', 'connections.session', 'eye'),
    ],
    secondary: { label: 'Reject request', to: 'connections.home' },
  }),
  make('connections', 'connections.network', 'Network request', 'review', {
    purpose:
      'Separate switch-network from add-network; unknown RPCs and explorer hosts are disclosed and validated before committing.',
    approval: true,
    rows: [
      row('Requesting app', 'https://example.invalid'),
      row('Action', 'Add a custom EVM network'),
      row('Chain ID', '12345 (sample)'),
      row('RPC endpoint', 'https://rpc.example.invalid'),
      row('Native currency', 'EXAMPLE'),
      row('Explorer', 'https://explorer.example.invalid'),
    ],
    notice: {
      title: 'This network is provided by the app',
      body: 'An untrusted network can provide misleading data.',
      tone: 'amber',
    },
    primary: { label: 'Approve network', to: 'connections.session' },
    secondary: { label: 'Reject', to: 'connections.home' },
    accountContext: true,
  }),
  make('connections', 'connections.sign-message', 'Review message', 'review', {
    purpose:
      'Keep readable and raw messages available; detect SIWE fields but do not imply arbitrary signatures are harmless.',
    headline: 'Message signature',
    approval: true,
    rows: [
      row('Requesting origin', 'https://example.invalid'),
      row('Account', 'Personal wallet'),
      row('Message', 'Sample sign-in request'),
      row('Domain / URI', 'example.invalid / https://example.invalid'),
      row('Chain, nonce, expiry', 'Shown when part of the signed request'),
    ],
    primary: { label: 'Authorize signature', to: 'settings.authorize' },
    secondary: { label: 'Reject', to: 'connections.home' },
    accountContext: true,
  }),
  make('connections', 'connections.typed-data', 'Review typed data', 'review', {
    purpose:
      'Show domain, verifying contract and structured fields with an inspectable raw fallback. Order/permit warnings are semantic, not a safety guarantee.',
    headline: 'Spending permission',
    approval: true,
    rows: [
      row('Origin', 'https://example.invalid'),
      row('Network', 'Ethereum'),
      row('Verifying contract', 'Sample full contract address'),
      row('Spender', 'Sample full spender address'),
      row('Allowance', 'Unlimited'),
      row('Expiry', 'Shown from request'),
    ],
    notice: {
      title: 'Unlimited allowance',
      body: 'This request can permit the spender to move tokens later.',
      tone: 'amber',
    },
    primary: { label: 'Authorize signature', to: 'settings.authorize' },
    secondary: { label: 'Reject', to: 'connections.home' },
    accountContext: true,
  }),
  make(
    'connections',
    'connections.transaction',
    'Review app transaction',
    'review',
    {
      purpose:
        'Contract call review preserves value, calldata, recipient, origin and fee cap; unclear intent remains explicitly unclear.',
      headline: 'Contract interaction',
      approval: true,
      rows: [
        row('Origin', 'https://example.invalid'),
        row('Network', 'Ethereum'),
        row('Contract', 'Sample complete address'),
        row('Native value', '0 ETH'),
        row('Requested action', 'Contract call · inspect data'),
        row('Maximum network fee', '0.00042 ETH'),
      ],
      primary: { label: 'Review authorization', to: 'transfer.authorize' },
      secondary: { label: 'Reject', to: 'connections.home' },
      accountContext: true,
    }
  ),
  make('connections', 'connections.batch', 'Review multiple calls', 'review', {
    purpose:
      'EOA calls are sequential and can partially complete; smart-account batch atomicity is shown only when supported.',
    approval: true,
    headline: '3 requested calls',
    rows: [
      row('Call 1', 'Approve token spending'),
      row('Call 2', 'Contract interaction'),
      row('Call 3', 'Transfer token'),
      row('Execution', 'Sequential for this account'),
      row('Total maximum cost', 'Show aggregate fees and transferred value'),
    ],
    notice: {
      title: 'Earlier calls may succeed',
      body: 'A later failure does not undo completed calls from a regular account.',
      tone: 'amber',
    },
    primary: { label: 'Authorize calls', to: 'transfer.authorize' },
    secondary: { label: 'Reject', to: 'connections.home' },
    accountContext: true,
  }),
  make(
    'connections',
    'connections.encryption',
    'Encryption request',
    'review',
    {
      purpose:
        'Distinct approval flows for encryption public-key disclosure and decryption; no blanket consent or clipboard leakage.',
      approval: true,
      headline: 'Share encryption public key?',
      rows: [
        row('Origin', 'https://example.invalid'),
        row('Account', 'Personal wallet'),
        row('Data shared', 'Encryption public key'),
      ],
      primary: { label: 'Approve once', to: 'connections.session' },
      secondary: { label: 'Reject', to: 'connections.home' },
      accountContext: true,
    }
  ),
  make('connections', 'connections.decrypt', 'Decrypt message', 'review', {
    purpose:
      'Origin-bound decryption approval and short-lived result display; content is hidden on lock/background.',
    approval: true,
    headline: 'Decrypt for this app?',
    rows: [
      row('Origin', 'https://example.invalid'),
      row('Account', 'Personal wallet'),
      row('Encrypted payload', 'Inspect raw data'),
    ],
    primary: { label: 'Authorize decryption', to: 'settings.authorize' },
    secondary: { label: 'Reject', to: 'connections.home' },
    accountContext: true,
  }),
  make('smart', 'smart.hub', 'Smart account', 'hub', {
    purpose:
      'Keep smart account identity separate from its owner/signer; readiness depends on chain, infrastructure and module state.',
    headline: 'Every permission in one place.',
    rows: [
      row(
        'Owners & signers',
        'Who can authorize this account',
        'smart.owners',
        'wallet'
      ),
      row(
        'Passkeys',
        'Manage registered credentials',
        'smart.passkeys',
        'lock'
      ),
      row(
        'Recovery guardians',
        'Review recovery policy',
        'smart.guardians',
        'shield'
      ),
      row(
        'Permissions & modules',
        'Review installed account modules',
        'smart.modules',
        'settings'
      ),
      row(
        'Network infrastructure',
        'Deployer and required contract status',
        'smart.infrastructure',
        'globe'
      ),
    ],
    accountContext: true,
  }),
  make('smart', 'smart.create', 'Create smart account', 'form', {
    purpose:
      'Explicit account deployment/setup review with signer and network; no universal chain support claim.',
    fields: [
      { label: 'Account name', value: 'Smart savings' },
      { label: 'Network', value: 'Supported EVM network' },
      { label: 'Owner', value: 'Personal wallet' },
      { label: 'Signer type', value: 'Select supported signer' },
    ],
    primary: { label: 'Review setup', to: 'smart.setup-review' },
    accountContext: true,
  }),
  make('smart', 'smart.setup-review', 'Review smart account setup', 'review', {
    purpose:
      'Show complete deployment/module plan and associated costs; explicit module consent is not hidden in normal account creation.',
    rows: [
      row('Network', 'Supported EVM network'),
      row('Owner', 'Personal wallet'),
      row('Modules', 'Selected signing and recovery modules'),
      row('Deployment', 'Not yet deployed'),
      row('Maximum setup cost', 'Quote required on live network'),
    ],
    primary: { label: 'Authorize setup', to: 'settings.authorize' },
    secondary: { label: 'Edit setup', to: 'smart.create' },
    accountContext: true,
  }),
  make('smart', 'smart.owners', 'Owners & signers', 'list', {
    purpose:
      'Expose EOA, hardware, passkey, composite and supported SLH-DSA configurations without conflating security properties.',
    rows: [
      row(
        'Primary owner',
        'Personal wallet · EOA',
        'accounts.details',
        'wallet'
      ),
      row(
        'Passkey signer',
        'Review credential binding',
        'smart.passkeys',
        'lock'
      ),
      row(
        'Advanced signers',
        'Composite / supported post-quantum module',
        'smart.signers',
        'shield'
      ),
      row(
        'Composite policy',
        'Threshold and member review',
        'smart.composite',
        'shield'
      ),
    ],
    accountContext: true,
  }),
  make('smart', 'smart.signers', 'Advanced signers', 'review', {
    purpose:
      'Describe precise module coverage and signer limits. Never imply an entire account or chain becomes post-quantum safe.',
    rows: [
      row('Signer module', 'Selected on-chain module'),
      row('Algorithms', 'Selected signer configuration'),
      row('Credential lifetime', 'Review module-specific limits'),
      row('Recovery', 'Separate configured recovery policy'),
    ],
    notice: {
      title: 'Review module compatibility',
      body: 'Signer support, recovery and transaction coverage depend on the selected network and account.',
    },
    primary: { label: 'Review module installation', to: 'smart.modules' },
    accountContext: true,
  }),
  make('smart', 'smart.passkeys', 'Passkeys', 'list', {
    purpose:
      'Credentials must remain bound to the accepted RP/origin and on-chain validator semantics; native association is a release gate.',
    rows: [
      row(
        'This device',
        'Sample credential · active',
        'smart.passkey-detail',
        'lock'
      ),
      row(
        'Add a passkey',
        'Use a supported authenticator',
        'smart.passkey-detail',
        'plus'
      ),
    ],
    accountContext: true,
  }),
  make('smart', 'smart.passkey-detail', 'Passkey details', 'review', {
    purpose:
      'Make credential removal and replacement distinct from device biometrics, and preserve another authorized recovery route.',
    rows: [
      row('Credential', 'This device · sample identifier'),
      row('Scope', 'Selected smart account'),
      row('Connected account', 'Selected smart account and network'),
      row('Recovery coverage', 'Configured guardians'),
    ],
    primary: { label: 'Review credential change', to: 'smart.setup-review' },
    accountContext: true,
  }),
  make('smart', 'smart.guardians', 'Recovery guardian', 'hub', {
    purpose:
      'Source parity uses one configured guardian and threshold one. Composite signing thresholds are a separate policy.',
    rows: [
      row('Guardian', '1 configured guardian'),
      row('Recovery threshold', '1 of 1'),
      row('Recovery delay', 'Configured on-chain delay'),
      row(
        'Guardian address',
        'Inspect or update policy',
        'smart.guardian-edit',
        'shield'
      ),
      row(
        'Recover authenticator',
        'Start or follow recovery',
        'smart.recovery',
        'refresh'
      ),
    ],
    accountContext: true,
  }),
  make('smart', 'smart.guardian-edit', 'Edit recovery guardian', 'form', {
    purpose:
      'Preserve the source single-guardian policy and allowed delay choices; do not invent multi-guardian support.',
    fields: [
      { label: 'Guardian address', value: 'Sample full guardian address' },
      { label: 'Threshold', value: '1 of 1 · fixed by supported module' },
      { label: 'Delay', value: 'Select a supported recovery delay' },
    ],
    primary: { label: 'Review policy change', to: 'smart.setup-review' },
    accountContext: true,
  }),
  make('smart', 'smart.recovery', 'Authenticator recovery', 'hub', {
    purpose:
      'Recover a supported account authenticator with the configured guardian, on-chain delay, cancellation and finalization states.',
    headline: 'Recovery in progress',
    rows: [
      row('Replacement authenticator', 'Sample new credential'),
      row('Guardian authorization', '1 of 1'),
      row('State', 'Waiting for configured recovery delay'),
      row('Available actions', 'Depend on current on-chain state'),
    ],
    primary: { label: 'Check recovery status', to: 'smart.recovery' },
    secondary: { label: 'Review cancellation', to: 'smart.setup-review' },
    accountContext: true,
  }),
  make('smart', 'smart.modules', 'Permissions & modules', 'list', {
    purpose:
      'List permissions, spending/session scope and module code identities. Installation/removal requires distinct explicit consent.',
    rows: [
      row(
        'Signing module',
        'Selected account signer',
        'smart.signers',
        'shield'
      ),
      row(
        'Recovery module',
        'Guardian threshold and delay',
        'smart.guardians',
        'shield'
      ),
      row(
        'App-requested module',
        'Review privileges before installation',
        'smart.module-consent',
        'globe'
      ),
      row(
        'Custom module',
        'Inspect roles and initialization data',
        'smart.custom-module',
        'plus'
      ),
    ],
    accountContext: true,
  }),
  make('smart', 'smart.module-consent', 'Review module permissions', 'review', {
    purpose:
      'An app cannot silently install a validator; show all roles and persistent authority.',
    approval: true,
    rows: [
      row('Requesting app', 'https://example.invalid'),
      row('Module address', 'Sample complete address'),
      row('Roles', 'Validator'),
      row('Permissions', 'All requested scope and limits'),
      row('Duration', 'Persistent until removed'),
    ],
    notice: {
      title: 'This changes account authority',
      body: 'Only add a module whose permissions you understand.',
      tone: 'amber',
    },
    primary: { label: 'Authorize module change', to: 'settings.authorize' },
    secondary: { label: 'Reject', to: 'smart.modules' },
    accountContext: true,
  }),
  make('smart', 'smart.infrastructure', 'Network infrastructure', 'review', {
    purpose:
      'Display source infrastructure readiness, contract deployment status and eligible deployment actions. Editable bundler/paymaster settings are not established source parity.',
    rows: [
      row('Network', 'Selected supported EVM network'),
      row('CREATE2 deployer', 'Deployment status'),
      row(
        'Factory / validators',
        'Each required contract and its deployment status'
      ),
      row('Pending deployment', 'Exact transaction status when present'),
    ],
    primary: { label: 'Refresh status', to: 'smart.infrastructure' },
    secondary: {
      label: 'Review required deployment',
      to: 'smart.setup-review',
    },
    accountContext: true,
  }),
  make('privacy', 'privacy.home', 'Private assets', 'hub', {
    purpose:
      'Separate public and private balance authority; incomplete sync is not zero and note availability depends on proofs/reservations.',
    headline: 'Private balance',
    amount: '1.1',
    unit: 'ETH',
    rows: [
      row(
        'Pool data',
        'Prepare and verify Ethereum pool history',
        'privacy.pool-data',
        'globe'
      ),
      row(
        'Deposit',
        'Move funds into the private pool',
        'privacy.deposit',
        'arrow-down-left'
      ),
      row(
        'Withdraw',
        'Send from available notes',
        'privacy.withdraw',
        'arrow-up-right'
      ),
      row(
        'Your notes',
        'View status and backup coverage',
        'privacy.notes',
        'lock'
      ),
      row(
        'Backups & import',
        'Whole-vault file or individual note',
        'privacy.backup-center',
        'wallet'
      ),
      row(
        'Privacy settings',
        'Services, capacity and cleanup',
        'privacy.settings',
        'settings'
      ),
    ],
    accountContext: true,
  }),
  make('privacy', 'privacy.deposit', 'Private deposit', 'form', {
    purpose:
      'A deposit produces a new bearer-secret note that needs a separate backup; ordinary seed backup is insufficient.',
    fields: [
      { label: 'Source account', value: 'Personal wallet' },
      {
        label: 'Pool & network',
        value: 'Ethereum Mainnet · pinned 0.1 ETH pool',
      },
      { label: 'Amount', value: '0.1 ETH · fixed denomination' },
    ],
    notice: {
      title: 'Back up the note',
      body: 'Your recovery phrase does not restore private notes.',
      tone: 'amber',
    },
    primary: { label: 'Review deposit', to: 'privacy.deposit-review' },
    accountContext: true,
  }),
  make(
    'privacy',
    'privacy.deposit-review',
    'Review private deposit',
    'review',
    {
      purpose:
        'Review pool, amount, fees and backup requirements before reserving/publishing; recovery must survive app termination.',
      rows: [
        row('Network / pool', 'Ethereum Mainnet · pinned 0.1 ETH pool'),
        row('Public amount', '0.1 ETH'),
        row('Maximum network fee', 'Quote required'),
        row('Backup coverage', 'New private note must be exported'),
      ],
      primary: { label: 'Back up deposit note', to: 'privacy.deposit-backup' },
      secondary: { label: 'Edit deposit', to: 'privacy.deposit' },
      accountContext: true,
    }
  ),
  make('privacy', 'privacy.withdraw', 'Private withdrawal', 'form', {
    requiresAccountSigner: false,
    purpose:
      'Available notes exclude reserved/spent/unknown states; separate recipient and relayer selections.',
    fields: [
      { label: 'Selected note', value: '0.1 ETH pool note' },
      { label: 'Recipient', value: 'Sample complete address' },
      { label: 'Delivery', value: 'Relayed withdrawal · selected' },
    ],
    primary: {
      label: 'Review relayed withdrawal',
      to: 'privacy.withdraw-review',
    },
    secondary: {
      label: 'Use direct withdrawal',
      to: 'privacy.withdraw-direct',
    },
    accountContext: true,
  }),
  make(
    'privacy',
    'privacy.withdraw-review',
    'Review private withdrawal',
    'review',
    {
      requiresAccountSigner: false,
      purpose:
        'Proof generation, relayer fee and on-chain amount are distinct; persist note reservation before submission.',
      rows: [
        row('Delivery', 'Relayed withdrawal'),
        row('Recipient', 'Sample full address'),
        row('Recipient receives', '0.099 ETH · example after relayer fee'),
        row('Relayer / network fee', 'Live quote required'),
        row('Selected notes', 'Reserved only after authorization'),
        row('Proof', 'Generated on this device when supported'),
      ],
      primary: { label: 'Authorize withdrawal', to: 'privacy.pending' },
      secondary: { label: 'Edit withdrawal', to: 'privacy.withdraw' },
      accountContext: true,
    }
  ),
  make('privacy', 'privacy.pending', 'Private transaction', 'hub', {
    purpose:
      'Expose proving, submitting, unknown, confirmed and failed-before-broadcast states without unsafe auto-retry.',
    headline: 'Preparing your proof',
    description: 'Keep Pali open while this device completes the proof.',
    rows: [
      row('Proof', 'In progress'),
      row('Submission', 'Not submitted'),
      row('Notes', 'Reserved for this request'),
    ],
    primary: {
      label: 'View transaction status',
      to: 'privacy.withdraw-status',
    },
    secondary: { label: 'Return to private assets', to: 'privacy.home' },
    accountContext: true,
  }),
  make('privacy', 'privacy.notes', 'Your private notes', 'list', {
    purpose:
      'Note identity, value, spend/reservation status and backup coverage must remain inspectable without exposing the note secret.',
    rows: [
      row('Note 01', '0.1 ETH · available · backed up', 'privacy.note', 'lock'),
      row(
        'Note 02',
        '1 ETH · available · backup needed',
        'privacy.note-1',
        'lock'
      ),
      row(
        'Import one note',
        'Restore a raw private note',
        'privacy.import',
        'plus'
      ),
    ],
    primary: { label: 'Back up notes', to: 'privacy.backup' },
    accountContext: true,
  }),
  make('privacy', 'privacy.note', 'Private note', 'hub', {
    purpose:
      'Bearer secrets are password-gated, document-scoped and cleared on background. Copy/export must be deliberate.',
    rows: [
      row('Value', '0.1 ETH'),
      row('Status', 'Available'),
      row('Backup', 'Individual private-note backup'),
      row(
        'Reveal secret',
        'Requires fresh password confirmation',
        'privacy.backup',
        'lock'
      ),
    ],
    notice: {
      title: 'A note can control funds',
      body: 'Anyone with a spendable note may be able to withdraw its value.',
      tone: 'amber',
    },
    primary: { label: 'Reveal note for backup', to: 'privacy.backup' },
    accountContext: true,
  }),
  make('privacy', 'privacy.backup', 'Reveal private note', 'form', {
    purpose:
      'Match source password-gated reveal of one raw note. There is no encrypted-file export or copy/download button in this flow.',
    fields: [
      { label: 'Selected note', value: 'Note 01 · Ethereum 0.1 ETH pool' },
      {
        label: 'Wallet password',
        value: 'Confirm your password',
        secret: true,
      },
    ],
    notice: {
      title: 'Back up this note separately',
      body: 'The recovery phrase does not restore private notes.',
      tone: 'amber',
    },
    primary: { label: 'Reveal note', to: 'privacy.backup-review' },
    accountContext: true,
  }),
  make('privacy', 'privacy.backup-review', 'Private note backup', 'phrase', {
    purpose:
      'Display a single raw bearer note after authorization. Match source read-only note reveal and explicit Hide, with no default copy/download.',
    headline: 'Private note',
    description:
      'Record this note privately. Anyone with a spendable note can use it.',
    notice: {
      title: 'This is not a recovery phrase',
      body: 'Back up each note separately and keep it private.',
      tone: 'amber',
    },
    primary: { label: 'Hide note', to: 'privacy.notes' },
    accountContext: true,
  }),
  make('privacy', 'privacy.import', 'Import private note', 'form', {
    purpose:
      'Match source raw note import. Validate format, pool, network and duplicate/spent status without claiming encrypted bundle import.',
    fields: [
      {
        label: 'Private note',
        value: 'Protected raw note entry — disabled in design',
        secret: true,
        multiline: true,
      },
    ],
    primary: { label: 'Review note to import', to: 'privacy.notes' },
    accountContext: true,
  }),
  make('privacy', 'privacy.settings', 'Privacy settings', 'list', {
    purpose:
      'Service endpoints, vault capacity and eligible cleanup remain distinct controls; no silent truncation.',
    rows: [
      row(
        'Network services',
        'Privacy indexer, relayer and pool',
        'privacy.services',
        'globe'
      ),
      row(
        'Note capacity',
        'Configured storage budget',
        'privacy.capacity',
        'wallet'
      ),
      row(
        'Clean up completed notes',
        'Review eligible spent/completed entries',
        'privacy.cleanup',
        'trash'
      ),
    ],
    accountContext: true,
  }),
  make('privacy', 'privacy.services', 'Privacy services', 'form', {
    purpose:
      'Changing the privacy service is not changing Ethereum RPC or the relayer; identify every endpoint separately.',
    fields: [
      { label: 'Privacy service', value: 'https://privacy.example.invalid' },
      { label: 'Relayer', value: 'https://relayer.example.invalid' },
      { label: 'Pool contract', value: 'Pinned registry · not user editable' },
    ],
    primary: { label: 'Verify services', to: 'privacy.settings' },
    accountContext: true,
  }),
  make('privacy', 'privacy.capacity', 'Note capacity', 'list', {
    purpose:
      'Supported capacities and encrypted-bundle budgets must fit native storage. Never reduce capacity below current note count.',
    rows: [
      row('128 notes', '4 MiB bundle budget'),
      row('256 notes', '8 MiB bundle budget'),
      row('512 notes', '16 MiB bundle budget'),
    ],
    primary: { label: 'Save capacity', to: 'privacy.settings' },
    accountContext: true,
  }),
  make('privacy', 'privacy.cleanup', 'Review note cleanup', 'review', {
    purpose:
      'Only eligible completed notes may be removed, with counts and explicit consent; available or uncertain notes stay protected.',
    rows: [
      row('Eligible completed notes', '3'),
      row('Available / pending notes', 'Protected · not removed'),
      row('Backup', 'Verify before removing local records'),
    ],
    primary: { label: 'Remove eligible records', to: 'privacy.notes' },
    secondary: { label: 'Keep records', to: 'privacy.settings' },
    accountContext: true,
  }),
  make('sentry', 'sentry.home', 'Sentry', 'hub', {
    purpose:
      'Syscoin signing/governance features; Sentry here is not an analytics service.',
    headline: 'Keys and operations',
    rows: [
      row(
        'Sentry keys',
        'Owner, operator, voting and collateral roles',
        'sentry.keys',
        'lock'
      ),
      row(
        'Operation requests',
        'Review requests from your Sentry service',
        'sentry.operation',
        'shield'
      ),
      row(
        'Link signer',
        'Connect supported signer identity',
        'sentry.link',
        'wallet'
      ),
      row('Vote', 'Review a governance vote', 'sentry.vote', 'check'),
      row(
        'Trusted service',
        'Endpoint and fee policy',
        'sentry.service',
        'globe'
      ),
      row(
        'Collateral',
        'Protected and pending outputs',
        'sentry.collateral',
        'shield'
      ),
    ],
    accountContext: true,
  }),
  make('sentry', 'sentry.keys', 'Sentry keys', 'list', {
    purpose:
      'Show role, algorithm and backup semantics; do not conflate seed accounts with independently generated role keys.',
    rows: [
      row('Owner key', 'Configured role identity', 'sentry.key-detail', 'lock'),
      row(
        'Operator key',
        'Algorithm and signer type',
        'sentry.key-detail',
        'lock'
      ),
      row(
        'Voting key',
        'Configured voting identity',
        'sentry.key-detail',
        'lock'
      ),
      row(
        'Collateral key',
        'Collateral ownership',
        'sentry.key-detail',
        'wallet'
      ),
    ],
    primary: { label: 'Import key', to: 'sentry.import' },
    accountContext: true,
  }),
  make('sentry', 'sentry.key-detail', 'Sentry key details', 'hub', {
    purpose:
      'Review role-specific public metadata and separate local-key removal from on-chain service operations.',
    rows: [
      row('Role', 'Operator'),
      row('Algorithm', 'Selected supported key scheme'),
      row('Public key', 'Sample public identifier'),
      row(
        'Remove local key',
        'Requires backup and password confirmation',
        'sentry.remove-key',
        'trash'
      ),
    ],
    accountContext: true,
  }),
  make('sentry', 'sentry.operation', 'Review Sentry operation', 'review', {
    purpose:
      'Review role-specific operation, destination/payout/collateral and signing scope; capabilities depend on chain and algorithm.',
    rows: [
      row('Operation', 'Register / update as selected'),
      row('Network', 'Syscoin UTXO'),
      row('Collateral', 'Sample collateral reference'),
      row('Operator / payout', 'Sample role configuration'),
      row('Maximum fee', 'Live network quote'),
    ],
    primary: { label: 'Authorize operation', to: 'settings.authorize' },
    secondary: { label: 'Cancel', to: 'sentry.home' },
    accountContext: true,
  }),
  make('sentry', 'sentry.link', 'Link Sentry signer', 'review', {
    purpose:
      'Bind requested signer and role to the actual wallet/account/chain, not a displayed key string alone.',
    rows: [
      row('Sentry identity', 'Sample registration identifier'),
      row('Requested role', 'Selected signer role'),
      row('Signer', 'Current eligible account'),
    ],
    primary: { label: 'Authorize link', to: 'settings.authorize' },
    accountContext: true,
  }),
  make('sentry', 'sentry.vote', 'Review governance vote', 'review', {
    purpose:
      'Proposal identifier, outcome and voting signer are reviewed as a distinct operation.',
    rows: [
      row('Proposal', 'Sample proposal identifier'),
      row('Outcome', 'Yes / no / abstain as selected'),
      row('Voting identity', 'Configured voting key'),
    ],
    primary: { label: 'Authorize vote', to: 'settings.authorize' },
    secondary: { label: 'Cancel', to: 'sentry.home' },
    accountContext: true,
  }),
  make('settings', 'settings.home', 'Settings', 'list', {
    purpose:
      'Durable wallet management and preferences are distinct from daily operational tools.',
    rows: [
      row('Accounts', 'Create, import and manage', 'accounts.list', 'wallet'),
      row(
        'Networks',
        'Add and manage network connections',
        'settings.networks',
        'globe'
      ),
      row(
        'Security & backups',
        'Lock, recovery and export',
        'settings.security',
        'shield'
      ),
      row(
        'Language & currency',
        'Personalize display',
        'settings.preferences',
        'settings'
      ),
      row(
        'Advanced',
        'Connection and safety controls',
        'settings.advanced',
        'settings'
      ),
      row('About Pali', 'Version, help and privacy', 'settings.about', 'info'),
    ],
  }),
  make('settings', 'settings.networks', 'Networks', 'list', {
    purpose:
      'Network family, identity and endpoint stay visible; mainnet and testnet are never distinguished by color alone.',
    rows: [
      row('Syscoin UTXO', 'Mainnet · SLIP-44 57', 'settings.network', 'globe'),
      row('Bitcoin', 'Mainnet · UTXO', 'settings.network', 'globe'),
      row('Ethereum', 'Mainnet · Chain ID 1', 'settings.network', 'globe'),
      row('Syscoin NEVM', 'Mainnet · Chain ID 57', 'settings.network', 'globe'),
      row(
        'Add network',
        'Custom RPC / Blockbook endpoint',
        'settings.network-add',
        'plus'
      ),
    ],
  }),
  make('settings', 'settings.network', 'Network details', 'review', {
    purpose:
      'Network edits must invalidate dependent quotes/reviews; separate network service identities.',
    rows: [
      row('Name', 'Syscoin UTXO'),
      row('Family', 'UTXO'),
      row('Endpoint', 'Configured Blockbook endpoint'),
      row('Native asset', 'SYS'),
      row('Explorer', 'Configured network explorer'),
    ],
    primary: { label: 'Edit network', to: 'settings.network-add' },
    secondary: { label: 'Choose network', to: 'wallet.home' },
  }),
  make('settings', 'settings.network-add', 'Add network', 'form', {
    purpose:
      'Validate endpoint and chain identity without publishing a half-configured network. No silent fallback.',
    fields: [
      { label: 'Network family', value: 'EVM / UTXO' },
      { label: 'Network name', value: 'Example network' },
      { label: 'RPC or Blockbook URL', value: 'https://rpc.example.invalid' },
      {
        label: 'Chain identity',
        value: 'Detected and independently confirmed',
      },
      { label: 'Native currency', value: 'Example symbol' },
      {
        label: 'Explorer (optional)',
        value: 'https://explorer.example.invalid',
      },
    ],
    primary: { label: 'Verify network', to: 'settings.network' },
  }),
  make('settings', 'settings.security', 'Security & backups', 'list', {
    purpose:
      'Security controls disclose current protection and backup coverage; app lock differs from account signers.',
    rows: [
      row('Lock Pali', 'Lock immediately', 'onboarding.unlock', 'lock'),
      row(
        'Device authentication',
        'Manage optional biometric unlock',
        'settings.device-auth',
        'shield'
      ),
      row(
        'Backup center',
        'Every secret type and its recovery coverage',
        'settings.backups',
        'wallet'
      ),
      row(
        'Auto-lock',
        'Background policy and timeout',
        'settings.autolock',
        'activity'
      ),
      row(
        'Remove wallet',
        'Review and remove from this device',
        'settings.remove',
        'trash'
      ),
    ],
  }),
  make('settings', 'settings.device-auth', 'Device authentication', 'hub', {
    purpose:
      'Biometric enrollment, revoked credentials, lockout and password fallback are independently tested native behavior.',
    headline: 'Unlock your way.',
    description:
      'Use a supported device authentication method after setting up your wallet password.',
    rows: [
      row(
        'Device authentication',
        'Supported on this device in the target build'
      ),
      row('Password fallback', 'Always keep your wallet password'),
      row('Secret exports', 'Require fresh password confirmation'),
    ],
    primary: { label: 'Set up device unlock', to: 'onboarding.biometrics' },
  }),
  make('settings', 'settings.autolock', 'Auto-lock', 'list', {
    purpose:
      'Native lifecycle lock policy is measured across suspension; a timer is not assumed to run in the background.',
    rows: [
      row(
        'When Pali leaves the screen',
        'Recommended for the first custody release',
        undefined,
        'lock',
        'Selected'
      ),
      row('After inactivity', 'Device-tested intervals where supported'),
    ],
    primary: { label: 'Save policy', to: 'settings.security' },
  }),
  make('settings', 'settings.backups', 'Backup center', 'list', {
    purpose:
      'One inventory makes backup completeness visible without incorrectly claiming one seed restores everything.',
    rows: [
      row(
        'Recovery phrase',
        'Seed-derived accounts',
        'settings.phrase',
        'wallet'
      ),
      row(
        'Imported private keys',
        'Separate account backups',
        'settings.private-key',
        'lock'
      ),
      row(
        'Private notes',
        'Whole-vault backup or individual notes',
        'privacy.backup-center',
        'lock'
      ),
      row(
        'Smart account recovery',
        'Guardians and passkey recovery policy',
        'smart.guardians',
        'shield'
      ),
      row(
        'Hardware accounts',
        'Follow the device backup procedure',
        'accounts.hardware',
        'shield'
      ),
    ],
  }),
  make('settings', 'settings.phrase', 'Reveal recovery phrase', 'form', {
    purpose:
      'Require current password and short-lived purpose-bound authorization; native protected display follows.',
    fields: [
      {
        label: 'Wallet password',
        value: 'Confirm your password',
        secret: true,
      },
    ],
    notice: {
      title: 'Keep your backup private',
      body: 'Only reveal it when you need to record or verify your own backup.',
      tone: 'amber',
    },
    primary: { label: 'Reveal phrase', to: 'onboarding.phrase' },
  }),
  make('settings', 'settings.private-key', 'Export account key', 'form', {
    purpose:
      'Only eligible software accounts can reveal/export keys; hardware and watch-only accounts present public identifiers instead.',
    fields: [
      { label: 'Account', value: 'Imported account' },
      {
        label: 'Wallet password',
        value: 'Confirm your password',
        secret: true,
      },
    ],
    notice: {
      title: 'This key controls this account',
      body: 'An exported private key requires its own secure backup.',
      tone: 'amber',
    },
    primary: { label: 'Reveal account key', to: 'settings.key-reveal' },
  }),
  make('settings', 'settings.key-reveal', 'Account key', 'phrase', {
    purpose:
      'Key exposure is scoped, short-lived, protected from app snapshots and explicit clipboard use; design never contains a usable key.',
    headline: 'Private key',
    notice: {
      title: 'Keep this key private',
      body: 'Anyone who has the key can control this account.',
      tone: 'amber',
    },
    primary: { label: 'Hide key', to: 'settings.backups' },
  }),
  make('settings', 'settings.authorize', 'Confirm it’s you', 'form', {
    purpose:
      'Purpose-bound current password authorization is not generic permission to execute a future unrelated action.',
    fields: [
      {
        label: 'Wallet password',
        value: 'Password entry — disabled in design',
        secret: true,
      },
    ],
    description:
      'Confirm the action you just reviewed. A changed or expired request must be reviewed again.',
    primary: { label: 'Confirm reviewed action', to: 'activity.list' },
    secondary: { label: 'Cancel', to: 'wallet.home' },
  }),
  make('settings', 'settings.preferences', 'Language & currency', 'list', {
    purpose:
      'Shared translations and currency preferences need native locale/text-scaling tests, including long translations.',
    rows: [
      row('Language', 'English', 'settings.language', 'globe'),
      row('Display currency', 'USD', 'settings.currency', 'settings'),
      row('Hide balances', 'Display privacy only', 'settings.security', 'eye'),
    ],
  }),
  make('settings', 'settings.language', 'Language', 'list', {
    purpose:
      'Use the extension’s translation catalogue and preserve locale selection; no hardcoded English-only product release.',
    rows: [
      row('English', 'English', undefined, undefined, 'Selected'),
      row('Español', 'Spanish'),
      row('Português', 'Portuguese'),
      row('All supported languages', 'Shared extension catalogue'),
    ],
    primary: { label: 'Save language', to: 'settings.preferences' },
  }),
  make('settings', 'settings.currency', 'Display currency', 'list', {
    purpose:
      'Fiat display preference never changes raw spend units or implies fiat availability.',
    rows: [
      row('USD', 'US dollar', undefined, undefined, 'Selected'),
      row('CAD', 'Canadian dollar'),
      row('EUR', 'Euro'),
      row('Other supported currencies', 'Shared extension catalogue'),
    ],
    primary: { label: 'Save currency', to: 'settings.preferences' },
  }),
  make('settings', 'settings.advanced', 'Advanced', 'list', {
    purpose:
      'Preserve meaningful extension controls with platform-correct labels; no fake global browser injection toggle.',
    rows: [
      row(
        'Refresh behavior',
        'Sync while active, reconcile on resume',
        'settings.refresh',
        'refresh'
      ),
      row(
        'Dapp connections',
        'Allow requests and revoke sessions',
        'connections.home',
        'globe'
      ),
      row(
        'Smart-account infrastructure',
        'Advanced network services',
        'smart.infrastructure',
        'settings'
      ),
      row(
        'Privacy services',
        'Pool data, relayer and storage',
        'privacy.settings',
        'lock'
      ),
      row(
        'Sentry settings',
        'Keys, trusted service and collateral',
        'sentry.home',
        'shield'
      ),
      row(
        'Testnet tools',
        'Only on configured test networks',
        'settings.faucet',
        'plus'
      ),
    ],
  }),
  make('settings', 'settings.faucet', 'Testnet funds', 'hub', {
    purpose:
      'Only present faucets for actually configured test networks; success is based on service/network evidence.',
    headline: 'For testing only.',
    description:
      'Testnet assets have no intended monetary value. Availability depends on the configured network faucet.',
    primary: { label: 'Request test funds', to: 'activity.list' },
    secondary: { label: 'Back to settings', to: 'settings.advanced' },
  }),
  make('settings', 'settings.remove', 'Remove wallet from device', 'review', {
    purpose:
      'Show exact local deletion scope and independent backup requirements; never conflate with on-chain revocation.',
    headline: 'Make sure you can restore it.',
    rows: [
      row('Seed-derived accounts', 'Recovery phrase required'),
      row('Imported keys', 'Separate key backups required'),
      row('Private notes', 'Individual private-note backups required'),
      row('Smart accounts', 'Recovery credentials and policy required'),
    ],
    notice: {
      title: 'This cannot be undone on this device',
      body: 'Removing local data does not revoke on-chain permissions or recover missing backups.',
      tone: 'red',
    },
    primary: {
      label: 'Confirm removal with password',
      to: 'settings.authorize',
    },
    secondary: { label: 'Keep wallet', to: 'settings.security' },
  }),
  make('settings', 'settings.about', 'About Pali', 'list', {
    purpose:
      'Version/build identity, help, privacy and network data handling remain inspectable with no default telemetry.',
    rows: [
      row('Version', 'Design target · extension-equivalent mobile'),
      row('Help & support', 'Verified official support entry'),
      row('Privacy', 'No default analytics; endpoint disclosures'),
      row('Security', 'Current compatibility and disclosure information'),
    ],
  }),
  make(
    'onboarding',
    'onboarding.recover-phrase',
    'Verify wallet recovery',
    'form',
    {
      purpose:
        'A distinct existing-wallet recovery path binds the matching phrase to the durable local wallet, never replacing it with an arbitrary seed.',
      fields: [
        {
          label: 'Matching recovery phrase',
          value: 'Protected native entry — inactive in design',
          secret: true,
        },
      ],
      primary: { label: 'Verify this wallet', to: 'onboarding.recover-match' },
      secondary: { label: 'Cancel', to: 'onboarding.unlock' },
    }
  ),
  make(
    'onboarding',
    'onboarding.recover-match',
    'Recovery identity verified',
    'review',
    {
      purpose:
        'The authority checks the matching stored HD identity and explains what remains separately backed up before password reset.',
      headline: 'This is your wallet.',
      rows: [
        row('Stored wallet identity', 'Matched by wallet authority'),
        row(
          'Imported keys / private notes',
          'Separate recovery coverage shown before proceeding'
        ),
      ],
      primary: {
        label: 'Set a new password',
        to: 'onboarding.recover-password',
      },
      secondary: { label: 'Cancel recovery', to: 'onboarding.unlock' },
    }
  ),
  make(
    'onboarding',
    'onboarding.recover-password',
    'Set a new password',
    'form',
    {
      purpose:
        'Journaled recovery commits and reconciles the existing encrypted wallet pair before reporting success.',
      fields: [
        { label: 'New password', value: 'New password', secret: true },
        {
          label: 'Confirm new password',
          value: 'Confirm password',
          secret: true,
        },
      ],
      primary: { label: 'Restore access', to: 'onboarding.unlock' },
    }
  ),
  make('wallet', 'wallet.tools', 'Tools', 'hub', {
    purpose:
      'Daily operations live in one stable tab. Unsupported tools remain discoverable with their actual account/network requirement.',
    rows: [
      row(
        'Connected apps',
        'Connections and permissions',
        'connections.home',
        'globe'
      ),
      row(
        'Private assets',
        'Notes, pool data and private transfers',
        'privacy.home',
        'lock'
      ),
      row(
        'Smart accounts',
        'Signers, modules and recovery',
        'smart.hub',
        'shield'
      ),
      row('Sentry', 'Authority keys and operations', 'sentry.home', 'shield'),
    ],
  }),

  make('privacy', 'privacy.pool-data', 'Pool data', 'hub', {
    purpose:
      'Public pool history is verified separately from private note ownership, with pinned addresses, block progress, pause and resume.',
    headline: 'Verified pool history',
    rows: [
      row('Network', 'Ethereum Mainnet'),
      row('Pool', 'Pinned 0.1 ETH deployment'),
      row('Sync state', 'Verifying downloaded events'),
      row('Verified through', 'Sample block number'),
      row('Prepare / refresh data', 'Resume bounded index synchronization'),
      row('Clear public cache', 'Does not delete private notes'),
    ],
    primary: { label: 'Pause synchronization', to: 'privacy.home' },
    accountContext: true,
  }),
  make('transfer', 'transfer.options', 'Transaction options', 'list', {
    purpose:
      'Present only options supported by the selected UTXO chain and transaction; feature toggles cannot alter an approved review silently.',
    rows: [
      row('Replace-by-fee', 'Enable replacement where supported'),
      row('Z-DAG', 'Syscoin-only option where supported'),
      row('Fee rate', 'Exact sat/vB units', 'transfer.custom-fee'),
    ],
    primary: { label: 'Review options', to: 'transfer.review' },
    accountContext: true,
  }),
  make(
    'connections',
    'connections.watch-asset',
    'Add requested asset?',
    'review',
    {
      purpose:
        'A dapp-provided symbol or image cannot establish token authenticity. Resolve identifiers against the selected chain.',
      approval: true,
      rows: [
        row('Origin', 'https://example.invalid'),
        row('Network', 'Ethereum'),
        row('Contract / GUID', 'Complete immutable asset identifier'),
        row('Display name', 'Untrusted metadata'),
        row('Decimals', 'Independently checked when possible'),
      ],
      primary: { label: 'Add asset', to: 'wallet.tokens' },
      secondary: { label: 'Reject', to: 'connections.home' },
      accountContext: true,
    }
  ),
  make('connections', 'connections.raw-data', 'Request details', 'review', {
    purpose:
      'Preserve byte-exact payload inspection alongside the semantic display, with bounded rendering and honest unknown fields.',
    approval: true,
    rows: [
      row('Method', 'Sample RPC method'),
      row('Origin', 'https://example.invalid'),
      row('Account / network', 'Bound request context'),
      row('Raw payload', 'Sample hex / structured payload only'),
      row('Interpretation', 'Unknown data is not marked safe'),
    ],
    secondary: { label: 'Back to request', to: 'connections.transaction' },
    accountContext: true,
  }),
  make('connections', 'connections.risk', 'Review this connection', 'review', {
    purpose:
      'Trusted-site lookup and spam signals inform the decision but do not replace per-operation authorization.',
    approval: true,
    headline: 'Check the requesting app',
    rows: [
      row('Origin', 'https://example.invalid'),
      row('Signal', 'Unlisted / flagged as applicable'),
      row('Requested access', 'View address and request approvals'),
    ],
    notice: {
      title: 'A familiar name is not verification',
      body: 'Check the actual site origin before continuing.',
      tone: 'amber',
    },
    primary: { label: 'Review permissions', to: 'connections.proposal' },
    secondary: { label: 'Reject request', to: 'connections.home' },
  }),
  make('activity', 'activity.batch-status', 'Batch progress', 'list', {
    purpose:
      'Show per-call identity and outcome; a partially completed EOA batch is not retryable as an untouched atomic transaction.',
    rows: [
      row('Call 1', 'Confirmed · sample hash'),
      row('Call 2', 'Status unknown · checking'),
      row('Call 3', 'Not submitted'),
      row('Batch result', 'Partial completion'),
    ],
    notice: {
      title: 'Some calls have completed',
      body: 'Do not repeat the whole batch while a submitted call has unknown status.',
      tone: 'amber',
    },
    primary: { label: 'Check submitted calls', to: 'activity.batch-status' },
    secondary: { label: 'Back to activity', to: 'activity.list' },
    accountContext: true,
  }),
  make('smart', 'smart.composite', 'Composite signing policy', 'form', {
    purpose:
      'Choose a valid threshold and list every member; protect against duplicate/unsupported signers and unusable policies.',
    fields: [
      { label: 'Approval threshold', value: '2 of 3 methods' },
      { label: 'Method 1', value: 'ECDSA owner' },
      { label: 'Method 2', value: 'Passkey credential' },
      { label: 'Method 3', value: 'Supported SLH-DSA authenticator' },
    ],
    notice: {
      title: 'Keep enough recovery methods',
      body: 'Losing the required number of signers can prevent access.',
    },
    primary: { label: 'Review policy', to: 'smart.setup-review' },
    accountContext: true,
  }),
  make('smart', 'smart.custom-module', 'Inspect custom module', 'form', {
    purpose:
      'Preflight code, roles and initialization data before a custom module can alter account authority.',
    fields: [
      { label: 'Module address', value: 'Sample complete contract address' },
      { label: 'Role', value: 'Validator' },
      { label: 'Initialization data', value: 'Sample raw initialization data' },
    ],
    primary: { label: 'Inspect permissions', to: 'smart.module-consent' },
    accountContext: true,
  }),
  make('sentry', 'sentry.service', 'Sentry service', 'form', {
    purpose:
      'A trusted service endpoint and maximum fee are explicit preferences; never give it unrestricted authority.',
    fields: [
      { label: 'Service endpoint', value: 'https://sentry.example.invalid' },
      {
        label: 'Maximum operation fee',
        value: '100000 satoshis (sample policy)',
      },
    ],
    primary: { label: 'Review service settings', to: 'sentry.service-review' },
    accountContext: true,
  }),
  make('sentry', 'sentry.collateral', 'Protected collateral', 'list', {
    purpose:
      'Distinguish active registered collateral from pending reservations and never silently make it spendable.',
    rows: [
      row(
        'Registered collateral',
        'Protected output · sample registration',
        'sentry.collateral-release',
        'shield'
      ),
      row(
        'Pending registration',
        'Reserved output · status pending',
        undefined,
        'activity'
      ),
    ],
    accountContext: true,
  }),
  make(
    'sentry',
    'sentry.collateral-release',
    'Release collateral protection',
    'review',
    {
      purpose:
        'Manual release is explicit and password-gated; explain the consequence of spending an active collateral output.',
      rows: [
        row('Output', 'Sample transaction ID and vout'),
        row('Registration', 'Sample registration identifier'),
      ],
      notice: {
        title: 'Spending can stop the registered node',
        body: 'Removing local protection makes this output available for selection.',
        tone: 'red',
      },
      primary: { label: 'Confirm with password', to: 'settings.authorize' },
      secondary: { label: 'Keep protected', to: 'sentry.collateral' },
      accountContext: true,
    }
  ),

  make('sentry', 'sentry.import', 'Import Sentry keys', 'form', {
    purpose:
      'Protected single or batch import preserves role, algorithm, labels, backup acknowledgement and password-confirmed durable storage.',
    fields: [
      { label: 'Import type', value: 'Single key / batch keys' },
      {
        label: 'Role & algorithm',
        value: 'Selected supported role and algorithm',
      },
      {
        label: 'Key material',
        value: 'Protected key entry — disabled in design',
        secret: true,
        multiline: true,
      },
      {
        label: 'Wallet password',
        value: 'Confirm your password',
        secret: true,
      },
    ],
    notice: {
      title: 'Keep a separate backup',
      body: 'Your wallet recovery phrase may not restore these imported authority keys.',
      tone: 'amber',
    },
    primary: { label: 'Review key import', to: 'sentry.import-review' },
    accountContext: true,
  }),
  make('settings', 'settings.refresh', 'Refresh behavior', 'form', {
    purpose:
      'Keep source refresh controls while native scheduling respects app suspension and request budgets.',
    fields: [
      {
        label: 'Refresh interval',
        value: 'Configured interval while app is active',
      },
      {
        label: 'When resuming',
        value: 'Reconcile context and refresh stale data',
      },
    ],
    primary: { label: 'Save preferences', to: 'settings.advanced' },
  }),

  make('transfer', 'transfer.eth-details', 'Send ETH', 'form', {
    purpose:
      'Chain-specific sample keeps selected asset, network and recipient through review and authorization.',
    fields: [
      { label: 'Network', value: 'Ethereum' },
      { label: 'Recipient', value: 'Sample complete recipient address' },
      { label: 'Amount', value: '0.25 ETH' },
    ],
    primary: { label: 'Review send', to: 'transfer.eth-review' },
    accountContext: true,
  }),
  make('transfer', 'transfer.eth-review', 'Review send', 'review', {
    purpose:
      'Review the same Ethereum sample selected in the prior step; do not change its network during navigation.',
    amount: '0.25',
    unit: 'ETH',
    rows: [
      row('Network', 'Ethereum'),
      row('Recipient', 'Sample complete address'),
      row('Amount', undefined, undefined, undefined, '0.25 ETH'),
      row('Maximum fee', undefined, undefined, undefined, '0.000042 ETH'),
      row('Maximum total', undefined, undefined, undefined, '0.250042 ETH'),
    ],
    primary: { label: 'Confirm and send', to: 'transfer.eth-authorize' },
    secondary: { label: 'Edit details', to: 'transfer.eth-details' },
    accountContext: true,
  }),
  make('transfer', 'transfer.eth-authorize', 'Authorize transfer', 'form', {
    purpose:
      'Retain Ethereum and reviewed quantity while choosing the correct account-specific authorizer.',
    fields: [
      { label: 'Reviewed transfer', value: '0.25 ETH · Ethereum' },
    ],
    primary: { label: 'Confirm transfer', to: 'transfer.eth-submitted' },
    secondary: { label: 'Cancel', to: 'transfer.eth-review' },
    accountContext: true,
    deviceConfirmation: true,
    hiddenInCatalog: true,
  }),
  make(
    'transfer',
    'transfer.eth-submitted',
    'Transaction submitted',
    'success',
    {
      purpose:
        'Submission on Ethereum is distinct from confirmation; retain the same network and amount.',
      headline: 'Submitted to the network',
      rows: [
        row('Network', 'Ethereum'),
        row('Amount', '0.25 ETH'),
        row('Transaction ID', 'Sample transaction identifier'),
      ],
      primary: { label: 'View transaction', to: 'activity.eth-detail' },
      secondary: { label: 'Back to wallet', to: 'wallet.home' },
      accountContext: true,
    }
  ),
  make('activity', 'activity.eth-detail', 'Transaction', 'review', {
    purpose:
      'Chain-specific sample receipt preserves network identity. Replacement is offered only on eligible EVM operations.',
    amount: '0.25',
    unit: 'ETH',
    rows: [
      row('Network', 'Ethereum'),
      row('Status', 'Pending confirmation'),
      row('From', 'Sample complete source'),
      row('To', 'Sample complete recipient'),
      row('Transaction ID', 'Sample full hash'),
    ],
    secondary: { label: 'Back to activity', to: 'activity.list' },
    accountContext: true,
  }),
  make('transfer', 'transfer.btc-details', 'Send BTC', 'form', {
    purpose:
      'Chain-specific sample keeps selected asset, network and recipient through review and authorization.',
    fields: [
      { label: 'Network', value: 'Bitcoin' },
      { label: 'Recipient', value: 'Sample complete recipient address' },
      { label: 'Amount', value: '0.005 BTC' },
    ],
    primary: { label: 'Review send', to: 'transfer.btc-review' },
    accountContext: true,
  }),
  make('transfer', 'transfer.btc-review', 'Review send', 'review', {
    purpose:
      'Review the same Bitcoin sample selected in the prior step; do not change its network during navigation.',
    amount: '0.005',
    unit: 'BTC',
    rows: [
      row('Network', 'Bitcoin'),
      row('Recipient', 'Sample complete address'),
      row('Amount', undefined, undefined, undefined, '0.005 BTC'),
      row('Maximum fee', undefined, undefined, undefined, '0.000042 BTC'),
      row('Maximum total', undefined, undefined, undefined, '0.005042 BTC'),
    ],
    primary: { label: 'Confirm and send', to: 'transfer.btc-authorize' },
    secondary: { label: 'Edit details', to: 'transfer.btc-details' },
    accountContext: true,
  }),
  make('transfer', 'transfer.btc-authorize', 'Authorize transfer', 'form', {
    purpose:
      'Retain Bitcoin and reviewed quantity while choosing the correct account-specific authorizer.',
    fields: [
      { label: 'Reviewed transfer', value: '0.005 BTC · Bitcoin' },
    ],
    primary: { label: 'Confirm transfer', to: 'transfer.btc-submitted' },
    secondary: { label: 'Cancel', to: 'transfer.btc-review' },
    accountContext: true,
    deviceConfirmation: true,
    hiddenInCatalog: true,
  }),
  make(
    'transfer',
    'transfer.btc-submitted',
    'Transaction submitted',
    'success',
    {
      purpose:
        'Submission on Bitcoin is distinct from confirmation; retain the same network and amount.',
      headline: 'Submitted to the network',
      rows: [
        row('Network', 'Bitcoin'),
        row('Amount', '0.005 BTC'),
        row('Transaction ID', 'Sample transaction identifier'),
      ],
      primary: { label: 'View transaction', to: 'activity.btc-detail' },
      secondary: { label: 'Back to wallet', to: 'wallet.home' },
      accountContext: true,
    }
  ),
  make('activity', 'activity.btc-detail', 'Transaction', 'review', {
    purpose:
      'Chain-specific sample receipt preserves network identity. Replacement is offered only on eligible EVM operations.',
    amount: '0.005',
    unit: 'BTC',
    rows: [
      row('Network', 'Bitcoin'),
      row('Status', 'Pending confirmation'),
      row('From', 'Sample complete source'),
      row('To', 'Sample complete recipient'),
      row('Transaction ID', 'Sample full hash'),
    ],
    secondary: { label: 'Back to activity', to: 'activity.list' },
    accountContext: true,
  }),
  make('transfer', 'transfer.nevm-details', 'Send SYS', 'form', {
    purpose:
      'Chain-specific sample keeps selected asset, network and recipient through review and authorization.',
    fields: [
      { label: 'Network', value: 'Syscoin NEVM' },
      { label: 'Recipient', value: 'Sample complete recipient address' },
      { label: 'Amount', value: '125.00 SYS' },
    ],
    primary: { label: 'Review send', to: 'transfer.nevm-review' },
    accountContext: true,
  }),
  make('transfer', 'transfer.nevm-review', 'Review send', 'review', {
    purpose:
      'Review the same Syscoin NEVM sample selected in the prior step; do not change its network during navigation.',
    amount: '125.00',
    unit: 'SYS',
    rows: [
      row('Network', 'Syscoin NEVM'),
      row('Recipient', 'Sample complete address'),
      row('Amount', undefined, undefined, undefined, '125.00 SYS'),
      row('Maximum fee', undefined, undefined, undefined, '0.000042 SYS'),
      row('Maximum total', undefined, undefined, undefined, '125.000042 SYS'),
    ],
    primary: { label: 'Confirm and send', to: 'transfer.nevm-authorize' },
    secondary: { label: 'Edit details', to: 'transfer.nevm-details' },
    accountContext: true,
  }),
  make('transfer', 'transfer.nevm-authorize', 'Authorize transfer', 'form', {
    purpose:
      'Retain Syscoin NEVM and reviewed quantity while choosing the correct account-specific authorizer.',
    fields: [
      { label: 'Reviewed transfer', value: '125.00 SYS · Syscoin NEVM' },
    ],
    primary: { label: 'Confirm transfer', to: 'transfer.nevm-submitted' },
    secondary: { label: 'Cancel', to: 'transfer.nevm-review' },
    accountContext: true,
    deviceConfirmation: true,
    hiddenInCatalog: true,
  }),
  make(
    'transfer',
    'transfer.nevm-submitted',
    'Transaction submitted',
    'success',
    {
      purpose:
        'Submission on Syscoin NEVM is distinct from confirmation; retain the same network and amount.',
      headline: 'Submitted to the network',
      rows: [
        row('Network', 'Syscoin NEVM'),
        row('Amount', '125.00 SYS'),
        row('Transaction ID', 'Sample transaction identifier'),
      ],
      primary: { label: 'View transaction', to: 'activity.nevm-detail' },
      secondary: { label: 'Back to wallet', to: 'wallet.home' },
      accountContext: true,
    }
  ),
  make('activity', 'activity.nevm-detail', 'Transaction', 'review', {
    purpose:
      'Chain-specific sample receipt preserves network identity. Replacement is offered only on eligible EVM operations.',
    amount: '125.00',
    unit: 'SYS',
    rows: [
      row('Network', 'Syscoin NEVM'),
      row('Status', 'Pending confirmation'),
      row('From', 'Sample complete source'),
      row('To', 'Sample complete recipient'),
      row('Transaction ID', 'Sample full hash'),
    ],
    secondary: { label: 'Back to activity', to: 'activity.list' },
    accountContext: true,
  }),
  make('activity', 'activity.utxo-detail', 'Transaction', 'review', {
    purpose:
      'UTXO receipt has no EVM cancellation controls. Preserve amount, output and asset identities.',
    amount: '125.00',
    unit: 'SYS',
    rows: [
      row('Network', 'Syscoin UTXO'),
      row('Status', 'Pending confirmation'),
      row('Recipient', 'Sample full recipient'),
      row('Transaction ID', 'Sample full hash'),
      row('Fee', '0.000042 SYS'),
    ],
    secondary: { label: 'Back to activity', to: 'activity.list' },
    accountContext: true,
  }),
  make(
    'transfer',
    'transfer.psbt-authorize',
    'Authorize PSBT signature',
    'form',
    {
      purpose:
        'Sign-only authorization must return a possibly partial PSBT rather than simulate a network broadcast.',
      fields: [
        { label: 'Network', value: 'Syscoin UTXO' },
        { label: 'Operation', value: 'Sign only — no broadcast' },
      ],
      primary: { label: 'Sign reviewed PSBT', to: 'transfer.psbt-result' },
      secondary: { label: 'Cancel', to: 'transfer.psbt' },
      accountContext: true,
      deviceConfirmation: true,
      hiddenInCatalog: true,
    }
  ),
  make('transfer', 'transfer.psbt-result', 'PSBT signature ready', 'success', {
    purpose:
      'A returned PSBT may need other signers; no broadcast or confirmed transaction is implied.',
    headline: 'Signed data returned',
    description:
      'This PSBT may still need other signatures. No transaction was broadcast.',
    secondary: { label: 'Back to connections', to: 'connections.home' },
    accountContext: true,
  }),
  make(
    'transfer',
    'transfer.nft-authorize',
    'Authorize collectible transfer',
    'form',
    {
      purpose:
        'Keep ERC-721 identity and network through authorization; this does not become a native SYS transfer.',
      fields: [
        { label: 'Collectible', value: 'Example collection #104 · Ethereum' },
        { label: 'Recipient', value: 'Sample complete recipient' },
      ],
      primary: {
        label: 'Confirm collectible transfer',
        to: 'transfer.nft-result',
      },
      secondary: { label: 'Cancel', to: 'transfer.nft-review' },
      accountContext: true,
      deviceConfirmation: true,
      hiddenInCatalog: true,
    }
  ),
  make(
    'transfer',
    'transfer.nft-result',
    'Collectible transfer submitted',
    'success',
    {
      purpose:
        'The collectible transfer remains an Ethereum transaction with its own token identity and pending status.',
      headline: 'Submitted to Ethereum',
      rows: [
        row('Collectible', 'Example collection #104'),
        row('Status', 'Pending confirmation'),
        row('Transaction ID', 'Sample transaction identifier'),
      ],
      secondary: { label: 'Back to collectibles', to: 'wallet.nfts' },
      accountContext: true,
    }
  ),
  make(
    'privacy',
    'privacy.deposit-backup',
    'Back up the deposit note',
    'form',
    {
      purpose:
        'A prepared deposit keeps its existing note and intent while backup is completed, before authorization and broadcast.',
      fields: [
        { label: 'Prepared note', value: 'Ethereum Mainnet · 0.1 ETH pool' },
        {
          label: 'Wallet password',
          value: 'Confirm your password',
          secret: true,
        },
      ],
      primary: { label: 'Reveal prepared note', to: 'privacy.deposit-note' },
      secondary: { label: 'Cancel deposit', to: 'privacy.home' },
      accountContext: true,
    }
  ),
  make('privacy', 'privacy.deposit-note', 'Deposit note backup', 'phrase', {
    purpose:
      'Show the prepared raw note under a protected grant; no automatic clipboard/download. Return to the same deposit intent.',
    headline: 'Private note',
    description:
      'Record this individual note privately before continuing. No valid note is present in this design.',
    primary: {
      label: 'I have recorded this note',
      to: 'privacy.deposit-ready',
    },
    secondary: { label: 'Cancel deposit', to: 'privacy.home' },
    accountContext: true,
  }),
  make(
    'privacy',
    'privacy.deposit-ready',
    'Confirm private deposit',
    'review',
    {
      purpose:
        'Backup acknowledgement, prepared note, account, pool and fee remain bound to the same deposit intent.',
      rows: [
        row('Network', 'Ethereum Mainnet'),
        row('Pool amount', '0.1 ETH'),
        row('Note backup', 'Acknowledged for this prepared note'),
        row('Maximum fee', 'Same current review quote'),
      ],
      primary: { label: 'Authorize deposit', to: 'privacy.pending' },
      secondary: { label: 'Cancel', to: 'privacy.home' },
      accountContext: true,
    }
  ),
  make('wallet', 'wallet.asset-btc', 'Bitcoin', 'hub', {
    purpose:
      'Asset detail preserves the selected Bitcoin asset and uses only matching send/receive paths.',
    amount: '0.0842',
    unit: 'BTC',
    subtitle: 'Bitcoin · Native asset',
    rows: [
      row(
        'Send',
        'Review a BTC transfer',
        'transfer.btc-details',
        'arrow-up-right'
      ),
      row(
        'Receive',
        'Show the Bitcoin address',
        'transfer.receive-btc',
        'arrow-down-left'
      ),
      row('Network', 'Bitcoin'),
      row(
        'Recent activity',
        'View this network’s transaction sample',
        'activity.btc-detail',
        'activity'
      ),
    ],
    accountContext: true,
  }),
  make('transfer', 'transfer.receive-btc', 'Receive BTC', 'receive', {
    purpose:
      'The QR and address share one account and one network identity. No other network is implied.',
    subtitle: 'Bitcoin',
    notice: {
      title: 'Check the network',
      body: 'Use only the Bitcoin network for this address.',
    },
    primary: { label: 'Copy address', to: 'transfer.receive-btc' },
    secondary: { label: 'Share address', to: 'transfer.receive-btc' },
    accountContext: true,
  }),
  make('wallet', 'wallet.asset-eth', 'Ethereum', 'hub', {
    purpose:
      'Asset detail preserves the selected Ethereum asset and uses only matching send/receive paths.',
    amount: '1.82',
    unit: 'ETH',
    subtitle: 'Ethereum · Native asset',
    rows: [
      row(
        'Send',
        'Review a ETH transfer',
        'transfer.eth-details',
        'arrow-up-right'
      ),
      row(
        'Receive',
        'Show the Ethereum address',
        'transfer.receive-eth',
        'arrow-down-left'
      ),
      row('Network', 'Ethereum'),
      row(
        'Recent activity',
        'View this network’s transaction sample',
        'activity.eth-detail',
        'activity'
      ),
    ],
    accountContext: true,
  }),
  make('transfer', 'transfer.receive-eth', 'Receive ETH', 'receive', {
    purpose:
      'The QR and address share one account and one network identity. No other network is implied.',
    subtitle: 'Ethereum',
    notice: {
      title: 'Check the network',
      body: 'Use only the Ethereum network for this address.',
    },
    primary: { label: 'Copy address', to: 'transfer.receive-eth' },
    secondary: { label: 'Share address', to: 'transfer.receive-eth' },
    accountContext: true,
  }),
  make('wallet', 'wallet.asset-nevm', 'Syscoin', 'hub', {
    purpose:
      'Asset detail preserves the selected Syscoin NEVM asset and uses only matching send/receive paths.',
    amount: '4,815.30',
    unit: 'SYS',
    subtitle: 'Syscoin NEVM · Native asset',
    rows: [
      row(
        'Send',
        'Review a SYS transfer',
        'transfer.nevm-details',
        'arrow-up-right'
      ),
      row(
        'Receive',
        'Show the Syscoin NEVM address',
        'transfer.receive-nevm',
        'arrow-down-left'
      ),
      row('Network', 'Syscoin NEVM'),
      row(
        'Recent activity',
        'View this network’s transaction sample',
        'activity.nevm-detail',
        'activity'
      ),
    ],
    accountContext: true,
  }),
  make('transfer', 'transfer.receive-nevm', 'Receive SYS', 'receive', {
    purpose:
      'The QR and address share one account and one network identity. No other network is implied.',
    subtitle: 'Syscoin NEVM',
    notice: {
      title: 'Check the network',
      body: 'Use only the Syscoin NEVM network for this address.',
    },
    primary: { label: 'Copy address', to: 'transfer.receive-nevm' },
    secondary: { label: 'Share address', to: 'transfer.receive-nevm' },
    accountContext: true,
  }),

  make('privacy', 'privacy.backup-center', 'Private-note backups', 'list', {
    scope: 'shared-enhancement',
    purpose:
      'Proposed shared extension/mobile enhancement: whole-note-vault encrypted backup alongside existing individual-note reveal/import.',
    rows: [
      row(
        'Back up all private notes',
        'Create a portable encrypted file',
        'privacy.bundle-export',
        'wallet'
      ),
      row(
        'Restore note backup',
        'Review and merge a backup file',
        'privacy.bundle-import',
        'plus'
      ),
      row(
        'Reveal one note',
        'Existing password-gated note backup',
        'privacy.backup',
        'lock'
      ),
      row(
        'Import one note',
        'Existing raw-note import',
        'privacy.import',
        'plus'
      ),
    ],
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-export', 'Back up all notes', 'review', {
    scope: 'shared-enhancement',
    purpose:
      'Export all retained private-note records and essential metadata in an independent password-encrypted format; not a copy of device-bound internal ciphertext. Freeze this exact inventory for one export attempt.',
    headline: 'A backup for every note.',
    rows: [
      ...sampleNoteBackupInventory(),
      row('Included', 'Every retained note in this wallet at this snapshot'),
      row('Note state', 'Retained regardless of available, pending, uncertain or completed status'),
      row('Not included', 'Wallet seed, imported account keys or passkeys'),
    ],
    notice: {
      title: 'Keep the file and password',
      body: 'You will need both to restore these private notes. Notes added after this snapshot require a new backup.',
    },
    primary: { label: 'Set backup password', to: 'privacy.bundle-password' },
    secondary: { label: 'Cancel', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-password', 'Protect note backup', 'form', {
    scope: 'shared-enhancement',
    purpose:
      'Fresh wallet-password confirmation authorizes secret export. A separate portable backup password encrypts the file without relying on this device’s key store.',
    fields: [
      { label: 'Wallet password', value: 'Confirm access to this wallet', secret: true },
      { label: 'Backup file password', value: 'Choose a strong password for this file', secret: true },
      { label: 'Confirm backup password', value: 'Repeat backup password', secret: true },
    ],
    notice: {
      title: 'Keep the backup password safe',
      body: 'Pali cannot recover an unknown backup password.',
    },
    primary: { label: 'Review encrypted backup', to: 'privacy.bundle-review' },
    secondary: { label: 'Cancel', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-review', 'Review note backup', 'review', {
    scope: 'shared-enhancement',
    purpose:
      'Show the same frozen inventory before invoking native save/share. Cancellation or failed handoff never marks backup complete.',
    rows: [
      ...sampleNoteBackupInventory(),
      row('File', 'pali-private-notes.pali-notes'),
      row('Protection', 'Password-encrypted and authenticated'),
      row('Recovery scope', 'Private notes only · not a complete wallet backup'),
    ],
    primary: { label: 'Save encrypted file', to: 'privacy.bundle-saved' },
    secondary: { label: 'Cancel', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-saved', 'Backup handed to destination', 'hub', {
    scope: 'shared-enhancement',
    purpose:
      'Show this acknowledgement only after the save/share adapter reports handoff. Handoff does not prove the file was durably saved; only a read-back can verify this exact inventory.',
    headline: 'Verify your saved copy.',
    description:
      'The encrypted file was handed to your chosen destination. Select the saved file to check that it contains this backup.',
    rows: [
      ...sampleNoteBackupInventory(),
      row('Verification', 'Not yet verified'),
    ],
    notice: {
      title: 'Handoff is not verification',
      body: 'A destination or share-sheet acknowledgement does not prove that the file can be opened later.',
      tone: 'amber',
    },
    primary: { label: 'Verify saved backup', to: 'privacy.bundle-verify' },
    secondary: { label: 'Verify later', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-verify', 'Verify note backup', 'form', {
    scope: 'shared-enhancement',
    purpose:
      'Read and authenticate the saved export in memory and compare its manifest with this exact expected snapshot. Another valid file does not verify this inventory. Verification never imports notes.',
    fields: [
      { label: 'Saved backup', value: 'Choose the file saved for snapshot PN-0941' },
      { label: 'Backup file password', value: 'Enter the file’s password', secret: true },
    ],
    rows: sampleNoteBackupInventory(),
    primary: { label: 'Verify this snapshot', to: 'privacy.bundle-verified' },
    secondary: { label: 'Cancel', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-verified', 'Backup verified', 'success', {
    scope: 'shared-enhancement',
    purpose:
      'A read-back result proves that this file/password pair authenticated and matched the expected snapshot inventory. It does not prove long-term storage safety or chain spend status.',
    headline: 'This snapshot can be opened.',
    description:
      'Both notes and the profile inventory matched snapshot PN-0941. Keep the file and password safe; create a new backup after adding notes.',
    rows: [
      ...sampleNoteBackupInventory(),
      row('Result', 'File authenticated · complete snapshot inventory matched'),
    ],
    primary: { label: 'Done', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-import', 'Restore note backup', 'form', {
    scope: 'shared-enhancement',
    purpose:
      'Accept only bounded versioned authenticated export files. Never pass the external file straight into an internal encrypted-vault restore routine.',
    fields: [
      { label: 'Encrypted note backup', value: 'Choose a .pali-notes backup file' },
      { label: 'Backup file password', value: 'Enter the file’s password', secret: true },
    ],
    primary: { label: 'Check backup', to: 'privacy.bundle-merge' },
    secondary: { label: 'Cancel', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-merge', 'Review notes to restore', 'review', {
    scope: 'shared-enhancement',
    purpose:
      'Authenticate and validate the entire import before a single mutation. Default merge deduplicates commitments and never replaces newer spend state. Bind the next wallet-password authorization to this file, destination and frozen merge preview.',
    rows: [
      ...sampleNoteBackupInventory(),
      row('New notes', '1 sample record · 0.1 ETH pool'),
      row('Already present', '1 duplicate · 1 ETH pool · existing record retained'),
      row('Conflicts', '0 in this sample · conflicts must be resolved'),
      row('Spend status', 'Imported note requires current-chain reconciliation'),
      row('Existing notes', 'Current state and reservations kept unchanged'),
    ],
    notice: {
      title: 'Restoring is not a balance check',
      body: 'Imported notes stay unverified until Pali checks their current status.',
    },
    primary: { label: 'Confirm with wallet password', to: 'privacy.bundle-authorize' },
    secondary: { label: 'Cancel', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-authorize', 'Authorize note restore', 'form', {
    scope: 'shared-enhancement',
    authorization: true,
    requiresAccountSigner: false,
    purpose:
      'Fresh destination-wallet password authentication authorizes this exact validated backup merge. The file password does not authorize mutation. Recheck destination generation, snapshot and capacity before one atomic commit.',
    fields: [
      { label: 'Destination wallet password', value: 'Confirm this wallet’s password', secret: true },
    ],
    rows: [
      row('Destination', 'Current initialized Pali wallet · sample'),
      row('Backup snapshot', 'PN-0941 · 2 retained notes'),
      row('Import', '1 new note · keep 1 existing duplicate'),
      row('Existing records', 'No replacement, deletion or reservation changes'),
    ],
    notice: {
      title: 'Check the destination',
      body: 'Changing the wallet or the validated file returns you to a fresh merge review.',
    },
    primary: { label: 'Import reviewed note', to: 'privacy.bundle-restored' },
    secondary: { label: 'Cancel', to: 'privacy.bundle-merge' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-restored', 'Notes restored', 'success', {
    scope: 'shared-enhancement',
    purpose:
      'Publish only after atomic durable merge. The new note is retained with a reconciliation guard, while the duplicate’s existing state and reservations remain unchanged.',
    headline: 'Note saved. Verification pending.',
    description:
      'One new note was saved locally and one existing note was kept. The imported note is not available to withdraw until its current status is verified.',
    rows: [
      row('Imported', '1 note · needs chain verification'),
      row('Already present', '1 note · current state kept unchanged'),
    ],
    primary: { label: 'View restored notes', to: 'privacy.bundle-notes' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-notes', 'Restored notes', 'list', {
    scope: 'shared-enhancement',
    purpose:
      'Keep the imported snapshot’s reconciliation state visible. This restoration scenario is separate from the ordinary ready-note examples and cannot imply immediate withdrawal availability.',
    rows: [
      row('Imported note · 0.1 ETH pool', 'Needs chain verification · withdrawal unavailable', 'privacy.bundle-note-status', 'activity'),
      row('Existing note · 1 ETH pool', 'Already present · existing state and reservations retained', undefined, 'lock'),
    ],
    notice: {
      title: 'Verification is still pending',
      body: 'Offline, stale or unavailable pool data never becomes an unspent result. Retain the note safely while Pali checks.',
      tone: 'amber',
    },
    primary: { label: 'Check imported note status', to: 'privacy.bundle-note-status' },
    secondary: { label: 'Back to backups', to: 'privacy.backup-center' },
    accountContext: true,
  }),
  make('privacy', 'privacy.bundle-note-status', 'Imported note status', 'review', {
    scope: 'shared-enhancement',
    purpose:
      'Represent the unresolved imported-note state without trusting a backup’s cached spent/unspent flags. No withdrawal action is available until current-chain reconciliation succeeds.',
    rows: [
      row('Network', 'Ethereum Mainnet'),
      row('Pool', 'Pinned 0.1 ETH pool'),
      row('Status', 'Needs chain verification'),
      row('Current observation', 'Not yet verified'),
      row('Withdrawal', 'Unavailable while status is unresolved'),
    ],
    primary: { label: 'Return to restored notes', to: 'privacy.bundle-notes' },
    secondary: { label: 'Back to backups', to: 'privacy.backup-center' },
    accountContext: true,
  }),

  make(
    'activity',
    'activity.cancel-review',
    'Review cancellation attempt',
    'review',
    {
      purpose:
        'An eligible EVM cancellation replaces the pending nonce with a new self-transfer. It is not the speed-up flow and is never a guaranteed undo.',
      rows: [
        row('Network', 'Syscoin NEVM'),
        row('Original transaction', 'Sample original transaction hash'),
        row('Action', 'Cancellation attempt'),
        row('Replacement recipient', 'Your own address'),
        row('Replacement value', '0 SYS'),
        row('Maximum new fee', 'Explicit replacement quote'),
      ],
      notice: {
        title: 'The original may confirm first',
        body: 'A cancellation cannot reverse an already confirmed transaction.',
        tone: 'amber',
      },
      primary: { label: 'Authorize cancellation', to: 'settings.authorize' },
      secondary: { label: 'Keep original', to: 'activity.detail' },
      accountContext: true,
    }
  ),
  make('privacy', 'privacy.note-1', 'Private note', 'hub', {
    purpose:
      'The selected one-ETH note retains its pool and note identity through reveal and withdrawal.',
    rows: [
      row('Value', '1 ETH'),
      row('Pool', 'Ethereum Mainnet · 1 ETH'),
      row('Status', 'Available'),
      row(
        'Reveal note',
        'Password-confirmed individual backup',
        'privacy.backup-1',
        'lock'
      ),
    ],
    primary: { label: 'Reveal for backup', to: 'privacy.backup-1' },
    accountContext: true,
  }),
  make('privacy', 'privacy.backup-1', 'Reveal private note', 'form', {
    purpose:
      'Fresh password confirmation reveals the specifically selected one-ETH note, not an arbitrary note.',
    fields: [
      {
        label: 'Selected note',
        value: 'Note 02 · Ethereum Mainnet · 1 ETH pool',
      },
      {
        label: 'Wallet password',
        value: 'Confirm your password',
        secret: true,
      },
    ],
    primary: { label: 'Reveal selected note', to: 'privacy.reveal-1' },
    accountContext: true,
  }),
  make('privacy', 'privacy.reveal-1', 'Private note', 'phrase', {
    purpose:
      'The revealed bearer note corresponds to Note02 and the one-ETH pool; no copy or download is performed by default.',
    headline: 'Private note',
    description: 'Selected note: Note 02 · 1 ETH pool.',
    primary: { label: 'Hide note', to: 'privacy.note-1' },
    accountContext: true,
  }),
  make('privacy', 'privacy.deposit-pending', 'Deposit status', 'hub', {
    purpose:
      'A deposit is a public funding transaction and does not run the private-withdrawal proof step.',
    headline: 'Deposit submitted',
    rows: [
      row('Network', 'Ethereum Mainnet'),
      row('Pool amount', '0.1 ETH'),
      row('Transaction status', 'Waiting for confirmation'),
      row('Note', 'Prepared note retained and backed up'),
    ],
    primary: { label: 'View deposit status', to: 'privacy.deposit-status' },
    secondary: { label: 'Back to notes', to: 'privacy.notes' },
    accountContext: true,
  }),
  make(
    'privacy',
    'privacy.deposit-status',
    'Private deposit transaction',
    'review',
    {
      purpose:
        'Deposit status shows the exact public funding transaction and associated pool, not a generic SYS receipt.',
      rows: [
        row('Network', 'Ethereum Mainnet'),
        row('Pool', 'Pinned 0.1 ETH pool'),
        row('Amount', '0.1 ETH'),
        row('Transaction', 'Sample deposit transaction ID'),
        row('State', 'Pending confirmation'),
      ],
      secondary: { label: 'Back to private assets', to: 'privacy.home' },
      accountContext: true,
    }
  ),
  make('sentry', 'sentry.import-review', 'Review key import', 'review', {
    purpose:
      'Local key import is a backup-confirmed vault mutation, not an on-chain Sentry registration.',
    rows: [
      row('Import scope', 'Selected single key or parsed batch'),
      row('Roles and algorithms', 'Review each parsed record'),
      row('Backup', 'Separate key backup acknowledged'),
    ],
    primary: { label: 'Authorize local import', to: 'settings.authorize' },
    secondary: { label: 'Edit import', to: 'sentry.import' },
    accountContext: true,
  }),
  make('sentry', 'sentry.service-review', 'Review service settings', 'review', {
    purpose:
      'Saving a trusted service URL and fee ceiling changes local policy; it does not submit a registration transaction.',
    rows: [
      row('Service', 'https://sentry.example.invalid'),
      row('Maximum fee', '100000 satoshis · sample'),
    ],
    primary: { label: 'Authorize settings change', to: 'settings.authorize' },
    secondary: { label: 'Edit settings', to: 'sentry.service' },
    accountContext: true,
  }),
  make('sentry', 'sentry.remove-key', 'Remove local Sentry key', 'review', {
    purpose:
      'Deleting a local key requires its independent backup and does not automatically unregister a node or release protected collateral.',
    rows: [
      row('Key', 'Selected role and public-key fingerprint'),
      row('Registered collateral', 'Remains protected'),
      row('Backup', 'Must be held independently'),
    ],
    primary: { label: 'Authorize key removal', to: 'settings.authorize' },
    secondary: { label: 'Keep key', to: 'sentry.key-detail' },
    accountContext: true,
  }),

  make(
    'privacy',
    'privacy.withdraw-direct',
    'Direct private withdrawal',
    'form',
    {
      requiresAccountSigner: true,
      purpose:
        'Direct withdrawal requires an eligible account to sign and pay gas; watch-only accounts must use an available relayed path instead.',
      fields: [
        { label: 'Network', value: 'Ethereum Mainnet' },
        { label: 'Private note', value: 'Selected 0.1 ETH pool note' },
        { label: 'Recipient', value: 'Sample complete address' },
        { label: 'Gas payer', value: 'Eligible signing account' },
      ],
      primary: {
        label: 'Review direct withdrawal',
        to: 'privacy.withdraw-direct-review',
      },
      secondary: { label: 'Use relayer instead', to: 'privacy.withdraw' },
      accountContext: true,
    }
  ),
  make(
    'privacy',
    'privacy.withdraw-direct-review',
    'Review direct withdrawal',
    'review',
    {
      requiresAccountSigner: true,
      purpose:
        'Direct withdrawal binds the note proof, recipient and gas-paying signer under the current account/network context.',
      rows: [
        row('Delivery', 'Direct transaction'),
        row('Network', 'Ethereum Mainnet'),
        row('Recipient', 'Sample complete address'),
        row('Pool amount', '0.1 ETH'),
        row('Gas payer', 'Selected eligible account'),
        row('Maximum gas fee', 'Explicit ETH quote'),
      ],
      primary: {
        label: 'Authorize direct withdrawal',
        to: 'settings.authorize',
      },
      secondary: { label: 'Edit details', to: 'privacy.withdraw-direct' },
      accountContext: true,
    }
  ),

  make(
    'privacy',
    'privacy.withdraw-status',
    'Private withdrawal status',
    'review',
    {
      purpose:
        'The withdrawal receipt remains bound to Ethereum and its original note/recipient/relayer context, never a generic NEVM sample.',
      rows: [
        row('Network', 'Ethereum Mainnet'),
        row('Pool', 'Selected pinned ETH pool'),
        row('Recipient', 'Sample complete recipient'),
        row('Delivery', 'Relayed / direct as selected'),
        row('Transaction', 'Sample withdrawal transaction ID'),
        row('Status', 'Waiting for verified confirmation'),
      ],
      secondary: { label: 'Back to private assets', to: 'privacy.home' },
      accountContext: true,
    }
  ),
];
// Each shared authorization view is materialized with its caller's operation and return paths.
// This keeps the prototype from changing an EVM request into a SYS transfer or a local edit into a registration.
const operationDestinations: Record<
  string,
  { next: string; headline: string; flow?: boolean }
> = {
  'accounts.remove': {
    next: 'accounts.list',
    headline: 'Account removed from this device',
  },
  'settings.remove': {
    next: 'onboarding.welcome',
    headline: 'Wallet removed from this device',
  },
  'smart.setup-review': {
    next: 'smart.hub',
    headline: 'Account change submitted',
  },
  'smart.module-consent': {
    next: 'smart.modules',
    headline: 'Module change submitted',
  },
  'sentry.import-review': {
    next: 'sentry.keys',
    headline: 'Local keys imported',
  },
  'sentry.service-review': {
    next: 'sentry.home',
    headline: 'Service settings saved',
  },
  'sentry.remove-key': { next: 'sentry.keys', headline: 'Local key removed' },
  'sentry.collateral-release': {
    next: 'sentry.collateral',
    headline: 'Local collateral protection updated',
  },
  'sentry.operation': {
    next: 'sentry.home',
    headline: 'Authorized response returned',
  },
  'sentry.link': {
    next: 'sentry.home',
    headline: 'Authorized response returned',
  },
  'sentry.vote': { next: 'sentry.home', headline: 'Vote signature returned' },
  'connections.sign-message': {
    next: 'connections.session',
    headline: 'Message signature returned',
  },
  'connections.typed-data': {
    next: 'connections.session',
    headline: 'Typed-data signature returned',
  },
  'connections.decrypt': {
    next: 'connections.session',
    headline: 'Decrypted response returned',
  },
  'connections.transaction': {
    next: 'activity.eth-detail',
    headline: 'Ethereum transaction submitted',
  },
  'connections.batch': {
    next: 'activity.batch-status',
    headline: 'Batch execution started',
  },
  'activity.replacement-review': {
    next: 'activity.detail',
    headline: 'Speed-up transaction submitted',
  },
  'activity.cancel-review': {
    next: 'activity.detail',
    headline: 'Cancellation attempt submitted',
  },
  'privacy.deposit-ready': {
    next: 'privacy.deposit-pending',
    headline: '',
    flow: true,
  },
  'privacy.withdraw-review': {
    next: 'privacy.pending',
    headline: '',
    flow: true,
  },
  'privacy.withdraw-direct-review': {
    next: 'privacy.pending',
    headline: '',
    flow: true,
  },
};
for (const [sourceId, destination] of Object.entries(operationDestinations)) {
  const source = baseScreens.find((item) => item.id === sourceId)!;
  if (
    [
      'accounts.remove',
      'settings.remove',
      'sentry.import-review',
      'sentry.service-review',
      'sentry.remove-key',
      'sentry.collateral-release',
    ].includes(sourceId)
  )
    source.requiresAccountSigner = false;
  const authId = sourceId + '.authorize';
  const resultId = sourceId + '.result';
  const actionLabel = source.primary?.label ?? 'Authorize reviewed action';
  source.primary = { label: actionLabel, to: authId };
  const summary = source.rows ?? [];
  baseScreens.push(
    make(
      source.family,
      authId,
      'Authorize ' + source.title.toLowerCase(),
      'form',
      {
        hiddenInCatalog: true,
        authorization: true,
        accountContext: true,
        approval: source.approval,
        requiresAccountSigner: source.requiresAccountSigner,
        purpose:
          'Purpose-bound authorization for ' +
          source.title +
          '. Keep the same origin, account, network and reviewed payload; cancel returns to this review.',
        fields: [
          {
            label: 'Wallet password',
            value: 'Protected authorization — disabled in design',
            secret: true,
          },
        ],
        rows: [row('Reviewed operation', source.title), ...summary],
        primary: {
          label: 'Confirm reviewed action',
          to: destination.flow ? destination.next : resultId,
        },
        secondary: { label: 'Cancel', to: sourceId },
      }
    )
  );
  if (!destination.flow)
    baseScreens.push(
      make(source.family, resultId, destination.headline, 'success', {
        hiddenInCatalog: true,
        accountContext: true,
        approval: source.approval,
        purpose:
          'Caller-specific design result; never replace the operation with a different asset, network, local mutation or broadcast.',
        headline: destination.headline,
        description: 'Sample outcome only. No live action was performed.',
        rows: summary.filter((item) =>
          /Network|Origin|Account|Action|Operation/i.test(item.title)
        ),
        primary: { label: 'Continue', to: destination.next },
        secondary: { label: 'Back to reviewed action', to: sourceId },
      })
    );
}
const unusedGenericAuthorization = baseScreens.find(
  (item) => item.id === 'settings.authorize'
);
if (unusedGenericAuthorization)
  unusedGenericAuthorization.hiddenInCatalog = true;
export const screens: readonly ScreenSpec[] = baseScreens;

// Keep existing-wallet recovery separate from first-run import in the graph.
const recovery = screens.find((s) => s.id === 'onboarding.recover');
if (recovery?.primary) recovery.primary.to = 'onboarding.recover-phrase';
export function getScreen(id: string): ScreenSpec {
  const found = screens.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown design screen: ${id}`);
  return found;
}
/** Software signing adds no password screen after explicit transaction review. */
export function resolveDesignAction(id: string, kind: 'personal' | 'watch' | 'hardware' | 'smart'): string {
  const target = getScreen(id);
  return kind === 'personal' && target.deviceConfirmation && target.primary ? target.primary.to : id;
}
export const reviewStates = [
  { id: 'ready', label: 'Ready' },
  { id: 'loading', label: 'Loading' },
  { id: 'offline', label: 'Offline' },
  { id: 'locked', label: 'Locked' },
  { id: 'changed', label: 'Context changed' },
  { id: 'expired', label: 'Review expired' },
  { id: 'unavailable', label: 'Not supported' },
] as const;
export type ReviewState = (typeof reviewStates)[number]['id'];

/** Traceability IDs from design/PARITY_MATRIX.md. Mapping is design coverage, not implementation status. */
export const featureCoverage: Readonly<Record<string, readonly string[]>> = {
  A01: [
    'onboarding.welcome',
    'onboarding.password',
    'onboarding.import',
    'onboarding.phrase',
    'onboarding.verify',
  ],
  A02: [
    'onboarding.unlock',
    'onboarding.recover',
    'onboarding.recover-phrase',
    'onboarding.recover-match',
    'onboarding.recover-password',
  ],
  A03: [
    'accounts.list',
    'accounts.create',
    'accounts.rename',
    'accounts.remove',
  ],
  A04: ['accounts.import-key', 'accounts.details'],
  A05: ['accounts.watch', 'accounts.details'],
  A06: [
    'accounts.hardware',
    'accounts.hardware-pair',
    'accounts.hardware-address',
  ],
  A07: ['settings.phrase', 'settings.private-key', 'settings.key-reveal'],
  A08: ['settings.remove', 'settings.backups'],
  N01: ['wallet.home', 'settings.networks'],
  N02: ['settings.network-add', 'settings.network'],
  N03: ['settings.network'],
  W01: ['wallet.home', 'wallet.asset'],
  W02: ['wallet.tokens', 'wallet.import-token', 'wallet.token-detail'],
  W03: ['wallet.nfts', 'wallet.nft-detail', 'transfer.nft-review'],
  W04: ['transfer.receive-network', 'transfer.receive'],
  T01: [
    'transfer.asset',
    'transfer.details',
    'transfer.fee',
    'transfer.custom-fee',
    'transfer.review',
    'transfer.authorize',
    'transfer.unknown',
  ],
  T02: [
    'transfer.details',
    'transfer.options',
    'transfer.psbt',
    'transfer.review',
  ],
  T03: ['activity.list', 'activity.detail'],
  T04: ['activity.replacement', 'activity.replacement-review'],
  T05: ['settings.faucet'],
  D01: [
    'connections.home',
    'connections.proposal',
    'connections.session',
    'connections.account',
  ],
  D02: ['connections.trusted', 'connections.risk'],
  D03: ['settings.advanced', 'connections.home'],
  D04: ['connections.network', 'connections.watch-asset'],
  D05: [
    'connections.sign-message',
    'connections.typed-data',
    'connections.raw-data',
  ],
  D06: [
    'connections.transaction',
    'connections.batch',
    'activity.batch-status',
  ],
  D07: ['transfer.psbt'],
  D08: ['connections.encryption', 'connections.decrypt'],
  D09: ['connections.session', 'connections.raw-data'],
  S01: ['smart.create', 'smart.setup-review', 'smart.infrastructure'],
  S02: ['smart.hub', 'smart.owners', 'smart.signers'],
  S03: ['smart.passkeys', 'smart.passkey-detail'],
  S04: ['smart.signers'],
  S05: [
    'smart.modules',
    'smart.composite',
    'smart.custom-module',
    'smart.module-consent',
  ],
  S06: ['smart.guardians', 'smart.guardian-edit', 'smart.recovery'],
  P01: ['privacy.home', 'privacy.pool-data'],
  P02: [
    'privacy.notes',
    'privacy.note',
    'privacy.backup',
    'privacy.import',
    'privacy.capacity',
    'privacy.cleanup',
  ],
  P03: [
    'privacy.deposit',
    'privacy.deposit-review',
    'privacy.deposit-backup',
    'privacy.deposit-note',
    'privacy.deposit-ready',
    'privacy.pending',
  ],
  P04: ['privacy.withdraw', 'privacy.withdraw-review', 'privacy.pending'],
  P05: ['privacy.services'],
  Y01: ['sentry.keys', 'sentry.import', 'sentry.key-detail', 'sentry.service'],
  Y02: ['sentry.link', 'sentry.collateral', 'sentry.collateral-release'],
  Y03: ['sentry.operation', 'sentry.vote'],
  G01: ['settings.language', 'settings.currency'],
  G02: ['settings.autolock', 'settings.refresh', 'settings.advanced'],
  G03: ['settings.about'],
};

export const enhancementCoverage = {
  B01: [
    'privacy.backup-center',
    'privacy.bundle-export',
    'privacy.bundle-password',
    'privacy.bundle-review',
    'privacy.bundle-saved',
    'privacy.bundle-verify',
    'privacy.bundle-verified',
    'privacy.bundle-import',
    'privacy.bundle-merge',
    'privacy.bundle-authorize',
    'privacy.bundle-restored',
    'privacy.bundle-notes',
    'privacy.bundle-note-status',
  ],
} as const;
