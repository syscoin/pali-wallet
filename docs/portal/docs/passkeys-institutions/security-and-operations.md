---
title: Security and operations
---

Pali smart accounts should be treated like production account infrastructure, not just a nicer login button. The account contract holds assets, and installed modules decide who can move those assets.

## Network and module dependency

Do not assume a Pali smart account can be created on an EVM chain before the Pali infrastructure exists there. The chain must have the Pali factory and modules available at the addresses Pali uses, either from a known deployment or from Pali's in-wallet Smart account setup flow. If the active network exposes the canonical CREATE2 deployer, Pali can deploy the missing setup from Settings > Advanced. Passkey validators also require P-256 WebAuthn verification support, which many modern EVM environments provide through a P-256/passkey precompile.

Today, Pali's configured test deployment is `zkTanenbaum` (`57057`). Treat zkSYS production as the production deployment target once the factory and modules are configured. Other compatible EVM chains can be enabled from the wallet when canonical CREATE2 support is present.

## Operational checklist

- Decide which validator should control the account: passkey, wallet-owned ECDSA, composite, or a later guardian recovery path.
- Treat external ECDSA owners as high-risk. If an address is not a local Pali account, users must understand that it can approve future account actions.
- Decide whether guardian recovery is enabled, who the guardians are, what threshold is required, and how long the recovery delay should be.
- Keep the gas payer account funded for deployment and smart-account executions.
- Monitor failed deployments, failed module installs, expired recovery schedules, and repeated recovery attempts.
- Provide a user support path for lost passkeys, lost wallet state, and failed guardian recovery.

## Creation, funding, and deployment

Pali smart accounts are counterfactual while Pali prepares creation. Pali stores durable metadata locally and deploys the account through the configured factory. Account creation needs a wallet gas payer with enough native token for deployment and any immediate module replacement.

The current flow uses wallet-paid gas. Pali deploys with a wallet-owned bootstrap validator, then installs the requested validator through an account execution when needed.

The factory can compute the account address before deployment. This is useful for display and funding UX. Production integrations should treat the account as usable after Pali returns success from `wallet_prepareSmartAccount`.

## Validator assumptions

Validators are the account's authorization boundary:

- A P-256 WebAuthn validator means the passkey proof authorizes actions.
- An ECDSA validator means the configured owner addresses authorize actions.
- A composite validator combines locally signable builtin child validators under a threshold: 1-of-N, t-of-N, or N-of-N. This Pali version does not support nested composites or collecting external or cross-device approvals.

When designing a composite policy, document the threshold rationale: 1-of-N optimizes availability, N-of-N optimizes assurance, and t-of-N balances both. Validators are replaceable modules, so the policy (and even the signature scheme — including future post-quantum validators) can be upgraded later without changing the account address. Guardians are an executor-role module and stay independent of whichever validator policy is active.

Installing a malicious validator is equivalent to giving that validator control of the account. Dapps that request module installation or validator replacement must be reviewed carefully by the user.

## Guardian recovery assumptions

Pali's guided guardian recovery flow is delayed validator replacement. Guardian approvals bind the exact account, chain, module, policy epoch, salt, and execution data. The current validator remains active until successful on-chain finalization. After the delay, anyone can submit finalization of the exact recovery already approved by the guardians, before it expires. The same account address and assets remain in place. Pali uses a fresh recovery salt per attempt, and the contract permits only one unexpired active schedule per account.

Guardian recovery is not a server-controlled backdoor: it requires the installed module and the configured guardian threshold. It is nevertheless a powerful delayed account authority. The on-chain executor accepts guardian-approved execution, not only the validator-replacement action constructed by Pali's UI; installed hook policies may impose further restrictions. Treat a compromised guardian threshold as a risk to account control and funds. Follow the [user recovery guide](../users/smart-account-validators#guardian-recovery) for setup, finalization, and owner intervention.

### Recovery email alerts

The recovery settings link to **Sysnode Account → Recovery alerts**. Sign in
with a verified email address, connect the deployed smart account on a supported
network, and approve the enrollment message in the wallet. This links the email
address to that public account; it does not give Sysnode any signing keys or
permission to move funds or cancel recovery.

Check that Sysnode reports monitoring as active. It monitors independently of
Pali being open and displays when a pending on-chain recovery becomes executable.
An email is a prompt to review the account in your trusted wallet,
not an approval or cancellation action. Delivery can be delayed or fail, and an
unavailable or lagging monitor is not evidence that the account is safe. The
service depends on its configured RPC; recent chain observations can reorganize.

If a recovery is unexpected and you still control the current approval method,
open that smart account's recovery settings and choose **Disable guardian
recovery**. After confirmation, Pali removes the recovery module, invalidating
pending guardian recovery and disabling that recovery path. Review and set up
trusted guardians again afterwards. This is an on-chain account action requiring
the current approval method and gas, not an email action. If submission is
uncertain, check its on-chain status before considering another attempt. Removal
must be confirmed before an unwanted recovery is finalized; it cannot reverse a
completed change of control. Keep replacement credentials safe, and retain old
credentials if other accounts or networks still use them.

New Pali recovery policies offer three- and seven-day waiting periods. The
ten-minute option is restricted to known testnets. Existing policies are not
changed automatically; the deployed contract's actual configuration remains
authoritative.

## Credential backup status

Pali may surface WebAuthn credential backup status when the browser and authenticator expose it. Treat this as operational signal, not as an on-chain security rule.

Backup status can indicate whether a credential appears device-bound, backup-eligible, or currently backed up/synced by the platform passkey provider. A synced passkey can improve convenience and device-loss recovery because the user may restore the credential through their Apple, Google, Microsoft, or other platform account. The tradeoff is that the effective security boundary now includes that platform account, its recovery process, and any devices where the passkey is synced.

| Credential status | Institution policy implication | User experience | Risk boundary |
| --- | --- | --- | --- |
| Backed up or synced | Accept when account recovery and onboarding convenience matter more than strict device isolation. | Best device-replacement and multi-device experience. Often the platform default for consumer passkeys. | Trust extends to the platform account, platform recovery flow, and synced devices. |
| Backup eligible | Decide whether eligibility alone is acceptable, because the credential may become synced later. | Flexible, but users may not understand whether sync is active. | Requires clear user guidance and periodic status review if the account value changes. |
| Device-bound or not backed up | Prefer for high-value, treasury, admin, or cold-style accounts. | More friction and more support burden if the device is lost. | Stronger isolation to a specific authenticator or hardware key. |
| Unknown or unavailable | Avoid for high-assurance policy decisions unless you have out-of-band authenticator controls. | User may proceed, but the institution cannot confidently classify the credential. | Ambiguous; do not treat as proof of cloud backup or proof of device-bound isolation. |

For higher-assurance institutional accounts, decide and document whether synced passkeys are acceptable. Synced passkeys are still secure for common wallet and dapp use because Pali and the dapp never receive the passkey private key, WebAuthn remains origin-bound, and the platform authenticator still performs user verification. They are simply not the right default for cold storage, treasury controls, or large long-term balances unless the institution explicitly accepts the platform-account recovery boundary.

## User communication

Use clear language in dapp copy and user support material. A good explanation tells the user:

- who can currently authorize the account
- whether a passkey, ECDSA owner, or composite policy is being installed
- whether any owner address is external to Pali
- whether guardian recovery is enabled and how long recovery takes
- who pays gas for deployment and account actions

## Do not rely on display text for enforcement

Wallet labels and explanatory text are disclosure fields. Enforcement is through on-chain modules and signatures.

## Local storage model

Pali stores these smart-account concepts:

- The passkey credential profile is lightweight local state for WebAuthn credentials: credential id, credential hash, public key, backup status, and display name.
- Smart-account metadata belongs to each account: address, chain id, factory, deployment salt, descriptor, active validator, available modules, installed modules, and deployment status.

The credential profile can exist before an account is created. A local smart account represents a Pali-managed account record that can be deployed, operated, and recovered according to its modules.
