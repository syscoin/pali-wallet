import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { isHexString } from '@ethersproject/bytes';
import { AddressZero, HashZero } from '@ethersproject/constants';
import { Contract } from '@ethersproject/contracts';
import { formatUnits } from '@ethersproject/units';
import { retryableFetch } from '@sidhujag/sysweb3-network';
import { ITxid } from '@sidhujag/sysweb3-utils';

import {
  IEvmTransactionResponse,
  ISysTransaction,
} from '../transactions/types';
import { savePasskeyCredentialProfileState } from 'state/paliStorage';
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
  getPasskeyCreateHash,
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
  PasskeyWebAuthnProof,
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

type PasskeyRecoverySource = { address?: string; log?: any };

type PasskeyRecoveryCandidate = {
  address: string;
  balance: string;
  currency: string;
  sponsor?: IPasskeySmartAccountMetadata['sponsor'];
  txCount?: number;
};

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

  private async savePasskeyCredentialProfileState(
    profile: IPasskeyCredentialProfile | null
  ): Promise<void> {
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;
    if (activeSlip44 === null) {
      console.warn(
        '[MainController] No active slip44 to save passkey credential profile'
      );
      return;
    }

    await savePasskeyCredentialProfileState(activeSlip44, profile);
  }

  public async createPasskeySmartAccount(params: {
    address: string;
    credentialProfile?: IPasskeyCredentialProfile;
    deploymentActionHash?: string;
    deploymentExecutions?: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>;
    deploymentProof?: PasskeyWebAuthnProof;
    label?: string;
    metadata: IPasskeySmartAccountMetadata;
  }): Promise<any> {
    const { accounts, activeNetwork } = store.getState().vault;
    const existingAccount = this.getExistingAccountByAddress(params.address);
    if (existingAccount) {
      if (existingAccount.account?.isPasskeySmartAccount) {
        if (!existingAccount.account.passkey?.isDeployed) {
          throw new Error(
            'This local passkey account was not confirmed on-chain. Recover or recreate it before using it.'
          );
        }
        store.dispatch(
          setActiveAccount({
            id: existingAccount.account.id,
            type: PaliKeyringAccountType.PasskeySmartAccount,
          })
        );
        return existingAccount.account;
      }
      throw new Error('Account already exists on your Wallet.');
    }

    const metadata = {
      ...params.metadata,
      isDeployed: true,
    };
    this.assertPasskeyAccountNetwork(metadata);
    this.assertSponsorHasUsableAuthorizationPath(metadata.sponsor);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    await this.deployPreparedPasskeySmartAccount({
      activeNetwork,
      address: params.address,
      deploymentActionHash: params.deploymentActionHash,
      deploymentExecutions: params.deploymentExecutions,
      deploymentProof: params.deploymentProof,
      metadata,
    });

    const confirmedMetadata = await this.readConfirmedPasskeyMetadata({
      address: params.address,
      expected: metadata,
      provider,
    });
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
      passkey: confirmedMetadata,
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
    if (
      params.credentialProfile &&
      !store.getState().vault.passkeyCredentialProfile
    ) {
      store.dispatch(setPasskeyCredentialProfile(params.credentialProfile));
      await this.savePasskeyCredentialProfileState(params.credentialProfile);
    }

    await this.saveWalletState('create-passkey-smart-account', true, true);
    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(true, true, false, true).catch(
        (error) => {
          console.error(
            '[MainController] Failed to update passkey account after creation:',
            error
          );
        }
      );
    }, 10);
    return newAccount;
  }

  public getPasskeyCredentialProfile(): IPasskeyCredentialProfile | null {
    return store.getState().vault.passkeyCredentialProfile || null;
  }

  public async savePasskeyCredentialProfile(
    profile: IPasskeyCredentialProfile | null
  ): Promise<IPasskeyCredentialProfile | null> {
    store.dispatch(setPasskeyCredentialProfile(profile));
    await this.savePasskeyCredentialProfileState(profile);
    return profile;
  }

  public async previewPasskeySmartAccountRecovery(params: {
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
  }): Promise<{
    candidates: PasskeyRecoveryCandidate[];
    existing: number;
    skipped: number;
  }> {
    const { activeNetwork, provider, factoryAddress } =
      this.getPasskeyRecoveryContext(params.credentialIdHash);
    const recoverySources = await this.getPasskeyRecoverySources({
      activeNetwork,
      credentialIdHash: params.credentialIdHash,
      factoryAddress,
      provider,
    });
    if (recoverySources.length === 0) {
      return { candidates: [], existing: 0, skipped: 0 };
    }

    const existingAddresses = this.getExistingAccountAddressSet();
    let existing = 0;
    const missingSources = recoverySources.filter((source) => {
      const address = this.getPasskeyRecoverySourceAddress(source);
      if (address && existingAddresses.has(address.toLowerCase())) {
        existing += 1;
        return false;
      }
      return true;
    });
    if (missingSources.length === 0) {
      return { candidates: [], existing, skipped: 0 };
    }

    let skipped = 0;
    const recoveryCandidates: PasskeyRecoveryCandidate[] = [];
    for (const sourceBatch of this.chunkArray(missingSources, 5)) {
      const recoveredCandidates = await Promise.all(
        sourceBatch.map((source) =>
          this.readRecoveredPasskeyAccount({
            address: source.address,
            credentialId: params.credentialId,
            credentialIdHash: params.credentialIdHash,
            factoryAddress,
            log: source.log,
            provider,
            backupStatus: params.backupStatus,
          })
        )
      );

      const enrichedCandidates = await Promise.all(
        recoveredCandidates.map(async (candidate) => {
          if (
            !candidate ||
            !candidate.metadata ||
            existingAddresses.has(candidate.address.toLowerCase())
          ) {
            return null;
          }

          const hints = await this.getPasskeyRecoveryActivityHints(
            candidate.address,
            activeNetwork,
            provider
          );
          return {
            address: candidate.address,
            balance: hints.balance,
            currency: hints.currency,
            sponsor: candidate.metadata.sponsor,
            ...(hints.txCount !== undefined ? { txCount: hints.txCount } : {}),
          };
        })
      );

      for (const candidate of enrichedCandidates) {
        if (
          !candidate ||
          existingAddresses.has(candidate.address.toLowerCase())
        ) {
          skipped += 1;
          continue;
        }

        existingAddresses.add(candidate.address.toLowerCase());
        recoveryCandidates.push(candidate);
      }
    }

    return { candidates: recoveryCandidates, existing, skipped };
  }

  public async importPasskeySmartAccounts(params: {
    addresses: string[];
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
  }): Promise<{
    accounts: Array<{ address: string; id: number; label: string }>;
    recovered: number;
    skipped: number;
  }> {
    const selectedAddresses = new Set(
      params.addresses.map((address) => getAddress(address).toLowerCase())
    );
    if (selectedAddresses.size === 0) {
      return { recovered: 0, skipped: 0, accounts: [] };
    }

    const { activeNetwork, provider, factoryAddress } =
      this.getPasskeyRecoveryContext(params.credentialIdHash);
    const recoverySources = await this.getPasskeyRecoverySources({
      activeNetwork,
      credentialIdHash: params.credentialIdHash,
      factoryAddress,
      provider,
    });
    if (recoverySources.length === 0) {
      return { recovered: 0, skipped: 0, accounts: [] };
    }

    const { accounts } = store.getState().vault;
    const existingAddresses = this.getExistingAccountAddressSet();
    let skipped = 0;
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
            backupStatus: params.backupStatus,
          })
        )
      );

      for (const candidate of candidates) {
        const normalizedAddress = candidate?.address?.toLowerCase();
        if (
          !candidate ||
          !candidate.metadata ||
          !normalizedAddress ||
          !selectedAddresses.has(normalizedAddress) ||
          existingAddresses.has(normalizedAddress)
        ) {
          if (normalizedAddress && selectedAddresses.has(normalizedAddress)) {
            skipped += 1;
          }
          continue;
        }

        const label = `Recovered Passkey Account ${nextId + 1}`;
        const newAccount = this.createRecoveredPasskeyAccountState({
          address: candidate.address,
          id: nextId,
          label,
          metadata: candidate.metadata,
        });

        store.dispatch(
          createAccount({
            account: newAccount,
            accountType: PaliKeyringAccountType.PasskeySmartAccount,
          })
        );
        existingAddresses.add(normalizedAddress);
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
          const profile = {
            credentialId: firstRecovered.passkey.credentialId,
            credentialIdHash: firstRecovered.passkey.credentialIdHash,
            backupStatus: firstRecovered.passkey.backupStatus,
            passkeyName: firstRecovered.passkey.passkeyName,
            publicKey: firstRecovered.passkey.publicKey,
          };
          store.dispatch(setPasskeyCredentialProfile(profile));
          await this.savePasskeyCredentialProfileState(profile);
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
      accounts: recoveredAccounts,
    };
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

  private getPasskeyRecoveryContext(credentialIdHash: string) {
    const { activeNetwork } = store.getState().vault;
    if (activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Passkey accounts are only supported on EVM networks');
    }
    if (!isHexString(credentialIdHash, 32)) {
      throw new Error('Invalid passkey credential hash');
    }

    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    return {
      activeNetwork,
      factoryAddress: getPasskeyFactoryAddress(activeNetwork.chainId),
      provider,
    };
  }

  private async getPasskeyRecoverySources({
    activeNetwork,
    credentialIdHash,
    factoryAddress,
    provider,
  }: {
    activeNetwork: { chainId: number };
    credentialIdHash: string;
    factoryAddress: string;
    provider: any;
  }): Promise<PasskeyRecoverySource[]> {
    let recoverySources: PasskeyRecoverySource[] = (
      await this.getPasskeyRecoveryRegistryAccounts({
        chainId: activeNetwork.chainId,
        credentialIdHash,
        provider,
      })
    ).map((address) => ({ address }));
    if (recoverySources.length === 0) {
      const logs = await this.getPasskeyRecoveryLogs({
        credentialIdHash,
        factoryAddress,
        provider,
      });
      recoverySources = logs.map((log) => ({ log }));
    }
    return recoverySources;
  }

  private createRecoveredPasskeyAccountState({
    address,
    id,
    label,
    metadata,
  }: {
    address: string;
    id: number;
    label: string;
    metadata: IPasskeySmartAccountMetadata;
  }) {
    return {
      address,
      balances: {
        [INetworkType.Syscoin]: -1,
        [INetworkType.Ethereum]: -1,
      },
      id,
      isImported: false,
      isLedgerWallet: false,
      isPasskeySmartAccount: true,
      isTrezorWallet: false,
      label,
      passkey: {
        ...metadata,
        passkeyName: label,
      },
      xprv: '',
      xpub: address,
    };
  }

  private async getPasskeyRecoveryActivityHints(
    address: string,
    activeNetwork: any,
    provider: any
  ) {
    let balance = '0';
    try {
      balance = formatUnits(await provider.getBalance(address), 18);
    } catch (error) {
      logError('Failed to fetch passkey recovery balance', 'UI', error);
    }

    const txCount = await this.getPasskeyRecoveryTxCount(
      address,
      activeNetwork
    );

    return {
      balance,
      currency: activeNetwork.currency || 'eth',
      ...(txCount !== undefined ? { txCount } : {}),
    };
  }

  private getBlockscoutV2Base(activeNetwork: any): string | null {
    const sourceUrl = activeNetwork.apiUrl || activeNetwork.explorer;
    if (!sourceUrl) return null;

    try {
      const url = new URL(sourceUrl);
      const path = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      url.pathname = path.endsWith('/api') ? `${path}/v2` : `${path}/api/v2`;
      return url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  private async getPasskeyRecoveryTxCount(
    address: string,
    activeNetwork: any
  ): Promise<number | undefined> {
    const blockscoutBase = this.getBlockscoutV2Base(activeNetwork);
    if (!blockscoutBase) return undefined;

    try {
      const response = await retryableFetch(
        `${blockscoutBase}/addresses/${address}/counters`
      );
      if (!response.ok) return undefined;

      const data = await response.json();
      const txCount = Number(data?.transactions_count);
      return Number.isFinite(txCount) ? txCount : undefined;
    } catch {
      return undefined;
    }
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

  private getExistingAccountByAddress(address: string) {
    const normalizedAddress = address.toLowerCase();
    const { accounts } = store.getState().vault;
    for (const [accountType, accountsByType] of Object.entries(accounts)) {
      for (const account of Object.values(accountsByType || {}) as any[]) {
        if (account?.address?.toLowerCase?.() === normalizedAddress) {
          return {
            account,
            accountType: accountType as PaliKeyringAccountType,
          };
        }
      }
    }
    return null;
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

    const recoveredUrl = this.normalizeSponsorUrl(recoveredSponsor?.url);
    const requestedUrl = this.normalizeSponsorUrl(requestedSponsor?.url);
    return recoveredUrl === requestedUrl;
  }

  private normalizeSponsorUrl(url?: string) {
    return typeof url === 'string' ? url.trim() : '';
  }

  private async useExistingRecoveredPasskeyAccount({
    address,
    metadata,
    saveOperation,
  }: {
    address: string;
    metadata: IPasskeySmartAccountMetadata;
    saveOperation: string;
  }) {
    const normalizedAddress = address.toLowerCase();
    const passkeyAccounts =
      store.getState().vault.accounts[
        PaliKeyringAccountType.PasskeySmartAccount
      ] || {};
    const existingAccount = Object.values(passkeyAccounts).find(
      (account: any) => account?.address?.toLowerCase?.() === normalizedAddress
    ) as any;

    if (!existingAccount) {
      throw new Error('Passkey account is not available in this wallet.');
    }

    store.dispatch(
      setActiveAccount({
        id: existingAccount.id,
        type: PaliKeyringAccountType.PasskeySmartAccount,
      })
    );
    if (!store.getState().vault.passkeyCredentialProfile) {
      const profile = {
        credentialId: metadata.credentialId,
        credentialIdHash: metadata.credentialIdHash,
        backupStatus: metadata.backupStatus,
        passkeyName: existingAccount.label || metadata.passkeyName,
        publicKey: metadata.publicKey,
      };
      store.dispatch(setPasskeyCredentialProfile(profile));
      await this.savePasskeyCredentialProfileState(profile);
      await this.saveWalletState(saveOperation, true, true);
    }

    return existingAccount;
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
      const profile = {
        credentialId: newAccount.passkey.credentialId,
        credentialIdHash: newAccount.passkey.credentialIdHash,
        backupStatus: newAccount.passkey.backupStatus,
        passkeyName: newAccount.passkey.passkeyName,
        publicKey: newAccount.passkey.publicKey,
      };
      store.dispatch(setPasskeyCredentialProfile(profile));
      await this.savePasskeyCredentialProfileState(profile);
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
  }: {
    chainId: number;
    credentialIdHash: string;
    provider: any;
  }): Promise<string[]> {
    try {
      const factory = getPasskeyFactory(chainId, provider);
      const count = BigNumber.from(
        await this.withPasskeyRpcBackoff(() =>
          factory.getAccountCountByCredential(credentialIdHash)
        )
      ).toNumber();
      const pageSize = 50;
      const accounts: string[] = [];

      for (let offset = 0; offset < count; offset += pageSize) {
        const page = await this.withPasskeyRpcBackoff<string[]>(() =>
          factory.getAccountsByCredential(credentialIdHash, offset, pageSize)
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
  }: {
    credentialIdHash: string;
    factoryAddress: string;
    provider: any;
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
          topics: [eventTopic, null, credentialIdHash],
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
  }: {
    address?: string;
    backupStatus?: PasskeyBackupStatus;
    credentialId: string;
    credentialIdHash: string;
    factoryAddress: string;
    log?: any;
    provider: any;
  }): Promise<{
    address: string;
    metadata?: IPasskeySmartAccountMetadata;
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
    const sponsorUrl = metadata.sponsorUrl ?? metadata[8];

    if (
      storedCredentialIdHash.toLowerCase() !== credentialIdHash.toLowerCase()
    ) {
      return null;
    }

    const sponsorModeNumber = Number(sponsorMode);
    const sponsor = this.recoverPasskeySponsorMetadata(
      sponsorModeNumber,
      sponsorSigner,
      sponsorUrl
    );
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
    sponsorUrl: string
  ): IPasskeySmartAccountMetadata['sponsor'] | null {
    const mode =
      sponsorMode === PasskeyContractSponsorMode.Required
        ? PasskeySponsorMode.Required
        : sponsorMode === PasskeyContractSponsorMode.GasOnly
        ? PasskeySponsorMode.GasOnly
        : PasskeySponsorMode.Disabled;

    const normalizedSponsorUrl = this.normalizeSponsorUrl(sponsorUrl);

    return {
      mode,
      ...(sponsorSigner && sponsorSigner !== AddressZero
        ? { signer: getAddress(sponsorSigner) }
        : {}),
      ...(normalizedSponsorUrl ? { url: normalizedSponsorUrl } : {}),
    };
  }

  private isPasskeySmartAccountAddress(address?: string) {
    if (!isHexString(address, 20)) {
      return false;
    }

    const normalizedAddress = getAddress(address).toLowerCase();
    const passkeyAccounts =
      store.getState().vault.accounts[
        PaliKeyringAccountType.PasskeySmartAccount
      ] || {};

    return Object.values(passkeyAccounts).some(
      (account: any) =>
        isHexString(account?.address, 20) &&
        getAddress(account.address).toLowerCase() === normalizedAddress
    );
  }

  private assertSponsorSignerIsExternallySignable(
    sponsor: IPasskeySmartAccountMetadata['sponsor']
  ) {
    if (this.isPasskeySmartAccountAddress(sponsor?.signer)) {
      throw new Error('Passkey sponsor signer cannot be a passkey account');
    }
  }

  private assertSponsorHasUsableAuthorizationPath(
    sponsor: IPasskeySmartAccountMetadata['sponsor']
  ) {
    this.assertSponsorSignerIsExternallySignable(sponsor);
    if (!sponsor || sponsor.mode === PasskeySponsorMode.Disabled) {
      return;
    }
    if (sponsor.mode === PasskeySponsorMode.GasOnly && !sponsor.url) {
      throw new Error('Passkey gas sponsorship requires a sponsor URL');
    }
    if (
      sponsor.mode === PasskeySponsorMode.Required &&
      !sponsor.url &&
      !this.getLocalSponsorSignerAccount(sponsor.signer)
    ) {
      throw new Error('Use a local signer or sponsor URL.');
    }
  }

  private async deployPreparedPasskeySmartAccount({
    activeNetwork,
    address,
    deploymentActionHash,
    deploymentExecutions,
    deploymentProof,
    metadata,
  }: {
    activeNetwork: { chainId: number };
    address: string;
    deploymentActionHash?: string;
    deploymentExecutions?: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>;
    deploymentProof?: PasskeyWebAuthnProof;
    metadata: IPasskeySmartAccountMetadata;
  }) {
    const { maxFeePerGas, maxPriorityFeePerGas } =
      (await this.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas()) as {
        maxFeePerGas: BigNumber;
        maxPriorityFeePerGas: BigNumber;
      };
    const executions = deploymentExecutions || [];
    const requiresPolicy = executions.length > 0;
    if (!deploymentProof) {
      throw new Error('Passkey approval is required to create this account');
    }
    const expectedDeploymentHash = requiresPolicy
      ? getPasskeyActionHash({
          account: address,
          chainId: metadata.chainId,
          executions,
          sponsorMode: PasskeyContractSponsorMode.None,
          sponsorSigner: AddressZero,
        })
      : getPasskeyCreateHash({
          account: address,
          chainId: metadata.chainId,
          credentialIdHash: metadata.credentialIdHash,
          deploymentSalt: metadata.deploymentSalt,
          publicKey: metadata.publicKey,
        });
    if (
      deploymentActionHash &&
      deploymentActionHash.toLowerCase() !==
        expectedDeploymentHash.toLowerCase()
    ) {
      throw new Error('Passkey deployment approval does not match account');
    }

    const deploymentGasLimit = BigNumber.from(3_000_000);
    const executionGasLimit = requiresPolicy
      ? BigNumber.from(1_000_000).mul(executions.length)
      : BigNumber.from(0);
    const gasLimit = deploymentGasLimit.add(executionGasLimit);
    const gasPayer = await this.getPasskeyDeploymentGasPayer(
      metadata,
      BigNumber.from(maxFeePerGas).mul(gasLimit)
    );
    const data = requiresPolicy
      ? passkeyFactoryInterface.encodeFunctionData('createAccountAndExecute', [
          getPasskeyMetadataFactoryAccountParams(metadata),
          executions,
          deploymentProof,
          { v: 0, r: HashZero, s: HashZero },
        ])
      : passkeyFactoryInterface.encodeFunctionData('createAccount', [
          getPasskeyMetadataFactoryAccountParams(metadata),
          deploymentProof,
        ]);

    await this.runWithGasPayer(
      gasPayer,
      async () => {
        const tx = await this.ethereumTransaction.sendFormattedTransaction(
          {
            chainId: activeNetwork.chainId,
            data,
            from: gasPayer.account.address,
            gasLimit: gasLimit.toNumber(),
            maxFeePerGas,
            maxPriorityFeePerGas,
            to:
              metadata.factoryAddress ||
              getPasskeyFactoryAddress(activeNetwork.chainId),
            value: 0,
          },
          false
        );
        await tx.wait?.();
        if (tx.hash) {
          await this.waitForPasskeyTransactionConfirmation(tx.hash);
        }
      },
      { persistRestore: false }
    );
  }

  private async readConfirmedPasskeyMetadata({
    address,
    expected,
    provider,
  }: {
    address: string;
    expected: IPasskeySmartAccountMetadata;
    provider: any;
  }): Promise<IPasskeySmartAccountMetadata> {
    const code = await this.withPasskeyRpcBackoff(() =>
      provider.getCode(address)
    );
    if (!code || code === '0x') {
      throw new Error('Passkey smart account is not deployed on-chain');
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
    const sponsorUrl = metadata.sponsorUrl ?? metadata[8];

    if (
      storedCredentialIdHash.toLowerCase() !==
        expected.credentialIdHash.toLowerCase() ||
      String(passkeyX).toLowerCase() !== expected.publicKey.x.toLowerCase() ||
      String(passkeyY).toLowerCase() !== expected.publicKey.y.toLowerCase() ||
      String(rpIdHash).toLowerCase() !==
        expected.publicKey.rpIdHash.toLowerCase() ||
      String(originHash).toLowerCase() !==
        expected.publicKey.originHash.toLowerCase() ||
      BigNumber.from(originLength).toNumber() !==
        expected.publicKey.originLength
    ) {
      throw new Error('Passkey smart account recovery metadata mismatch');
    }

    const onchainSponsor = this.recoverPasskeySponsorMetadata(
      Number(sponsorMode),
      sponsorSigner,
      sponsorUrl
    );

    return {
      ...expected,
      isDeployed: true,
      publicKey: {
        originHash,
        originLength: BigNumber.from(originLength).toNumber(),
        rpIdHash,
        x: passkeyX,
        y: passkeyY,
      },
      sponsor: {
        ...(onchainSponsor || { mode: PasskeySponsorMode.Disabled }),
        ...(expected.sponsor?.policyText
          ? { policyText: expected.sponsor.policyText }
          : {}),
      },
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
    };
  }): Promise<{
    address: string;
    deploymentActionHash?: string;
    deploymentExecution?: {
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    };
    deploymentExecutions?: Array<{
      data: string;
      deadline: number;
      nonce: string;
      target: string;
      value: string;
    }>;
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
    const sponsor = normalizePasskeySponsor(params.sponsor);
    this.assertSponsorHasUsableAuthorizationPath(sponsor);
    const accountParams = getPasskeyFactoryAccountParams({
      credentialIdHash: params.credentialIdHash,
      deploymentSalt: params.deploymentSalt,
      publicKey: params.publicKey,
    });
    const address = await factory.getAccountAddress(accountParams);
    const metadata = {
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
      publicKey: params.publicKey,
      sponsor,
    };
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    const deploymentExecution = getPasskeyPolicyExecution(
      address,
      metadata,
      0,
      deadline
    );
    const deploymentExecutions = deploymentExecution
      ? [deploymentExecution]
      : undefined;
    const deploymentActionHash = deploymentExecutions
      ? getPasskeyActionHash({
          account: address,
          chainId: activeNetwork.chainId,
          executions: deploymentExecutions,
          sponsorMode: PasskeyContractSponsorMode.None,
          sponsorSigner: AddressZero,
        })
      : getPasskeyCreateHash({
          account: address,
          chainId: activeNetwork.chainId,
          credentialIdHash: params.credentialIdHash,
          deploymentSalt: params.deploymentSalt,
          publicKey: params.publicKey,
        });

    return {
      address,
      deploymentActionHash,
      deploymentExecution,
      deploymentExecutions,
      factoryAddress,
      metadata,
    };
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
      const updatedProfile = {
        ...profile,
        backupStatus,
      };
      store.dispatch(setPasskeyCredentialProfile(updatedProfile));
      await this.savePasskeyCredentialProfileState(updatedProfile);
    }

    return backupStatus;
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

  private getConfirmedSponsorFromExecutions({
    accountAddress,
    executions,
    sponsor,
  }: {
    accountAddress: string;
    executions: Array<{
      data: string;
      target: string;
      value: string;
    }>;
    sponsor?: {
      mode?: string;
      policyText?: string;
      signer?: string;
      url?: string;
    } | null;
  }) {
    const normalizedSponsor = normalizePasskeySponsor(sponsor);
    this.assertSponsorHasUsableAuthorizationPath(normalizedSponsor);
    if (executions.length !== 1) {
      throw new Error('Passkey policy update must contain one execution');
    }

    const [execution] = executions;
    if (
      getAddress(execution.target) !== getAddress(accountAddress) ||
      !BigNumber.from(execution.value || 0).eq(0)
    ) {
      throw new Error('Passkey policy update must target this passkey account');
    }

    const decoded = passkeySmartAccountInterface.decodeFunctionData(
      'setSponsor',
      execution.data
    );
    const onchainSponsor = this.recoverPasskeySponsorMetadata(
      Number(decoded[0]),
      decoded[1],
      decoded[2]
    );
    if (
      !this.recoveredSponsorMatchesRequest(onchainSponsor, normalizedSponsor)
    ) {
      throw new Error('Passkey policy metadata does not match execution');
    }

    return normalizedSponsor;
  }

  private stagePasskeySponsorMetadata(
    accountId: number,
    sponsor: IPasskeySmartAccountMetadata['sponsor']
  ) {
    const account = store.getState().vault.accounts[
      PaliKeyringAccountType.PasskeySmartAccount
    ]?.[accountId] as any;
    if (!account?.passkey) {
      throw new Error('Passkey account not found');
    }

    store.dispatch(
      setAccountPropertyByIdAndType({
        id: accountId,
        type: PaliKeyringAccountType.PasskeySmartAccount,
        property: 'passkey',
        value: {
          ...account.passkey,
          sponsor,
        },
      })
    );
  }

  private getLocalSponsorSignerAccount(sponsorSigner?: string) {
    if (!sponsorSigner) {
      return null;
    }

    const normalizedSponsorSigner = getAddress(sponsorSigner).toLowerCase();
    const { accounts } = store.getState().vault;
    const localSignerAccountTypes = [
      PaliKeyringAccountType.HDAccount,
      PaliKeyringAccountType.Imported,
      PaliKeyringAccountType.Ledger,
      PaliKeyringAccountType.Trezor,
    ];

    for (const accountType of localSignerAccountTypes) {
      for (const account of Object.values(
        accounts[accountType] || {}
      ) as any[]) {
        if (
          isHexString(account?.address, 20) &&
          getAddress(account.address).toLowerCase() === normalizedSponsorSigner
        ) {
          return { account, accountType };
        }
      }
    }

    return null;
  }

  private async getLocalSponsorProof(
    actionHash: string,
    sponsorSigner?: string
  ) {
    const sponsorSignerAccount =
      this.getLocalSponsorSignerAccount(sponsorSigner);
    if (!sponsorSignerAccount) {
      return null;
    }

    const signature = await this.runWithGasPayer(
      sponsorSignerAccount,
      () =>
        this.ethereumTransaction.signPersonalMessage([
          actionHash,
          sponsorSignerAccount.account.address,
        ]),
      { persistRestore: false }
    );
    const sponsorProof = this.normalizePasskeySponsorProof(signature);
    if (!sponsorProof) {
      throw new Error('Local sponsor signer did not return a valid signature');
    }

    return sponsorProof;
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
  }> {
    return this.preparePasskeyExecutions([params]);
  }

  public async preparePasskeyExecutions(
    params: Array<{
      data?: string;
      target: string;
      value: string;
    }>
  ): Promise<{
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
  }> {
    if (params.length === 0) {
      throw new Error('Passkey execution batch is empty');
    }
    const normalizedParams = params.map((param) =>
      this.normalizePasskeyExecutionPayload(param)
    );
    for (const normalizedParam of normalizedParams) {
      await this.assertPasskeyExecutionTargetAllowed(normalizedParam.target);
    }
    const { activeAccount, accounts } = store.getState().vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id] as any;
    if (!account?.isPasskeySmartAccount || !account.passkey) {
      throw new Error('Active account is not a passkey account');
    }

    const metadata = account.passkey as IPasskeySmartAccountMetadata;
    this.assertPasskeyAccountNetwork(metadata);
    if (!metadata.isDeployed) {
      throw new Error(
        'This passkey account was not confirmed on-chain. Recover or recreate it before using it.'
      );
    }
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const contract = new Contract(
      account.address,
      passkeySmartAccountInterface,
      provider
    );
    const nonce = await contract.nonce();
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    const executions = normalizedParams.map((normalizedParam, index) => ({
      target: normalizedParam.target,
      value: normalizedParam.value,
      data: normalizedParam.data,
      nonce: nonce.add(index).toString(),
      deadline,
    }));

    const actionHash = getPasskeyActionHash({
      account: account.address,
      chainId: metadata.chainId,
      executions,
      sponsorMode: getPasskeySponsorContractMode(metadata),
      sponsorSigner: metadata.sponsor?.signer || AddressZero,
    });

    return {
      actionHash,
      execution: executions[0],
      executions,
    };
  }

  public async submitPasskeyExecution(params: {
    actionHash?: string;
    confirmedSponsor?: {
      mode?: string;
      policyText?: string;
      signer?: string;
      url?: string;
    } | null;
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
    const confirmedSponsor =
      'confirmedSponsor' in params
        ? this.getConfirmedSponsorFromExecutions({
            accountAddress: account.address,
            executions,
            sponsor: params.confirmedSponsor,
          })
        : undefined;
    for (const execution of executions) {
      if (getAddress(execution.target) !== getAddress(account.address)) {
        await this.assertPasskeyExecutionTargetAllowed(execution.target);
      }
    }

    if (!metadata.isDeployed) {
      throw new Error(
        'This passkey account was not confirmed on-chain. Recover or recreate it before using it.'
      );
    }

    const emptySponsorProof = { v: 0, r: HashZero, s: HashZero };
    let sponsorProof = emptySponsorProof;
    const sponsorResult = await this.resolvePasskeySponsorResult(
      account,
      activeNetwork.chainId,
      {
        ...params,
        actionHash: params.actionHash,
        confirmedSponsor,
        executions,
      }
    );
    if (sponsorResult.type === 'relayed') {
      try {
        const txResponse = await this.verifyPasskeyRelayedTransaction(
          sponsorResult.txHash,
          account.address,
          executions,
          params.proof,
          metadata
        );
        const passkeyTxResponse = {
          ...(txResponse as IEvmTransactionResponse),
          passkeyExecutionFrom: account.address,
        } as IEvmTransactionResponse;
        if (params.waitForConfirmation) {
          await this.waitForPasskeyTransactionConfirmation(
            sponsorResult.txHash
          );
        }
        await this.savePasskeyTransactionForLocalRecipients(
          passkeyTxResponse,
          executions,
          account.address,
          {
            id: account.id,
            type: PaliKeyringAccountType.PasskeySmartAccount,
          }
        );
        if (confirmedSponsor) {
          this.stagePasskeySponsorMetadata(account.id, confirmedSponsor);
        }
        await this.recordPasskeyBackupStatusFromProof(account, params.proof);
        await this.sendAndSaveTransaction(
          passkeyTxResponse,
          {
            id: account.id,
            type: PaliKeyringAccountType.PasskeySmartAccount,
          },
          { persist: false }
        );
        try {
          await this.saveWalletState('send-passkey-transaction', true, true);
        } catch (error) {
          console.error(
            '[MainController] Failed to persist passkey transaction:',
            error
          );
        }
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
    const executionGasLimit = BigNumber.from(1_000_000).mul(
      Math.max(executions.length, 1)
    );
    const gasLimit = executionGasLimit;
    const gasPayer = await this.getDefaultPasskeyGasPayer(
      BigNumber.from(maxFeePerGas).mul(gasLimit)
    );
    const data = passkeySmartAccountInterface.encodeFunctionData('execute', [
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
            to: account.address,
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
    if (confirmedSponsor) {
      this.stagePasskeySponsorMetadata(account.id, confirmedSponsor);
    }
    await this.recordPasskeyBackupStatusFromProof(account, params.proof);
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
      confirmedSponsor?: IPasskeySmartAccountMetadata['sponsor'];
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
    const currentSponsor = metadata.sponsor;
    const sponsorMetadata =
      currentSponsor?.mode === PasskeySponsorMode.Required &&
      currentSponsor.signer
        ? currentSponsor
        : params.confirmedSponsor || currentSponsor;
    const proofMetadata = { ...metadata, sponsor: sponsorMetadata };
    const emptyProof = { v: 0, r: HashZero, s: HashZero };

    const executions = params.executions || [params.execution];
    const actionHash =
      params.actionHash ||
      getPasskeyActionHash({
        account: account.address,
        chainId,
        executions,
        sponsorMode: getPasskeySponsorContractMode(metadata),
        sponsorSigner: currentSponsor?.signer || AddressZero,
      });
    const providedProof = this.normalizePasskeySponsorProof(
      params.sponsorProof || params.sponsorSignature
    );
    if (providedProof) {
      verifyPasskeySponsorProof(actionHash, providedProof, proofMetadata);
      return { sponsorProof: providedProof, type: 'local' };
    }

    if (
      sponsorMetadata?.mode !== PasskeySponsorMode.Required &&
      sponsorMetadata?.mode !== PasskeySponsorMode.GasOnly
    ) {
      return { sponsorProof: emptyProof, type: 'local' };
    }

    if (!sponsorMetadata?.url) {
      if (sponsorMetadata?.mode === PasskeySponsorMode.Required) {
        const localSponsorProof = await this.getLocalSponsorProof(
          actionHash,
          sponsorMetadata.signer
        );
        if (localSponsorProof) {
          verifyPasskeySponsorProof(
            actionHash,
            localSponsorProof,
            proofMetadata
          );
          return { sponsorProof: localSponsorProof, type: 'local' };
        }
        throw new Error('Sponsor signer is not in this wallet.');
      }
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
        sponsorMetadata.url,
        {
          account: account.address,
          actionHash,
          chainId,
          execution: params.execution,
          executions,
          proof: params.proof,
          sponsorSigner: sponsorMetadata.signer,
          version: PASSKEY_SMART_ACCOUNT_VERSION,
        }
      );
    } catch (error) {
      if (sponsorMetadata.mode === PasskeySponsorMode.GasOnly) {
        return { sponsorProof: emptyProof, type: 'local' };
      }
      const localSponsorProof = await this.getLocalSponsorProof(
        actionHash,
        sponsorMetadata.signer
      );
      if (localSponsorProof) {
        verifyPasskeySponsorProof(actionHash, localSponsorProof, proofMetadata);
        return { sponsorProof: localSponsorProof, type: 'local' };
      }
      throw error;
    }

    if (sponsorResult.type === 'relayed') {
      return sponsorResult;
    }
    if (sponsorMetadata.mode === PasskeySponsorMode.GasOnly) {
      return { sponsorProof: emptyProof, type: 'local' };
    }
    verifyPasskeySponsorProof(
      actionHash,
      sponsorResult.sponsorProof,
      proofMetadata
    );
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

      const responseText = await response.text();
      return this.parsePasskeySponsorJsonResponse(responseText);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parsePasskeySponsorJsonResponse(responseText: string) {
    const trimmedResponse = responseText.trim();
    if (!trimmedResponse) {
      throw new Error('Sponsor service returned an empty response');
    }

    try {
      return JSON.parse(trimmedResponse);
    } catch {
      if (trimmedResponse.startsWith('<')) {
        throw new Error(
          'Sponsor service returned a non-JSON response. Check that the sponsor URL points to the API endpoint.'
        );
      }

      throw new Error('Sponsor service returned invalid JSON');
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
        if (tx.to?.toLowerCase() !== expectedAccount.toLowerCase()) {
          throw new Error('Sponsor relayed an unexpected passkey transaction');
        }
        const decoded = passkeySmartAccountInterface.decodeFunctionData(
          'execute',
          tx.data
        );
        const decodedExecutions = decoded[0];
        const decodedProof = decoded[1];
        const decodedSponsorProof = decoded[2];

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
            sponsorMode: getPasskeySponsorContractMode(metadata),
            sponsorSigner: metadata.sponsor?.signer || AddressZero,
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
