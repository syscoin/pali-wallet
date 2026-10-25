// The offscreen host owns this Worker and terminates it on every exit path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const installThread = require('./subworkerRuntime.js') as (host: any) => void;
self.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
  const port = event.data.port;
  if (!(port instanceof MessagePort)) return;
  self.onmessage = null;
  const host = {
    postMessage: (value: unknown, transfer: Transferable[] = []) =>
      port.postMessage(value, transfer),
    set onmessage(handler: (message: MessageEvent) => void) {
      port.onmessage = handler;
    },
    close: () => {
      port.close();
      self.close();
    },
  };
  installThread(host);
  port.start();
};
export {};
