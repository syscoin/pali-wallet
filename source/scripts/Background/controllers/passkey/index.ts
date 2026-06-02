import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { isHexString } from '@ethersproject/bytes';
import { AddressZero, HashZero } from '@ethersproject/constants';
import { Contract } from '@ethersproject/contracts';
import { id as hashText } from '@ethersproject/hash';
import { formatUnits } from '@ethersproject/units';
import { ITxid } from '@sidhujag/sysweb3-utils';

import {
  IEvmTransactionResponse,
  ISysTransaction,
} from '../transactions/types';
import { savePasskeySlip44State } from 'state/paliStorage';
import store from 'state/store';
import {
  createAccount,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setSingleTransactionToState,
  setPasskeyCredentialProfile,
} from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import {
  setIsPollingUpdate,
  setPostNetworkSwitchLoading,
} from 'state/vaultGlobal';
import {
  INetworkType,
  IPasskeySmartAccountMetadata,
  IPasskeyCredentialProfile,
  KeyringAccountType as PaliKeyringAccountType,
  PasskeyBackupStatus,
  PasskeySponsorMode,
} from 'types/network';
import { logError } from 'utils/logger';
import { clearNavigationState } from 'utils/navigationState';
import {
  getPasskeyFactory,
  getPasskeyFactoryAddress,
  getPasskeyBackupStatus,
  hexToBytes,
  PasskeyContractSponsorMode,
  assertPasskeyRelayPayloadMatches,
  getPasskeyActionHash,
  getPasskeyFactoryAccountParams,
  getPasskeyMetadataFactoryAccountParams,
  getPasskeyPolicyExecution,
  getPasskeySponsorContractMode,
  normalizePasskeySponsor,
  normalizePasskeySponsorProof,
  passkeyFactoryInterface,
  passkeySmartAccountInterface,
  PASSKEY_SMART_ACCOUNT_VERSION,
  selectPasskeyDeploymentGasPayer,
  selectPasskeyGasPayerCandidate,
  selectFundedPasskeyGasPayerCandidate,
  PasskeyRelayedTransactionNotFoundError,
  verifyPasskeyRelayedSponsorProof,
  verifyPasskeySponsorProof,
} from 'utils/passkey';
import { blacklistService } from 'utils/security/blacklistService';

export interface IPasskeyControllerDependencies {
  getEthereumTransaction: () => any;
  getLatestUpdateForCurrentAccount: (
    isPolling?: boolean,
    forceUpdate?: boolean,
    isAssetPolling?: boolean,
    skipCache?: boolean
  ) => Promise<boolean>;
  saveWalletState: (
    operation: string,
    isUserActivity?: boolean,
    sync?: boolean
  ) => Promise<void>;
  sendAndSaveEthTransaction: (
    params: any,
    isLegacy?: boolean,
    targetAccount?: { id: number; type: PaliKeyringAccountType },
    transactionMetadata?: Record<string, unknown>,
    saveOptions?: { clearNavigation?: boolean; persist?: boolean }
  ) => Promise<IEvmTransactionResponse>;
  sendAndSaveTransaction: (
    tx: IEvmTransactionResponse | ISysTransaction | ITxid,
    targetAccount?: { id: number; type: PaliKeyringAccountType },
    options?: { clearNavigation?: boolean; persist?: boolean }
  ) => Promise<void>;
}

class PasskeyController {
  constructor(private readonly deps: IPasskeyControllerDependencies) {}

  private get ethereumTransaction() {
    return this.deps.getEthereumTransaction();
  }

  private getLatestUpdateForCurrentAccount(
    isPolling?: boolean,
    forceUpdate?: boolean,
    isAssetPolling?: boolean,
    skipCache?: boolean
  ) {
    return this.deps.getLatestUpdateForCurrentAccount(
      isPolling,
      forceUpdate,
      isAssetPolling,
      skipCache
    );
  }

  private saveWalletState(
    operation: string,
    isUserActivity = false,
    sync = false
  ) {
    return this.deps.saveWalletState(operation, isUserActivity, sync);
  }

  private sendAndSaveEthTransaction(
    params: any,
    isLegacy?: boolean,
    targetAccount?: { id: number; type: PaliKeyringAccountType },
    transactionMetadata?: Record<string, unknown>,
    saveOptions?: { clearNavigation?: boolean; persist?: boolean }
  ) {
    return this.deps.sendAndSaveEthTransaction(
      params,
      isLegacy,
      targetAccount,
      transactionMetadata,
      saveOptions
    );
  }

  private sendAndSaveTransaction(
    tx: IEvmTransactionResponse | ISysTransaction | ITxid,
    targetAccount?: { id: number; type: PaliKeyringAccountType },
    options?: { clearNavigation?: boolean; persist?: boolean }
  ) {
    return this.deps.sendAndSaveTransaction(tx, targetAccount, options);
  }

  public async savePasskeyMetadataState(operation: string): Promise<void> {
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;
    if (activeSlip44 === null) {
      console.warn(
        `[MainController] No active slip44 to save passkey metadata for operation: ${operation}`
      );
      return;
    }

    const vaultState = store.getState().vault;
    const passkeyAccounts =
      vaultState.accounts[PaliKeyringAccountType.PasskeySmartAccount] || {};
    const accounts = Object.fromEntries(
      Object.entries(passkeyAccounts)
        .filter(([, account]: [string, any]) => account?.passkey)
        .map(([id, account]: [string, any]) => [
          id,
          {
            ...account.passkey,
            address: account.address,
          },
        ])
    );

    await savePasskeySlip44State(activeSlip44, {
      accounts,
      passkeyCredentialProfile: vaultState.passkeyCredentialProfile || null,
    });
  }

  public async createPasskeySmartAccount(params: {
    address: string;
    label?: string;
    metadata: IPasskeySmartAccountMetadata;
  }): Promise<any> {
    const { accounts } = store.getState().vault;
    const normalizedAddress = params.address.toLowerCase();
    const accountAlreadyExists = Object.values(accounts).some(
      (accountsByType: Record<number, any>) =>
        Object.values(accountsByType || {}).some(
          (account: any) =>
            account?.address?.toLowerCase?.() === normalizedAddress
        )
    );

    if (accountAlreadyExists) {
      throw new Error('Account already exists on your Wallet.');
    }

    const passkeyAccounts =
      accounts[PaliKeyringAccountType.PasskeySmartAccount] || {};
    const existingIds = Object.values(passkeyAccounts)
      .map((account: any) => account.id)
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b);

    let nextId = 0;
    for (const id of existingIds) {
      if (id === nextId) {
        nextId += 1;
      } else if (id > nextId) {
        break;
      }
    }

    const newAccount = {
      address: params.address,
      balances: {
        [INetworkType.Syscoin]: -1,
        [INetworkType.Ethereum]: -1,
      },
      id: nextId,
      isImported: false,
      isLedgerWallet: false,
      isPasskeySmartAccount: true,
      isTrezorWallet: false,
      label: params.label || `Passkey Account ${nextId + 1}`,
      passkey: params.metadata,
      xprv: '',
      xpub: params.address,
    };

    store.dispatch(
      createAccount({
        account: newAccount,
        accountType: PaliKeyringAccountType.PasskeySmartAccount,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: newAccount.id,
        type: PaliKeyringAccountType.PasskeySmartAccount,
      })
    );

    await this.saveWalletState('create-passkey-smart-account', true, true);
    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(true, true, false, true)
        .catch((error) => {
          console.error(
            '[MainController] Failed to update passkey account after creation:',
            error
          );
        })
        .finally(() => {
          store.dispatch(setIsPollingUpdate(false));
          store.dispatch(setPostNetworkSwitchLoading(false));
        });
    }, 10);
    return newAccount;
  }

  public getPasskeyCredentialProfile(): IPasskeyCredentialProfile | null {
    const { accounts, passkeyCredentialProfile } = store.getState().vault;
    const passkeyAccounts =
      accounts[PaliKeyringAccountType.PasskeySmartAccount] || {};
    if (passkeyCredentialProfile && Object.keys(passkeyAccounts).length === 0) {
      store.dispatch(setPasskeyCredentialProfile(null));
      this.savePasskeyMetadataState(
        'clear-stale-passkey-credential-profile'
      ).catch((error) =>
        logError('Failed to clear stale passkey profile', 'UI', error)
      );
      return null;
    }

    return passkeyCredentialProfile || null;
  }

  public async savePasskeyCredentialProfile(
    profile: IPasskeyCredentialProfile
  ): Promise<IPasskeyCredentialProfile> {
    store.dispatch(setPasskeyCredentialProfile(profile));
    await this.savePasskeyMetadataState('save-passkey-credential-profile');
    return profile;
  }

  public async recoverPasskeySmartAccounts(params: {
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
    sponsorUrls?: string[];
  }): Promise<{
    accounts: Array<{ address: string; id: number; label: string }>;
    missingSponsorUrl: number;
    recovered: number;
    skipped: number;
  }> {
    const { activeNetwork } = store.getState().vault;
    if (activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Passkey accounts are only supported on EVM networks');
    }
    if (!isHexString(params.credentialIdHash, 32)) {
      throw new Error('Invalid passkey credential hash');
    }

    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const factoryAddress = getPasskeyFactoryAddress(activeNetwork.chainId);
    const recoveryId = this.getPasskeyRecoveryId(
      factoryAddress,
      activeNetwork.chainId
    );
    let recoverySources: Array<{ address?: string; log?: any }> = (
      await this.getPasskeyRecoveryRegistryAccounts({
        chainId: activeNetwork.chainId,
        credentialIdHash: params.credentialIdHash,
        provider,
        recoveryId,
      })
    ).map((address) => ({ address }));
    if (recoverySources.length === 0) {
      const logs = await this.getPasskeyRecoveryLogs({
        credentialIdHash: params.credentialIdHash,
        factoryAddress,
        provider,
        recoveryId,
      });
      recoverySources = logs.map((log) => ({ log }));
    }
    if (recoverySources.length === 0) {
      return { recovered: 0, skipped: 0, missingSponsorUrl: 0, accounts: [] };
    }

    const { accounts } = store.getState().vault;
    const existingAddresses = new Set<string>();
    Object.values(accounts).forEach((accountsByType: Record<number, any>) => {
      Object.values(accountsByType || {}).forEach((account: any) => {
        if (account?.address) {
          existingAddresses.add(account.address.toLowerCase());
        }
      });
    });
    recoverySources = recoverySources.filter((source) => {
      const address = this.getPasskeyRecoverySourceAddress(source);
      return !address || !existingAddresses.has(address.toLowerCase());
    });
    if (recoverySources.length === 0) {
      return { recovered: 0, skipped: 0, missingSponsorUrl: 0, accounts: [] };
    }

    let skipped = 0;
    let missingSponsorUrl = 0;
    const recoveredAccounts: Array<{
      address: string;
      id: number;
      label: string;
    }> = [];
    const existingPasskeyIds = Object.values(
      accounts[PaliKeyringAccountType.PasskeySmartAccount] || {}
    )
      .map((account: any) => account.id)
      .filter((id) => Number.isFinite(id));
    let nextId = this.getNextPasskeySmartAccountId(existingPasskeyIds);

    for (const sourceBatch of this.chunkArray(recoverySources, 5)) {
      const candidates = await Promise.all(
        sourceBatch.map((source) =>
          this.readRecoveredPasskeyAccount({
            address: source.address,
            credentialId: params.credentialId,
            credentialIdHash: params.credentialIdHash,
            factoryAddress,
            log: source.log,
            provider,
            recoveryId,
            backupStatus: params.backupStatus,
            sponsorUrls: params.sponsorUrls,
          })
        )
      );

      for (const candidate of candidates) {
        if (candidate?.missingSponsorUrl) {
          missingSponsorUrl += 1;
          skipped += 1;
          continue;
        }
        if (
          !candidate ||
          !candidate.metadata ||
          existingAddresses.has(candidate.address.toLowerCase())
        ) {
          skipped += 1;
          continue;
        }

        const label = `Recovered Passkey Account ${nextId + 1}`;
        const newAccount = {
          address: candidate.address,
          balances: {
            [INetworkType.Syscoin]: -1,
            [INetworkType.Ethereum]: -1,
          },
          id: nextId,
          isImported: false,
          isLedgerWallet: false,
          isPasskeySmartAccount: true,
          isTrezorWallet: false,
          label,
          passkey: {
            ...candidate.metadata,
            passkeyName: label,
          },
          xprv: '',
          xpub: candidate.address,
        };

        store.dispatch(
          createAccount({
            account: newAccount,
            accountType: PaliKeyringAccountType.PasskeySmartAccount,
          })
        );
        existingAddresses.add(candidate.address.toLowerCase());
        recoveredAccounts.push({
          address: newAccount.address,
          id: newAccount.id,
          label,
        });
        nextId += 1;
      }
    }

    if (recoveredAccounts.length > 0) {
      store.dispatch(
        setActiveAccount({
          id: recoveredAccounts[0].id,
          type: PaliKeyringAccountType.PasskeySmartAccount,
        })
      );
      if (!store.getState().vault.passkeyCredentialProfile) {
        const firstRecovered = store.getState().vault.accounts[
          PaliKeyringAccountType.PasskeySmartAccount
        ]?.[recoveredAccounts[0].id] as any;
        if (firstRecovered?.passkey) {
          store.dispatch(
            setPasskeyCredentialProfile({
              credentialId: firstRecovered.passkey.credentialId,
              credentialIdHash: firstRecovered.passkey.credentialIdHash,
              backupStatus: firstRecovered.passkey.backupStatus,
              passkeyName: firstRecovered.passkey.passkeyName,
              publicKey: firstRecovered.passkey.publicKey,
            })
          );
        }
      }
      await this.refreshRecoveredPasskeyNativeBalances(
        recoveredAccounts,
        provider
      );
      await this.saveWalletState('recover-passkey-smart-accounts', true, true);
    }

    return {
      recovered: recoveredAccounts.length,
      skipped,
      missingSponsorUrl,
      accounts: recoveredAccounts,
    };
  }

  public async recoverPasskeySmartAccountForCreate(params: {
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
    label?: string;
    sponsor?: {
      mode?: string;
      policyText?: string;
      signer?: string;
      url?: string;
      urlHash?: string;
    };
  }): Promise<any | null> {
    const { activeNetwork } = store.getState().vault;
    if (activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Passkey accounts are only supported on EVM networks');
    }
    if (!isHexString(params.credentialIdHash, 32)) {
      throw new Error('Invalid passkey credential hash');
    }

    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const requestedSponsor = normalizePasskeySponsor(params.sponsor);
    const factoryAddress = getPasskeyFactoryAddress(activeNetwork.chainId);
    const recoveryId = this.getPasskeyRecoveryId(
      factoryAddress,
      activeNetwork.chainId
    );
    const sponsorUrls = requestedSponsor.url ? [requestedSponsor.url] : [];
    let recoverySources: Array<{ address?: string; log?: any }> = (
      await this.getPasskeyRecoveryRegistryAccounts({
        chainId: activeNetwork.chainId,
        credentialIdHash: params.credentialIdHash,
        provider,
        recoveryId,
      })
    ).map((address) => ({ address }));

    if (recoverySources.length === 0) {
      const logs = await this.getPasskeyRecoveryLogs({
        credentialIdHash: params.credentialIdHash,
        factoryAddress,
        provider,
        recoveryId,
      });
      recoverySources = logs.map((log) => ({ log }));
    }
    if (recoverySources.length === 0) {
      return null;
    }

    const existingAddresses = this.getExistingAccountAddressSet();
    for (const sourceBatch of this.chunkArray(recoverySources, 5)) {
      const candidates = await Promise.all(
        sourceBatch.map((source) =>
          this.readRecoveredPasskeyAccount({
            address: source.address,
            credentialId: params.credentialId,
            credentialIdHash: params.credentialIdHash,
            factoryAddress,
            log: source.log,
            provider,
            recoveryId,
            backupStatus: params.backupStatus,
            sponsorUrls,
          })
        )
      );

      for (const candidate of candidates) {
        if (!candidate?.metadata) {
          continue;
        }
        if (
          !this.recoveredSponsorMatchesRequest(
            candidate.metadata.sponsor,
            requestedSponsor
          )
        ) {
          if (
            this.recoveredSponsorHasRequestedUrl(
              candidate.metadata.sponsor,
              requestedSponsor
            )
          ) {
            throw new Error(
              'Passkey sponsor signer does not match the existing account policy.'
            );
          }
          continue;
        }
        if (existingAddresses.has(candidate.address.toLowerCase())) {
          throw new Error('Account already exists on your Wallet.');
        }

        return this.addRecoveredPasskeyAccount({
          address: candidate.address,
          label: params.label,
          metadata: candidate.metadata,
          provider,
          saveOperation: 'recover-passkey-smart-account-for-create',
        });
      }
    }

    return null;
  }

  private getPasskeyRecoverySourceAddress(source: {
    address?: string;
    log?: any;
  }) {
    if (source.address) {
      return getAddress(source.address);
    }
    if (source.log) {
      try {
        const parsed = passkeyFactoryInterface.parseLog(source.log);
        return getAddress(parsed.args.account);
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  private getExistingAccountAddressSet() {
    const { accounts } = store.getState().vault;
    const existingAddresses = new Set<string>();
    Object.values(accounts).forEach((accountsByType: Record<number, any>) => {
      Object.values(accountsByType || {}).forEach((account: any) => {
        if (account?.address) {
          existingAddresses.add(account.address.toLowerCase());
        }
      });
    });
    return existingAddresses;
  }

  private recoveredSponsorMatchesRequest(
    recoveredSponsor: IPasskeySmartAccountMetadata['sponsor'],
    requestedSponsor: IPasskeySmartAccountMetadata['sponsor']
  ) {
    const recoveredMode = recoveredSponsor?.mode || PasskeySponsorMode.Disabled;
    const requestedMode = requestedSponsor?.mode || PasskeySponsorMode.Disabled;
    if (recoveredMode !== requestedMode) {
      return false;
    }

    const recoveredSigner = recoveredSponsor?.signer
      ? getAddress(recoveredSponsor.signer).toLowerCase()
      : '';
    const requestedSigner = requestedSponsor?.signer
      ? getAddress(requestedSponsor.signer).toLowerCase()
      : '';
    if (recoveredSigner !== requestedSigner) {
      return false;
    }

    const recoveredUrlHash = (recoveredSponsor?.urlHash || '').toLowerCase();
    const requestedUrlHash = (requestedSponsor?.urlHash || '').toLowerCase();
    return recoveredUrlHash === requestedUrlHash;
  }

  private recoveredSponsorHasRequestedUrl(
    recoveredSponsor: IPasskeySmartAccountMetadata['sponsor'],
    requestedSponsor: IPasskeySmartAccountMetadata['sponsor']
  ) {
    const requestedUrlHash = (requestedSponsor?.urlHash || '').toLowerCase();
    if (!requestedUrlHash) {
      return false;
    }

    return (recoveredSponsor?.urlHash || '').toLowerCase() === requestedUrlHash;
  }

  private async addRecoveredPasskeyAccount({
    address,
    label,
    metadata,
    provider,
    saveOperation,
  }: {
    address: string;
    label?: string;
    metadata: IPasskeySmartAccountMetadata;
    provider: any;
    saveOperation: string;
  }) {
    const { accounts } = store.getState().vault;
    const existingIds = Object.values(
      accounts[PaliKeyringAccountType.PasskeySmartAccount] || {}
    )
      .map((account: any) => account.id)
      .filter((id) => Number.isFinite(id));
    const nextId = this.getNextPasskeySmartAccountId(existingIds);
    const accountLabel = label || `Recovered Passkey Account ${nextId + 1}`;
    const newAccount = {
      address,
      balances: {
        [INetworkType.Syscoin]: -1,
        [INetworkType.Ethereum]: -1,
      },
      id: nextId,
      isImported: false,
      isLedgerWallet: false,
      isPasskeySmartAccount: true,
      isTrezorWallet: false,
      label: accountLabel,
      passkey: {
        ...metadata,
        passkeyName: accountLabel,
      },
      xprv: '',
      xpub: address,
    };

    store.dispatch(
      createAccount({
        account: newAccount,
        accountType: PaliKeyringAccountType.PasskeySmartAccount,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: newAccount.id,
        type: PaliKeyringAccountType.PasskeySmartAccount,
      })
    );
    if (!store.getState().vault.passkeyCredentialProfile) {
      store.dispatch(
        setPasskeyCredentialProfile({
          credentialId: newAccount.passkey.credentialId,
          credentialIdHash: newAccount.passkey.credentialIdHash,
          backupStatus: newAccount.passkey.backupStatus,
          passkeyName: newAccount.passkey.passkeyName,
          publicKey: newAccount.passkey.publicKey,
        })
      );
    }
    await this.refreshRecoveredPasskeyNativeBalances([newAccount], provider);
    await this.saveWalletState(saveOperation, true, true);
    return newAccount;
  }

  private async refreshRecoveredPasskeyNativeBalances(
    recoveredAccounts: Array<{ address: string; id: number }>,
    provider: any
  ) {
    const balanceResults = await Promise.allSettled(
      recoveredAccounts.map(async (account) => ({
        ...account,
        balance: Number(
          formatUnits(await provider.getBalance(account.address), 18)
        ),
      }))
    );

    balanceResults.forEach((result) => {
      if (result.status !== 'fulfilled') {
        return;
      }

      const account = store.getState().vault.accounts[
        PaliKeyringAccountType.PasskeySmartAccount
      ]?.[result.value.id] as any;
      if (!account) {
        return;
      }

      store.dispatch(
        setAccountPropertyByIdAndType({
          id: result.value.id,
          type: PaliKeyringAccountType.PasskeySmartAccount,
          property: 'balances',
          value: {
            ...account.balances,
            [INetworkType.Ethereum]: result.value.balance,
          },
        })
      );
    });
  }

  private getNextPasskeySmartAccountId(existingIds: number[]) {
    const sortedIds = [...existingIds].sort((a, b) => a - b);
    let nextId = 0;
    for (const id of sortedIds) {
      if (id === nextId) {
        nextId += 1;
      } else if (id > nextId) {
        break;
      }
    }
    return nextId;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private async withPasskeyRpcBackoff<T>(operation: () => Promise<T>) {
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
        const delay = 750 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error('Passkey RPC retry loop failed unexpectedly');
  }

  private async getPasskeyRecoveryRegistryAccounts({
    chainId,
    credentialIdHash,
    provider,
    recoveryId,
  }: {
    chainId: number;
    credentialIdHash: string;
    provider: any;
    recoveryId: string;
  }): Promise<string[]> {
    try {
      const factory = getPasskeyFactory(chainId, provider);
      const count = BigNumber.from(
        await this.withPasskeyRpcBackoff(() =>
          factory.getAccountCountByCredential(recoveryId, credentialIdHash)
        )
      ).toNumber();
      const pageSize = 50;
      const accounts: string[] = [];

      for (let offset = 0; offset < count; offset += pageSize) {
        const page = await this.withPasskeyRpcBackoff<string[]>(() =>
          factory.getAccountsByCredential(
            recoveryId,
            credentialIdHash,
            offset,
            pageSize
          )
        );
        accounts.push(...page.map((address) => getAddress(address)));
      }

      return accounts;
    } catch (error) {
      logError('Passkey registry recovery lookup failed', 'UI', error);
      return [];
    }
  }

  private async getPasskeyRecoveryLogs({
    credentialIdHash,
    factoryAddress,
    provider,
    recoveryId,
  }: {
    credentialIdHash: string;
    factoryAddress: string;
    provider: any;
    recoveryId: string;
  }) {
    const latestBlock = await this.withPasskeyRpcBackoff<number>(() =>
      provider.getBlockNumber()
    );
    const chunkSize = 50_000;
    const eventTopic = passkeyFactoryInterface.getEventTopic('AccountCreated');
    const logs: any[] = [];

    for (let fromBlock = 0; fromBlock <= latestBlock; fromBlock += chunkSize) {
      const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
      const chunkLogs = await this.withPasskeyRpcBackoff<any[]>(() =>
        provider.getLogs({
          address: factoryAddress,
          fromBlock,
          toBlock,
          topics: [eventTopic, null, recoveryId, credentialIdHash],
        })
      );
      logs.push(...chunkLogs);
    }

    return logs;
  }

  private async readRecoveredPasskeyAccount({
    address: discoveredAddress,
    backupStatus,
    credentialId,
    credentialIdHash,
    factoryAddress,
    log,
    provider,
    recoveryId,
    sponsorUrls,
  }: {
    address?: string;
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
    factoryAddress: string;
    log?: any;
    provider: any;
    recoveryId: string;
    sponsorUrls?: string[];
  }): Promise<{
    address: string;
    metadata?: IPasskeySmartAccountMetadata;
    missingSponsorUrl?: boolean;
  } | null> {
    let address = discoveredAddress ? getAddress(discoveredAddress) : '';
    let deploymentSalt = HashZero;
    if (log) {
      const parsed = passkeyFactoryInterface.parseLog(log);
      address = getAddress(parsed.args.account);
      deploymentSalt = parsed.args.salt as string;
    }
    if (!address) {
      return null;
    }

    const code = await this.withPasskeyRpcBackoff(() =>
      provider.getCode(address)
    );
    if (!code || code === '0x') {
      return null;
    }

    const account = new Contract(
      address,
      passkeySmartAccountInterface,
      provider
    );
    const metadata = (await this.withPasskeyRpcBackoff(() =>
      account.getRecoveryMetadata()
    )) as any;
    const passkeyX = metadata.passkeyX ?? metadata[0];
    const passkeyY = metadata.passkeyY ?? metadata[1];
    const storedCredentialIdHash = metadata.credentialIdHash ?? metadata[2];
    const rpIdHash = metadata.rpIdHash ?? metadata[3];
    const originHash = metadata.originHash ?? metadata[4];
    const originLength = metadata.originLength ?? metadata[5];
    const sponsorMode = metadata.sponsorMode ?? metadata[6];
    const sponsorSigner = metadata.sponsorSigner ?? metadata[7];
    const sponsorUrlHash = metadata.sponsorUrlHash ?? metadata[8];

    if (
      storedCredentialIdHash.toLowerCase() !== credentialIdHash.toLowerCase()
    ) {
      return null;
    }

    const sponsorModeNumber = Number(sponsorMode);
    const sponsor = this.recoverPasskeySponsorMetadata(
      sponsorModeNumber,
      sponsorSigner,
      sponsorUrlHash,
      sponsorUrls
    );
    if (!sponsor) {
      return {
        address,
        missingSponsorUrl: true,
      };
    }

    return {
      address,
      metadata: {
        chainId: store.getState().vault.activeNetwork.chainId,
        contractVersion: PASSKEY_SMART_ACCOUNT_VERSION,
        backupStatus,
        credentialId,
        credentialIdHash: storedCredentialIdHash,
        deploymentSalt,
        factoryAddress,
        isDeployed: true,
        passkeyName: 'Recovered Passkey Account',
        recoveryId,
        publicKey: {
          originHash,
          originLength: BigNumber.from(originLength).toNumber(),
          rpIdHash,
          x: passkeyX,
          y: passkeyY,
        },
        sponsor,
      },
    };
  }

  private recoverPasskeySponsorMetadata(
    sponsorMode: number,
    sponsorSigner: string,
    sponsorUrlHash: string,
    sponsorUrls?: string[]
  ): IPasskeySmartAccountMetadata['sponsor'] | null {
    const mode =
      sponsorMode === PasskeyContractSponsorMode.Required
        ? PasskeySponsorMode.Required
        : sponsorMode === PasskeyContractSponsorMode.GasOnly
        ? PasskeySponsorMode.GasOnly
        : PasskeySponsorMode.Disabled;

    const normalizedSponsorUrlHash =
      sponsorUrlHash && sponsorUrlHash !== HashZero
        ? sponsorUrlHash.toLowerCase()
        : '';
    const sponsorUrl = (sponsorUrls || [])
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter(Boolean)
      .find((url) => hashText(url).toLowerCase() === normalizedSponsorUrlHash);

    if (
      mode === PasskeySponsorMode.Required &&
      normalizedSponsorUrlHash &&
      !sponsorUrl
    ) {
      return null;
    }

    return {
      mode,
      ...(sponsorSigner && sponsorSigner !== AddressZero
        ? { signer: getAddress(sponsorSigner) }
        : {}),
      ...(sponsorUrl ? { url: sponsorUrl } : {}),
      ...(normalizedSponsorUrlHash ? { urlHash: sponsorUrlHash } : {}),
    };
  }

  public async preparePasskeySmartAccount(params: {
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
    deploymentSalt: string;
    label?: string;
    passkeyName: string;
    publicKey: {
      originHash: string;
      originLength: number;
      rpIdHash: string;
      x: string;
      y: string;
    };
    sponsor?: {
      mode?: string;
      policyText?: string;
      signer?: string;
      url?: string;
      urlHash?: string;
    };
  }): Promise<{
    address: string;
    factoryAddress: string;
    metadata: IPasskeySmartAccountMetadata;
  }> {
    const { activeNetwork } = store.getState().vault;
    if (activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Passkey accounts are only supported on EVM networks');
    }

    const gasPayer = this.getPasskeyGasPayerCandidate();

    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const factoryAddress = getPasskeyFactoryAddress(activeNetwork.chainId);
    const factory = getPasskeyFactory(activeNetwork.chainId, provider);
    const recoveryId = this.getPasskeyRecoveryId(
      factoryAddress,
      activeNetwork.chainId
    );
    const sponsor = normalizePasskeySponsor(params.sponsor);
    const accountParams = getPasskeyFactoryAccountParams({
      credentialIdHash: params.credentialIdHash,
      deploymentSalt: params.deploymentSalt,
      publicKey: params.publicKey,
      recoveryId,
    });
    const address = await factory.getAccountAddress(accountParams);

    return {
      address,
      factoryAddress,
      metadata: {
        backupStatus: params.backupStatus,
        chainId: activeNetwork.chainId,
        contractVersion: PASSKEY_SMART_ACCOUNT_VERSION,
        credentialId: params.credentialId,
        credentialIdHash: params.credentialIdHash,
        deploymentGasPayer: {
          address: gasPayer.account.address,
          id: gasPayer.account.id,
          type: gasPayer.accountType,
        },
        deploymentSalt: params.deploymentSalt,
        factoryAddress,
        isDeployed: false,
        passkeyName: params.passkeyName,
        recoveryId,
        publicKey: params.publicKey,
        sponsor,
      },
    };
  }

  public async updatePasskeySponsorMetadata(
    accountId: number,
    sponsor?: {
      mode?: string;
      policyText?: string;
      signer?: string;
      url?: string;
      urlHash?: string;
    } | null
  ): Promise<IPasskeySmartAccountMetadata['sponsor']> {
    const account = store.getState().vault.accounts[
      PaliKeyringAccountType.PasskeySmartAccount
    ]?.[accountId] as any;
    if (!account?.passkey) {
      throw new Error('Passkey account not found');
    }

    const normalizedSponsor = normalizePasskeySponsor(sponsor);
    store.dispatch(
      setAccountPropertyByIdAndType({
        id: accountId,
        type: PaliKeyringAccountType.PasskeySmartAccount,
        property: 'passkey',
        value: {
          ...account.passkey,
          sponsor: normalizedSponsor,
        },
      })
    );
    await this.savePasskeyMetadataState('update-passkey-sponsor-metadata');
    return normalizedSponsor;
  }

  public async updatePasskeyBackupStatus(
    accountId: number,
    backupStatus: PasskeyBackupStatus
  ): Promise<PasskeyBackupStatus> {
    const account = store.getState().vault.accounts[
      PaliKeyringAccountType.PasskeySmartAccount
    ]?.[accountId] as any;
    if (!account?.passkey) {
      throw new Error('Passkey account not found');
    }

    const profile = store.getState().vault.passkeyCredentialProfile;
    const updatesProfile =
      profile?.credentialIdHash &&
      profile.credentialIdHash.toLowerCase() ===
        account.passkey.credentialIdHash?.toLowerCase();
    if (
      account.passkey.backupStatus === backupStatus &&
      (!updatesProfile || profile.backupStatus === backupStatus)
    ) {
      return backupStatus;
    }

    store.dispatch(
      setAccountPropertyByIdAndType({
        id: accountId,
        type: PaliKeyringAccountType.PasskeySmartAccount,
        property: 'passkey',
        value: {
          ...account.passkey,
          backupStatus,
        },
      })
    );

    if (updatesProfile) {
      store.dispatch(
        setPasskeyCredentialProfile({
          ...profile,
          backupStatus,
        })
      );
    }

    await this.savePasskeyMetadataState('update-passkey-backup-status');
    return backupStatus;
  }

  public async getPasskeyDeploymentStatus(accountId: number): Promise<boolean> {
    const account = store.getState().vault.accounts[
      PaliKeyringAccountType.PasskeySmartAccount
    ]?.[accountId] as any;
    if (!account?.passkey) {
      throw new Error('Passkey account not found');
    }

    this.assertPasskeyAccountNetwork(account.passkey);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const code = await provider.getCode(account.address);
    const isDeployed = Boolean(code && code !== '0x');
    if (Boolean(account.passkey.isDeployed) !== isDeployed) {
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: accountId,
          type: PaliKeyringAccountType.PasskeySmartAccount,
          property: 'passkey',
          value: {
            ...account.passkey,
            isDeployed,
          },
        })
      );
      await this.savePasskeyMetadataState('update-passkey-deployment-status');
    }

    return isDeployed;
  }

  private async recordPasskeyBackupStatusFromProof(
    account: any,
    proof: { authenticatorData: string }
  ) {
    try {
      const backupStatus = getPasskeyBackupStatus(
        hexToBytes(proof.authenticatorData)
      );
      await this.updatePasskeyBackupStatus(account.id, backupStatus);
    } catch (error) {
      logError('Failed to update passkey backup status', 'UI', error);
    }
  }

  private async passkeyGasPayerHasBalance(
    address: string,
    minimumBalanceWei: BigNumber
  ) {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const balance = await provider.getBalance(address);
    return BigNumber.from(balance).gte(minimumBalanceWei);
  }

  private getPasskeyRecoveryId(factoryAddress: string, chainId: number) {
    const { accounts } = store.getState().vault;
    const firstHdAccount =
      accounts[PaliKeyringAccountType.HDAccount]?.[0] || null;
    if (!firstHdAccount?.address) {
      throw new Error(
        'Passkey recovery requires the first HD account in this wallet'
      );
    }

    return hashText(
      [
        'PALI_PASSKEY_RECOVERY_V1',
        chainId.toString(),
        getAddress(factoryAddress),
        getAddress(firstHdAccount.address),
      ].join(':')
    );
  }

  private async getDefaultPasskeyGasPayer(minimumBalanceWei: BigNumber) {
    const { accounts, activeAccount } = store.getState().vault;
    return selectFundedPasskeyGasPayerCandidate(
      accounts,
      activeAccount,
      (address) => this.passkeyGasPayerHasBalance(address, minimumBalanceWei)
    );
  }

  private getPasskeyGasPayerCandidate() {
    const { accounts, activeAccount } = store.getState().vault;
    return selectPasskeyGasPayerCandidate(accounts, activeAccount);
  }

  private async getPasskeyDeploymentGasPayer(
    metadata: IPasskeySmartAccountMetadata,
    minimumBalanceWei: BigNumber
  ) {
    const { accounts } = store.getState().vault;
    if (!metadata.deploymentGasPayer) {
      return this.getDefaultPasskeyGasPayer(minimumBalanceWei);
    }
    const gasPayer = selectPasskeyDeploymentGasPayer(accounts, metadata, () => {
      throw new Error(
        'Passkey deployment gas payer is no longer available in this wallet'
      );
    });
    if (
      !(await this.passkeyGasPayerHasBalance(
        gasPayer.account.address,
        minimumBalanceWei
      ))
    ) {
      throw new Error(
        'Passkey deployment gas payer does not have native gas on this network'
      );
    }
    return gasPayer;
  }

  private async runWithGasPayer<T>(
    gasPayer: { account: any; accountType: PaliKeyringAccountType },
    callback: () => Promise<T>,
    options: { persistRestore?: boolean } = {}
  ): Promise<T> {
    const { persistRestore = true } = options;
    const original = store.getState().vault.activeAccount;
    store.dispatch(
      setActiveAccount({
        id: gasPayer.account.id,
        type: gasPayer.accountType,
      })
    );

    try {
      return await callback();
    } finally {
      store.dispatch(setActiveAccount(original));
      if (persistRestore) {
        try {
          await this.saveWalletState(
            'restore-passkey-active-account',
            false,
            true
          );
        } catch (error) {
          console.error(
            '[MainController] Failed to persist restored active account after passkey gas payer operation:',
            error
          );
        }
      }
    }
  }

  private assertPasskeyAccountNetwork(metadata: IPasskeySmartAccountMetadata) {
    const { activeNetwork } = store.getState().vault;
    if (metadata.contractVersion !== PASSKEY_SMART_ACCOUNT_VERSION) {
      throw new Error(
        'This Passkey Account was created with an unsupported contract version. Please recover or recreate it with the current Pali version.'
      );
    }

    if (
      activeNetwork.kind !== INetworkType.Ethereum ||
      metadata.chainId !== activeNetwork.chainId
    ) {
      throw new Error('Passkey account is not available on the active network');
    }

    return getPasskeyFactoryAddress(activeNetwork.chainId);
  }

  public assertPasskeySmartAccountSupported(): boolean {
    const { activeNetwork } = store.getState().vault;
    if (activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Passkey accounts are only supported on EVM networks');
    }

    getPasskeyFactoryAddress(activeNetwork.chainId);
    return true;
  }

  private async assertPasskeyExecutionTargetAllowed(target: string) {
    const blacklistResult = await blacklistService.checkAddress(
      getAddress(target)
    );
    if (
      blacklistResult.isBlacklisted &&
      (blacklistResult.severity === 'critical' ||
        blacklistResult.severity === 'high')
    ) {
      throw new Error(
        `Passkey transaction blocked: ${
          blacklistResult.reason || 'Execution target address is blacklisted'
        }. Severity: ${blacklistResult.severity}`
      );
    }
  }

  private normalizePasskeyExecutionPayload(params: {
    data?: string;
    target: string;
    value: string;
  }) {
    const target = getAddress(params.target);
    const value = BigNumber.from(params.value);
    if (value.lt(0)) {
      throw new Error('Passkey execution value cannot be negative');
    }

    const data = params.data || '0x';
    if (!isHexString(data)) {
      throw new Error('Passkey execution data must be hex bytes');
    }

    return {
      data,
      target,
      value: value.toString(),
    };
  }

  public async ensurePasskeySmartAccountDeployed(): Promise<boolean> {
    const { activeAccount, activeNetwork, accounts } = store.getState().vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id] as any;

    if (!account?.isPasskeySmartAccount || !account.passkey) {
      throw new Error('Active account is not a passkey account');
    }

    const metadata = account.passkey as IPasskeySmartAccountMetadata;
    const factoryAddress = this.assertPasskeyAccountNetwork(metadata);

    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const code = await provider.getCode(account.address);
    if (code && code !== '0x') {
      return false;
    }

    const { maxFeePerGas, maxPriorityFeePerGas } =
      (await this.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas()) as {
        maxFeePerGas: BigNumber;
        maxPriorityFeePerGas: BigNumber;
      };
    const gasLimit = BigNumber.from(3_000_000);
    const gasPayer = await this.getPasskeyDeploymentGasPayer(
      metadata,
      BigNumber.from(maxFeePerGas).mul(gasLimit)
    );
    const data = passkeyFactoryInterface.encodeFunctionData('createAccount', [
      getPasskeyMetadataFactoryAccountParams(metadata),
    ]);

    await this.runWithGasPayer(gasPayer, async () => {
      const tx = await this.ethereumTransaction.sendFormattedTransaction(
        {
          chainId: activeNetwork.chainId,
          data,
          from: gasPayer.account.address,
          gasLimit: gasLimit.toNumber(),
          maxFeePerGas,
          maxPriorityFeePerGas,
          to: metadata.factoryAddress || factoryAddress,
          value: 0,
        },
        false
      );
      await tx.wait?.();
    });

    const deployedCode = await provider.getCode(account.address);
    if (!deployedCode || deployedCode === '0x') {
      throw new Error('Passkey smart account deployment address mismatch');
    }

    const updatedMetadata = {
      ...metadata,
      isDeployed: true,
    };
    store.dispatch(
      setAccountPropertyByIdAndType({
        id: account.id,
        type: PaliKeyringAccountType.PasskeySmartAccount,
        property: 'passkey',
        value: updatedMetadata,
      })
    );
    await this.savePasskeyMetadataState('deploy-passkey-smart-account');
    return true;
  }

  public async preparePasskeyDeploymentPolicyExecution(): Promise<{
    actionHash: string;
    execution: {
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    };
    executions: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>;
    requiresDeployment: boolean;
  } | null> {
    const { activeAccount, accounts } = store.getState().vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id] as any;
    if (!account?.isPasskeySmartAccount || !account.passkey) {
      throw new Error('Active account is not a passkey account');
    }

    const metadata = account.passkey as IPasskeySmartAccountMetadata;
    this.assertPasskeyAccountNetwork(metadata);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const code = await provider.getCode(account.address);
    if (code && code !== '0x') {
      return null;
    }

    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    const policyExecution = getPasskeyPolicyExecution(
      account.address,
      metadata,
      0,
      deadline
    );
    if (!policyExecution) {
      return null;
    }

    const executions = [policyExecution];
    const actionHash = getPasskeyActionHash({
      account: account.address,
      chainId: metadata.chainId,
      executions,
      sponsorMode: PasskeyContractSponsorMode.None,
      sponsorSigner: AddressZero,
    });

    return {
      actionHash,
      execution: policyExecution,
      executions,
      requiresDeployment: true,
    };
  }

  public async preparePasskeyExecution(params: {
    data?: string;
    target: string;
    value: string;
  }): Promise<{
    actionHash: string;
    execution: {
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    };
    executions: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>;
    requiresDeployment: boolean;
  }> {
    const normalizedParams = this.normalizePasskeyExecutionPayload(params);
    await this.assertPasskeyExecutionTargetAllowed(normalizedParams.target);

    const { activeAccount, accounts } = store.getState().vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id] as any;
    if (!account?.isPasskeySmartAccount || !account.passkey) {
      throw new Error('Active account is not a passkey account');
    }

    const metadata = account.passkey as IPasskeySmartAccountMetadata;
    this.assertPasskeyAccountNetwork(metadata);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    let requiresDeployment = !metadata.isDeployed;
    if (requiresDeployment) {
      const code = await provider.getCode(account.address);
      requiresDeployment = !code || code === '0x';
      if (!requiresDeployment) {
        store.dispatch(
          setAccountPropertyByIdAndType({
            id: account.id,
            type: PaliKeyringAccountType.PasskeySmartAccount,
            property: 'passkey',
            value: {
              ...metadata,
              isDeployed: true,
            },
          })
        );
        await this.savePasskeyMetadataState('update-passkey-deployment-status');
      }
    }
    const contract = new Contract(
      account.address,
      passkeySmartAccountInterface,
      provider
    );
    const nonce = requiresDeployment
      ? BigNumber.from(0)
      : await contract.nonce();
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    const executions = [];
    const pendingPolicy = requiresDeployment
      ? getPasskeyPolicyExecution(
          account.address,
          metadata,
          nonce.toNumber(),
          deadline
        )
      : null;
    if (pendingPolicy) {
      executions.push(pendingPolicy);
    }
    const execution = {
      target: normalizedParams.target,
      value: normalizedParams.value,
      data: normalizedParams.data,
      nonce: nonce.add(executions.length).toString(),
      deadline,
    };
    executions.push(execution);

    const actionHash = getPasskeyActionHash({
      account: account.address,
      chainId: metadata.chainId,
      executions,
      sponsorMode: requiresDeployment
        ? PasskeyContractSponsorMode.None
        : getPasskeySponsorContractMode(metadata),
      sponsorSigner: requiresDeployment
        ? AddressZero
        : metadata.sponsor?.signer || AddressZero,
    });

    return { actionHash, execution, executions, requiresDeployment };
  }

  public async submitPasskeyExecution(params: {
    actionHash?: string;
    execution: {
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    };
    executions?: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>;
    proof: {
      authenticatorData: string;
      challengeOffset: number;
      clientDataJSON: string;
      originOffset: number;
      r: string;
      s: string;
      typeOffset: number;
    };
    requiresDeployment?: boolean;
    sponsorProof?:
      | string
      | {
          r?: string;
          s?: string;
          signature?: string;
          v?: number | string;
        };
    sponsorSignature?: string;
    waitForConfirmation?: boolean;
  }) {
    const { activeAccount, activeNetwork, accounts } = store.getState().vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id] as any;

    if (!account?.isPasskeySmartAccount) {
      throw new Error('Active account is not a passkey account');
    }

    const metadata = account.passkey as IPasskeySmartAccountMetadata;
    this.assertPasskeyAccountNetwork(metadata);
    const executions = params.executions || [params.execution];
    for (const execution of executions) {
      if (getAddress(execution.target) !== getAddress(account.address)) {
        await this.assertPasskeyExecutionTargetAllowed(execution.target);
      }
    }

    const requiresDeployment =
      params.requiresDeployment === undefined
        ? !metadata.isDeployed
        : params.requiresDeployment;

    const emptySponsorProof = { v: 0, r: HashZero, s: HashZero };
    let sponsorProof = emptySponsorProof;
    const sponsorResult = await this.resolvePasskeySponsorResult(
      account,
      activeNetwork.chainId,
      {
        ...params,
        actionHash: params.actionHash,
        executions,
      }
    );
    if (sponsorResult.type === 'relayed') {
      try {
        const txResponse = await this.verifyPasskeyRelayedTransaction(
          sponsorResult.txHash,
          requiresDeployment,
          account.address,
          executions,
          params.proof,
          metadata
        );
        const passkeyTxResponse = {
          ...(txResponse as IEvmTransactionResponse),
          passkeyExecutionFrom: account.address,
        } as IEvmTransactionResponse;
        await this.sendAndSaveTransaction(passkeyTxResponse, {
          id: account.id,
          type: PaliKeyringAccountType.PasskeySmartAccount,
        });
        await this.savePasskeyTransactionForLocalRecipients(
          passkeyTxResponse,
          executions,
          account.address,
          {
            id: account.id,
            type: PaliKeyringAccountType.PasskeySmartAccount,
          }
        );
        if (params.waitForConfirmation) {
          await this.waitForPasskeyTransactionConfirmation(
            sponsorResult.txHash
          );
        }
        if (requiresDeployment) {
          await this.savePasskeyDeploymentStatusIfConfirmed(account, metadata);
        }
        await this.recordPasskeyBackupStatusFromProof(account, params.proof);
        return { hash: sponsorResult.txHash };
      } catch (error) {
        if (
          metadata.sponsor?.mode !== PasskeySponsorMode.GasOnly ||
          error instanceof PasskeyRelayedTransactionNotFoundError
        ) {
          throw error;
        }
      }
    } else {
      sponsorProof = sponsorResult.sponsorProof;
    }

    const { maxFeePerGas, maxPriorityFeePerGas } =
      (await this.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas()) as {
        maxFeePerGas: BigNumber;
        maxPriorityFeePerGas: BigNumber;
      };
    const gasLimit = BigNumber.from(requiresDeployment ? 4_000_000 : 1_000_000);
    const gasPayer = requiresDeployment
      ? await this.getPasskeyDeploymentGasPayer(
          metadata,
          BigNumber.from(maxFeePerGas).mul(gasLimit)
        )
      : await this.getDefaultPasskeyGasPayer(
          BigNumber.from(maxFeePerGas).mul(gasLimit)
        );
    const data = requiresDeployment
      ? passkeyFactoryInterface.encodeFunctionData('createAccountAndExecute', [
          getPasskeyMetadataFactoryAccountParams(metadata),
          executions,
          params.proof,
          sponsorProof,
        ])
      : passkeySmartAccountInterface.encodeFunctionData('execute', [
          executions,
          params.proof,
          sponsorProof,
        ]);

    const response = await this.runWithGasPayer(
      gasPayer,
      async () =>
        this.sendAndSaveEthTransaction(
          {
            chainId: activeNetwork.chainId,
            data,
            from: gasPayer.account.address,
            gasLimit: gasLimit.toNumber(),
            maxFeePerGas,
            maxPriorityFeePerGas,
            to: requiresDeployment
              ? metadata.factoryAddress ||
                getPasskeyFactoryAddress(activeNetwork.chainId)
              : account.address,
            value: 0,
          },
          false,
          {
            id: account.id,
            type: PaliKeyringAccountType.PasskeySmartAccount,
          },
          {
            passkeyExecutionFrom: account.address,
          },
          {
            clearNavigation: false,
            persist: false,
          }
        ),
      { persistRestore: false }
    );
    if (params.waitForConfirmation && (response as any)?.hash) {
      await this.waitForPasskeyTransactionConfirmation((response as any).hash);
    }
    await this.savePasskeyTransactionForLocalRecipients(
      response,
      executions,
      account.address,
      {
        id: account.id,
        type: PaliKeyringAccountType.PasskeySmartAccount,
      }
    );
    if (requiresDeployment) {
      await this.savePasskeyDeploymentStatusIfConfirmed(account, metadata);
    }
    try {
      await this.saveWalletState('send-passkey-transaction', true, true);
    } catch (error) {
      console.error(
        '[MainController] Failed to persist passkey transaction:',
        error
      );
    }
    try {
      await clearNavigationState();
      console.log(
        '[MainController] Navigation state cleared after transaction'
      );
    } catch (e) {
      console.error('[MainController] Failed to clear navigation state:', e);
    }
    await this.recordPasskeyBackupStatusFromProof(account, params.proof);
    return response;
  }

  private async waitForPasskeyTransactionConfirmation(txHash: string) {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const receipt = await provider.waitForTransaction(txHash, 1, 120_000);
    if (!receipt) {
      throw new Error('Passkey transaction was not confirmed in time');
    }
    if (receipt.status === 0) {
      throw new Error('Passkey transaction reverted');
    }
  }

  private async savePasskeyDeploymentStatusIfConfirmed(
    account: any,
    metadata: IPasskeySmartAccountMetadata
  ) {
    const deployedCode = await this.ethereumTransaction.web3Provider.getCode(
      account.address
    );
    if (!deployedCode || deployedCode === '0x') {
      return false;
    }

    store.dispatch(
      setAccountPropertyByIdAndType({
        id: account.id,
        type: PaliKeyringAccountType.PasskeySmartAccount,
        property: 'passkey',
        value: {
          ...metadata,
          isDeployed: true,
        },
      })
    );
    await this.savePasskeyMetadataState('deploy-passkey-smart-account');
    return true;
  }

  private async savePasskeyTransactionForLocalRecipients(
    tx: IEvmTransactionResponse,
    executions: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>,
    passkeyFrom: string,
    sourceAccount: { id: number; type: PaliKeyringAccountType }
  ) {
    const { accounts, activeNetwork } = store.getState().vault;
    const sourceAddress = passkeyFrom.toLowerCase();
    const nativeRecipients = new Set(
      executions
        .filter((execution) => {
          const data = execution.data || '0x';
          return data === '0x' && BigNumber.from(execution.value || 0).gt(0);
        })
        .map((execution) => getAddress(execution.target).toLowerCase())
    );

    if (nativeRecipients.size === 0) {
      return;
    }

    Object.values(PaliKeyringAccountType).forEach((accountType) => {
      Object.values(accounts[accountType] || {}).forEach((candidate: any) => {
        if (!candidate?.address) {
          return;
        }

        const candidateAddress = candidate.address.toLowerCase();
        if (
          candidateAddress === sourceAddress ||
          !nativeRecipients.has(candidateAddress) ||
          (candidate.id === sourceAccount.id &&
            accountType === sourceAccount.type)
        ) {
          return;
        }

        store.dispatch(
          setSingleTransactionToState({
            accountId: candidate.id,
            accountType,
            chainId: activeNetwork.chainId,
            networkType: TransactionsType.Ethereum,
            transaction: {
              ...tx,
              passkeyExecutionFrom: passkeyFrom,
            } as IEvmTransactionResponse,
          })
        );
      });
    });
  }

  private async resolvePasskeySponsorResult(
    account: any,
    chainId: number,
    params: {
      actionHash?: string;
      execution: {
        data: string;
        deadline: number;
        nonce: string;
        target: string;
        value: string;
      };
      executions?: Array<{
        data: string;
        deadline: number;
        nonce: string;
        target: string;
        value: string;
      }>;
      proof: {
        authenticatorData: string;
        challengeOffset: number;
        clientDataJSON: string;
        originOffset: number;
        r: string;
        s: string;
        typeOffset: number;
      };
      sponsorProof?:
        | string
        | {
            r?: string;
            s?: string;
            signature?: string;
            v?: number | string;
          };
      sponsorSignature?: string;
    }
  ): Promise<
    | { sponsorProof: { r: string; s: string; v: number }; type: 'local' }
    | { txHash: string; type: 'relayed' }
  > {
    const metadata = account.passkey as IPasskeySmartAccountMetadata;
    const emptyProof = { v: 0, r: HashZero, s: HashZero };

    const executions = params.executions || [params.execution];
    const actionHash =
      params.actionHash ||
      getPasskeyActionHash({
        account: account.address,
        chainId,
        executions,
        sponsorMode: getPasskeySponsorContractMode(metadata),
        sponsorSigner: metadata.sponsor?.signer || AddressZero,
      });
    const providedProof = this.normalizePasskeySponsorProof(
      params.sponsorProof || params.sponsorSignature
    );
    if (providedProof) {
      verifyPasskeySponsorProof(actionHash, providedProof, metadata);
      return { sponsorProof: providedProof, type: 'local' };
    }

    if (
      metadata.sponsor?.mode !== PasskeySponsorMode.Required &&
      metadata.sponsor?.mode !== PasskeySponsorMode.GasOnly
    ) {
      return { sponsorProof: emptyProof, type: 'local' };
    }

    if (
      !metadata.sponsor?.url &&
      metadata.sponsor?.mode === PasskeySponsorMode.Required
    ) {
      throw new Error(
        'This passkey account requires sponsor authorization, but no sponsor URL is configured'
      );
    }
    if (!metadata.sponsor?.url) {
      return { sponsorProof: emptyProof, type: 'local' };
    }

    let sponsorResult:
      | {
          sponsorProof: { r: string; s: string; v: number };
          type: 'authorization';
        }
      | { txHash: string; type: 'relayed' };
    try {
      sponsorResult = await this.fetchPasskeySponsorResult(
        metadata.sponsor.url,
        {
          account: account.address,
          actionHash,
          chainId,
          execution: params.execution,
          executions,
          proof: params.proof,
          sponsorSigner: metadata.sponsor.signer,
          version: PASSKEY_SMART_ACCOUNT_VERSION,
        }
      );
    } catch (error) {
      if (metadata.sponsor.mode === PasskeySponsorMode.GasOnly) {
        return { sponsorProof: emptyProof, type: 'local' };
      }
      throw error;
    }

    if (sponsorResult.type === 'relayed') {
      return sponsorResult;
    }
    if (metadata.sponsor.mode === PasskeySponsorMode.GasOnly) {
      return { sponsorProof: emptyProof, type: 'local' };
    }
    verifyPasskeySponsorProof(actionHash, sponsorResult.sponsorProof, metadata);
    return { sponsorProof: sponsorResult.sponsorProof, type: 'local' };
  }

  private normalizePasskeySponsorProof(
    proofOrSignature?:
      | string
      | {
          r?: string;
          s?: string;
          signature?: string;
          v?: number | string;
        }
      | null
  ): { r: string; s: string; v: number } | null {
    return normalizePasskeySponsorProof(proofOrSignature);
  }

  private async fetchPasskeySponsorResult(
    sponsorUrl: string,
    payload: {
      account: string;
      actionHash: string;
      chainId: number;
      execution: {
        data: string;
        deadline: number;
        nonce: string;
        target: string;
        value: string;
      };
      executions: Array<{
        data: string;
        deadline: number;
        nonce: string;
        target: string;
        value: string;
      }>;
      proof: {
        authenticatorData: string;
        challengeOffset: number;
        clientDataJSON: string;
        originOffset: number;
        r: string;
        s: string;
        typeOffset: number;
      };
      sponsorSigner?: string;
      version: string;
    }
  ): Promise<
    | {
        sponsorProof: { r: string; s: string; v: number };
        type: 'authorization';
      }
    | { txHash: string; type: 'relayed' }
  > {
    const responseBody = await this.postPasskeySponsorRequest(sponsorUrl, {
      ...payload,
      idempotencyKey: payload.actionHash,
      requestType: 'execute',
    });
    return this.resolvePasskeySponsorResponse(
      sponsorUrl,
      payload,
      responseBody
    );
  }

  private async postPasskeySponsorRequest(
    sponsorUrl: string,
    payload: Record<string, unknown>
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(sponsorUrl, {
        body: JSON.stringify(payload),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Sponsor authorization failed: ${response.status}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolvePasskeySponsorResponse(
    sponsorUrl: string,
    payload: {
      account: string;
      actionHash: string;
      chainId: number;
      execution: {
        data: string;
        deadline: number;
        nonce: string;
        target: string;
        value: string;
      };
      proof: {
        authenticatorData: string;
        challengeOffset: number;
        clientDataJSON: string;
        originOffset: number;
        r: string;
        s: string;
        typeOffset: number;
      };
      sponsorSigner?: string;
      version: string;
    },
    body: any
  ): Promise<
    | {
        sponsorProof: { r: string; s: string; v: number };
        type: 'authorization';
      }
    | { txHash: string; type: 'relayed' }
  > {
    const immediate = this.parsePasskeySponsorResponse(body);
    if (immediate.type !== 'pending') {
      return immediate;
    }

    return this.pollPasskeySponsorRequest(
      immediate.statusUrl || sponsorUrl,
      payload,
      immediate.requestId
    );
  }

  private parsePasskeySponsorResponse(body: any):
    | { requestId: string; statusUrl?: string; type: 'pending' }
    | {
        sponsorProof: { r: string; s: string; v: number };
        type: 'authorization';
      }
    | { txHash: string; type: 'relayed' } {
    const txHash = body?.txHash || body?.transactionHash || body?.hash;
    if (typeof txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { txHash, type: 'relayed' };
    }

    const sponsorProof = this.normalizePasskeySponsorProof(
      body?.sponsorProof || body?.signature || body?.sponsorSignature
    );
    if (sponsorProof) {
      return { sponsorProof, type: 'authorization' };
    }

    const requestId = body?.requestId || body?.id;
    const status = String(body?.status || body?.type || '').toLowerCase();
    if (requestId && (status === 'pending' || status === 'queued' || !status)) {
      return {
        requestId: String(requestId),
        statusUrl:
          typeof body?.statusUrl === 'string' ? body.statusUrl : undefined,
        type: 'pending',
      };
    }

    throw new Error(
      'Sponsor response did not include txHash, signature, or pending request id'
    );
  }

  private async pollPasskeySponsorRequest(
    statusUrl: string,
    payload: {
      account: string;
      actionHash: string;
      chainId: number;
      execution: {
        data: string;
        deadline: number;
        nonce: string;
        target: string;
        value: string;
      };
      proof: {
        authenticatorData: string;
        challengeOffset: number;
        clientDataJSON: string;
        originOffset: number;
        r: string;
        s: string;
        typeOffset: number;
      };
      sponsorSigner?: string;
      version: string;
    },
    requestId: string
  ): Promise<
    | {
        sponsorProof: { r: string; s: string; v: number };
        type: 'authorization';
      }
    | { txHash: string; type: 'relayed' }
  > {
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const body = await this.postPasskeySponsorRequest(statusUrl, {
        account: payload.account,
        actionHash: payload.actionHash,
        chainId: payload.chainId,
        idempotencyKey: payload.actionHash,
        requestId,
        requestType: 'status',
        version: payload.version,
      });
      const result = this.parsePasskeySponsorResponse(body);
      if (result.type !== 'pending') {
        return result;
      }
    }

    throw new Error('Sponsor relay request is still pending');
  }

  private async verifyPasskeyRelayedTransaction(
    txHash: string,
    requiresDeployment: boolean,
    expectedAccount: string,
    expectedExecutions: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>,
    expectedProof: {
      authenticatorData: string;
      challengeOffset: number;
      clientDataJSON: string;
      originOffset: number;
      r: string;
      s: string;
      typeOffset: number;
    },
    metadata: IPasskeySmartAccountMetadata
  ) {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const tx = await provider.getTransaction(txHash);
      if (tx) {
        const expectedTo = requiresDeployment
          ? metadata.factoryAddress ||
            getPasskeyFactoryAddress(metadata.chainId)
          : expectedAccount;
        if (tx.to?.toLowerCase() !== expectedTo.toLowerCase()) {
          throw new Error('Sponsor relayed an unexpected passkey transaction');
        }
        const decoded = requiresDeployment
          ? passkeyFactoryInterface.decodeFunctionData(
              'createAccountAndExecute',
              tx.data
            )
          : passkeySmartAccountInterface.decodeFunctionData('execute', tx.data);
        const decodedExecutions = requiresDeployment ? decoded[1] : decoded[0];
        const decodedProof = requiresDeployment ? decoded[2] : decoded[1];
        const decodedSponsorProof = requiresDeployment
          ? decoded[3]
          : decoded[2];

        if (requiresDeployment) {
          const expectedParams =
            getPasskeyMetadataFactoryAccountParams(metadata);
          const decodedParams = decoded[0];
          if (
            decodedParams.recoveryId !== expectedParams.recoveryId ||
            decodedParams.passkeyX !== expectedParams.passkeyX ||
            decodedParams.passkeyY !== expectedParams.passkeyY ||
            decodedParams.credentialIdHash !==
              expectedParams.credentialIdHash ||
            decodedParams.rpIdHash !== expectedParams.rpIdHash ||
            decodedParams.originHash !== expectedParams.originHash ||
            decodedParams.originLength.toString() !==
              expectedParams.originLength.toString() ||
            decodedParams.salt !== expectedParams.salt
          ) {
            throw new Error(
              'Sponsor relayed an unexpected passkey transaction'
            );
          }
        }

        if (decodedExecutions?.length !== expectedExecutions.length) {
          throw new Error('Sponsor relayed an unexpected passkey transaction');
        }
        expectedExecutions.forEach((expectedExecution, index) => {
          assertPasskeyRelayPayloadMatches(
            decodedExecutions?.[index],
            decodedProof,
            expectedExecution,
            expectedProof
          );
        });
        if (metadata.sponsor?.mode === PasskeySponsorMode.Required) {
          const actionHash = getPasskeyActionHash({
            account: expectedAccount,
            chainId: metadata.chainId,
            executions: expectedExecutions,
            sponsorMode: requiresDeployment
              ? PasskeyContractSponsorMode.None
              : getPasskeySponsorContractMode(metadata),
            sponsorSigner: requiresDeployment
              ? AddressZero
              : metadata.sponsor?.signer || AddressZero,
          });
          verifyPasskeyRelayedSponsorProof(
            actionHash,
            decodedSponsorProof,
            metadata
          );
        }
        return tx;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new PasskeyRelayedTransactionNotFoundError();
  }
}

export default PasskeyController;
