const MAX_PAIRING_URI_LENGTH = 4096;
const MAX_LINK_LENGTH = MAX_PAIRING_URI_LENGTH * 3 + 64;
const ENTRY_LIFETIME_MS = 5 * 60_000;
const MAX_RECENT_TOPICS = 16;

/** Ephemeral routing input. Never persist it or include it in diagnostics. */
export type NativePairingEntry = Readonly<{
  id: string;
  uri: string;
  expiresAt: number;
}>;

/** Extract routing input only. The connection controller owns URI validation. */
export function extractPairingUri(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_LINK_LENGTH ||
    !/^[\x21-\x7e]+$/.test(value)
  )
    return null;
  if (value.startsWith('wc:'))
    return value.length <= MAX_PAIRING_URI_LENGTH ? value : null;
  try {
    const link = new URL(value);
    if (
      link.protocol !== 'pali:' ||
      link.host !== 'wc' ||
      link.username ||
      link.password ||
      link.pathname ||
      link.hash
    )
      return null;
    const parameters = [...link.searchParams];
    if (parameters.length !== 1 || parameters[0]?.[0] !== 'uri') return null;
    const uri = parameters[0][1];
    return uri.startsWith('wc:') &&
      uri.length <= MAX_PAIRING_URI_LENGTH &&
      /^[\x21-\x7e]+$/.test(uri)
      ? uri
      : null;
  } catch {
    return null;
  }
}

/** One pending OS link survives lock/onboarding without replacing an earlier link. */
export class NativePairingInbox {
  private pending: NativePairingEntry | null = null;
  private readonly recentTopics = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private serial = 0;
  private closed = false;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  readonly getSnapshot = () => this.pending;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  offer(value: unknown): NativePairingEntry | undefined {
    if (this.closed) return;
    const uri = extractPairingUri(value);
    if (!uri) return;
    const now = this.now();
    for (const [previous, expiry] of this.recentTopics)
      if (expiry <= now) this.recentTopics.delete(previous);
    if (this.pending && this.pending.expiresAt <= now)
      this.consume(this.pending.id);
    const topic = /^wc:([a-f0-9]{64})@2(?:\?|$)/i.exec(uri)?.[1]?.toLowerCase();
    if (this.pending || (topic && this.recentTopics.has(topic))) return;
    const entry = Object.freeze({
      id: `pairing-${++this.serial}`,
      uri,
      expiresAt: now + ENTRY_LIFETIME_MS,
    });
    if (topic) this.recentTopics.set(topic, entry.expiresAt);
    if (this.recentTopics.size > MAX_RECENT_TOPICS)
      this.recentTopics.delete(this.recentTopics.keys().next().value!);
    this.pending = entry;
    this.timer = setTimeout(() => this.consume(entry.id), ENTRY_LIFETIME_MS);
    this.publish();
    return entry;
  }

  consume(id: string): void {
    if (this.pending?.id !== id) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
    this.publish();
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
    this.recentTopics.clear();
    this.listeners.clear();
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }
}

export type PairingLinkSource = Readonly<{
  getInitialURL(): Promise<string | null | undefined>;
  addEventListener(
    name: 'url',
    listener: (event: { url: string }) => void
  ): { remove(): void };
}>;

/** Warm links and user navigation supersede a delayed initial URL. */
export function observePairingLinks(
  linking: PairingLinkSource,
  receive: (value: string) => void,
  initialIsCurrent: () => boolean
): () => void {
  let active = true;
  let receivedWarmLink = false;
  const subscription = linking.addEventListener('url', (event) => {
    if (!active) return;
    receivedWarmLink = true;
    receive(event.url);
  });
  const initial = async () => linking.getInitialURL();
  void initial()
    .then((value) => {
      if (
        active &&
        !receivedWarmLink &&
        initialIsCurrent() &&
        typeof value === 'string'
      )
        receive(value);
    })
    .catch(() => undefined);
  return () => {
    active = false;
    subscription.remove();
  };
}
