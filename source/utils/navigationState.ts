/** Bounded, public browsing snapshots. Signing and secret-entry flows never resume. */
import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';

import store from '../state/store';

import { chromeStorage } from './storageAPI';

export interface IWalletNavigationScope {
  account: string;
  network: string;
}
export interface INavigationContext {
  returnContext?: INavigationContext;
  returnRoute: string;
  scrollPosition?: number;
  scrollPositions?: Record<string, number>;
  state?: Record<string, any>;
  tab?: string;
  walletScope?: IWalletNavigationScope;
}
export interface ISavedNavigationState {
  currentPath: string;
  returnContext?: INavigationContext;
  scrollPosition?: number;
  scrollPositions?: Record<string, number>;
  state?: Record<string, any>;
  tab?: string;
  timestamp: number;
  version: 2;
  walletScope: IWalletNavigationScope;
}
const NAVIGATION_STATE_KEY = 'pali_navigation_state';
let navigationWriteGeneration = 0;
const NAVIGATION_STORAGE_LOCK = 'pali-navigation-storage';
const withNavigationStorageLock = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  // Web Locks coordinates the popup and MV3 worker. Older runtimes retain only
  // the local generation guard; it cannot synchronize separate documents.
  return locks?.request
    ? await locks.request(
        NAVIGATION_STORAGE_LOCK,
        { mode: 'exclusive' },
        operation
      )
    : await operation();
};
const MAX_BYTES = 32 * 1024;
const MAX_CONTEXTS = 12;
const BROWSING_ROUTES = new Set([
  '/home',
  '/home/details',
  '/home/smart-account',
  '/tokens/add',
  '/receive',
  '/faucet',
  '/settings/about',
  '/settings/advanced',
  '/settings/languages',
  '/settings/currency',
  '/settings/manage-accounts',
  '/settings/edit-account',
  '/settings/account/smart-account-policy',
  '/settings/networks/connected-sites',
  '/settings/networks/custom-rpc',
  '/settings/networks/edit',
  '/settings/networks/trusted-sites',
  '/settings/remove-eth',
]);
const DRAFT_ROUTES = new Set(['/send/eth', '/send/sys']);
export type NavigationPersistencePolicy =
  | 'save-browsing'
  | 'form-owned-draft'
  | 'save-confirmation-caller'
  | 'discard';

/** One policy owns which public view may survive a main-popup document. */
export const getNavigationPersistencePolicy = (
  path: string
): NavigationPersistencePolicy => {
  const safePath = safeWalletPath(path);
  if (!safePath) return 'discard';
  const query = new URL(path, 'https://wallet.invalid').searchParams;
  if (query.has('route') || query.has('externalRoute')) return 'discard';
  const pathname = safePath.split(/[?#]/)[0];
  if (BROWSING_ROUTES.has(pathname)) return 'save-browsing';
  if (DRAFT_ROUTES.has(pathname)) return 'form-owned-draft';
  if (pathname === '/send/confirm') return 'save-confirmation-caller';
  return 'discard';
};
const record = (value: any): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const scalar = (value: any) =>
  typeof value === 'boolean' ||
  (typeof value === 'string' && value.length <= 2048) ||
  (typeof value === 'number' && Number.isFinite(value));
const pick = (value: any, keys: string[]) => {
  const result: Record<string, any> = {};
  if (record(value))
    for (const key of keys) if (scalar(value[key])) result[key] = value[key];
  return result;
};
const PUBLIC_ASSET_FIELDS = [
  'id',
  'assetGuid',
  'assetType',
  'contractAddress',
  'contract',
  'chainId',
  'decimals',
  'balance',
  'rawBalance',
  'isNft',
  'logo',
  'name',
  'tokenId',
  'tokenStandard',
  'tokenSymbol',
  'symbol',
  'image',
  'type',
  'originDecimals',
  'maxSupply',
  'totalSupply',
];
const BOOLEAN_KEYS = new Set([
  'open',
  'isCoinSelected',
  'hasMoreServer',
  'isDefault',
  'isEditing',
  'RBF',
  'isMaxSend',
  'isNft',
  'nftCollection',
]);
const COUNT_KEYS = new Set([
  'tokensVisibleCount',
  'nftsVisibleCount',
  'sptVisibleCount',
  'visibleCount',
]);
const STRING_KEYS = new Set([
  'hash',
  'search',
  'searchValue',
  'sortByValue',
  'selectedTokenId',
  'manualTokenId',
  'cacheKey',
  'trustedSitesSearch',
  'tokenImportScope',
  'customContractAddress',
  'customTokenId',
  'customAssetGuid',
  'selectedNftTokenId',
  'network',
  'receiver',
  'amount',
  'nftTokenId',
]);
const boundedPick = (input: any, keys: string[]) => {
  const result = pick(input, keys);
  for (const key of Object.keys(result)) {
    if (STRING_KEYS.has(key) && typeof result[key] !== 'string') {
      delete result[key];
      continue;
    }
    if (key === 'cacheKey' && !result[key]) {
      delete result[key];
      continue;
    }
    if (BOOLEAN_KEYS.has(key) && typeof result[key] !== 'boolean')
      delete result[key];
    if (COUNT_KEYS.has(key))
      result[key] =
        typeof result[key] === 'number'
          ? Math.min(2000, Math.max(50, Math.floor(result[key])))
          : 50;
    if (
      ['nextPage', 'restoreThroughPage'].includes(key) &&
      (typeof result[key] !== 'number' ||
        !Number.isInteger(result[key]) ||
        result[key] < 2 ||
        result[key] > 10_000)
    )
      delete result[key];
  }
  return result;
};
const UI_KEYS = [
  'tab',
  'isCoinSelected',
  'searchValue',
  'sortByValue',
  'tokensVisibleCount',
  'nftsVisibleCount',
  'sptVisibleCount',
  'cacheKey',
  'hasMoreServer',
  'nextPage',
  'visibleCount',
  'restoreThroughPage',
  'selectedTokenId',
  'manualTokenId',
];
const SCALAR_KEYS = [
  'id',
  'hash',
  'nftCollection',
  'tab',
  'isCoinSelected',
  'searchValue',
  'sortByValue',
  'customContractAddress',
  'customTokenId',
  'customAssetGuid',
  'tokenImportScope',
  'manageAccountsScrollTop',
  'manageNetworksScrollTop',
  'scrollPosition',
  'trustedSitesSearch',
  'accountType',
  'chain',
  'isDefault',
  'isEditing',
  'smartAccountPolicyView',
  'policyParentScroll',
];

let lastScopeInputs = '';
let lastScope: IWalletNavigationScope;

/** Endpoint fingerprints include API credentials without storing their plaintext. */
export const getWalletNavigationScope = (): IWalletNavigationScope => {
  const state = store.getState();
  const vault = state.vault;
  const ref = vault?.activeAccount;
  const account = ref && vault.accounts?.[ref.type]?.[ref.id];
  const network = vault?.activeNetwork;
  const accountIdentity = JSON.stringify([
    ref?.type,
    ref?.id,
    account?.address,
    account?.xpub,
  ]);
  const networkIdentity = JSON.stringify([
    network?.kind,
    network?.chainId,
    network?.slip44,
    state.vaultGlobal?.activeSlip44,
    network?.url,
    network?.apiUrl,
  ]);
  const inputs = accountIdentity + networkIdentity;
  if (inputs !== lastScopeInputs) {
    lastScopeInputs = inputs;
    lastScope = Object.freeze({
      account: keccak256(toUtf8Bytes(accountIdentity)),
      network: keccak256(toUtf8Bytes(networkIdentity)),
    });
  }
  return lastScope;
};
export const isRestorableWalletRoute = (path: string) => {
  const pathname = safeWalletPath(path)?.split(/[?#]/)[0];
  return Boolean(
    pathname && (BROWSING_ROUTES.has(pathname) || DRAFT_ROUTES.has(pathname))
  );
};
/** Only local routes and browsing query parameters can enter a return chain. */
export const safeWalletPath = (path: any): string | null => {
  if (
    typeof path !== 'string' ||
    path.length > 2048 ||
    !/^\/[\w/-]*(?:[?#].*)?$/.test(path) ||
    path.startsWith('//')
  )
    return null;
  const url = new URL(path, 'https://wallet.invalid');
  const params = new URLSearchParams();
  for (const key of ['tab', 'view']) {
    const value = url.searchParams.get(key);
    if (value && /^[\w-]{1,64}$/.test(value)) params.set(key, value);
  }
  const hash = /^#[\w-]{1,64}$/.test(url.hash) ? url.hash : '';
  return url.pathname + (params.toString() ? `?${params}` : '') + hash;
};
export const withNavigationTab = (path: string, tab?: string) => {
  const url = new URL(path, 'https://wallet.invalid');
  if (tab && /^[\w-]{1,64}$/.test(tab)) url.searchParams.set('tab', tab);
  return `${url.pathname}${url.search}${url.hash}`;
};
const scrollNumber = (n: any) =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000_000;
const sanitizeScroll = (value: any) => {
  const result: Record<string, number> = {};
  if (record(value))
    for (const [key, n] of Object.entries(value).slice(0, 20))
      if (/^[\w-]{1,64}$/.test(key) && scrollNumber(n)) result[key] = n;
  return result;
};
export const captureNavigationScroll = (): Record<string, number> => {
  const positions: Record<string, number> = {};
  if (typeof document !== 'undefined')
    document
      .querySelectorAll<HTMLElement>('[data-navigation-scroll]')
      .forEach((el) => {
        const key = el.dataset.navigationScroll;
        if (
          key &&
          scrollNumber(el.scrollTop) &&
          Object.keys(positions).length < 20
        )
          positions[key] = el.scrollTop;
      });
  return positions;
};

/** Pick known public fields rather than recursively copying arbitrary route payloads. */
export const sanitizeBrowsingState = (
  path: string,
  input: any
): Record<string, any> => {
  const pathname = path.split(/[?#]/)[0];
  const state = DRAFT_ROUTES.has(pathname)
    ? {}
    : boundedPick(input, SCALAR_KEYS);
  if (pathname === '/home/details' && input?.isImportPreview === true)
    Object.assign(
      state,
      pick(input, [...PUBLIC_ASSET_FIELDS, 'isImportPreview'])
    );
  for (const key of ['homeAssets', 'homeActivity', 'nftView']) {
    const saved = input?.[key];
    if (
      record(saved) &&
      typeof saved.scope === 'string' &&
      saved.scope.length <= 2048
    )
      state[key] = {
        scope: saved.scope,
        value: boundedPick(saved.value, UI_KEYS),
      };
  }
  if (record(input?.smartAccountPicker))
    state.smartAccountPicker = boundedPick(input.smartAccountPicker, [
      'open',
      'search',
      'visibleCount',
      'scrollTop',
      'network',
    ]);
  if (record(input?.policyParentScrollPositions))
    state.policyParentScrollPositions = sanitizeScroll(
      input.policyParentScrollPositions
    );
  if (record(input?.selected))
    state.selected = pick(input.selected, ['chainId', 'key', 'kind']);
  if (record(input?.nftData))
    state.nftData = pick(input.nftData, PUBLIC_ASSET_FIELDS);
  if (DRAFT_ROUTES.has(pathname)) {
    state.formValues = boundedPick(input?.formValues, [
      'receiver',
      'amount',
      'nftTokenId',
    ]);
    if (record(input?.selectedAsset))
      state.selectedAsset = pick(input.selectedAsset, PUBLIC_ASSET_FIELDS);
    Object.assign(
      state,
      boundedPick(input, ['RBF', 'isMaxSend', 'selectedNftTokenId'])
    );
    // Verification/balance results are deliberately re-read by the send flow.
  }
  return state;
};
const sameScope = (saved: any, current: IWalletNavigationScope) =>
  record(saved) &&
  saved.account === current.account &&
  saved.network === current.network;
const ACCOUNT_INDEPENDENT = new Set([
  '/settings/about',
  '/settings/advanced',
  '/settings/languages',
  '/settings/currency',
  '/settings/manage-accounts',
  '/settings/edit-account',
  '/settings/networks/connected-sites',
  '/settings/networks/edit',
  '/settings/networks/custom-rpc',
  '/settings/networks/trusted-sites',
  '/settings/remove-eth',
]);
const sanitizedContext = (
  input: any,
  current: IWalletNavigationScope,
  depth = 0
): INavigationContext | undefined => {
  if (!record(input) || depth >= MAX_CONTEXTS) return undefined;
  const route = safeWalletPath(input.returnRoute);
  if (!route || !isRestorableWalletRoute(route)) return undefined;
  const pathname = route.split(/[?#]/)[0];
  const matches = sameScope(input.walletScope, current);
  if (DRAFT_ROUTES.has(pathname) && !matches) return undefined;
  // Choosing an account changes identity; returning to the chooser never switches it back.
  const pickerMatches =
    pathname === '/home/smart-account' &&
    input.state?.smartAccountPicker?.network === current.network;
  const keepState = matches || ACCOUNT_INDEPENDENT.has(pathname);
  const state = keepState
    ? sanitizeBrowsingState(route, input.state)
    : pickerMatches
    ? {
        smartAccountPicker: boundedPick(input.state.smartAccountPicker, [
          'open',
          'search',
          'visibleCount',
          'scrollTop',
          'network',
        ]),
      }
    : {};
  return {
    returnRoute: route,
    tab: pick(input, ['tab']).tab,
    state,
    scrollPosition:
      keepState && scrollNumber(input.scrollPosition)
        ? input.scrollPosition
        : 0,
    scrollPositions:
      keepState || pickerMatches ? sanitizeScroll(input.scrollPositions) : {},
    walletScope: current,
    returnContext: sanitizedContext(input.returnContext, current, depth + 1),
  };
};

/** A finished or uncertain action may resume its public caller, never a Send draft. */
export const getTransactionReturnContext = (
  input: any,
  current = getWalletNavigationScope()
): INavigationContext | undefined => {
  const keepPublic = (
    context: INavigationContext | undefined
  ): INavigationContext | undefined => {
    if (!context) return undefined;
    const parent = keepPublic(context.returnContext);
    return DRAFT_ROUTES.has(context.returnRoute.split(/[?#]/)[0])
      ? parent
      : { ...context, returnContext: parent };
  };
  return keepPublic(sanitizedContext(input, current));
};

/** An idle internal review resumes its unsigned caller, rather than its transaction. */
export const getConfirmationReturnContext = (
  state: any,
  current = getWalletNavigationScope()
): INavigationContext | undefined => {
  if (
    !record(state) ||
    state.external === true ||
    !sameScope(state.walletScope, current)
  )
    return undefined;
  // Missing or malformed markers cannot prove that a submission never began.
  return state.submissionStarted === false && record(state.tx)
    ? sanitizedContext(state.returnContext, current)
    : getTransactionReturnContext(state.returnContext, current);
};

export const createNavigationContext = (
  returnRoute: string,
  tab?: string,
  state?: Record<string, any>,
  returnContext?: INavigationContext
): INavigationContext => ({
  returnRoute,
  tab,
  state: sanitizeBrowsingState(returnRoute, state),
  returnContext,
  scrollPosition: typeof window === 'undefined' ? 0 : window.scrollY || 0,
  scrollPositions: captureNavigationScroll(),
  walletScope: getWalletNavigationScope(),
});
export const createBrowsingNavigationContext = (
  location: { hash?: string; pathname: string; search?: string; state?: any },
  extra?: Record<string, any>
) =>
  createNavigationContext(
    `${location.pathname}${location.search || ''}${location.hash || ''}`,
    undefined,
    { ...location.state, ...extra },
    location.state?.returnContext
  );

const createSavedNavigationState = (
  path: string,
  tab?: string,
  state?: Record<string, any>,
  returnContext?: INavigationContext,
  scroll?: Pick<INavigationContext, 'scrollPosition' | 'scrollPositions'>
): ISavedNavigationState => {
  const scope = getWalletNavigationScope();
  return {
    currentPath: withNavigationTab(safeWalletPath(path)!, tab),
    state: sanitizeBrowsingState(path, state),
    returnContext: sanitizedContext(returnContext, scope),
    scrollPosition: scroll
      ? scrollNumber(scroll.scrollPosition)
        ? scroll.scrollPosition
        : 0
      : typeof window === 'undefined'
      ? 0
      : window.scrollY || 0,
    scrollPositions: scroll
      ? sanitizeScroll(scroll.scrollPositions)
      : captureNavigationScroll(),
    timestamp: Date.now(),
    version: 2,
    walletScope: scope,
  };
};
const saveNavigationStateUnlocked = async (snapshot: ISavedNavigationState) => {
  if (JSON.stringify(snapshot).length > MAX_BYTES)
    throw new Error('Navigation snapshot exceeds its storage limit');
  await chromeStorage.setItem(NAVIGATION_STATE_KEY, snapshot);
};
const clearNavigationStateUnlocked = async () => {
  await chromeStorage.removeItem(NAVIGATION_STATE_KEY);
};

export const saveNavigationState = async (
  path: string,
  tab?: string,
  state?: Record<string, any>,
  returnContext?: INavigationContext,
  scroll?: Pick<INavigationContext, 'scrollPosition' | 'scrollPositions'>
): Promise<void> => {
  if (!isRestorableWalletRoute(path)) return;
  const generation = ++navigationWriteGeneration;
  try {
    // Capture values and their wallet before waiting behind another document.
    const snapshot = createSavedNavigationState(
      path,
      tab,
      state,
      returnContext,
      scroll
    );
    await withNavigationStorageLock(async () => {
      if (
        generation !== navigationWriteGeneration ||
        !sameScope(snapshot.walletScope, getWalletNavigationScope())
      )
        return;
      await saveNavigationStateUnlocked(snapshot);
    });
  } catch {
    /* Closing a popup or storage failure must not block navigation. */
  }
};
export const clearNavigationState = async (): Promise<void> => {
  ++navigationWriteGeneration;
  try {
    // Auth cleanup always runs; a queued save must never cancel it.
    await withNavigationStorageLock(clearNavigationStateUnlocked);
  } catch {
    /* non-fatal */
  }
};

/** Preserve a review's safe caller without ever serializing the review payload. */
export const saveConfirmationReturnState = async (
  state: any
): Promise<void> => {
  const context = getConfirmationReturnContext(state);
  if (!context) {
    await clearNavigationState();
    return;
  }
  await saveNavigationState(
    context.returnRoute,
    context.tab,
    context.state,
    context.returnContext,
    context
  );
};

/** Transaction cleanup must not erase an unrelated public Settings/caller view. */
export const clearTransactionNavigationState = async (
  options: { assertCurrent?: () => boolean; requireDiscard?: boolean } = {}
): Promise<void> => {
  const strict = options.requireDiscard === true;
  const generation = strict
    ? ++navigationWriteGeneration
    : navigationWriteGeneration;
  const startingScope = getWalletNavigationScope();
  const ownsSnapshot = () => {
    const current =
      sameScope(startingScope, getWalletNavigationScope()) &&
      (strict && options.assertCurrent
        ? options.assertCurrent()
        : generation === navigationWriteGeneration);
    if (!current && strict)
      throw new Error('Navigation cleanup context changed');
    return current;
  };
  try {
    await withNavigationStorageLock(async () => {
      if (!ownsSnapshot()) return;
      const saved = await loadNavigationStateUnlocked(
        generation,
        startingScope,
        { strict, ignoreGeneration: strict && Boolean(options.assertCurrent) }
      );
      // A newer navigation or an authentication cleanup owns the snapshot now.
      if (!ownsSnapshot()) return;
      if (!saved) {
        // Missing/invalid records need no second removal, and a transient read
        // failure must not erase a public view another document already saved.
        return;
      }
      let contextWithDraft: INavigationContext | undefined = {
        returnRoute: saved.currentPath,
        returnContext: saved.returnContext,
      };
      let containsDraft = false;
      while (contextWithDraft) {
        if (DRAFT_ROUTES.has(contextWithDraft.returnRoute.split(/[?#]/)[0])) {
          containsDraft = true;
          break;
        }
        contextWithDraft = contextWithDraft.returnContext;
      }
      // Ordinary public browsing already satisfies cleanup. Preserve its timestamp
      // and avoid a background read/write roundtrip racing the popup's next view.
      if (!containsDraft) return;
      const context = getTransactionReturnContext({
        returnRoute: saved.currentPath,
        tab: saved.tab,
        state: saved.state,
        returnContext: saved.returnContext,
        scrollPosition: saved.scrollPosition,
        scrollPositions: saved.scrollPositions,
        walletScope: saved.walletScope,
      });
      if (!context) {
        if (!strict) ++navigationWriteGeneration;
        await clearNavigationStateUnlocked();
        return;
      }
      // Strict cleanup took ownership when requested. Do not invalidate a later
      // legitimate marker/view save already waiting behind this shared lock.
      if (!strict) ++navigationWriteGeneration;
      await saveNavigationStateUnlocked(
        createSavedNavigationState(
          context.returnRoute,
          context.tab,
          context.state,
          context.returnContext,
          context
        )
      );
    });
  } catch (error) {
    if (strict) throw error;
    /* Closing a popup or storage failure must not block transaction cleanup. */
  }
};
const loadNavigationStateUnlocked = async (
  generation: number,
  startingScope: IWalletNavigationScope,
  options: { ignoreGeneration?: boolean; strict?: boolean } = {}
): Promise<ISavedNavigationState | null> => {
  try {
    const saved = await chromeStorage.getItem(NAVIGATION_STATE_KEY);
    if (
      (!options.ignoreGeneration && generation !== navigationWriteGeneration) ||
      !sameScope(startingScope, getWalletNavigationScope())
    ) {
      if (options.strict) throw new Error('Navigation cleanup context changed');
      return null;
    }
    const autolock = store.getState().vaultGlobal?.advancedSettings?.autolock;
    const timeout =
      (typeof autolock === 'number' && autolock > 0 ? autolock : 30) * 60_000 -
      30_000;
    if (
      !record(saved) ||
      JSON.stringify(saved).length > MAX_BYTES ||
      saved.version !== 2 ||
      !isRestorableWalletRoute(saved.currentPath) ||
      !Number.isFinite(saved.timestamp) ||
      saved.timestamp > Date.now() + 1000 ||
      Date.now() - saved.timestamp > timeout
    ) {
      if (saved) {
        if (!options.strict) ++navigationWriteGeneration;
        await clearNavigationStateUnlocked();
      }
      return null;
    }
    const current = getWalletNavigationScope();
    const path = safeWalletPath(saved.currentPath)!;
    const matches = sameScope(saved.walletScope, current);
    if (DRAFT_ROUTES.has(path.split(/[?#]/)[0]) && !matches) {
      if (!options.strict) ++navigationWriteGeneration;
      await clearNavigationStateUnlocked();
      return null;
    }
    return {
      currentPath: path,
      version: 2,
      timestamp: saved.timestamp,
      walletScope: current,
      state: matches ? sanitizeBrowsingState(path, saved.state) : {},
      returnContext: sanitizedContext(saved.returnContext, current),
      scrollPosition:
        matches && scrollNumber(saved.scrollPosition)
          ? saved.scrollPosition
          : 0,
      scrollPositions: matches ? sanitizeScroll(saved.scrollPositions) : {},
    };
  } catch (error) {
    if (options.strict) throw error;
    return null;
  }
};
export const loadNavigationState =
  async (): Promise<ISavedNavigationState | null> => {
    const generation = navigationWriteGeneration;
    const startingScope = getWalletNavigationScope();
    try {
      return await withNavigationStorageLock(() => {
        if (
          generation !== navigationWriteGeneration ||
          !sameScope(startingScope, getWalletNavigationScope())
        )
          return Promise.resolve(null);
        return loadNavigationStateUnlocked(generation, startingScope);
      });
    } catch {
      return null;
    }
  };
export const navigateWithContext = (
  navigate: (path: string, options?: any) => void,
  targetPath: string,
  targetState: Record<string, any>,
  returnContext: INavigationContext
) => {
  navigate(targetPath, {
    state: {
      ...targetState,
      walletScope: getWalletNavigationScope(),
      returnContext: {
        ...returnContext,
        walletScope: returnContext.walletScope || getWalletNavigationScope(),
        scrollPositions:
          returnContext.scrollPositions || captureNavigationScroll(),
      },
    },
  });
};
export const navigateBack = (
  navigate: (path: string | number, options?: any) => void,
  location: { state?: any }
) => {
  const context = sanitizedContext(
    location.state?.returnContext,
    getWalletNavigationScope()
  );
  if (context)
    navigate(withNavigationTab(context.returnRoute, context.tab), {
      replace: true,
      state: {
        ...context.state,
        returnContext: context.returnContext,
        scrollPosition: context.scrollPosition,
        scrollPositions: context.scrollPositions,
        walletScope: context.walletScope,
      },
    });
  else navigate('/home', { replace: true });
};
export const getCurrentTab = (
  searchParams: URLSearchParams,
  locationState: any,
  defaultTab: string
): string => searchParams.get('tab') || locationState?.tab || defaultTab;
