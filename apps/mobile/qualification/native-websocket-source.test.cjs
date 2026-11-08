/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('owned socket is compiled through normal Android autolinking and has a JVM gate', () => {
  const config = JSON.parse(
    read('modules/pali-walletconnect-socket/expo-module.config.json')
  );
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, [
    'org.syscoin.pali.websocket.PaliWalletConnectSocketModule',
  ]);
  assert.equal(
    JSON.parse(read('package.json')).expo.autolinking.nativeModulesDir,
    './modules'
  );
  assert.match(
    read('modules/pali-walletconnect-socket/android/build.gradle'),
    /expo-module-gradle-plugin/
  );
  assert.match(
    read('modules/pali-walletconnect-socket/android/build.gradle'),
    /implementation 'com\.facebook\.react:react-android'/
  );
  assert.match(
    fs.readFileSync(
      path.resolve(
        root,
        '../../.github/workflows/mobile-native-qualification.yml'
      ),
      'utf8'
    ),
    /:pali-walletconnect-socket:testDebugUnitTest/
  );
});

test('native record precedes network entry and pending cancellation uses cancel', () => {
  const module = read(
    'modules/pali-walletconnect-socket/android/src/main/java/org/syscoin/pali/websocket/PaliWalletConnectSocketModule.kt'
  );
  assert.match(module, /private val socketRegistry = SocketRegistry\(\)/);
  assert.doesNotMatch(module, /private val registry\b/);
  assert(
    module.indexOf('socketRegistry.create(id)') <
      module.indexOf('client.newWebSocket(')
  );
  assert.match(module, /socketRegistry\.attach\(connection, socket\)/);
  assert.match(module, /OnDestroy \{ socketRegistry\.invalidate\(\) \}/);
  assert.doesNotMatch(
    module,
    /\.message\b|printStackTrace|Log\.|trustAll|hostnameVerifier|sslSocketFactory/
  );
  const registry = read(
    'modules/pali-walletconnect-socket/android/src/main/java/org/syscoin/pali/websocket/SocketRegistry.kt'
  );
  assert.match(
    registry,
    /if \(action\.second\) socket\.close\(code, reason\) else socket\.cancel\(\)/
  );
  assert.match(registry, /connections\[connection\.id\] !== connection/);
});

test('qualification captures the owned constructor before the network guard and preserves its subclass', () => {
  const qualification = read('qualification/index.tsx');
  const capture = qualification.indexOf(
    'const NativeWebSocket = await getWalletConnectWebSocket()'
  );
  assert(
    capture > 0 && capture < qualification.indexOf('globalThis.WebSocket =')
  );
  assert.match(qualification, /WebSocket: NativeWebSocket, launch/);
  const runtime = read('src/platform/walletConnectRuntime.native.ts');
  assert.match(runtime, /Platform\.OS !== 'android'/);
  assert.match(
    runtime,
    /socket\.prototype\.isPrototypeOf\(globalThis\.WebSocket\?\.prototype\)/
  );
  const transport = read('src/connections/walletConnect.ts');
  const prepare = transport.indexOf('await owned(options.preparePlatform())');
  const load = transport.indexOf(
    'await owned((options.loadSdk ?? officialSdk)())'
  );
  assert(prepare > 0 && load > prepare);
});

test('public Expo Blob is pinned and scoped without replacing global Blob', () => {
  assert.equal(
    JSON.parse(read('package.json')).dependencies['expo-blob'],
    '58.0.3'
  );
  assert.equal(
    JSON.parse(read('package-lock.json')).packages['node_modules/expo-blob']
      .version,
    '58.0.3'
  );
  const source = read('modules/pali-walletconnect-socket/index.ts');
  assert.match(source, /import \{ Blob as ExpoBlob \} from 'expo-blob'/);
  assert.match(source, /value instanceof ExpoBlob/);
  assert.doesNotMatch(source, /globalThis\.Blob\s*=/);
  assert.match(
    read('modules/pali-walletconnect-socket/socket.ts'),
    /Buffer\.from\(bytes\.buffer, bytes\.byteOffset, bytes\.byteLength\)/
  );
});
