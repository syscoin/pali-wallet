import type { Blob as ExpoBlob } from 'expo-blob';

type NativeBinaryBlob = Blob | ExpoBlob;

export type NativeSocketEvent = Readonly<{
  id: string;
  type: 'open' | 'text' | 'binary' | 'error' | 'close';
  data?: string;
  protocol?: string;
  code?: number;
  reason?: string;
}>;
export type NativeSocketPort = Readonly<{
  createId(): string;
  connect(
    id: string,
    url: string,
    protocols: string[],
    headers: Record<string, string>
  ): void;
  send(id: string, data: string, binary: boolean): boolean;
  close(id: string, code: number, reason: string): void;
  bufferedAmount(id: string): number;
  addListener(
    name: 'socketEvent',
    listener: (event: NativeSocketEvent) => void
  ): { remove(): void };
}>;
export type NativeBinaryBlobs = Readonly<{
  create(bytes: Uint8Array<ArrayBuffer>): NativeBinaryBlob;
  isBlob(value: unknown): value is NativeBinaryBlob;
  read(value: NativeBinaryBlob): Promise<ArrayBuffer>;
}>;

// The existing 1 MiB dapp request budget fits after WalletConnect encryption/base64.
// This bounds bytes crossing the native bridge, including non-WalletConnect users.
export const NATIVE_SOCKET_MAX_BYTES = 2 * 1024 * 1024;
const unavailable = () => new Error('NATIVE_WEBSOCKET_UNAVAILABLE');
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Native runtime preparation installs the qualified native Buffer implementation.
const encode = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    'base64'
  );
const decode = (text: string) => {
  if (text.length > Math.ceil(NATIVE_SOCKET_MAX_BYTES / 3) * 4)
    throw unavailable();
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text
    )
  )
    throw unavailable();
  const binary = Buffer.from(text, 'base64');
  if (binary.byteLength > NATIVE_SOCKET_MAX_BYTES) throw unavailable();
  return new Uint8Array(binary);
};
const byteLength = (text: string) => {
  if (text.length > NATIVE_SOCKET_MAX_BYTES) throw unavailable();
  return new TextEncoder().encode(text).length;
};
function readBlob(
  blob: NativeBinaryBlob,
  binary: NativeBinaryBlobs
): Promise<ArrayBuffer> {
  if (binary.isBlob(blob)) return binary.read(blob);
  const read = Blob.prototype.arrayBuffer;
  if (typeof read === 'function') return read.call(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(unavailable());
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(unavailable());
    reader.readAsArrayBuffer(blob);
  });
}

/** Standard event/state adapter. Native code owns and cancels the actual socket. */
export function createNativeWebSocket(
  port: NativeSocketPort,
  binary: NativeBinaryBlobs
): typeof WebSocket {
  const sockets = new Map<string, AndroidWebSocket>();
  class AndroidWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readonly extensions = '';
    private selectedProtocol = '';
    private state = 0;
    private mode: BinaryType = 'blob';
    private readonly id: string;
    private queuedBytes = 0;
    private sends: Promise<void> = Promise.resolve();
    private errorEmitted = false;
    private readonly handlers = new Map<
      string,
      { callback: (event: never) => unknown; listener: EventListener }
    >();

    constructor(
      address: string | URL,
      protocols: string | string[] = [],
      options: { headers?: Record<string, string>; origin?: string } = {}
    ) {
      super();
      let url: URL;
      try {
        url = new URL(String(address));
      } catch {
        throw unavailable();
      }
      if (
        !['ws:', 'wss:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        url.href.length > 8192
      )
        throw unavailable();
      const selected =
        typeof protocols === 'string' ? [protocols] : [...protocols];
      if (
        selected.length > 16 ||
        new Set(selected).size !== selected.length ||
        selected.some(
          (value) =>
            typeof value !== 'string' ||
            value.length > 256 ||
            !token.test(value)
        )
      )
        throw unavailable();
      const headers = { ...options.headers };
      if (
        options.origin !== undefined &&
        !Object.keys(headers).some((name) => name.toLowerCase() === 'origin')
      )
        headers.origin = options.origin;
      if (
        Object.keys(headers).length > 32 ||
        Object.entries(headers).some(
          ([name, value]) =>
            !token.test(name) ||
            name.length > 256 ||
            typeof value !== 'string' ||
            value.length > 8192 ||
            /[\r\n]/.test(value)
        ) ||
        Object.entries(headers).reduce(
          (total, [name, value]) => total + name.length + value.length,
          0
        ) > 65536
      )
        throw unavailable();
      this.url = url.href;
      this.id = port.createId();
      if (
        typeof this.id !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(this.id) ||
        sockets.has(this.id)
      )
        throw unavailable();
      sockets.set(this.id, this);
      try {
        port.connect(this.id, this.url, selected, headers);
      } catch {
        sockets.delete(this.id);
        this.state = this.CLOSED;
        throw unavailable();
      }
    }

    get binaryType(): BinaryType {
      return this.mode;
    }
    set binaryType(value: BinaryType) {
      if (value === 'blob' || value === 'arraybuffer') this.mode = value;
    }
    get protocol(): string {
      return this.selectedProtocol;
    }
    get readyState(): number {
      return this.state;
    }
    get bufferedAmount(): number {
      return this.queuedBytes + port.bufferedAmount(this.id);
    }
    private handler(type: string, value: ((event: never) => unknown) | null) {
      const previous = this.handlers.get(type);
      if (previous) this.removeEventListener(type, previous.listener);
      this.handlers.delete(type);
      if (typeof value === 'function') {
        const listener: EventListener = (event) =>
          value.call(this, event as never);
        this.handlers.set(type, { callback: value, listener });
        this.addEventListener(type, listener);
      }
    }
    private readHandler<T extends Event>(
      type: string
    ): ((event: T) => unknown) | null {
      return (
        (this.handlers.get(type)?.callback as
          | ((event: T) => unknown)
          | undefined) ?? null
      );
    }
    get onopen() {
      return this.readHandler<Event>('open');
    }
    set onopen(value: ((event: Event) => unknown) | null) {
      this.handler('open', value);
    }
    get onmessage() {
      return this.readHandler<MessageEvent>('message');
    }
    set onmessage(value: ((event: MessageEvent) => unknown) | null) {
      this.handler('message', value);
    }
    get onerror() {
      return this.readHandler<Event>('error');
    }
    set onerror(value: ((event: Event) => unknown) | null) {
      this.handler('error', value);
    }
    get onclose() {
      return this.readHandler<CloseEvent>('close');
    }
    set onclose(value: ((event: CloseEvent) => unknown) | null) {
      this.handler('close', value);
    }

    private error() {
      if (this.errorEmitted || this.readyState === this.CLOSED) return;
      this.errorEmitted = true;
      this.dispatchEvent(new Event('error'));
    }
    private finish(code: number, reason: string, clean: boolean) {
      if (this.readyState === this.CLOSED) return;
      this.state = this.CLOSED;
      sockets.delete(this.id);
      const event = new Event('close');
      Object.defineProperties(event, {
        code: { value: code },
        reason: { value: reason },
        wasClean: { value: clean },
      });
      this.dispatchEvent(event);
    }
    receive(event: NativeSocketEvent) {
      if (this.readyState === this.CLOSED) return;
      if (event.type === 'error') {
        this.error();
        this.finish(1006, '', false);
        return;
      }
      if (event.type === 'close') {
        this.finish(event.code ?? 1006, event.reason ?? '', true);
        return;
      }
      if (event.type === 'open') {
        if (this.readyState !== this.CONNECTING) return;
        this.selectedProtocol = event.protocol ?? '';
        this.state = this.OPEN;
        this.dispatchEvent(new Event('open'));
        return;
      }
      if (event.type !== 'text' && event.type !== 'binary') return;
      if (this.readyState !== this.OPEN || typeof event.data !== 'string')
        return;
      try {
        const data = event.type === 'binary' ? decode(event.data) : event.data;
        if (
          typeof data === 'string' &&
          byteLength(data) > NATIVE_SOCKET_MAX_BYTES
        )
          throw unavailable();
        const message = new Event('message');
        Object.defineProperty(message, 'data', {
          value:
            typeof data === 'string'
              ? data
              : this.mode === 'arraybuffer'
              ? data.buffer
              : binary.create(data),
        });
        this.dispatchEvent(message);
      } catch {
        this.error();
        this.close(1000, '');
      }
    }

    send(data: string | ArrayBufferLike | NativeBinaryBlob | ArrayBufferView) {
      if (this.readyState === this.CONNECTING)
        throw new Error('INVALID_STATE_ERR');
      if (this.readyState !== this.OPEN) return;
      let size: number;
      let captured: string | Uint8Array | NativeBinaryBlob;
      const checkSize = (bytes: number) => {
        if (
          bytes > NATIVE_SOCKET_MAX_BYTES ||
          this.queuedBytes + bytes > 4 * NATIVE_SOCKET_MAX_BYTES
        )
          throw unavailable();
      };
      if (typeof data === 'string') {
        size = byteLength(data);
        captured = data;
      } else if (data instanceof Blob || binary.isBlob(data)) {
        size = data.size;
        captured = data;
      } else if (data instanceof ArrayBuffer) {
        size = data.byteLength;
        checkSize(size);
        captured = new Uint8Array(data).slice();
      } else if (ArrayBuffer.isView(data)) {
        size = data.byteLength;
        checkSize(size);
        captured = new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength
        ).slice();
      } else throw unavailable();
      checkSize(size);
      this.queuedBytes += size;
      this.sends = this.sends
        .then(async () => {
          try {
            if (this.readyState === this.CLOSED) return;
            const value =
              captured instanceof Blob || binary.isBlob(captured)
                ? new Uint8Array(await readBlob(captured, binary))
                : captured;
            if (this.readyState === this.CLOSED) return;
            if (typeof value !== 'string' && value.byteLength !== size)
              throw unavailable();
            if (
              !port.send(
                this.id,
                typeof value === 'string' ? value : encode(value),
                typeof value !== 'string'
              )
            )
              throw unavailable();
          } finally {
            this.queuedBytes -= size;
          }
        })
        .catch(() => {
          this.error();
          if (this.readyState !== this.CLOSED) port.close(this.id, 1000, '');
        });
    }
    close(code = 1000, reason = '') {
      if (
        !Number.isInteger(code) ||
        (code !== 1000 && (code < 3000 || code > 4999)) ||
        typeof reason !== 'string' ||
        new TextEncoder().encode(reason).length > 123
      )
        throw unavailable();
      if (this.readyState === this.CLOSING || this.readyState === this.CLOSED)
        return;
      const connecting = this.readyState === this.CONNECTING;
      this.state = this.CLOSING;
      if (connecting) port.close(this.id, code, reason);
      else
        void this.sends.then(() => {
          if (this.readyState !== this.CLOSED)
            port.close(this.id, code, reason);
        });
    }
  }
  port.addListener('socketEvent', (event) =>
    sockets.get(event.id)?.receive(event)
  );
  return AndroidWebSocket as unknown as typeof WebSocket;
}
