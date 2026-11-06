import { ethErrors } from 'helpers/errors';

import { isRequestDocumentLive } from '../controllers/message-handler/request-lifetime';
import type { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { createDappApprovalLifetime } from 'utils/dappApprovalLifetime';
import { getDappOrigin } from 'utils/dappOrigin';
import {
  getPersonalSignParams,
  isValidPersonalSignMessage,
} from 'utils/personalSignReview';
import {
  getPaliErc7739PersonalSignHash,
  hashPersonalSignMessage,
} from 'utils/smartAccount/erc7739';
import { getInstalledValidatorModuleByAddress } from 'utils/smartAccount/modules';

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
  const parsed = getPersonalSignParams(params);
  const request =
    parsed?.address.toLowerCase() === address.toLowerCase()
      ? parsed
      : undefined;
  const signerChecks = new Map<
    string,
    (currentAccounts: typeof accounts) => boolean
  >();
  const lifetime = createDappApprovalLifetime(() => {
    const state = store.getState();
    const current = state.vault;
    const account = current.accounts[type]?.[id];
    const network = current.activeNetwork;
    for (const isCurrent of signerChecks.values())
      if (!isCurrent(current.accounts)) return false;
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
  const assertLiveDocument = (live: boolean) => {
    if (!live) lifetime.retire();
    assertCurrent();
  };

  return {
    signal: lifetime.signal,
    isCurrent: lifetime.isCurrent,
    retire: lifetime.retire,
    assertCurrent,
    async checkDocument(
      approverIsLive: () => Promise<boolean>,
      recheckSite?: true
    ) {
      assertCurrent();
      assertLiveDocument(await isRequestDocumentLive(sender));
      // A same-URL reload can retire the approver while the site probe waits.
      assertLiveDocument(await approverIsLive());
      // A requesting iframe can disappear while the approver probe waits.
      if (recheckSite) assertLiveDocument(await isRequestDocumentLive(sender));
    },
    matches(args: unknown) {
      return (
        request !== undefined &&
        Array.isArray(args) &&
        args.length === 1 &&
        args[0]?.[0] === request.address &&
        args[0]?.[1] === request.message
      );
    },
    bindSmartAccountSigner(args: unknown) {
      if (
        type !== KeyringAccountType.SmartAccount ||
        !request ||
        !isValidPersonalSignMessage(request.message) ||
        !Array.isArray(args) ||
        args.length !== 3
      )
        return;

      const [selectedSigner, activeValidator, signerValidator] = args;
      if (
        typeof activeValidator !== 'string' ||
        typeof signerValidator !== 'string'
      )
        return;

      const currentAccounts = store.getState().vault.accounts;
      const currentAccount = currentAccounts[type]?.[id];
      const metadata = currentAccount?.isSmartAccount
        ? currentAccount.smartAccount
        : undefined;
      // Require the exact hydrated active address, including for a composite.
      if (
        metadata?.chainId !== chainId ||
        metadata.auth?.validator?.toLowerCase() !==
          activeValidator.toLowerCase()
      )
        return;

      const active = getInstalledValidatorModuleByAddress(
        metadata,
        activeValidator
      );
      const signer = signerValidator.toLowerCase();
      const validator =
        signer === active?.address.toLowerCase()
          ? active
          : active?.id === 'composite' &&
            active.config.childValidators.some(
              (child) => child.toLowerCase() === signer
            ) &&
            getInstalledValidatorModuleByAddress(metadata, signer);
      if (!validator) return;

      const getDigest = () =>
        getPaliErc7739PersonalSignHash({
          accountAddress: address,
          chainId,
          hash: hashPersonalSignMessage(request.message),
        });
      const hasMetadata = (next: typeof accounts) => {
        const account = next[type]?.[id];
        return account?.isSmartAccount && account.smartAccount === metadata;
      };
      if (validator.id === 'slh-dsa') {
        const { keyId, parameterSet, pkRoot, pkSeed } = validator.config;
        if (selectedSigner !== keyId) return;
        const actionHash = getDigest();
        signerChecks.set('slh-dsa', hasMetadata);
        return {
          method: 'signSLHDSAActionHash' as const,
          args: [
            { accountId: id, actionHash, keyId, parameterSet, pkRoot, pkSeed },
          ],
        };
      }

      const owner = selectedSigner;
      if (
        validator.id !== 'ecdsa' ||
        typeof owner?.address !== 'string' ||
        !Number.isSafeInteger(owner.id) ||
        owner.id < 0 ||
        (owner.type !== KeyringAccountType.HDAccount &&
          owner.type !== KeyringAccountType.Imported)
      )
        return;
      const { id: ownerId, type: ownerType } = owner;
      const ownerAddress = owner.address.toLowerCase();
      const currentOwner = currentAccounts[ownerType]?.[ownerId];
      if (
        currentOwner?.address?.toLowerCase() !== ownerAddress ||
        !validator.config.owners.some(
          (configured) => configured.toLowerCase() === ownerAddress
        )
      )
        return;

      const digest = getDigest();
      // A change to this hydrated validator or owner retires the whole
      // approval, including composite siblings already in flight.
      signerChecks.set(`${ownerType}:${ownerId}`, (next) => {
        const current = next[ownerType]?.[ownerId];
        return (
          hasMetadata(next) &&
          current?.address === currentOwner.address &&
          current.xpub === currentOwner.xpub
        );
      });
      return {
        method: 'signSmartAccountActionDigestInternal' as const,
        args: [
          [currentOwner.address, digest],
          { id: ownerId, type: ownerType },
          undefined,
        ],
      };
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
  if (!Array.isArray(methods) || methods[0] !== 'wallet') return undefined;
  const smartAccount =
    methods.length === 2 && methods[1] === 'signSmartAccountPersonalDigest';
  if (
    !smartAccount &&
    (methods.length !== 3 ||
      methods[1] !== 'ethereumTransaction' ||
      methods[2] !== 'signPersonalMessage')
  )
    return undefined;
  const binding = sender.documentId && approvals.get(sender.documentId);
  if (!binding) throw personalSignApprovalExpired();
  const { approval, approverIsLive } = binding;
  approval.assertCurrent();
  const signer = smartAccount
    ? approval.bindSmartAccountSigner(args)
    : undefined;
  if (smartAccount ? !signer : !approval.matches(args))
    throw personalSignApprovalExpired();
  return {
    signer,
    assertCurrent: approval.assertCurrent,
    checkDocument: (recheckSite?: true) =>
      approval.checkDocument(approverIsLive, recheckSite),
  };
};
