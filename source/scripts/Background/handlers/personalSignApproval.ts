import { ethErrors } from 'helpers/errors';

import { isRequestDocumentLive } from '../controllers/message-handler/request-lifetime';
import type { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { INetworkType } from 'types/network';
import { createDappApprovalLifetime } from 'utils/dappApprovalLifetime';
import { getDappOrigin } from 'utils/dappOrigin';
import { getPersonalSignParams } from 'utils/personalSignReview';

import type { IEnhancedRequestContext } from '../controllers/message-handler/types';

export const personalSignApprovalExpired = () =>
  ethErrors.provider.userRejectedRequest(
    'This site approval is no longer current. Request it again.'
  );

const grantReplacements = new WeakMap<AbortSignal, (grant: IDApp) => void>();

export const getPersonalSignGrantReplacement = (signal?: AbortSignal) =>
  signal && grantReplacements.get(signal);

/** Keep the original grant across both existing queues, including reexecution. */
export const watchConnectedPersonalSignGrant = ({
  host,
  method,
  sender,
  signal,
}: IEnhancedRequestContext['originalRequest']) => {
  if (
    method !== 'personal_sign' ||
    !sender?.documentId ||
    getDappOrigin(sender.url || '') !== host ||
    getPersonalSignGrantReplacement(signal)
  )
    return;
  const state = store.getState();
  let grant = state.dapp.dapps[host];
  if (
    grant?.chain !== INetworkType.Ethereum ||
    state.vault.activeNetwork.kind !== INetworkType.Ethereum
  )
    return;

  let successor: IDApp | undefined;
  const lifetime = createDappApprovalLifetime(() => {
    const current = store.getState().dapp.dapps[host];
    // Only the exact replacement staged by this request's approved durable
    // account selection may continue it. Removal or any other write retires it.
    if (successor && current === successor) {
      grant = successor;
      successor = undefined;
    }
    return current === grant;
  }, signal);
  const unsubscribe = store.subscribe(lifetime.isCurrent);
  grantReplacements.set(lifetime.signal, (next) => {
    if (!lifetime.isCurrent()) throw personalSignApprovalExpired();
    successor = next;
  });
  return {
    signal: lifetime.signal,
    dispose() {
      unsubscribe();
      grantReplacements.delete(lifetime.signal);
      lifetime.dispose();
    },
  };
};

export const capturePersonalSignApproval = ({
  host,
  params,
  sender,
  signal,
  getWalletSessionGeneration,
}: {
  getWalletSessionGeneration: () => number;
  host: string;
  params: Parameters<typeof getPersonalSignParams>[0];
  sender?: chrome.runtime.MessageSender;
  signal?: AbortSignal;
}) => {
  if (
    sender?.tab?.id === undefined ||
    !sender.documentId ||
    getDappOrigin(sender.url || '') !== host
  )
    throw personalSignApprovalExpired();

  const { dapp, vault } = store.getState();
  const grant = dapp.dapps[host];
  const { activeAccount, accounts, activeNetwork } = vault;
  const { id, type } = activeAccount;
  const { address, xpub } = accounts[type]?.[id] ?? {};
  const { chainId, url, slip44 } = activeNetwork;
  if (
    grant?.chain !== INetworkType.Ethereum ||
    grant.accountId !== id ||
    grant.accountType !== type ||
    !address
  )
    throw personalSignApprovalExpired();

  const generation = getWalletSessionGeneration();
  const request = getPersonalSignParams(params);
  const lifetime = createDappApprovalLifetime(() => {
    const state = store.getState();
    const current = state.vault;
    const account = current.accounts[type]?.[id];
    const network = current.activeNetwork;
    return (
      state.dapp.dapps[host] === grant &&
      current.activeAccount.id === id &&
      current.activeAccount.type === type &&
      account?.address === address &&
      account.xpub === xpub &&
      !current.isBitcoinBased &&
      network.kind === INetworkType.Ethereum &&
      network.chainId === chainId &&
      network.url === url &&
      network.slip44 === slip44 &&
      getWalletSessionGeneration() === generation
    );
  }, signal);
  // Observe removal before a failed durable revoke can restore the same grant.
  const unsubscribe = store.subscribe(lifetime.isCurrent);
  const assertCurrent = () => {
    if (!lifetime.isCurrent()) throw personalSignApprovalExpired();
  };

  return {
    signal: lifetime.signal,
    isCurrent: lifetime.isCurrent,
    retire: lifetime.retire,
    assertCurrent,
    async checkDocument(approverIsLive: () => Promise<boolean>) {
      assertCurrent();
      const siteIsLive = await isRequestDocumentLive(sender);
      assertCurrent();
      // A same-URL reload can retire the approver while the site probe waits.
      if (!siteIsLive || !(await approverIsLive())) {
        lifetime.retire();
        throw personalSignApprovalExpired();
      }
      assertCurrent();
    },
    matches(args: unknown) {
      return (
        request !== undefined &&
        request.address.toLowerCase() === address.toLowerCase() &&
        Array.isArray(args) &&
        args.length === 1 &&
        args[0]?.[0] === request.address &&
        args[0]?.[1] === request.message
      );
    },
    dispose() {
      unsubscribe();
      lifetime.dispose();
    },
  };
};

type PersonalSignApproval = ReturnType<typeof capturePersonalSignApproval>;
const approvals = new Map<
  string,
  { approval: PersonalSignApproval; approverIsLive: () => Promise<boolean> }
>();

/** Only a Chrome-authenticated approval document can be bound by the popup. */
export const bindPersonalSignApproval = (
  documentId: string,
  approval: PersonalSignApproval,
  approverIsLive: () => Promise<boolean>
) => {
  const binding = { approval, approverIsLive };
  approvals.set(documentId, binding);
  return () => {
    if (approvals.get(documentId) === binding) approvals.delete(documentId);
  };
};

export const requirePersonalSignApproval = (
  sender: chrome.runtime.MessageSender,
  methods: unknown,
  args: unknown
) => {
  if (
    !Array.isArray(methods) ||
    methods.length !== 3 ||
    methods[0] !== 'wallet' ||
    methods[1] !== 'ethereumTransaction' ||
    methods[2] !== 'signPersonalMessage'
  )
    return undefined;
  const binding = sender.documentId && approvals.get(sender.documentId);
  if (!binding || !binding.approval.matches(args))
    throw personalSignApprovalExpired();
  const { approval, approverIsLive } = binding;
  approval.assertCurrent();
  return {
    assertCurrent: approval.assertCurrent,
    checkDocument: () => approval.checkDocument(approverIsLive),
  };
};
