# Wallet catalogue

This unreleased app has one canonical version-1 format. No intermediate development format is migrated or silently replaced. Unknown or malformed data remains preserved and unavailable.

The catalogue binds the authenticated wallet identity, HD/imported accounts, saved EVM registrations and active selection. Mutations use revision-checked compare-and-set and revoke the prior context. Default networks only seed a new catalogue; they never overwrite saved endpoints.
