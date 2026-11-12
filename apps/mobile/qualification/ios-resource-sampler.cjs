// CI diagnostics only. Never retain process arguments, paths, memory contents or app data.
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { Buffer } = require('node:buffer');

const PROCESS_KINDS = Object.freeze({
  PaliQualification: 'qualification',
  Simulator: 'simulator',
  'com.apple.CoreSimulator.CoreSimulatorService': 'simulator-service',
  'com.apple.WebKit.WebContent': 'web-content',
  'com.apple.WebKit.GPU': 'web-gpu',
  'com.apple.WebKit.Networking': 'web-network',
  XCBBuildService: 'build-service',
  'swift-frontend': 'swift-compiler',
  clang: 'c-compiler',
});
const MAX_BYTES = 1024 * 1024;
const MAX_SAMPLES = 360;
const INPUT_BYTES = 512 * 1024;
const numeric = (value) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

function processUsage(text) {
  if (typeof text !== 'string' || text.length > INPUT_BYTES) return null;
  const groups = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+(?:\.\d+)?)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const name = match[3].split('/').pop();
    const kind = Object.hasOwn(PROCESS_KINDS, name) ? PROCESS_KINDS[name] : undefined;
    if (!kind) continue;
    const cpuPercent = Number(match[1]), rssBytes = Number(match[2]) * 1024;
    if (!numeric(cpuPercent) || cpuPercent > 10000 || !Number.isSafeInteger(rssBytes) || !numeric(rssBytes)) return null;
    const group = groups.get(kind) ?? { kind, count: 0, cpuPercent: 0, rssBytes: 0 };
    group.count++; group.cpuPercent += cpuPercent; group.rssBytes += rssBytes;
    if (group.count > 256 || !numeric(group.rssBytes)) return null;
    groups.set(kind, group);
  }
  return [...groups.values()].map(group => ({ ...group, cpuPercent: Math.round(group.cpuPercent * 100) / 100 }));
}

function memoryUsage(vm, system) {
  if (typeof vm !== 'string' || vm.length > 16384 || typeof system !== 'string' || system.length > 16384) return null;
  const pageSize = Number(/page size of (\d+) bytes/.exec(vm)?.[1]);
  const physicalBytes = Number(system.split('\n')[0]);
  const swap = /used\s*=\s*(\d+(?:\.\d+)?)([KMGT])/.exec(system);
  if (!numeric(pageSize) || !pageSize || !Number.isSafeInteger(physicalBytes) || !numeric(physicalBytes) || !physicalBytes || !swap) return null;
  const swapUsedBytes = Number(swap[1]) * 1024 ** ({ K: 1, M: 2, G: 3, T: 4 }[swap[2]]);
  if (!numeric(swapUsedBytes)) return null;
  const result = { physicalBytes, swapUsedBytes };
  for (const [label, key] of [['Pages free', 'freeBytes'], ['Pages active', 'activeBytes'], ['Pages inactive', 'inactiveBytes'],
    ['Pages wired down', 'wiredBytes'], ['Pages occupied by compressor', 'compressedBytes'], ['Pageouts', 'pageoutBytes']]) {
    const count = Number(new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm').exec(vm)?.[1]);
    const bytes = count * pageSize;
    if (!Number.isSafeInteger(bytes) || !numeric(bytes)) return null;
    result[key] = bytes;
  }
  return result;
}

function capture() {
  const read = (command, args) => {
    try { return execFileSync(command, args, { encoding: 'utf8', timeout: 2000, maxBuffer: INPUT_BYTES, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' } }); }
    catch { return undefined; }
  };
  const load = os.loadavg();
  return {
    load: load.length === 3 && load.every(numeric) ? load : null,
    memory: memoryUsage(read('/usr/bin/vm_stat', []), read('/usr/sbin/sysctl', ['-n', 'hw.memsize', 'vm.swapusage'])),
    processes: processUsage(read('/bin/ps', ['-axo', 'pcpu=,rss=,comm='])),
  };
}

function main() {
  const [output, mode] = process.argv.slice(2);
  if (process.platform !== 'darwin' || !output || (mode !== undefined && mode !== '--once') || process.argv.length > 4)
    throw Error('Expected macOS diagnostic output path and optional --once');
  const fd = fs.openSync(output, 'wx', 0o600), started = performance.now();
  let bytes = 0, samples = 0, timer, stopped = false;
  const close = () => { if (!stopped) { stopped = true; clearTimeout(timer); fs.closeSync(fd); } };
  const sample = () => {
    if (stopped) return;
    const value = `${JSON.stringify({ version: 1, elapsedMs: Math.round(performance.now() - started), ...capture() })}\n`;
    const size = Buffer.byteLength(value);
    if (bytes + size > MAX_BYTES) { close(); return; }
    fs.writeSync(fd, value); bytes += size; samples++;
    if (mode === '--once' || samples >= MAX_SAMPLES) close();
    else timer = setTimeout(sample, 5000);
  };
  process.once('SIGTERM', close); process.once('SIGINT', close);
  try { sample(); } catch { close(); process.exitCode = 1; }
}

module.exports = { processUsage, memoryUsage, MAX_BYTES, MAX_SAMPLES };
if (require.main === module) main();
