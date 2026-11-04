# Transfer journal

This unreleased app has one canonical version-1 format. No intermediate development format is migrated or silently replaced. Unknown or malformed data remains preserved and unavailable.

The journal verifies signed transaction bytes against the wallet/account, chain and reviewed native or ERC20 intent. Writes are acknowledged before broadcast; ambiguous writes quarantine the owner until reopen. Complete-row compare-and-set preserves sibling chains. Status is a revisable RPC observation. Only explicit retry can resend identical bytes. Archive acknowledgement precedes replacement of an older confirmed record.
