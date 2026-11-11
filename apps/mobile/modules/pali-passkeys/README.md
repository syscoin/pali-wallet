# Native P-256 passkeys

Pali uses Apple's AuthenticationServices and Android Credential Manager to acquire
real WebAuthn responses. The shared extension code validates the original signed
client data, challenge, credential, RP hash, user verification, P-256 key and
signature before encoding the on-chain proof. Keys remain in the OS credential
provider. These smart-account credentials are separate from local PIN/biometric
wallet entry and from the extension's optional PRF unlock.

The fixed relying party is `paliwallet.com`. iOS expects the native API's
`https://paliwallet.com` origin; Android uses the actual APK signing certificate's
`android:apk-key-hash:` origin. Existing on-chain validator profiles pin their
origin as well as their key, so an unrelated browser/app origin is not silently
substituted. A profile that does not match must be replaced through the existing
authorized policy/recovery flow.

## Release association and qualification

The Expo plugin installs the `webcredentials:paliwallet.com` entitlement and the
Android asset-statements reference. Before device/store release, serve these
files over HTTPS without redirects using the **production** signing identities:

- `https://paliwallet.com/.well-known/apple-app-site-association`: a
  `webcredentials.apps` entry for `<Apple Team ID>.com.paliwallet.mobile`.
- `https://paliwallet.com/.well-known/assetlinks.json`: a
  `delegate_permission/common.get_login_creds` statement for Android package
  `com.paliwallet.mobile` with its actual Play App Signing SHA-256 fingerprint.

Do not publish a developer/debug signing certificate as production authority.
The source plugin cannot prove website ownership or substitute invented signing
IDs. Missing/mismatched association fails in the OS credential ceremony. Native
association paths on the apex domain must bypass a blanket `www` redirect and
return the correct JSON directly; a redirect to a website's HTML/404 page is not
an association. Check both exact URLs again after deployment.
Native module builds and synthetic signature tests do not establish successful device
registration, sync/provider behavior or live on-chain execution; qualify those
against the final signed installation and configured domain.

References: [Apple passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys/),
[Android prerequisites](https://developer.android.com/identity/credential-manager/prerequisites).
