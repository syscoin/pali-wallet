import { PALI_HTTP_USER_AGENT } from '../../../../shared/paliHttpIdentity';

const FIRST_RULE_ID = 1700000;
const LAST_RULE_ID = 1799999;

type Rule = chrome.declarativeNetRequest.Rule;
type RuleStore = Pick<
  typeof chrome.declarativeNetRequest,
  'getDynamicRules' | 'updateDynamicRules'
> & {
  MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES?: number;
  MAX_NUMBER_OF_DYNAMIC_RULES?: number;
  MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES?: number;
  getSessionRules?: () => Promise<Rule[]>;
};

function httpOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('Wallet HTTP endpoint must use HTTP or HTTPS');
  return url.origin;
}

export function walletBackendOrigin(value: string): string {
  const origin = httpOrigin(value);
  if (/[*|^]/.test(origin)) throw new Error('Wallet HTTP endpoint is invalid');
  return origin;
}

/** Only public origins enter rules; path/query credentials never enter storage or logs. */
export function walletBackendUrls(
  networks: Record<
    'ethereum' | 'syscoin',
    Record<string, { apiUrl?: string; url: string }>
  >,
  active?: { apiUrl?: string; url: string }
): string[] {
  const urls: string[] = [];
  for (const group of Object.values(networks))
    for (const network of Object.values(group)) {
      urls.push(network.url);
      if (network.apiUrl) urls.push(network.apiUrl);
    }
  if (active) {
    urls.push(active.url);
    if (active.apiUrl) urls.push(active.apiUrl);
  }
  return urls;
}

export function createWalletHttpIdentity(
  extensionId: string,
  store?: RuleStore
) {
  const validInitiator =
    /^(?:[a-p]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(
      extensionId
    );
  const positiveLimit = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) > 0;
  const owned = (rule: Rule) =>
    rule.id >= FIRST_RULE_ID && rule.id <= LAST_RULE_ID;
  const safeAction = (rule: Rule) =>
    ['block', 'allow', 'allowAllRequests', 'upgradeScheme'].includes(
      rule.action.type
    );
  let configured = new Set<string>();
  let rejectedOrigins = new Set<string>();
  let configurationError: Error | undefined;
  const temporary = new Map<string, number>();
  let installed = new Set<string>();
  let pending: Promise<void> = Promise.resolve();
  let desiredKey: string | undefined;
  let pendingUpdates = 0;
  let installedValid = true;
  const synchronize = (explicitRetry = false): Promise<void> => {
    const origins = [...new Set([...configured, ...temporary.keys()])].sort();
    const key = origins.join('\n');
    if (
      key === desiredKey &&
      !(explicitRetry && pendingUpdates === 0 && !installedValid)
    )
      return pending;
    desiredKey = key;
    pendingUpdates++;
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        if (
          !validInitiator ||
          !store ||
          typeof store.getDynamicRules !== 'function' ||
          typeof store.updateDynamicRules !== 'function'
        )
          throw new Error('Wallet HTTP identification is unavailable');
        const old = await store.getDynamicRules();
        const foreign = old.filter((rule) => !owned(rule));
        const unsafeLimit = store.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES;
        const dynamicLimit = store.MAX_NUMBER_OF_DYNAMIC_RULES;
        const combinedLimit = store.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES;
        let overCapacity = origins.length > LAST_RULE_ID - FIRST_RULE_ID + 1;
        if (positiveLimit(unsafeLimit)) {
          overCapacity ||=
            origins.length +
              foreign.filter((rule) => !safeAction(rule)).length >
            unsafeLimit;
          if (positiveLimit(dynamicLimit))
            overCapacity ||= origins.length + foreign.length > dynamicLimit;
        } else if (positiveLimit(combinedLimit)) {
          if (typeof store.getSessionRules !== 'function')
            throw new Error('Wallet HTTP identification is unavailable');
          const session = await store.getSessionRules();
          overCapacity ||=
            origins.length + foreign.length + session.length > combinedLimit;
        } else if (positiveLimit(dynamicLimit)) {
          overCapacity ||= origins.length + foreign.length > dynamicLimit;
        } else throw new Error('Wallet HTTP identification is unavailable');
        if (overCapacity)
          throw new Error('Wallet HTTP identification capacity is unavailable');
        const rules: Rule[] = origins.map((origin, index) => ({
          id: FIRST_RULE_ID + index,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: 'user-agent',
                operation:
                  'set' as chrome.declarativeNetRequest.HeaderOperation,
                value: PALI_HTTP_USER_AGENT,
              },
            ],
          },
          condition: {
            initiatorDomains: [extensionId],
            resourceTypes: [
              'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType,
            ],
            urlFilter: `|${origin}/`,
          },
        }));
        await store.updateDynamicRules({
          removeRuleIds: old.filter(owned).map((rule) => rule.id),
          addRules: rules,
        });
        installed = new Set(origins);
        installedValid = true;
      })
      .catch((error) => {
        installedValid = false;
        throw error;
      })
      .finally(() => {
        pendingUpdates--;
      });
    // Ordinary requests never retry installation. An explicit probe may retry once.
    void pending.catch(() => undefined);
    return pending;
  };
  const isBackend = (url: string): boolean => {
    try {
      const origin = httpOrigin(url);
      return (
        configured.has(origin) ||
        rejectedOrigins.has(origin) ||
        temporary.has(origin)
      );
    } catch {
      return false;
    }
  };
  const isReady = (url: string): boolean =>
    !configurationError &&
    isBackend(url) &&
    pendingUpdates === 0 &&
    installedValid &&
    installed.has(walletBackendOrigin(url));
  const prepare = async (url: string): Promise<boolean> => {
    if (!isBackend(url)) return false;
    if (configurationError) throw configurationError;
    await pending;
    if (configurationError) throw configurationError;
    if (!isReady(url))
      throw new Error('Wallet HTTP identification is unavailable');
    return true;
  };
  return Object.freeze({
    configure(urls: readonly string[]): Promise<void> {
      const next = new Set<string>();
      let invalid = false;
      for (const url of urls) {
        try {
          // Classify recognizable HTTP origins even when their rule syntax is
          // invalid, so rejection can never send them through unrelated fetch.
          next.add(httpOrigin(url));
          walletBackendOrigin(url);
        } catch {
          invalid = true;
        }
      }
      if (invalid) {
        rejectedOrigins = next;
        configurationError = new Error(
          'Wallet HTTP endpoint configuration is invalid'
        );
        return Promise.reject(configurationError);
      }
      const corrected = configurationError !== undefined;
      configured = next;
      rejectedOrigins.clear();
      configurationError = undefined;
      return synchronize(corrected);
    },
    isBackend,
    isReady,
    prepare,
    async withBackend<T>(url: string, operation: () => Promise<T>): Promise<T> {
      if (configurationError) throw configurationError;
      const origin = walletBackendOrigin(url);
      if (configured.has(origin)) {
        await synchronize(true);
        await prepare(url);
        return operation();
      }
      temporary.set(origin, (temporary.get(origin) ?? 0) + 1);
      try {
        await synchronize(true);
        await prepare(url);
        return await operation();
      } finally {
        const count = temporary.get(origin)! - 1;
        if (count) temporary.set(origin, count);
        else temporary.delete(origin);
        void synchronize().catch(() => undefined);
      }
    },
  });
}

let identity: ReturnType<typeof createWalletHttpIdentity> | undefined;
export function walletHttpIdentity() {
  if (!identity) {
    let initiator = '';
    try {
      initiator = new URL(chrome.runtime.getURL('/')).hostname;
    } catch {
      /* Offline custody remains available without the browser HTTP capability. */
    }
    identity = createWalletHttpIdentity(
      initiator,
      typeof chrome === 'undefined' ? undefined : chrome.declarativeNetRequest
    );
  }
  return identity;
}
export const withWalletBackend = <T>(
  url: string,
  operation: () => Promise<T>
) => walletHttpIdentity().withBackend(url, operation);
