# Android passkey transport

`PaliPasskeys` uses the callback APIs in AndroidX Credential Manager 1.6.0
(`credentials` and `credentials-play-services-auth`). It requires Android 9/API
28 or newer and Digital Asset Links for the app signing certificate and
`paliwallet.com`. Credential-provider availability is determined by Android.

The Expo contract is:

- `getContext()` synchronously returns `{ rpId, origin }`. The origin is
  `android:apk-key-hash:` plus unpadded base64url SHA-256 of the sole current APK
  signing certificate. Multiple current signers are refused.
- `prepare()` synchronously reserves a random, one-use request ID for the current
  resumed Activity. At most 32 unused reservations are allowed; none are evicted.
- `create(id, optionsJson)` and `get(id, optionsJson)` consume that reservation
  and resolve to the provider's raw registration/assertion JSON string. Only one
  ceremony is live. No origin override or client-data hash is passed to Android.
- `cancel(id)` synchronously removes a reservation or cancels the matching live
  ceremony and reports whether it existed. Module/Activity destruction also
  cancels it. Late results cannot settle a canceled request.

Requests are limited to 64 KiB and depth eight. They must specify the fixed RP,
32-byte challenge, required user verification, and 90-second timeout. Creation
also requires a 32-byte user ID, names of at most 80 characters, only ES256,
resident credentials, and no attestation. At most 32 excluded credentials or one
allowed credential can be supplied. Credential IDs are at most 1 KiB. Unknown
options are refused. Raw responses are limited to 256 KiB and are not parsed as
wallet keys or signatures by this module.

Completion is delivered only to the original, resumed Activity. A result that
arrives during the credential provider's UI is held until the same Activity
resumes; a 90-second native deadline also bounds that wait. The JavaScript owner
must still cancel on loss of its wallet/account/operation scope and validate the
standard WebAuthn response.

`PaliPasskeyPolicyTest` covers request admission, bounds, certificate-origin
derivation, and unchanged raw responses. `PaliPasskeyTicketsTest` covers canceled
queued starts, exactly-once consumption, concurrent claims, capacity without
eviction, and retirement. To run these JVM tests with Java 17+ and no app build:

```sh
python3 apps/mobile/modules/pali-passkeys/android/run-jvm-tests.py --download
```

The runner caches checksum-pinned test jars under the temporary directory;
subsequent runs can omit `--download`. Use `--java`, `--cache`, and `--log` to
select an installed JVM, existing jar cache, and log path. An Android-only
compilation can use the generated Expo Android project task
`:pali-passkeys:compileDebugKotlin`; `:pali-passkeys:testDebugUnitTest` runs these
tests in that Gradle project without assembling or installing the app.

Device/provider UI,
Digital Asset Links, and actual Credential Manager integration require Android
qualification; the JVM tests do not establish those outcomes.

References: [stable versions](https://developer.android.com/jetpack/androidx/releases/credentials),
[Credential Manager callback API](https://developer.android.com/reference/kotlin/androidx/credentials/CredentialManager),
[passkey prerequisites](https://developer.android.com/identity/passkeys/create-passkeys).
