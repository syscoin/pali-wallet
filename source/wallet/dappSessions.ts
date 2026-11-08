import {
  matchesDappAccountIdentity,
  matchesDappAccountReference,
  MAX_DAPP_ORIGIN_LENGTH,
  type DappGrant as IDApp,
  type DappPermissionFrame,
  type DappPublicAccount,
  type DappAccountSelection as IDAppAccountSelectionContext,
} from '../shared/dappTypes.ts';
import { getDappOrigin } from '../utils/dappOrigin.ts';

import type { INetwork, KeyringAccountType } from '../types/network';

export type {
  DappPermissionMap,
  DappPermissionFrame,
} from '../shared/dappTypes.ts';
export type DappWalletContext = Readonly<{
  activeSlip44: number;
  generation: number;
  isBitcoinBased: boolean;
  network: INetwork;
  unlocked: boolean;
}>;
export type DappSessionEvent = Readonly<{ method: string; params: unknown }>;

/** Host I/O only. Shared code decides admission, repair and publication. */
export type DappPermissionPort = {
  assertWritable(): void;
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  publish(frame: DappPermissionFrame): void;
  read(): DappPermissionFrame;
  write(frame: DappPermissionFrame): Promise<void>;
};

export type DappSessionHost<
  Account extends DappPublicAccount = DappPublicAccount
> = {
  account(id: number, type: KeyringAccountType): Account | undefined;
  /** Match the extension's persisted-grant disclosure predicate. */
  canPublishAccount(
    account: Account | undefined,
    type: KeyringAccountType,
    network: INetwork
  ): boolean;
  clearProviderCache(): void;
  isAccountAvailable(
    account: Account | undefined,
    type: KeyringAccountType,
    network: INetwork
  ): boolean;
  notifyConnection(origin: string, connected: boolean): void;
  now(): number;
  permissions: DappPermissionPort;
  providerAvailability(id: string): Promise<void>;
  reportError(operation: string, error: unknown): void;
  /** Resolve immutable recipients before queuing public-event delivery. */
  resolveDelivery(
    origin: string,
    id: string
  ): Promise<
    | ((
        prepare: () => DappSessionEvent,
        isCurrent: () => boolean
      ) => Promise<void>)
    | null
  >;
  wallet(): DappWalletContext;
};

export type DappGrantWrite = Readonly<{
  grant: IDApp;
  isCurrent(): boolean;
  isPreviousRetired(): boolean;
  isSameWallet(): boolean;
  previous: IDApp | undefined;
  restoredPrevious(): IDApp | undefined;
}>;

/** Publish an approved grant only after its marked candidate is durable. */
export function commitDappPermissionGrant(
  port: DappPermissionPort,
  request: DappGrantWrite,
  onCleanupFailure: (error: unknown) => void
): Promise<void> {
  const { grant, previous } = request;
  return port.exclusive(async () => {
    const admittedPrevious =
      previous === undefined
        ? request.restoredPrevious()
        : port.read().dapps[grant.host] === undefined &&
          request.isPreviousRetired()
        ? undefined
        : previous;
    const assertCurrent = () => {
      port.assertWritable();
      if (
        !request.isSameWallet() ||
        !request.isCurrent() ||
        port.read().dapps[grant.host] !== admittedPrevious
      )
        throw new Error('Permission grant context changed');
    };
    assertCurrent();
    const beforeStage = port.read();
    const pendingOrigins = beforeStage.pendingOrigins.includes(grant.host)
      ? beforeStage.pendingOrigins
      : [...beforeStage.pendingOrigins, grant.host];
    if (pendingOrigins.length > 256)
      throw new Error('Too many pending dapp permissions');
    port.publish({ ...beforeStage, pendingOrigins });
    try {
      assertCurrent();
      await port.write({
        dapps: { ...port.read().dapps, [grant.host]: grant },
        pendingOrigins,
      });
      assertCurrent();
    } catch (error) {
      if (!request.isSameWallet()) throw error;
      const live = port.read();
      const repaired = {
        ...live,
        pendingOrigins: live.pendingOrigins.filter(
          (origin) => origin !== grant.host
        ),
      };
      try {
        port.assertWritable();
        await port.write(repaired);
        if (request.isSameWallet()) {
          const current = port.read();
          port.publish({
            ...current,
            pendingOrigins: current.pendingOrigins.filter(
              (origin) => origin !== grant.host
            ),
          });
        }
      } catch (repairError) {
        if (request.isSameWallet()) {
          const latest = port.read();
          const dapps = { ...latest.dapps };
          if (dapps[grant.host] === admittedPrevious) delete dapps[grant.host];
          port.publish({ ...latest, dapps });
        }
        throw repairError;
      }
      throw error;
    }
    port.publish({
      ...port.read(),
      dapps: { ...port.read().dapps, [grant.host]: grant },
    });
    // Publication is the commit point. Cleanup failure may conservatively hide
    // this grant after restart, but cannot turn an approved grant into failure.
    if (!request.isSameWallet()) return;
    const live = port.read();
    const committed = {
      ...live,
      pendingOrigins: live.pendingOrigins.filter(
        (origin) => origin !== grant.host
      ),
    };
    try {
      await port.write(committed);
      if (request.isSameWallet()) {
        const current = port.read();
        port.publish({
          ...current,
          pendingOrigins: current.pendingOrigins.filter(
            (origin) => origin !== grant.host
          ),
        });
      }
    } catch (error) {
      try {
        onCleanupFailure(error);
      } catch {
        /* Reporting cannot undo a committed grant. */
      }
    }
  });
}

const ACCOUNT_EVENT = 'pali_accountsChanged';
const XPUB_EVENT = 'pali_xpubChanged';
const LOCK_EVENT = 'pali_unlockStateChanged';
const NETWORK_EVENTS = new Set([
  'pali_chainChanged',
  'pali_isBitcoinBased',
  'pali_blockExplorerChanged',
]);
const MAX_PENDING_REVOCATIONS = 256;

/** One owner for origin grants, runtime sessions and their durable transitions. */
export function createDappSessions<Account extends DappPublicAccount>(
  host: DappSessionHost<Account>
) {
  const required = [
    host.wallet,
    host.account,
    host.canPublishAccount,
    host.isAccountAvailable,
    host.resolveDelivery,
    host.providerAvailability,
    host.notifyConnection,
    host.clearProviderCache,
    host.now,
    host.reportError,
    host.permissions?.assertWritable,
    host.permissions?.exclusive,
    host.permissions?.read,
    host.permissions?.write,
    host.permissions?.publish,
  ];
  if (required.some((method) => typeof method !== 'function'))
    throw new TypeError('An explicit dapp session host is required');
  const permissions = host.permissions;
  const sessions: Record<
    string,
    { activeAddress: string | null; approvalOpen: boolean }
  > = {};
  const pendingGrants = new Map<
    string,
    {
      accountId: number;
      accountType: KeyringAccountType;
      isCurrent?: () => boolean;
      previous?: IDApp;
      restoredPrevious?: IDApp;
      retiredPrevious?: IDApp;
    }
  >();
  const pendingRevocations = new Map<string, { inFlight?: Promise<void> }>();
  const networkPublications = new Map<string, Promise<void>>();
  const getAll = () => permissions.read().dapps;
  const publishGrant = (grant: IDApp) =>
    permissions.publish({
      ...permissions.read(),
      dapps: { ...getAll(), [grant.host]: grant },
    });
  const removeGrant = (origin: string) => {
    const dapps = { ...getAll() };
    delete dapps[origin];
    permissions.publish({ ...permissions.read(), dapps });
  };
  const get = (origin: string) => getAll()[origin];
  const resolveAccount = (grant: IDApp | undefined) => {
    const wallet = host.wallet();
    if (!grant || grant.chain !== wallet.network.kind) return null;
    const account = host.account(grant.accountId, grant.accountType);
    if (
      !account ||
      !host.canPublishAccount(account, grant.accountType, wallet.network)
    )
      return null;
    if (!matchesDappAccountReference(grant, account, wallet.network))
      return null;
    return account;
  };
  const currentConnection = (origin: string) => {
    const connection = get(origin),
      wallet = host.wallet();
    return connection &&
      connection.chain === wallet.network.kind &&
      (connection.chain !== 'syscoin' || resolveAccount(connection))
      ? connection
      : undefined;
  };
  const isConnected = (origin: string) => Boolean(currentConnection(origin));
  const getAccount = (origin: string) => resolveAccount(get(origin));
  const setup = (origin: string) => {
    if (
      origin.length > MAX_DAPP_ORIGIN_LENGTH ||
      getDappOrigin(origin) !== origin
    )
      return;
    if (!isConnected(origin)) {
      delete sessions[origin];
      return;
    }
    const account = getAccount(origin);
    sessions[origin] = {
      activeAddress:
        (host.wallet().isBitcoinBased ? account?.xpub : account?.address) ||
        null,
      approvalOpen: false,
    };
  };
  const validateAccountSelection = (
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext: IDAppAccountSelectionContext
  ) => {
    if (!expectedContext)
      throw new Error('Account selection context is required');
    const wallet = host.wallet(),
      network = wallet.network;
    const account = host.account(accountId, accountType);
    if (!account || !host.isAccountAvailable(account, accountType, network))
      throw new Error('Account is not available on the active network');
    const sameAddress =
      typeof expectedContext.address === 'string' &&
      (wallet.isBitcoinBased
        ? account.address === expectedContext.address
        : account.address.toLowerCase() ===
          expectedContext.address.toLowerCase());
    if (
      !sameAddress ||
      account.xpub !== expectedContext.xpub ||
      network.kind !== expectedContext.network?.kind ||
      network.chainId !== expectedContext.network?.chainId ||
      network.url !== expectedContext.network?.url ||
      network.slip44 !== expectedContext.network?.slip44
    )
      throw new Error(
        'Account context changed. Please select an account again.'
      );
    return { account, network, isBitcoinBased: wallet.isBitcoinBased };
  };
  const publicAccountEvent = (
    origin: string,
    data: DappSessionEvent
  ): DappSessionEvent => {
    if (![ACCOUNT_EVENT, XPUB_EVENT, LOCK_EVENT].includes(data.method))
      return data;
    const wallet = host.wallet(),
      connection = currentConnection(origin),
      account = resolveAccount(connection);
    const unlocked =
      wallet.unlocked &&
      (data.method !== LOCK_EVENT ||
        (data.params as { isUnlocked?: boolean } | null)?.isUnlocked === true);
    const mayDisclose =
      unlocked &&
      connection &&
      account &&
      host.isAccountAvailable(account, connection.accountType, wallet.network);
    const address = mayDisclose ? account.address : null;
    const xpub =
      mayDisclose && wallet.isBitcoinBased ? account.xpub || null : null;
    return {
      method: data.method,
      params:
        data.method === LOCK_EVENT
          ? { isUnlocked: unlocked, accounts: address ? [address] : [], xpub }
          : data.method === ACCOUNT_EVENT
          ? address
            ? [address]
            : []
          : xpub,
    };
  };
  const networkPublicationScope = () => {
    const wallet = host.wallet(),
      network = wallet.network;
    return JSON.stringify([
      wallet.generation,
      network.kind,
      network.chainId,
      network.slip44,
      network.url,
      network.apiUrl,
      wallet.activeSlip44,
      wallet.isBitcoinBased,
    ]);
  };
  const dispatchEvent = async (
    origin: string,
    data: DappSessionEvent,
    id = 'notification',
    isCurrent = () => true
  ) => {
    if (
      !data?.method ||
      data.method === 'undefined' ||
      getDappOrigin(origin) !== origin
    )
      return;
    const scope = NETWORK_EVENTS.has(data.method)
      ? networkPublicationScope()
      : undefined;
    const canDispatch = () =>
      isCurrent() &&
      (scope === undefined || scope === networkPublicationScope());
    let publication: Promise<void> | undefined;
    let finish: (() => void) | undefined;
    try {
      const deliver = await host.resolveDelivery(origin, id);
      if (!deliver || !canDispatch()) return;
      if (scope !== undefined) {
        const previous = networkPublications.get(origin);
        publication = new Promise<void>((resolve) => {
          finish = resolve;
        });
        networkPublications.set(origin, publication);
        await previous;
      }
      if (!canDispatch()) return;
      await deliver(() => publicAccountEvent(origin, data), canDispatch);
    } catch (error) {
      host.reportError('dapp event delivery', error);
    } finally {
      finish?.();
      if (publication && networkPublications.get(origin) === publication)
        networkPublications.delete(origin);
    }
  };
  const disconnectedEvents = (origin: string) => {
    void dispatchEvent(
      origin,
      { method: ACCOUNT_EVENT, params: [] },
      ACCOUNT_EVENT
    );
    void dispatchEvent(
      origin,
      { method: XPUB_EVENT, params: null },
      XPUB_EVENT
    );
  };
  const notifyDisconnected = (origin: string) => {
    host.notifyConnection(origin, false);
    disconnectedEvents(origin);
  };
  const grantAccountPermission = (
    origin: string,
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext: IDAppAccountSelectionContext,
    connectionDetails?: IDApp,
    stageReplacement?: (grant: IDApp) => void
  ) => {
    if (
      origin.length > MAX_DAPP_ORIGIN_LENGTH ||
      getDappOrigin(origin) !== origin
    )
      throw new Error('A complete requesting origin is required');
    const { account, network, isBitcoinBased } = validateAccountSelection(
      accountId,
      accountType,
      expectedContext
    );
    if (
      connectionDetails &&
      (connectionDetails.chain !== network.kind ||
        connectionDetails.chainId !== network.chainId)
    )
      throw new Error('Connection network context changed');
    if (pendingGrants.has(origin))
      throw new Error('A permission grant is already pending for this site');
    const date = connectionDetails?.date ?? host.now(),
      generation = host.wallet().generation;
    const existing = get(origin);
    const grant: IDApp = connectionDetails
      ? { ...connectionDetails }
      : existing?.chain === network.kind
      ? { ...existing, accountId, accountType, date }
      : {
          host: origin,
          accountId,
          accountType,
          date,
          chain: network.kind,
          chainId: network.chainId,
        };
    const { address, xpub } = account,
      slip44 = network.slip44 ?? 57;
    if (isBitcoinBased && (!Number.isSafeInteger(slip44) || !xpub))
      throw new Error('Account reference is not available');
    if (isBitcoinBased) grant.utxoAccount = { slip44, xpub };
    else delete grant.utxoAccount;
    stageReplacement?.(grant);
    const selectedNetwork = { ...network };
    const attempt: NonNullable<ReturnType<typeof pendingGrants.get>> = {
      accountId,
      accountType,
      previous: existing,
    };
    pendingGrants.set(origin, attempt);
    const isCurrent = () => {
      const wallet = host.wallet(),
        current = host.account(accountId, accountType);
      return (
        wallet.generation === generation &&
        pendingGrants.get(origin) === attempt &&
        current?.address === address &&
        current?.xpub === xpub &&
        (!isBitcoinBased || (wallet.network.slip44 ?? 57) === slip44) &&
        host.isAccountAvailable(current, accountType, wallet.network) &&
        (!connectionDetails ||
          (wallet.network.kind === selectedNetwork.kind &&
            wallet.network.chainId === selectedNetwork.chainId &&
            wallet.network.url === selectedNetwork.url &&
            wallet.network.slip44 === selectedNetwork.slip44))
      );
    };
    attempt.isCurrent = isCurrent;
    return commitDappPermissionGrant(
      permissions,
      {
        grant,
        previous: existing,
        isCurrent,
        isSameWallet: () => host.wallet().generation === generation,
        restoredPrevious: () => attempt.restoredPrevious,
        isPreviousRetired: () =>
          existing !== undefined &&
          pendingGrants.get(origin) === attempt &&
          attempt.retiredPrevious === existing,
      },
      (error) => host.reportError('dapp grant marker cleanup', error)
    )
      .finally(host.clearProviderCache)
      .then(() => {
        if (!isCurrent() || get(origin) !== grant)
          throw new Error('Permission grant context changed');
        sessions[origin] ??= { activeAddress: '', approvalOpen: false };
        if (connectionDetails) host.notifyConnection(origin, true);
        sessions[origin].activeAddress = isBitcoinBased
          ? account.xpub
          : account.address;
        if (isBitcoinBased)
          void dispatchEvent(
            origin,
            { method: XPUB_EVENT, params: account.xpub },
            XPUB_EVENT
          );
        void dispatchEvent(
          origin,
          { method: ACCOUNT_EVENT, params: [account.address] },
          ACCOUNT_EVENT
        );
        return { account, network, isBitcoinBased, date };
      })
      .finally(() => {
        if (pendingGrants.get(origin) === attempt) pendingGrants.delete(origin);
      });
  };
  const connect = async (
    grant: IDApp,
    context: IDAppAccountSelectionContext
  ) => {
    await grantAccountPermission(
      grant.host,
      grant.accountId,
      grant.accountType,
      context,
      grant
    );
  };
  const changeAccount = async (
    origin: string,
    accountId: number,
    accountType: KeyringAccountType,
    context: IDAppAccountSelectionContext,
    stageReplacement?: (grant: IDApp) => void
  ) => {
    if (!isConnected(origin))
      throw new Error('Unable to update account. DApp does not exist');
    await grantAccountPermission(
      origin,
      accountId,
      accountType,
      context,
      undefined,
      stageReplacement
    );
  };
  const requestPermissions = (
    origin: string,
    accountId: number,
    accountType: KeyringAccountType,
    context: IDAppAccountSelectionContext
  ) =>
    grantAccountPermission(origin, accountId, accountType, context).then(
      ({ account, network, isBitcoinBased, date }) => {
        const response = [
          {
            id: '1',
            parentCapability: 'eth_accounts',
            invoker: origin,
            caveats: [
              { type: 'restrictReturnedAccounts', value: [account.address] },
            ],
            date,
          },
        ];
        if (!isBitcoinBased)
          response.push({
            id: '2',
            parentCapability: 'endowment:permitted-chains',
            invoker: origin,
            caveats: [
              {
                type: 'restrictNetworkSwitching',
                value: [`0x${network.chainId.toString(16)}`],
              },
            ],
            date,
          });
        return response;
      }
    );
  const captureAccountSessionRetirement = (
    accountId: number,
    accountType: KeyringAccountType
  ) => {
    const generation = host.wallet().generation;
    let retired = false;
    const grants = Object.values(getAll()).filter((grant) =>
      matchesDappAccountIdentity(grant, accountId, accountType)
    );
    return {
      grants,
      retire() {
        if (retired || generation !== host.wallet().generation) return;
        retired = true;
        for (const grant of grants) {
          const origin = grant.host;
          if (get(origin)) continue;
          const attempt = pendingGrants.get(origin);
          if (
            attempt?.previous === grant &&
            (attempt.accountId !== accountId ||
              attempt.accountType !== accountType) &&
            attempt.isCurrent?.()
          )
            attempt.retiredPrevious = grant;
          delete sessions[origin];
          notifyDisconnected(origin);
        }
      },
    };
  };
  const revokeDurably = (
    origin: string,
    allowAlreadyDisconnected: boolean,
    canceledGrant: boolean
  ): Promise<void> => {
    const pending = pendingRevocations.get(origin);
    if (pending?.inFlight) {
      if (canceledGrant || sessions[origin] || get(origin)) {
        const revokeCurrent = () =>
          revokeDurably(origin, allowAlreadyDisconnected, canceledGrant);
        return pending.inFlight.then(revokeCurrent, revokeCurrent);
      }
      return pending.inFlight;
    }
    if (
      !pending &&
      !canceledGrant &&
      !sessions[origin] &&
      !get(origin) &&
      !permissions.read().pendingOrigins.includes(origin)
    ) {
      if (allowAlreadyDisconnected) {
        disconnectedEvents(origin);
        return Promise.resolve();
      }
      return Promise.reject(new Error('DApp not connected'));
    }
    if (!pending && pendingRevocations.size >= MAX_PENDING_REVOCATIONS)
      return Promise.reject(
        new Error('Too many pending revocations; retry an earlier revocation')
      );
    const entry = pending || {},
      previous = get(origin),
      session = sessions[origin];
    const generation = host.wallet().generation;
    const account =
      previous && host.account(previous.accountId, previous.accountType);
    let restored = false;
    const restorePermission = () => {
      const current =
        previous && host.account(previous.accountId, previous.accountType);
      if (
        !previous ||
        !account ||
        pendingRevocations.get(origin) !== entry ||
        generation !== host.wallet().generation ||
        get(origin) ||
        sessions[origin] ||
        current?.address !== account.address ||
        current?.xpub !== account.xpub
      )
        return;
      const approval = pendingGrants.get(origin);
      if (approval && approval.previous === undefined)
        approval.restoredPrevious = previous;
      publishGrant(previous);
      if (session) sessions[origin] = session;
      restored = true;
    };
    pendingRevocations.set(origin, entry);
    entry.inFlight = Promise.resolve()
      .then(() =>
        permissions.exclusive(async () => {
          if (generation !== host.wallet().generation) return;
          permissions.assertWritable();
          const frame = permissions.read();
          const removed = {
            ...frame,
            pendingOrigins: frame.pendingOrigins.filter(
              (value) => value !== origin
            ),
          };
          try {
            await permissions.write(removed);
          } catch (error) {
            restorePermission();
            throw error;
          }
          if (generation !== host.wallet().generation) return;
          permissions.assertWritable();
          const current = permissions.read();
          permissions.publish({
            ...current,
            pendingOrigins: current.pendingOrigins.filter(
              (value) => value !== origin
            ),
          });
        })
      )
      .then(() => {
        if (pendingRevocations.get(origin) !== entry) return;
        if (
          generation === host.wallet().generation &&
          !sessions[origin] &&
          !get(origin)
        )
          notifyDisconnected(origin);
        pendingRevocations.delete(origin);
      })
      .catch((error) => {
        entry.inFlight = undefined;
        if (restored && pendingRevocations.get(origin) === entry)
          pendingRevocations.delete(origin);
        throw error;
      });
    if (sessions[origin] || get(origin)) {
      delete sessions[origin];
      removeGrant(origin);
    }
    return entry.inFlight;
  };
  const revoke = (
    origin: string,
    options: Readonly<{ allowAlreadyDisconnected: boolean }>
  ) => {
    if (typeof options?.allowAlreadyDisconnected !== 'boolean')
      return Promise.reject(
        new TypeError('Explicit revocation options are required')
      );
    return revokeDurably(
      origin,
      options.allowAlreadyDisconnected,
      pendingGrants.delete(origin)
    );
  };
  /** The caller includes this synchronous revocation in its existing durable wallet transaction. */
  const retireForTransaction = (origin: string) => {
    const canceledGrant = pendingGrants.delete(origin);
    if (!canceledGrant && !sessions[origin] && !get(origin))
      throw new Error('DApp not connected');
    delete sessions[origin];
    removeGrant(origin);
    notifyDisconnected(origin);
  };
  const handleStateChange = async (id: string, data: DappSessionEvent) => {
    if (!data?.method || data.params === undefined) return;
    if (id === 'pali_addProperty' || id === 'pali_removeProperty') {
      await host.providerAvailability(id);
      return;
    }
    const origins = new Set(Object.keys(sessions));
    if (
      id === 'pali_chainChanged' ||
      id === 'pali_isBitcoinBased' ||
      (id === LOCK_EVENT &&
        (data.params as { isUnlocked?: boolean } | null)?.isUnlocked === false)
    )
      for (const origin of pendingRevocations.keys()) origins.add(origin);
    for (const origin of origins) void dispatchEvent(origin, data, id);
  };
  const handleBlockExplorerChange = async (
    id: string,
    data: DappSessionEvent
  ) => {
    for (const origin of Object.keys(sessions))
      void dispatchEvent(origin, data, id);
  };
  const resetSessions = async (previousOrigins: string[]) => {
    const generation = host.wallet().generation;
    const origins = new Set([...previousOrigins, ...Object.keys(sessions)]);
    pendingGrants.clear();
    for (const origin of Object.keys(sessions)) delete sessions[origin];
    await Promise.all(
      Array.from(origins, async (origin) => {
        for (const [method, params] of [
          [LOCK_EVENT, { isUnlocked: false }],
          [ACCOUNT_EVENT, []],
          [XPUB_EVENT, null],
        ] as const)
          await dispatchEvent(
            origin,
            { method, params },
            method,
            () => generation === host.wallet().generation && !get(origin)
          );
      })
    );
  };
  return {
    setup,
    connect,
    requestPermissions,
    changeAccount,
    revoke,
    retireForTransaction,
    captureAccountSessionRetirement,
    resetSessions,
    handleStateChange,
    handleBlockExplorerChange,
    get,
    getAll,
    getAccount,
    isConnected,
    hasApproval: (origin: string) => sessions[origin]?.approvalOpen ?? false,
    setApprovalOpen: (origin: string, open: boolean) => {
      const session = sessions[origin];
      if (!session) throw new Error('DApp not connected');
      session.approvalOpen = open;
    },
  };
}
