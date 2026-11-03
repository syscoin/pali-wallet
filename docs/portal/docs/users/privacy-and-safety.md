---
title: Privacy and safety
---

Pali is designed to minimize what dapps can learn without explicit user action.

## What Pali does not expose

Pali does not expose seed phrases, private keys, passkey private material, wallet passwords, or unrestricted account lists to web pages.

## What dapps can request

Dapps can request public account addresses, provider state, network state, signatures, transaction approvals, PSBT signing, asset watch approvals, chain switching, smart-account creation, and batch execution.

## Connection safety

Only connect to dapps you trust. A connected dapp can see the account you approved for that origin and can request future actions. You can revoke site access from the wallet.

## Public blockchain data

Blockchain activity is public. Your address, transaction history, token approvals, UTXO activity, smart-account deployment, and smart-account activity may be visible on explorers and indexers.

## Network service providers

Selected RPC and Blockbook providers receive the account addresses and transaction queries or broadcasts needed for your actions. UTXO account queries may include an extended public key (xpub). Token discovery, explorers, pricing, network discovery and hardware-support services receive requests depending on the operation. These endpoints can also see your IP address and request timing. Connected dapps receive the public accounts you approve and any signatures you authorize.

## Private notes

This feature uses four fixed Tornado Classic ETH pools (0.1, 1, 10 and 100 ETH) on Ethereum mainnet; it does not make ordinary wallet activity private. Deposit and direct withdrawal require a signing-capable software HD or imported account. An imported watch-only account can provide context for a relayed withdrawal; hardware and smart accounts are not supported for these operations. Direct withdrawal links the gas payer and recipient publicly. A relayer has its own fees and trust risks. No anonymity or post-quantum privacy is guaranteed.

A private note is a bearer secret: anyone with it can withdraw. While your wallet is unlocked and you know its password, use **Reveal for backup** on each saved note and keep the backups private and secure. Your recovery phrase alone cannot restore generated notes after recovery, reset, or moving installations.

The Privacy service supplies public pool data and the relayer directory; the selected Ethereum RPC is separate, as is a chosen relayer's endpoint. The service defaults to `https://sysnode.info`. Its setting accepts an HTTPS origin, or HTTP on `localhost` or `127.0.0.1`, without a path, credentials, query or fragment. Changing the service clears prepared public pool data, so prepare again; saved notes remain. Providers can observe your IP address and request timing.

Pali can use its default Privacy service or your own Sysnode service. To run your own service, see the [Sysnode standalone guide](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

The default limit is 128 saved notes (up to 4 MiB). In **Note capacity**, you can choose 256 (up to 8 MiB) or 512 (up to 16 MiB); higher limits can use more local storage and slow vault operations. The limit changes only how many notes can be saved. Storage grows with saved data; no space is reserved in advance, and no notes are removed.

Use **Clear completed notes** to verify and remove completed notes. A known withdrawal must be finalized, as must any recorded related deposit; unverified notes remain saved. The selected Ethereum RPC receives the withdrawal transaction hash and, if present, the related deposit transaction hash, so its provider can link them. The check relies on that RPC's responses.

You cannot lower the limit below the number of saved notes. A note shown as spent may still lack the locally recorded withdrawal and transaction hash required for clearing and will remain saved. Clearing checks notes individually; if it is interrupted, earlier removals may already have completed. Refresh the list after an error before retrying.

## Smart-account privacy

Smart-account modules and executions are public on-chain. If a dapp asks to install an ECDSA owner or recovery module, review the owner addresses and recovery settings before approving.
