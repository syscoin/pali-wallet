---
title: Smart accounts and validators
---

Pali smart accounts are EVM contract accounts that can be controlled by modules. A passkey is one supported way to control a smart account. Instead of signing every action with a normal EOA private key, the user can approve actions with the browser or operating system passkey UI.

Behind the scenes, WebAuthn passkeys use P-256 signatures. Pali's passkey validator is built so those P-256 proofs can be verified by the smart account. That is why a biometric or platform passkey approval can authorize an on-chain action without exposing the passkey private key to Pali or the dapp.

## Why use a smart account?

- Modular approval methods for everyday use.
- Wallet-owned ECDSA control when a normal wallet key should own the account.
- Co-managed policies through composite validators.
- Batch execution with a single user approval.
- Guardian recovery after a timelock.
- Deterministic account creation so Pali can reconstruct account records.

## Passkeys, ECDSA, and co-managed accounts

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>Users can create modular smart accounts from Settings or from dapp requests, then choose the validator that controls approvals.</figcaption>
</figure>

Pali supports these validator styles:

- **Passkey:** the browser or operating system asks for WebAuthn approval.
- **ECDSA:** configured EVM owner addresses approve account actions.
- **SLH-DSA:** Pali's local post-quantum signer approves actions using its encrypted signer state. See [Post-quantum signer](./post-quantum-signer) for backup and signature-counter limitations.
- **Composite:** child validators are combined under a threshold, such as passkey or ECDSA.

Think of validators as the answer to "who can approve actions for this account?" — and the useful part is that the answer can change without changing your account:

- **One approval** (1-of-N): one configured child validator must approve.
- **A threshold of approvals** (t-of-N): at least the configured number of child validators must approve.
- **Every approval** (N-of-N): all configured child validators must approve.

Pali collects locally available builtin child approvals in the policy's configured order until its threshold is met. Declining an approval stops that request; Pali does not silently switch to another signer after a rejection. A policy must retain enough locally signable builtin children to meet its threshold. Compatible custom validators may be optional children, but Pali does not collect external/custom signatures or cross-device approvals for them. Nested composite policies are not supported by this version.

The composite builder requires at least two installed validators. The guided approval-method switch replaces the previous validator. The current advanced **Custom validator** (bring your own module) flow can retain additional compatible validators, but requires correct module initialization data; it is not a simple cross-device approval setup.

Changing the validator does not change the smart-account address, balances, or history. Access to a local signer still depends on its key or passkey being available; changing the policy does not restore missing signer state or coordinate SLH-DSA usage across restored devices.

Guardians are a separate, delayed authority rather than your everyday approval method. A sufficient set of guardian approvals can authorize recovery of account control, so choose and protect them accordingly. The delay gives the current owner time to react; it does not make an untrusted guardian safe. See [Guardian recovery](#guardian-recovery).

Pali can use a shared wallet passkey profile or create a separate passkey credential for an account. Shared passkeys are convenient for users who want one wallet-controlled passkey. Separate passkeys can help isolate credentials per service or policy.

## Deployment

A smart account may exist as a counterfactual address while Pali prepares creation. Pali derives the address from deterministic factory inputs, deploys through the Pali factory, and saves durable account metadata locally.

The account starts from a wallet-owned bootstrap validator for deterministic deployment. If the user or dapp selected a passkey or another validator, Pali installs that validator and removes the bootstrap validator through a smart-account execution.

## Network support

Smart accounts require the Pali factory and module contracts to exist at the addresses Pali uses for the active chain. In this Pali build, `zkTanenbaum` testnet is configured for smart-account creation, and zkSYS production support uses the same model once the production factory and module addresses are configured.

Other compatible EVM chains can use the same contracts. When the active network has canonical CREATE2 support, Pali can deploy the missing smart-account setup from inside the wallet: open Settings, go to Advanced, and use the **Smart account setup** Deploy button. Passkey validators need P-256 WebAuthn verification support, which many modern EVM environments expose through a P-256/passkey precompile.

### Pending setup

Slow setup exposes a **Check status** action. Leaving the page or switching networks does not cancel a transaction already submitted. Return to the original network and check its setup status before trying another deployment. A timeout or missing reply does not prove that nothing was deployed.

## Recovery

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>Smart-account settings begin with registration when the account is not yet deployed. Once registered, the same settings provide approval-method and recovery controls.</figcaption>
</figure>

If local wallet state is deleted or Pali is installed on a new device, deterministic Pali smart accounts can be reconstructed from wallet metadata and chain configuration. Accounts with passkey validators still need access to the relevant passkey credential to approve actions.

One passkey credential can control multiple smart accounts. Pali separates the passkey credential profile from each deployed account's smart-account metadata.

## Guardian recovery

Pali uses self-custodial recovery guardians for smart-account recovery. A guardian is an EVM address the user controls separately from the active validator — typically a backup EVM wallet, imported account, or hardware wallet, but on-chain a guardian can be **any account that can prove a signature**, including a contract account. While the account is healthy, the user can add or remove guardians and update the recovery wait period from the policy screen.

The recovery module verifies guardian approvals with standard signature checking: a plain ECDSA signature for normal addresses, or an ERC-1271 contract-signature check when the guardian address is itself a contract. That means a guardian can be another smart account — including one whose own signing policy is a composite, a custom validator, or a future post-quantum validator. The recovery path then inherits whatever signature scheme the guardian account enforces, so recovery security is not limited to classic ECDSA keys.

Pali's guardian screens can collect approvals from local key-based guardians (wallet, imported, or hardware accounts) and local smart-account guardians that Pali can sign for, including SLH-DSA smart accounts. A smart-account guardian must already be deployed on-chain to answer ERC-1271 signature checks. An arbitrary external guardian that is not available as a local Pali signing account still needs an external recovery flow to produce its approval.

### Set up, start, and finish recovery

1. While your current approval method still works, open the smart account's **Recovery guardian** settings. Register the smart account first if it is not yet deployed. Choose a separately controlled guardian and a waiting period, then approve the on-chain setup. Keep the required gas payer funded.
2. If that approval method is lost, use **Start recovery** to choose and prove control of a replacement approval method. The configured guardian signs the exact recovery intent. Starting the request needs gas and does not immediately replace the current owner.
3. Wait until the on-chain recovery becomes executable. The current approval method remains active during this wait. Starting recovery does not move the account's funds or change its address.
4. Return to the same account and network to finish the saved recovery. After the delay, anyone can submit finalization of the exact recovery already approved by the guardians, before it expires. The configured replacement then controls the same smart account; its address, assets, and history remain unchanged.

After successful finalization, the old active approval method no longer authorizes that account through the replaced validator. Do not delete its key or passkey until you have checked whether other accounts or networks still need it. A request that expires before finalization needs a new recovery attempt.

New Pali policies offer **3 days** or **7 days** of waiting. **10 minutes** is available only on known testnets for testing. These are Pali's setup choices, not an enforced contract-wide minimum; existing on-chain policies keep their actual settings. The waiting period is also distinct from the subsequent window in which finalization is allowed.

### Stop an unexpected recovery

If you still control the current approval method, open that account's recovery settings and choose **Disable guardian recovery**. Check the account and network in the confirmation, then approve and pay the network gas. Confirmed removal invalidates pending recovery requests, including ones started outside this wallet, and removes the guardian recovery path. Set up trusted guardians again if you want recovery protection afterwards.

Act before the unwanted recovery is finalized. Disabling recovery cannot reverse a completed validator replacement. If Pali says the removal result is uncertain, use **Check removal status** before considering another attempt; closing the screen, an error, or a timeout does not cancel a submitted transaction. Do not send the same request again blindly.

### Optional recovery email alerts

The settings link opens **Sysnode Account → Recovery alerts**. Use a verified email address, connect this deployed smart account on a network supported by Sysnode, and approve the enrollment message with the account's current signing method. This is optional and separate from installing a guardian; Sysnode receives no private signing keys and cannot move funds or cancel recovery.

Monitoring continues while Pali is closed, but depends on the service, its network RPC, and email delivery. Alerts can be delayed or fail, and recent chain observations can be reorganized. No email is not proof that no recovery was started. Treat an alert as a reason to inspect the exact account and network in your trusted wallet, not as an approval request. See [Recovery alerts and operational limits](../passkeys-institutions/security-and-operations#recovery-email-alerts).

The guardian signature binds the chain, account address, recovery module, recovery salt, execution mode, and recovery calldata. Pali uses a fresh salt for each recovery attempt, and the module permits only one active recovery per account.

Technical note: the guardian recovery executor stores a per-account guardian set, threshold, delay, expiration, and pending recovery. Pali currently exposes simple guardian flows for UX clarity, while the module supports threshold policies such as 1-of-N or M-of-N. The guided wallet flow builds validator replacement; the on-chain executor is not restricted to that UI action. A guardian threshold can sign delayed account execution, subject to any installed hook policy. Treat guardian compromise as a risk to the account and its funds, not merely to its label or login.

## Dapp-created accounts

Dapps can request a smart account with `wallet_prepareSmartAccount`:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "p256-webauthn"
  }
}
```

Dapps can also request an ECDSA validator:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "ecdsa",
    "config": {
      "owners": ["0x..."],
      "threshold": 1
    }
  }
}
```

If the requested ECDSA owner is not a local Pali account, Pali shows a warning and requires explicit acknowledgement before continuing.

## Standards references

Pali smart accounts are built around public smart-account standards:

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337) for UserOperation-style account execution.
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579) for validator and executor modules.
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271) for signatures from contract accounts.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) for passkey approvals.
