// Shared network types - mirror sysweb3 types without importing the package
// This prevents frontend bundles from pulling in sysweb3 dependencies

/* eslint-disable no-shadow */
export enum INetworkType {
  Ethereum = 'ethereum',
  Syscoin = 'syscoin',
}
/* eslint-enable no-shadow */

export interface INetwork {
  apiUrl?: string;
  chainId: number;
  coingeckoId?: string;
  coingeckoPlatformId?: string;
  currency: string;
  default?: boolean;
  explorer?: string;
  key?: string;
  kind: INetworkType;
  label: string;
  slip44: number;
  url: string;
}

/* eslint-disable no-shadow */
export enum KeyringAccountType {
  HDAccount = 'HDAccount',
  Imported = 'Imported',
  Ledger = 'Ledger',
  SmartAccount = 'SmartAccount',
  Trezor = 'Trezor',
}
/* eslint-enable no-shadow */

/* eslint-disable no-shadow */
export enum PasskeyBackupStatus {
  BackupCapable = 'backupCapable',
  DeviceBound = 'deviceBound',
  Synced = 'synced',
  Unavailable = 'unavailable',
}
/* eslint-enable no-shadow */

export interface ISmartAccountMetadata {
  auth?: {
    data: string;
    module?: 'composite' | 'ecdsa' | 'p256-webauthn';
    scheme?: 'composite' | 'ecdsa' | 'p256-webauthn';
    validator: string;
  };
  availableModules?: Array<{
    displayName: string;
    id: 'composite' | 'ecdsa' | 'guardian-recovery' | 'p256-webauthn';
    installed?: boolean;
    supported?: boolean;
  }>;
  chainId: number;
  contractVersion: string;
  deploymentGasPayer?: {
    address: string;
    id: number;
    type: KeyringAccountType;
  };
  deploymentSalt: string;
  descriptor?: {
    accountIndex: number;
    accountVersion: string;
    anchor: string;
    anchorHash: string;
    chainId: number;
    deploymentSalt: string;
    factoryAddress: string;
  };
  factoryAddress?: string;
  installedModules?: SmartAccountInstalledModule[];
  isDeployed: boolean;
}

export type SmartAccountInstalledModule =
  | SmartAccountValidatorModule
  | SmartAccountExecutorModule;

export type SmartAccountValidatorModule =
  | {
      address: string;
      config: SmartAccountP256WebAuthnConfig;
      data?: string;
      id: 'p256-webauthn';
      type: 'validator';
    }
  | {
      address: string;
      config: SmartAccountEcdsaConfig;
      data?: string;
      id: 'ecdsa';
      type: 'validator';
    }
  | {
      address: string;
      config: SmartAccountCompositeConfig;
      data?: string;
      id: 'composite';
      type: 'validator';
    };

export type SmartAccountExecutorModule = {
  address: string;
  config: SmartAccountGuardianRecoveryConfig;
  data?: string;
  id: 'guardian-recovery';
  type: 'executor';
};

export type SmartAccountP256WebAuthnConfig = {
  backupStatus?: PasskeyBackupStatus;
  credentialId?: string;
  credentialIdHash: string;
  passkeyName?: string;
  publicKey: {
    originHash: string;
    originLength: number;
    rpIdHash: string;
    x: string;
    y: string;
  };
};

export type SmartAccountEcdsaConfig = {
  owners: string[];
  threshold: number;
};

export type SmartAccountCompositeConfig = {
  childValidators: string[];
  threshold: number;
};

export type SmartAccountGuardianRecoveryConfig = {
  delaySeconds: number;
  expirationSeconds?: number;
  guardians: string[];
  threshold: number;
};

export interface IPasskeyCredentialProfile {
  backupStatus?: PasskeyBackupStatus;
  credentialId: string;
  credentialIdHash: string;
  passkeyName: string;
  publicKey: SmartAccountP256WebAuthnConfig['publicKey'];
  // WebAuthn user handle (base64url) the credential was registered with;
  // required for Signal API cleanup of stale credential-manager entries.
  userHandle?: string;
}
export type IKeyringBalances = {
  [INetworkType.Syscoin]: number;
  [INetworkType.Ethereum]: number;
};

export interface IKeyringAccountState {
  address: string;
  balances: IKeyringBalances;
  // Per-chain EVM tx count hint (chainId -> txCount)
  // Used to decide if explorer paging can be enabled safely
  evmTxCountByChainId?: Record<number, number>;
  id: number;
  isImported: boolean;
  isLedgerWallet: boolean;
  isSmartAccount?: boolean;
  isTrezorWallet: boolean;
  label: string;
  smartAccount?: ISmartAccountMetadata;
  // Per-chain last block scanned for ERC-4337 UserOperationEvent logs
  // (smart accounts only; chainId -> blockNumber)
  smartAccountUserOpScanByChainId?: Record<number, number>;
  xprv: string;
  xpub: string;
}

export const initialActiveHdAccountState: IKeyringAccountState = {
  address: '',
  balances: {
    ethereum: 0,
    syscoin: 0,
  },
  id: 0,
  isTrezorWallet: false,
  isLedgerWallet: false,
  label: 'Account 1',
  isSmartAccount: false,
  evmTxCountByChainId: {},
  xprv: '',
  xpub: '',
  isImported: false,
};
