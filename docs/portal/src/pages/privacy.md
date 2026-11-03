---
title: Privacy policy
description: How Pali Wallet handles local wallet data and information used by network services.
---

<h1 id="privacy-policy" style={{ scrollMarginTop: '5rem' }}>Pali Wallet privacy policy</h1>

Updated November 2, 2026.

This notice describes how the Pali Wallet browser extension handles information when you use it, and the logging practices of Pali/Syscoin-operated services. Separate websites, dapps, blockchain networks and independent service providers have their own practices.

Pali processes information to provide wallet features: showing accounts, balances and assets; reviewing and submitting transactions or signatures; connecting to dapps; configuring networks; and providing optional features you choose. **Pali/Syscoin-operated services do not retain request or access logs and do not use usage or crash analytics.** They still process the requests needed to provide their services. Data deliberately saved for an optional service, such as a recovery-alert subscription, is separate from request logs.

## Information kept in the wallet

Pali is a self-custodial wallet. Your recovery phrase and wallet-controlled private keys are held in the wallet on your device, protected by your wallet password; the extension stores encrypted private-note records locally. The extension also keeps wallet data and preferences, such as account and network information, site permissions and transaction records, in browser storage. Not every item in browser storage should be assumed to be secret or encrypted.

Passkey private material is held by your authenticator; its handling and any synchronization depend on your device, browser and passkey provider. Hardware wallets and their associated software handle their own keys. Pali can use public account information and signatures from those devices without requiring you to enter their private keys into the extension.

Keep your recovery phrase, private keys, password and private notes secret. Pali's dapp provider does not provide those secrets as wallet API results. Anyone who has a private note can withdraw with it. Back up each note separately while you can unlock the wallet and confirm your password: the recovery phrase alone does not recreate randomly generated notes, and wallet recovery deletes saved private notes. Do not send secrets to support or enter them into a website that asks for them.

## Network and service requests

The extension contacts the network and services needed for the features you use. Those services can see your IP address, request time and information in the request. Depending on your selected network, settings and actions:

- Your selected blockchain RPC and Blockbook providers receive requests needed to read balances, account or transaction information and submit transactions. These requests can include public addresses, transaction details or hashes; UTXO account queries may include an extended public key (xpub), which can reveal related addresses and activity.
- Explorer and token-discovery providers may receive account addresses, contract addresses or transaction identifiers when the wallet requests indexed information or you open an explorer. Price, token metadata and network-discovery services may receive asset, network and currency queries. Hardware-wallet connections may use device-related software or services.
- A dapp you connect can receive the public account information you approve, provider and network information, and signatures or transaction results you authorize. Depending on the requested and approved wallet operation, UTXO dapps may also receive public key or xpub information. Blockchain transactions and smart-account activity are public and can be retained and analyzed by network participants.

The no-logs and no-analytics practices stated above apply to Pali/Syscoin-operated services. Independent RPC, Blockbook, explorer, relayer and other third-party services have their own practices. Choosing or changing a provider does not erase data it may already hold.

## Optional Privacy feature

The Privacy feature uses four fixed Tornado Classic ETH pools on Ethereum mainnet. The Privacy service supplies public pool data and a relayer directory. It defaults to `https://sysnode.info`, and you may configure another supported service origin. This service is separate from your selected Ethereum RPC and from a selected relayer. Changing the Privacy service clears prepared public pool data, so you must prepare again; saved private notes remain in the wallet.

Pool-data requests do not send your private note or wallet address as a lookup. The service can observe the selected pool, IP address and timing. When you explicitly clear completed notes, your selected Ethereum RPC receives the known withdrawal transaction hash and, where recorded, the related deposit hash; its provider can link them. The check relies on that RPC's responses.

If you choose a relayed withdrawal, the chosen relayer receives the proof and public withdrawal inputs, including the pool, root, nullifier hash, recipient and fee. It does not need the private note or witness. Direct withdrawal instead publicly links the gas-paying account and recipient. Local proof generation may also download a public proving key from its hosting service when it is not already cached. These features do not guarantee anonymity or post-quantum privacy.

## Optional recovery alerts

Pali can link you to Sysnode's separate recovery-alert service. If you enroll, you use a verified email address, connect a supported deployed smart account and approve an enrollment signature. Sysnode stores your account email and recovery-alert information, including the public account, network, optional label and monitoring and notification records, to provide this service. An alert email can include the account, network, label, recovery event and transaction link. This service data is separate from request and access logs. Alerts can be delayed or unavailable and cannot themselves cancel a recovery.

Disabling a recovery alert stops monitoring; it does not itself erase the stored subscription or account information. To request deletion of service-account data, contact the service operator. Removing Pali from your browser does not delete a separate Sysnode account, previously delivered emails or public blockchain records. Email providers and other independent services have their own retention practices.

## Local storage, retention and your choices

Wallet records and preferences are kept in this browser installation to support the features you use. Some caches are refreshed or cleared automatically. You can remove wallet data through the wallet controls or browser storage controls; do so only after making the backups you need. Browser-profile backups or copies you made may retain earlier data.

You can manage connected sites and revoke their wallet access, select or configure supported network and service endpoints, and choose whether to use optional Privacy and recovery-alert features. Wallet removal or recovery affects local wallet data; it cannot remove public blockchain records, copies you created, or information already received by independent services. Before removing or recovering a wallet, make and secure any necessary recovery-phrase, imported-key and private-note backups.

## Contact

For questions about the Pali Wallet extension, contact the developer at [pali@syscoin.org](mailto:pali@syscoin.org), the developer email listed on the [Pali Wallet Chrome Web Store listing](https://chromewebstore.google.com/detail/pali-wallet/mgffkfbidihjpoaomajlbgchddlicgpn). The [Pali Wallet website](https://www.paliwallet.com/) also points users to its community support channel. Never include a recovery phrase, password, private key or private note in a support request.

## Policy updates

This page is updated when these practices change. The date above identifies the current notice. For practical guidance, see [Privacy and safety](https://docs.paliwallet.com/docs/users/privacy-and-safety) and [Recovery and backups](https://docs.paliwallet.com/docs/users/recovery-and-backups).
