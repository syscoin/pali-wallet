# Android WebSocket ownership

React Native 0.88.1 records its Android WebSocket only after HTTP upgrade. Closing
a connecting socket therefore cannot cancel its pending OkHttp call. This
module keeps a per-connection record before starting the call and uses OkHttp
`cancel()` while connecting. An opened socket retains normal WebSocket close.

The existing WalletConnect platform preparation installs one stable Android
constructor before the protocol SDK is imported. Current native application
WebSocket callers are WalletConnect and its qualification path. iOS continues
using React Native. The qualification path captures the same constructor before
wrapping it in its existing loopback-only subclass.

The adapter preserves text, ArrayBuffer/view and Blob send order, protocols,
headers, binary delivery, event handlers and ready states. Eight native slots
include connections awaiting terminal cleanup. Frames crossing the bridge are
bounded to 2 MiB, accommodating the existing 1 MiB dapp limit after encryption.
Queued JavaScript sends are bounded to 8 MiB per socket. These are bridge and
queue limits. OkHttp allocates incoming frames before the bridge enforces its
limit.

Default binary messages use the public `expo-blob` Blob implementation. Its
`size`, `type`, `text()`, `arrayBuffer()` and `slice()` methods are available on
received values. Existing callers retain the React Native global `Blob`
constructor.
Both Expo Blob values and existing React Native Blob inputs can be sent.
The current WalletConnect consumers exchange strings. A future binary consumer must use
the received object's public methods, or select `binaryType = 'arraybuffer'`.
Encoding uses the existing qualified native Buffer with the view's exact byte
offset and length.

TLS and upgrade use platform OkHttp defaults. Diagnostics contain a fixed error
code.

Expo autolinks the local Android library into the normal app build. The native
qualification workflow compiles and runs `SocketRegistryTest` before assembling
the APK. Android execution requires the native qualification job.
