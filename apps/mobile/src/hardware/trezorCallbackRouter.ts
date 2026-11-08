export type NativeTrezorLinkEvents = Readonly<{
  addEventListener(
    type: 'url',
    listener: (event: { url: string }) => void
  ): { remove(): void };
  getInitialURL(): Promise<string | null | undefined>;
}>;

/** Events may record a bounded public response; they cannot approve or unlock. */
export function createNativeTrezorCallbackRouter(
  receiver: { receiveCallback(url: unknown): boolean },
  links: NativeTrezorLinkEvents
) {
  let active = true;
  const receive = (url: unknown) => {
    if (active) receiver.receiveCallback(url);
  };
  const subscription = links.addEventListener('url', (event) =>
    receive(event.url)
  );
  // A cold launch has no pending process-owned job and is ignored by the receiver.
  const ready = Promise.resolve()
    .then(() => links.getInitialURL())
    .then(receive, () => undefined);
  return Object.freeze({
    ready,
    dispose() {
      if (active) {
        active = false;
        subscription.remove();
      }
    },
  });
}
