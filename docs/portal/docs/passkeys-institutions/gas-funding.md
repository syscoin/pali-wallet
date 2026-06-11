---
title: Gas and funding
---

Pali smart accounts are contract accounts, so the account authorization and the gas payer are separate concerns. A passkey or validator approval authorizes the smart account action. A funded wallet account still pays the network fee for deploying the account, installing modules, scheduling recovery, or executing calls.

## Current model

The current Pali smart-account flow uses wallet-paid gas:

- Account deployment is sent by a local funded EVM account.
- Validator replacement and module installation are smart-account executions submitted by a local gas payer.
- `wallet_sendCalls` batches are authorized by the active smart-account validator and submitted as one transaction.
- Guardian recovery start/finalize transactions are sent by a local gas payer or guardian account.

This means a user can approve with a passkey, but the wallet still needs native gas on the active chain.

## What dapps should tell users

Dapps should avoid saying "gasless" for the current flow. Better wording is:

- "Pali will create a smart account and may ask for gas."
- "You will approve the account action, and Pali will submit it on-chain."
- "Keep a small amount of native token available for deployment and recovery."

## Future gas payment capabilities

The smart-account design does not prevent future paymaster or relay support. Those features should be exposed as explicit wallet capabilities and should be described separately from validator authorization.

For now, do not pass legacy gas-payer or paymaster objects to `wallet_prepareSmartAccount`. The current creation request is based on account label and authenticator/module configuration.

## Institution guidance

- Keep the deployment gas payer funded.
- Monitor failed deployments and failed module installs.
- Explain who controls each validator or guardian.
- Avoid conflating "validator approval" with "free transaction."
