const { X509Certificate } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');
const process = require('node:process');
const { setTimeout: delay } = require('node:timers/promises');
const { createPublicPoolFixture } = require('./public-pool-server.cjs');
const { readPublicPoolCa } = require('./public-pool-ca.cjs');
const { publicPoolBuild } = require('./public-pool-contract.ts');

function readBounded(file, limit) {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > limit) throw Error('PUBLIC_POOL_FIXTURE_FILE_INVALID');
  const content = readFileSync(file);
  if (content.length > limit) throw Error('PUBLIC_POOL_FIXTURE_FILE_INVALID');
  return content;
}

function readFixtureBuild(receiptFile) {
  const receipt = JSON.parse(readBounded(receiptFile, 8192));
  if (receipt.identifier !== 'com.paliwallet.qualification' || receipt.qualificationEntry !== 'qualification/index.tsx' ||
      receipt.http || receipt.physical) throw Error('PUBLIC_POOL_FIXTURE_BUILD_INVALID');
  return publicPoolBuild(receipt.publicPool);
}

async function run([platform, receiptFile, caFile, certFile, keyFile, reportFile]) {
  if (!['ios', 'android'].includes(platform) || ![receiptFile, caFile, certFile, keyFile, reportFile].every(Boolean))
    throw Error('PUBLIC_POOL_FIXTURE_ARGUMENTS_INVALID');
  const { build, caSha256 } = readFixtureBuild(receiptFile);
  const ca = readPublicPoolCa(caFile);
  const cert = readBounded(certFile, 8192);
  if (ca.sha256 !== caSha256 || !new X509Certificate(cert).verify(new X509Certificate(ca.pem).publicKey))
    throw Error('PUBLIC_POOL_FIXTURE_TLS_CA_MISMATCH');
  const key = readBounded(keyFile, 8192);
  const owner = new AbortController();
  const stop = () => owner.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const fixture = await createPublicPoolFixture({ key, cert });
    try {
      const { snapshotPort, anchorPort, token } = fixture.launch;
      const uri = `pali-wallet-qualification://run?phase=create&scenario=import&poolSnapshotPort=${snapshotPort}&poolAnchorPort=${anchorPort}&poolToken=${token}`;
      console.log(JSON.stringify({ uri, report: `pali-native-public-pool-${token}.json`, snapshotPort, anchorPort, caSha256 }));
      const deadline = performance.now() + 15 * 60_000;
      while (performance.now() < deadline) {
        if (owner.signal.aborted) throw Error('PUBLIC_POOL_FIXTURE_CANCELLED');
        let text;
        try { text = readBounded(reportFile, 8192); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        if (text !== undefined) {
          const report = JSON.parse(text);
          if (!report ||
              Object.keys(report).sort().join(',') !== 'caSha256,kind,lockfileSha256,networkCalls,platform,result,sessionId,sourceRevision,status,token,version' ||
              Object.entries({ ...build, caSha256, kind: 'native-public-pool', status: 'passed', platform, token, networkCalls: 0 })
                .some(([key, value]) => report[key] !== value) ||
              typeof report.sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(report.sessionId))
            throw Error('PUBLIC_POOL_FIXTURE_REPORT_INVALID');
          fixture.assertComplete(report.result);
          console.log(JSON.stringify({ passed: true, ...build, platform, caSha256, result: report.result }));
          return;
        }
        await delay(500, undefined, { signal: owner.signal });
      }
      throw Error('PUBLIC_POOL_FIXTURE_REPORT_TIMEOUT');
    } finally { await fixture.close(); }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (require.main === module) {
  if (process.env.CI !== 'true' || process.env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION !== '1')
    throw Error('PUBLIC_POOL_FIXTURE_REQUIRES_ISOLATED_CI');
  run(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { readFixtureBuild };
