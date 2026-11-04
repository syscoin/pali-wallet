// Public fake report fields only; no private key material is used by host-runner tests.
function importedEvidence(phase = 'create') {
  return {
    nativeImportedVerified: true, importedAccountId: 'imported:60:1', importedAccountIndex: 1,
    importedAddress: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF', importedChainIds: ['1', '5700', '57057'],
    importedTransferHashes: ['0x' + '1'.repeat(64), '0x' + '2'.repeat(64), '0x' + '3'.repeat(64)],
    importedJournalContainerVersion: 1, importedSignatures: phase === 'create' ? 3 : 0,
    importedAuthorizations: phase === 'create' ? 0 : 3, importedInjectedBroadcasts: 3,
    importedRestoredFromJournal: phase === 'restart', importedKeyRevealVerified: true,
  };
}
module.exports = { importedEvidence };
