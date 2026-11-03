# Pali native cryptography boundary

This local Expo module supplies the narrow WebCrypto operations used by the shared wallet SDK. It does not install globals automatically. Native bootstrap must install `createNativeWalletCrypto()` from `src/crypto/native` after the Node-compatibility provider, await `qualifyWalletCrypto()`, and only then construct the SDK. The web entry rejects native custody.

The supported subset is raw, nonextractable PBKDF2/HKDF/AES keys; PBKDF2 bits with SHA-256 or SHA-512, PBKDF2-SHA512 to opaque AES keys; HKDF-SHA256; AES-256-GCM with a 12-byte IV and 128-bit appended tag; SHA-256 digest; and synchronous CSPRNG bytes. Unknown algorithms, key export, JWK import, incompatible usages, and other tag/key sizes fail closed. This includes the whole-note backup codec's PBKDF2-SHA512/AES256-GCM contract and its 8 MiB plaintext ceiling. This is not a complete WebCrypto implementation.

Keys are opaque native Expo SharedObjects. JavaScript exposes only frozen CryptoKey metadata and privately associates each key with its owning context. Native operations validate owner, type, usage and lifetime again. GC releases native key material; explicit provider disposal closes the context and attempts to erase all surviving key buffers. Disposal is for fatal shutdown/tests, not each wallet lock. Swift/JVM/bridge copies and platform key schedules cannot be promised complete zeroization.

AES-GCM uses CryptoKit on Apple platforms and JCA `AES/GCM/NoPadding` on Android. Only `CryptoKitError.authenticationFailure` or `AEADBadTagException` produces the typed authentication-rejected result. Only that result becomes JavaScript `OperationError`. Argument, provider, setup and lifecycle failures become operational errors, with no raw input or native error messages exposed. Decrypted bytes are returned only after authentication succeeds.

PBKDF2 uses CommonCrypto on Apple platforms. Android uses Bouncy Castle's byte-oriented PBKDF2 and HKDF generators; it never registers or replaces a global JCA provider. This preserves arbitrary imported password bytes, Unicode encoding, embedded NULs, and the SDK's exact derivations without implementing a KDF loop here. Apple HKDF uses CryptoKit. Entropy uses SecRandomCopyBytes/SecureRandom. SHA-256 uses CryptoKit/MessageDigest.

All JavaScript BufferSources and parameter values are copied before awaiting native work. Native argument conversion produces owned Data/ByteArray values. Operations are queued off the UI thread; at most eight async facade calls may be outstanding. Limits are 8 MiB of AES plaintext (plus a 16-byte ciphertext tag), 1 MiB of digest input, 64 KiB salt/AAD/info, 4 KiB imported KDF material, 1–2,000,000 PBKDF2 iterations and 1–64 output bytes. The SDK's production 900,000 and legacy 20,000 rounds are unchanged. Native argument checks repeat these limits. Sync entropy requests are limited to WebCrypto's 65,536-byte limit and preserve view offsets.

## Dependency identity

- Gradle coordinate: `org.bouncycastle:bcprov-jdk18on:1.86`, constrained strictly to 1.86.
- [Official release](https://www.bouncycastle.org/download/bouncy-castle-java/): 1.86, September 2026. No beta or TLS-only version is used.
- Upstream source tag `r1rv86`: `eacda831fbe15b272933e40841d8b0827b556fae`.
- [Provider JAR](https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk18on/1.86/bcprov-jdk18on-1.86.jar), SHA-256 `2af190b300cbb0b35e248ccf5f4a06b6072030aeb3da7a98ec73abe5b4cb371f`.
- [Sources JAR](https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk18on/1.86/bcprov-jdk18on-1.86-sources.jar), SHA-256 `34a8b7dcb030a08ddd5356d3d5be962f9299ca5275e1460273186f8fdbe44c34`.
- [POM](https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk18on/1.86/bcprov-jdk18on-1.86.pom), SHA-256 `970b70cb75a184639b6fb9ba3c465aca6a4e1a5f3fff4d65ce8574b2fd79ef38`.
- The JAR's license is preserved in `BOUNCY-CASTLE-LICENSE.md`. Only `PKCS5S2ParametersGenerator`, `HKDFBytesGenerator`, SHA digest classes and parameter holders are referenced. The 7,224,011-byte distribution JAR is not a prediction of final app size; release shrinking and size need measurement.

## Validation boundary

`tests/crypto.test.ts` uses a clearly labeled Node control behind the bridge interface. It covers the facade, immutable inputs, key ownership, 20k/900k Unicode fixtures, exact SDK private-record/vault envelopes, limits, error classification and lifecycle. It does not exercise the Expo native bridge.

The CI/device harness can call `qualifyWalletCryptoFull(provider, createNativeWalletCrypto)` from `src/crypto/qualificationFull`. It uses only the checked-in public fixture JSON and runs the production KDF vectors across offset Uint8Array, DataView and the SDK's Buffer alias, authenticated-envelope tampering, the backup 8 MiB boundary and independent provider lifetime. It returns static case names and timings; the harness must record the actual native binary, device and provider. This full module is separate from normal startup qualification.

`tests/main.swift` executes the production Swift primitive file against the public fixture JSON on macOS. Android `PaliCryptoPrimitivesTest` exercises the production Kotlin primitive code on a JVM. Neither host check proves iOS/Android device or bridge behavior. The startup self-test uses one PBKDF2 round solely as a capability check and never changes SDK parameters.

Before custody is enabled, run native builds and the actual Expo/Hermes bridge on both target platforms; include full 20k/900k vectors, native error-classification checks, malformed input, offset views, key lifetime/disposal, and background/foreground responsiveness on supported physical devices. The native build, device, OS and artifact hashes belong in that qualification report.
