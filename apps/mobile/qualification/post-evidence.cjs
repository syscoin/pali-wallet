/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');
// Bind the current native graph and its shared account, replay and HTTP code.
const POST_REQUIRED_MAPPED_SOURCES = Object.freeze([
  "apps/mobile/qualification/index.tsx",
  "apps/mobile/scripts/qualificationSdkIdentity.ts",
  "apps/mobile/qualification/launch-parameters.ts",
  "apps/mobile/qualification/http-contract.ts",
  "apps/mobile/qualification/physical-contract.ts",
  "apps/mobile/qualification/capture-crypto-load.ts",
  "apps/mobile/src/crypto/quickCryptoLoad.ts",
  "apps/mobile/src/crypto/quickCryptoInstall.ts",
  "apps/mobile/qualification/native-handle-contract.ts",
  "apps/mobile/qualification/storage-diagnostics.ts",
  "apps/mobile/src/storage/openStages.ts",
  "apps/mobile/src/storage/types.ts",
  "apps/mobile/src/platform/cryptoBootstrap.native.ts",
  "apps/mobile/src/crypto/native.native.ts",
  "apps/mobile/src/crypto/provider.ts",
  "apps/mobile/src/crypto/qualification.ts",
  "apps/mobile/src/storage/coordinator.ts",
  "apps/mobile/src/storage/sqlite.ts",
  "apps/mobile/src/storage/json.ts",
  "apps/mobile/src/crypto/qualificationFull.ts",
  "apps/mobile/src/crypto/diagnostics.ts",
  "apps/mobile/src/platform/http.native.ts",
  "apps/mobile/src/platform/httpPolicy.ts",
  "apps/mobile/qualification/http-native.ts",
  "apps/mobile/src/platformRpc.ts",
  "source/shared/evmNetworks.ts",
  "apps/mobile/src/core/addresses.ts",
  "apps/mobile/src/custody/authority.ts",
  "apps/mobile/src/custody/types.ts",
  "apps/mobile/src/custody/keyringRuntime.ts",
  "apps/mobile/src/custody/transferJournal.ts",
  "apps/mobile/src/custody/networkContext.ts",
  "apps/mobile/src/custody/transferIntent.ts",
  "source/shared/erc20.ts",
  "apps/mobile/src/portfolio/erc20Metadata.ts",
  "apps/mobile/src/custody/accountIdentity.ts",
  "apps/mobile/src/custody/walletCatalogue.ts",
  "apps/mobile/src/custody/importedAccounts.ts",
  "apps/mobile/src/custody/evmFeeContracts.ts",
  "apps/mobile/src/core/amounts.ts",
  "source/utils/nativeBalance.ts",
  "apps/mobile/src/portfolio/tokenRegistry.ts",
  "apps/mobile/src/activity/historyStore.ts",
  "apps/mobile/src/activity/types.ts",
  "apps/mobile/src/custody/hdKeyExport.ts",
  "apps/mobile/src/platform/unsupportedNodeTransport.native.js",
  "apps/mobile/src/custody/seedBackup.ts",
  "apps/mobile/src/storage/native.native.ts",
  "apps/mobile/src/storage/sqlCipher.ts",
  "apps/mobile/src/storage/nativePolicyDiagnostic.ts",
  "apps/mobile/qualification/hd-accounts.ts",
  "apps/mobile/qualification/erc20-transfer.ts",
  "apps/mobile/src/custody/transfers.ts",
  "apps/mobile/src/custody/transferRpc.ts",
  "apps/mobile/src/custody/evmTransferReadRpc.ts",
  "apps/mobile/qualification/nevm-transfer.ts",
  "apps/mobile/qualification/zksys-transfer.ts",
  "apps/mobile/qualification/hd-key-reveal.ts",
  "apps/mobile/qualification/imported-evm.ts",
  "apps/mobile/qualification/post-native.ts",
  "apps/mobile/qualification/post-contract.ts",
  "apps/mobile/qualification/post-fixtures.ts",
  "source/shared/passwordPolicy.ts",
  "source/shared/networkText.ts",
  "source/shared/paliHttpIdentity.ts",
  "source/shared/evmFeeGuard.ts",
  "source/shared/evmTransactionObservation.ts",
  "source/wallet/accountRecords.ts",
  "source/wallet/accountRecovery.ts",
  "source/wallet/importedAccountRecovery.ts",
  "source/wallet/evmSignedRecords.ts",
  "source/wallet/evmSignedReplay.ts",
  "apps/mobile/src/storage/accountRecordKey.ts",
  "apps/mobile/src/storage/recoverySnapshot.ts",
  "apps/mobile/src/storage/walletIdentity.ts",
  "apps/mobile/src/storage/noteDomain.ts",
  "apps/mobile/src/custody/sharedSignedRecords.ts",
  "apps/mobile/src/custody/recoveryInventory.ts"
]);
function assertPostMappedSources(map, readExpected) {
  if (!map || map.version !== 3 || !Array.isArray(map.sources) || !Array.isArray(map.sourcesContent) ||
      map.sources.length !== map.sourcesContent.length || map.sources.length > 10000) throw Error('POST_SOURCE_MAP_INVALID');
  const seen = new Set();
  for (let i = 0; i < map.sources.length; i++) {
    const source = map.sources[i];
    if (typeof source !== 'string') throw Error('POST_SOURCE_MAP_INVALID');
    if (source.startsWith('\0') || source.includes('/node_modules/')) continue;
    const relative = source === '/scripts/qualificationSdkIdentity.ts' ||
      source.startsWith('/qualification/') || source.startsWith('/src/') || source.startsWith('/modules/') ? `apps/mobile${source}`
      : source.startsWith('/source/') ? source.slice(1) : null;
    if (!relative || relative.split('/').includes('..') || seen.has(relative) || typeof map.sourcesContent[i] !== 'string') throw Error('POST_SOURCE_MAP_INVALID');
    const expected = readExpected(relative);
    if (!Buffer.isBuffer(expected) || !expected.equals(Buffer.from(map.sourcesContent[i]))) throw Error('POST_SOURCE_MAP_MISMATCH');
    seen.add(relative);
  }
  if (POST_REQUIRED_MAPPED_SOURCES.some(source => !seen.has(source))) throw Error('POST_SOURCE_MAP_MISSING');
  return seen.size;
}
function assertCurrentPostSourceMap(map) {
  const repository = path.resolve(__dirname, '../../..');
  return assertPostMappedSources(map, relative => {
    const file = path.join(repository, relative), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('POST_SOURCE_MAP_INVALID');
    return fs.readFileSync(file);
  });
}
module.exports = { POST_REQUIRED_MAPPED_SOURCES, assertPostMappedSources, assertCurrentPostSourceMap };
