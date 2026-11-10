import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import { assertQualificationBuild, parseQualificationLaunch } from './launch-parameters.ts';
import {
  physicalBuild,
  physicalLaunch,
  physicalReportFields,
  resetPhysicalFixture,
} from './physical-contract.ts';
import type { PhysicalLaunch } from './physical-contract.ts';
import { captureQualificationCryptoLoad, captureQualificationModuleLoad } from './capture-crypto-load.ts';
import { qualifyNativeHandleContract } from './native-handle-contract.ts';
import { createStorageQualificationDiagnostic } from './storage-diagnostics.ts';
import { httpBuild, type HttpLaunch } from './http-contract.ts';
import { withWalletConnectQualificationScope } from './walletconnect-scope.ts';
import type { WalletConnectQualificationDiagnostic } from './walletconnect-native.ts';
import { makePublicPoolFailure, PUBLIC_POOL_FAILURE_FILE, publicPoolBuild, type PublicPoolLaunch } from './public-pool-contract.ts';
import { parsePrivateProofReport, privateProofReportName } from './private-proof-contract.ts';
import { createPrivateProofDiagnostic, PRIVATE_PROOF_CHECK } from './private-proof-diagnostics.ts';
import { createSentryIsolatedDiagnostic } from './sentry-isolated-diagnostics.ts';
import { SENTRY_ISOLATED_CHECK } from './native-sentry-isolated.ts';

import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { NativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import type { FullSlhEvidence } from './native-slh-full.ts';
import type { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import {
  ensureNativeCryptoReady,
  nativeCryptoCheckpoint,
  nativeCryptoInstallDiagnostic,
  nativeCryptoLoadDiagnostic,
} from '../src/platform/cryptoBootstrap';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import type {
  CryptoFullCase,
  CryptoLoadDiagnostic,
} from '../src/crypto/diagnostics.ts';
import type { FullCryptoQualification } from '../src/crypto/qualificationFull.ts';

// Public BIP39 fixture only. This entry is selected exclusively by the isolated
// qualification configuration and never imported by the production entry.
const PUBLIC_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = '123456';
const EXPECTED_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const EXPECTED_HD_ADDRESS = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0';
const EXPECTED_ERC20_HD_ADDRESS = '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A';
const EXPECTED_NEVM_HD_ADDRESS = '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E';
const EXPECTED_ZKSYS_HD_ADDRESS = '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA';
type Phase = 'create' | 'restart';
type Scenario = 'import' | 'generate';
type Check = { name: string; durationMs: number };
type LaunchParameters = {
  phase: Phase;
  scenario: Scenario;
  address: string | null;
  physical?: never;
  http?: HttpLaunch;
  publicPool?: PublicPoolLaunch;
  privateProof?: Readonly<{ token: string }>;
} | PhysicalLaunch;
const expect = (value: unknown) => {
  if (!value) throw Error('QUALIFICATION_ASSERTION_FAILED');
};

async function launchParameters(): Promise<LaunchParameters> {
  const physical = Constants.expoConfig?.extra?.paliPhysicalQualification;
  if (physical === undefined) {
    assertQualificationBuild(
      Constants.expoConfig?.ios?.bundleIdentifier,
      Constants.expoConfig?.android?.package
    );
  }
  if (Platform.OS === 'ios') {
    // NSArgumentDomain is read only by this dedicated fixture entry. Direct
    // native launch avoids SpringBoard's confirmation for external URL opens.
    const { Settings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('react-native') as typeof import('react-native');
    const raw = Settings.get('PaliQualificationURL');
    if (physical !== undefined) {
      if (Constants.executionEnvironment === 'storeClient')
        throw Error('PHYSICAL_QUALIFICATION_STANDALONE_REQUIRED');
      return physicalLaunch(raw, physicalBuild(
        physical,
        Constants.expoConfig?.ios?.bundleIdentifier,
        Constants.expoConfig?.android?.package
      ));
    }
    return parseQualificationLaunch(raw);
  }
  if (physical !== undefined)
    throw Error('PHYSICAL_QUALIFICATION_IOS_REQUIRED');
  const initial = await Linking.getInitialURL();
  const raw =
    initial ??
    (await new Promise<string>((resolve, reject) => {
      const subscription = Linking.addEventListener('url', ({ url }) => {
        clearTimeout(timer);
        subscription.remove();
        resolve(url);
      });
      const timer = setTimeout(() => {
        subscription.remove();
        reject(Error('QUALIFICATION_LINK_MISSING'));
      }, 15000);
    }));
  return parseQualificationLaunch(raw);
}

function QualificationApp() {
  const [status, setStatus] = useState('Waiting for qualification command');
  useEffect(() => {
    let started = false;
    let privateProofLifetime: AbortController | undefined;
    const qualificationLifetime = new AbortController();
    const run = async () => {
      if (started) return;
      started = true;
      const publicPoolConfiguration = Constants.expoConfig?.extra?.paliPublicPoolQualification;
      const fullSlhConfiguration = Constants.expoConfig?.extra?.paliFullSlhQualification;
      const checks: Check[] = [];
      let stage = 'parameters';
      let parameters: Awaited<ReturnType<typeof launchParameters>> | undefined;
      let storage: OpenWalletStorage | undefined;
      let runtime: KeyringRuntime | undefined;
      let capturedHost: InstanceType<NativeKeyringSdk['HostKeyring']> | undefined;
      let fullSlh: FullSlhEvidence | undefined;
      let authority: NativeCustodyAuthority | undefined;
      let backup: SeedBackupFlow | undefined;
      let cryptoEvidence: FullCryptoQualification | undefined;
      let walletConnectDiagnostic: WalletConnectQualificationDiagnostic | undefined;
      let fullCryptoCase: CryptoFullCase | undefined;
      let qualificationLoadDiagnostic: CryptoLoadDiagnostic | undefined;
      const storageDiagnostic = createStorageQualificationDiagnostic();
      const privateProofDiagnostic = createPrivateProofDiagnostic();
      const sentryIsolatedDiagnostic = createSentryIsolatedDiagnostic(Date.now);
      const mnemonicEntropy: Uint8Array[] = [];
      let observingGeneration = false;
      let mnemonicEntropyVerified = false;
      let expectedHdAddress: string | undefined;
      let expectedErc20Address: string | undefined;
      let expectedNevmAddress: string | undefined;
      let expectedZksysAddress: string | undefined;
      let networkCalls = 0;
      let verifiedSdkVersion: string | undefined;
      let verifiedQuickCryptoIdentity: string | undefined;
      let sentryBlindingCalls = 0;
      const check = async <T,>(
        name: string,
        fn: () => Promise<T>
      ): Promise<T> => {
        stage = name;
        setStatus(name);
        const start = Date.now();
        const result = await fn();
        checks.push({ name, durationMs: Date.now() - start });
        return result;
      };
      try {
        parameters = await launchParameters();
        if (fullSlhConfiguration !== undefined && (parameters.physical || parameters.scenario !== 'import' || parameters.http || parameters.publicPool || parameters.privateProof ||
          Constants.expoConfig?.extra?.paliPrivateProofQualification !== undefined || publicPoolConfiguration !== undefined || Constants.expoConfig?.extra?.paliHttpQualification !== undefined))
          throw Error('FULL_SLH_QUALIFICATION_BUILD_INVALID');
        const { getWalletConnectWebSocket } = await import('../src/platform/walletConnectRuntime.native');
        const NativeWebSocket = await getWalletConnectWebSocket();
        globalThis.fetch = (() => {
          networkCalls++;
          throw Error('QUALIFICATION_NETWORK_FORBIDDEN');
        }) as typeof fetch;
        const forbiddenTransport = function () {
          networkCalls++;
          throw Error('QUALIFICATION_NETWORK_FORBIDDEN');
        };
        globalThis.XMLHttpRequest =
          forbiddenTransport as unknown as typeof XMLHttpRequest;
        globalThis.WebSocket =
          forbiddenTransport as unknown as typeof WebSocket;
        const privateProofConfiguration = Constants.expoConfig?.extra?.paliPrivateProofQualification;
        if (privateProofConfiguration !== undefined || (!parameters.physical && parameters.privateProof)) {
          if (parameters.physical || parameters.http || parameters.publicPool || !parameters.privateProof ||
              parameters.phase !== 'create' || parameters.scenario !== 'import' || publicPoolConfiguration !== undefined ||
              !['ios', 'android'].includes(Platform.OS) || !FileSystem.documentDirectory)
            throw Error('PRIVATE_PROOF_QUALIFICATION_BUILD_INVALID');
          const build = httpBuild(privateProofConfiguration);
          const token = parameters.privateProof.token;
          const installedVersion = require('@sidhujag/sysweb3-keyring/package.json').version;
          const { paliQualificationSdkVersion, paliQualificationSdkIdentity } = Constants.expoConfig?.extra ?? {};
          expect(typeof installedVersion === 'string' && installedVersion === paliQualificationSdkVersion &&
            typeof paliQualificationSdkIdentity === 'string');
          const destination = `${FileSystem.documentDirectory}${privateProofReportName(token)}`;
          expect(!(await FileSystem.getInfoAsync(destination)).exists && !(await FileSystem.getInfoAsync(`${destination}.tmp`)).exists);
          stage = 'private proof host';
          const owner = new AbortController();
          privateProofLifetime = owner;
          const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') owner.abort(); });
          const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => owner.abort()) : undefined;
          const assertCurrent = () => {
            if (owner.signal.aborted || AppState.currentState !== 'active') throw Error('PRIVATE_PROOF_QUALIFICATION_INACTIVE');
          };
          try {
            assertCurrent();
            await ensureNativeCryptoReady();
            const { runNativeSentryCrypto } = await import('../modules/pali-private-prover');
            const { qualifyNativeSentryIsolated } = await import('./native-sentry-isolated.ts');
            await check(SENTRY_ISOLATED_CHECK, () => qualifyNativeSentryIsolated(owner.signal, runNativeSentryCrypto, sentryIsolatedDiagnostic.observe));
            stage = PRIVATE_PROOF_CHECK;
            privateProofDiagnostic.observe('proof-before-cancel', 'start');
            assertCurrent();
            const { qualifyNativePrivateProof } = await import('./native-private-proof.ts');
            const result = await qualifyNativePrivateProof({ assertCurrent, signal: owner.signal, onDiagnostic: privateProofDiagnostic.observe });
            assertCurrent();
            expect(networkCalls === 0);
            const expected = { ...build, token, sdkVersion: paliQualificationSdkIdentity, sdkPackageVersion: installedVersion,
              platform: Platform.OS as 'ios' | 'android' };
            const text = JSON.stringify({
              ...build, token, sdkVersion: paliQualificationSdkIdentity, sdkPackageVersion: installedVersion,
              kind: 'native-private-proof', status: 'passed', platform: Platform.OS, sessionId: Constants.sessionId,
              jsNetworkCalls: networkCalls, nativeNetworkObservation: 'unmeasured', sentryQualified: true, result,
            });
            privateProofDiagnostic.observe('proof-after-cancel', 'report-check');
            parsePrivateProofReport(text, expected);
            privateProofDiagnostic.observe('proof-after-cancel', 'report-write');
            await FileSystem.writeAsStringAsync(`${destination}.tmp`, text);
            assertCurrent();
            await FileSystem.moveAsync({ from: `${destination}.tmp`, to: destination });
            setStatus('Native public proof vector passed');
          } finally { owner.abort(); appState.remove(); blur?.remove(); }
          return;
        }
        if (parameters.phase === 'reset') {
          // Deliberate host-requested cleanup in this fixed fixture's private
          // Keychain group. The production entry never imports this module.
          const [secure, keys] = await Promise.all([
            import('expo-secure-store'),
            import('../src/storage/coordinator.ts'),
          ]);
          const options = {
            keychainService: keys.WALLET_KEY_SERVICE,
            keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            requireAuthentication: false,
          };
          const report = await resetPhysicalFixture(parameters, {
            deleteKey: () => secure.deleteItemAsync(keys.WALLET_KEY_NAME, options),
            readKey: () => secure.getItemAsync(keys.WALLET_KEY_NAME, options),
          });
          await writeReport('reset', report);
          setStatus('Explicit physical fixture key reset acknowledged');
          return;
        }
        await check('Hermes text and string capabilities', async () => {
          expect(typeof ''.isWellFormed === 'function');
          expect('Pali'.isWellFormed() && !'\ud800'.isWellFormed());
          expect(
            typeof TextEncoder === 'function' &&
              typeof TextDecoder === 'function'
          );
          const text = 'Pali 🔐';
          expect(
            new TextDecoder('utf-8', { fatal: true }).decode(
              new TextEncoder().encode(text)
            ) === text
          );
          let invalidRejected = false;
          try {
            new TextDecoder('utf-8', { fatal: true }).decode(
              new Uint8Array([255])
            );
          } catch {
            invalidRejected = true;
          }
          expect(invalidRejected);
        });
        const nativeCrypto = await check(
          'native crypto bridge and full vectors',
          async () => {
            const originalProcess = globalThis.process;
            const originalEnvironment = originalProcess.env;
            const originalBrowser = Object.getOwnPropertyDescriptor(originalProcess, 'browser');
            // This cold-load preflight is exclusive to the isolated public
            // fixture. A failure is final; no installer or wallet is started.
            await captureQualificationCryptoLoad(
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              () => require('react-native-quick-crypto'),
              async (text) => {
                if (!FileSystem.documentDirectory)
                  throw Error('QUALIFICATION_REPORT_UNAVAILABLE');
                await FileSystem.writeAsStringAsync(
                  `${FileSystem.documentDirectory}pali-native-qualification-load-error.json`,
                  text
                );
              },
              (diagnostic) => {
                qualificationLoadDiagnostic = diagnostic;
              }
            );
            const provider = await ensureNativeCryptoReady();
            // The installed QuickCrypto owns its nextTick fallback. Neither
            // production startup nor this fixture should pretend to be a browser.
            expect(globalThis.process === originalProcess);
            expect(globalThis.process.env === originalEnvironment);
            expect(typeof globalThis.process.nextTick === 'function');
            const currentBrowser = Object.getOwnPropertyDescriptor(originalProcess, 'browser');
            expect(JSON.stringify(currentBrowser) === JSON.stringify(originalBrowser));
            const { createNativeWalletCrypto } = await import(
              '../src/crypto/native'
            );
            const { qualifyWalletCryptoFull } = await import(
              '../src/crypto/qualificationFull.ts'
            );
            cryptoEvidence = await qualifyWalletCryptoFull(
              provider,
              createNativeWalletCrypto,
              (name) => {
                fullCryptoCase = name;
              }
            );
            return provider;
          }
        );
        await check('native factory handles reject direct construction', async () => {
          const { requireNativeModule } = await import('expo-modules-core');
          qualifyNativeHandleContract(requireNativeModule('PaliWalletCrypto'));
        });
        // The observer delegates every request to the qualified native CSPRNG.
        // Noble captures the global crypto object during module evaluation.
        // Install before loading ethers through the public Merkle check or SDK.
        const observedCrypto: Crypto = Object.freeze({
          subtle: nativeCrypto.subtle,
          getRandomValues<T extends ArrayBufferView>(array: T): T {
            const result = nativeCrypto.getRandomValues(array);
            if (result?.byteLength === 16) sentryBlindingCalls++;
            if (observingGeneration && result?.byteLength === 16) {
              if (mnemonicEntropy.length >= 32)
                throw Error('QUALIFICATION_ENTROPY_BOUND');
              mnemonicEntropy.push(
                new Uint8Array(
                  result.buffer,
                  result.byteOffset,
                  result.byteLength
                ).slice()
              );
            }
            return result;
          },
          randomUUID: () => nativeCrypto.randomUUID(),
        });
        Object.defineProperty(globalThis, 'crypto', {
          value: observedCrypto,
          configurable: true,
          enumerable: true,
          writable: false,
        });
        await check('native public Merkle and HMAC vectors', async () => {
          const { createNativePublicMerkleExecutor } = await import('../src/crypto/native');
          const { qualifyNativePublicMerkle } = await import('../src/crypto/qualificationPublicMerkle.ts');
          const { qualifyWalletHmac } = await import('../src/crypto/qualificationHmac.ts');
          await qualifyNativePublicMerkle(createNativePublicMerkleExecutor());
          await qualifyWalletHmac(nativeCrypto);
        });
        await check('native SLH leaf setup vector', async () => {
          const { requireNativeModule } = await import('expo-modules-core');
          const { qualifyNativeSlhLeaf } = await import('./native-slh-leaf.ts');
          await qualifyNativeSlhLeaf(requireNativeModule('PaliWalletCrypto'));
        });
        const { createNativeSentryPublicKeyDeriver } = await import('../src/crypto/sentryPublicKey.native');
        const { qualifyNativeSentryClassical, SENTRY_CLASSICAL_CHECK } = await import('./native-sentry-classical.ts');
        const { qualifyNativeSentryShake, SENTRY_SHAKE_CHECK } = await import('./native-sentry-shake.ts');
        const sentryDerive = createNativeSentryPublicKeyDeriver();
        await check(SENTRY_CLASSICAL_CHECK, () => qualifyNativeSentryClassical(
          qualificationLifetime.signal, () => sentryBlindingCalls, sentryDerive));
        await check(SENTRY_SHAKE_CHECK, () => qualifyNativeSentryShake(qualificationLifetime.signal, sentryDerive));
        const { qualifyNativeSentryApprovals, SENTRY_APPROVAL_CHECK } = await import('./native-sentry-approvals.ts');
        const { createNativeSentryCryptoExecutor } = await import('../src/crypto/sentryCrypto.native');
        await check(SENTRY_APPROVAL_CHECK, () => qualifyNativeSentryApprovals(qualificationLifetime.signal,
          createNativeSentryCryptoExecutor(null)));
        const { paliQuickCryptoSentryIdentity, paliQualificationSdkVersion, paliQualificationSdkIdentity, paliQualificationSdkDigest } = Constants.expoConfig?.extra ?? {};
        const sdkIdentity = paliQualificationSdkDigest === undefined ? paliQualificationSdkVersion
          : typeof paliQualificationSdkDigest === 'string' && /^[0-9a-f]{64}$/.test(paliQualificationSdkDigest)
          ? `${paliQualificationSdkVersion}.sdk-${paliQualificationSdkDigest}` : null;
        expect(typeof paliQuickCryptoSentryIdentity === 'string' && paliQuickCryptoSentryIdentity.length > 0 &&
          sdkIdentity !== null && paliQualificationSdkIdentity === `${sdkIdentity}.${paliQuickCryptoSentryIdentity}`);
        verifiedQuickCryptoIdentity = paliQuickCryptoSentryIdentity;
        if (publicPoolConfiguration !== undefined || (!parameters.physical && parameters.publicPool)) {
          stage = 'public pool configuration';
          if (parameters.physical || parameters.http || !parameters.publicPool || !['ios', 'android'].includes(Platform.OS) ||
              !FileSystem.documentDirectory) throw Error('PUBLIC_POOL_QUALIFICATION_BUILD_INVALID');
          const launch = parameters.publicPool;
          const { build, caSha256 } = publicPoolBuild(publicPoolConfiguration);
          await check('public pool snapshot, Merkle and anchors', async () => {
            const [{ createNativePublicSnapshotTransport }, { createNativePublicMerkleExecutor }, { qualifyNativePublicPool }] = await Promise.all([
              import('../src/privacy/publicSnapshotNative.native.ts'), import('../src/crypto/native'), import('./public-pool-native.ts'),
            ]);
            const owner = new AbortController();
            const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') owner.abort(); });
            const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => owner.abort()) : undefined;
            try {
              if (AppState.currentState !== 'active') throw Error('PUBLIC_POOL_QUALIFICATION_INACTIVE');
              const result = await qualifyNativePublicPool({ launch, transport: createNativePublicSnapshotTransport(),
                executeMerkleBatch: createNativePublicMerkleExecutor(), lifetime: owner.signal });
              expect(!owner.signal.aborted && AppState.currentState === 'active' && networkCalls === 0);
              stage = 'public pool report';
              const destination = `${FileSystem.documentDirectory}pali-native-public-pool-${launch.token}.json`;
              await FileSystem.writeAsStringAsync(`${destination}.tmp`, JSON.stringify({ ...build, caSha256,
                kind: 'native-public-pool', status: 'passed', platform: Platform.OS, sessionId: Constants.sessionId,
                token: launch.token, networkCalls, result }));
              expect(!owner.signal.aborted && AppState.currentState === 'active');
              await FileSystem.moveAsync({ from: `${destination}.tmp`, to: destination });
            } finally { appState.remove(); blur?.remove(); owner.abort(); }
          });
          setStatus('Offline public pool verification passed');
          return;
        }
        const httpConfiguration = Constants.expoConfig?.extra?.paliHttpQualification;
        if (httpConfiguration !== undefined || (!parameters.physical && parameters.http)) {
          if (parameters.physical || !parameters.http || !['ios', 'android'].includes(Platform.OS))
            throw Error('HTTP_QUALIFICATION_BUILD_INVALID');
          const build = httpBuild(httpConfiguration);
          // Run before protected-storage admission, in a separate report: an
          // iOS Simulator storage refusal must never become custody success.
          stage = 'native HTTP transport';
          const { createNativePublicSnapshotTransport } = await import('../src/privacy/publicSnapshotNative.native.ts');
          const [{ walletFetch }, { fetch: cookieFetch }, { qualifyNativeHttp, HttpQualificationError }, { qualifyNativePost, PostQualificationError }] = await Promise.all([
            import('../src/platform/http'), import('expo/fetch'), import('./http-native.ts'), import('./post-native.ts'),
          ]);
          if (!FileSystem.documentDirectory) throw Error('HTTP_QUALIFICATION_REPORT_UNAVAILABLE');
          const destination = `${FileSystem.documentDirectory}pali-native-http-${parameters.http.token}.json`;
          try {
            const evidence = await qualifyNativeHttp({ launch: parameters.http, build,
              walletFetch, cookieFetch: cookieFetch as typeof walletFetch,
              snapshotTransport: createNativePublicSnapshotTransport(),
              phase: parameters.phase, scenario: parameters.scenario, platform: Platform.OS as 'ios' | 'android',
              sessionId: Constants.sessionId, networkCalls: () => networkCalls });
            await FileSystem.writeAsStringAsync(`${destination}.tmp`, JSON.stringify(evidence));
            await FileSystem.moveAsync({ from: `${destination}.tmp`, to: destination });
            const candidateIdentity = Constants.expoConfig?.extra?.paliWalletConnectIdentity;
            if (candidateIdentity !== undefined) {
              if (typeof candidateIdentity !== 'string') throw Error('WALLETCONNECT_NATIVE_BUILD_INVALID');
              stage = 'native WalletConnect lifecycle';
              const { http: launch, phase, scenario } = parameters;
              let connectionEvidence;
              try {
                connectionEvidence = await withWalletConnectQualificationScope({
                  crypto: nativeCrypto, WebSocket: NativeWebSocket, launch,
                  onForbidden() { networkCalls++; throw Error('QUALIFICATION_NETWORK_FORBIDDEN'); },
                }, async () => {
                  const NetInfo = await import('@react-native-community/netinfo');
                  // Keep native connectivity and events, but suppress the default
                  // internet probe for this loopback-only qualification process.
                  // Restoring defaults would start another probe under the fence.
                  NetInfo.configure({ reachabilityShouldRun: () => false });
                  const { prepareWalletConnectRuntime } = await import('../src/platform/walletConnectRuntime.native');
                  await prepareWalletConnectRuntime();
                  const { qualifyNativeWalletConnect } = await import('./walletconnect-native.ts');
                  return qualifyNativeWalletConnect({ launch, build,
                    candidateIdentity, walletFetch, phase, scenario,
                    platform: Platform.OS as 'ios' | 'android', sessionId: Constants.sessionId });
                });
              } catch (error) {
                const { WalletConnectQualificationError } = await import('./walletconnect-native.ts');
                walletConnectDiagnostic = error instanceof WalletConnectQualificationError
                  ? error.diagnostic : new WalletConnectQualificationError('init', error).diagnostic;
                throw error;
              }
              const connectionDestination = `${FileSystem.documentDirectory}pali-native-walletconnect-${parameters.http.token}.json`;
              await FileSystem.writeAsStringAsync(`${connectionDestination}.tmp`, JSON.stringify(connectionEvidence));
              await FileSystem.moveAsync({ from: `${connectionDestination}.tmp`, to: connectionDestination });
            }
            stage = 'native POST transport';
            const postDestination = `${FileSystem.documentDirectory}pali-native-post-${parameters.http.token}.json`;
            const postEvidence = await qualifyNativePost({ launch: parameters.http, build, walletFetch,
              phase: parameters.phase, scenario: parameters.scenario, platform: Platform.OS as 'ios' | 'android',
              sessionId: Constants.sessionId, networkCalls: () => networkCalls });
            await FileSystem.writeAsStringAsync(`${postDestination}.tmp`, JSON.stringify(postEvidence));
            await FileSystem.moveAsync({ from: `${postDestination}.tmp`, to: postDestination });
          } catch (error) {
            if (error instanceof HttpQualificationError || error instanceof PostQualificationError) {
              const isPost = error instanceof PostQualificationError;
              const failedDestination = isPost ? `${FileSystem.documentDirectory}pali-native-post-${parameters.http.token}.json` : destination;
              const diagnostic = { ...build, kind: isPost ? 'native-post-diagnostic' : 'native-http-diagnostic', status: 'failed', diagnosticOnly: true,
                failedCase: error.failedCase, token: parameters.http.token, phase: parameters.phase,
                scenario: parameters.scenario, platform: Platform.OS, sessionId: Constants.sessionId,
                failureDetail: error.failureDetail };
              await FileSystem.writeAsStringAsync(`${failedDestination}.tmp`, JSON.stringify(diagnostic))
                .then(() => FileSystem.moveAsync({ from: `${failedDestination}.tmp`, to: failedDestination })).catch(() => undefined);
            }
            throw error;
          }
        }
        const [
          { NativeCustodyAuthority },
          { createKeyringRuntimeFactory },
          { SeedBackupFlow },
          { openNativeWalletStorage },
          { createNativePinCredentialPort },
          bip39,
        ] = await Promise.all([
          import('../src/custody/authority.ts'),
          import('../src/custody/keyringRuntime.ts'),
          import('../src/custody/seedBackup.ts'),
          import('../src/storage/native'),
          import('../src/platform/pinCredential.native'),
          import('bip39'),
        ]);
        const qualificationSlhExecution = null;
        const qualificationPinCredential = createNativePinCredentialPort();
        const factory = createKeyringRuntimeFactory({ pinCredential: qualificationPinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: PUBLIC_PASSWORD }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: null, slhExecution: qualificationSlhExecution, readEvmRetirement: null,
          ensureCryptoReady: async () => {
            await ensureNativeCryptoReady();
          },
          openStorage: async () => {
            try {
              storage = await check('open SQLCipher and device key', () => openNativeWalletStorage({
                randomBytes: (length) =>
                  nativeCrypto.getRandomValues(new Uint8Array(length)),
                digest: async (bytes) =>
                  new Uint8Array(
                    await nativeCrypto.subtle.digest('SHA-256', bytes)
                  ),
              }, storageDiagnostic.observe));
            } catch (error) {
              storageDiagnostic.capture(error);
              throw error;
            }
            return storage;
          },
          loadSdk: async () => {
            const sdk = await check('load software SDK', () => captureQualificationModuleLoad(
              'software-sdk-load',
              // Capture only this first dependency evaluation, before any SDK
              // instance, wallet phrase or session can exist. No retry on failure.
              () => ({
                // eslint-disable-next-line @typescript-eslint/no-require-imports -- Capture synchronous native module loading.
                ...require('@sidhujag/sysweb3-keyring/cjs/software.js'),
                // eslint-disable-next-line @typescript-eslint/no-require-imports -- Capture synchronous native module loading.
                HostKeyring: require('@sidhujag/sysweb3-keyring/cjs/host-keyring.js').HostKeyring,
                // eslint-disable-next-line @typescript-eslint/no-require-imports -- Capture synchronous native module loading.
                createLedgerHardware: require('@sidhujag/sysweb3-keyring/cjs/ledger-hardware.js').createLedgerHardware,
              }) as import('../src/custody/keyringSdk.ts').NativeKeyringSdk,
              async (text) => {
                if (!FileSystem.documentDirectory) throw Error('QUALIFICATION_REPORT_UNAVAILABLE');
                await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}pali-native-qualification-sdk-load-error.json`, text);
              },
              () => undefined
            ));
            // The embedded package metadata must match the exact locked build pin.
            const installedVersion = require('@sidhujag/sysweb3-keyring/package.json').version;
            const { paliQualificationSdkVersion, paliQualificationSdkIdentity } = Constants.expoConfig?.extra ?? {};
            expect(typeof installedVersion === 'string' && installedVersion === paliQualificationSdkVersion &&
              typeof paliQualificationSdkIdentity === 'string');
            verifiedSdkVersion = paliQualificationSdkIdentity;
            stage = 'initialize native custody';
            setStatus(stage);
            if (fullSlhConfiguration !== undefined) {
              const Host = sdk.HostKeyring;
              return { ...sdk, HostKeyring: class extends Host {
                constructor(...args: ConstructorParameters<NativeKeyringSdk['HostKeyring']>) { super(...args); capturedHost = this; }
              } };
            }
            return sdk;
          },
        });
        authority = new NativeCustodyAuthority({
          async open() {
            runtime = (await factory.open()) as KeyringRuntime;
            return runtime;
          },
        });
        backup = new SeedBackupFlow(authority, () => runtime?.backup);
        await check('initialize native custody', () =>
          authority!.initialize()
        );
        if (parameters.phase === 'create') {
          expect(authority.getSnapshot().phase === 'empty');
          await check('create or import real SDK wallet', async () => {
            if (parameters!.scenario === 'import')
              await authority!.importPhrase(PUBLIC_PHRASE, PUBLIC_PASSWORD);
            else {
              observingGeneration = true;
              try {
                await authority!.create(PUBLIC_PASSWORD);
              } finally {
                observingGeneration = false;
              }
            }
          });
          expect(authority.getSnapshot().phase === 'backup-required');
          await check('fresh password-backed seed confirmation', async () => {
            const presentation = await backup!.begin(PUBLIC_PASSWORD);
            expect(presentation.words.length === 12);
            const { HDNodeWallet } = await import('ethers/wallet');
            expectedHdAddress = HDNodeWallet.fromPhrase(presentation.words.join(' '), undefined, "m/44'/60'/0'/0/1").address;
            expectedErc20Address = HDNodeWallet.fromPhrase(presentation.words.join(' '), undefined, "m/44'/60'/0'/0/2").address;
            expectedNevmAddress = HDNodeWallet.fromPhrase(presentation.words.join(' '), undefined, "m/44'/60'/0'/0/3").address;
            expectedZksysAddress = HDNodeWallet.fromPhrase(presentation.words.join(' '), undefined, "m/44'/60'/0'/0/4").address;
            if (parameters!.scenario === 'import') expect(expectedHdAddress === EXPECTED_HD_ADDRESS);
            if (parameters!.scenario === 'import') expect(expectedErc20Address === EXPECTED_ERC20_HD_ADDRESS);
            if (parameters!.scenario === 'import') expect(expectedNevmAddress === EXPECTED_NEVM_HD_ADDRESS);
            if (parameters!.scenario === 'import') expect(expectedZksysAddress === EXPECTED_ZKSYS_HD_ADDRESS);
            if (parameters!.scenario === 'import')
              expect(presentation.words.join(' ') === PUBLIC_PHRASE);
            else {
              const generatedEntropy = bip39.mnemonicToEntropy(
                presentation.words.join(' ')
              );
              mnemonicEntropyVerified = mnemonicEntropy.some(
                (bytes) =>
                  Array.from(bytes, (byte) =>
                    byte.toString(16).padStart(2, '0')
                  ).join('') === generatedEntropy
              );
              expect(mnemonicEntropyVerified && mnemonicEntropy.length > 0);
              mnemonicEntropy.forEach((bytes) => bytes.fill(0));
              mnemonicEntropy.length = 0;
            }
            let rejected = false;
            try {
              await backup!.confirm(`${presentation.id}-stale`, presentation.words);
            } catch {
              rejected = true;
            }
            expect(
              rejected && authority!.getSnapshot().backup === 'unconfirmed'
            );
            await backup!.confirm(presentation.id, presentation.words);
            expect(authority!.getSnapshot().phase === 'ready');
          });
        } else {
          expect(authority.getSnapshot().phase === 'locked');
          expect(authority.getSnapshot().backup === 'confirmed');
          await check('unlock wallet after process restart', () =>
            authority!.unlock(PUBLIC_PASSWORD)
          );
          expect(authority.getSnapshot().phase === 'ready');
        }
        const rootAccount = authority.getCatalogue()?.accounts.find((account) => account.id === 'hd:60:0');
        expect(rootAccount && /^0x[0-9a-fA-F]{40}$/.test(rootAccount.address));
        if (parameters.scenario === 'import') expect(rootAccount?.address === EXPECTED_ADDRESS);
        if (fullSlhConfiguration !== undefined) {
          const { fullSlhBuild, readFullSlhEvidence, qualifyNativeSlhFull, FULL_SLH_CHECK } = await import('./native-slh-full.ts');
          const build = fullSlhBuild(fullSlhConfiguration);
          const ring = capturedHost, opened = storage, custody = authority, activeRuntime = runtime;
          if (!ring || !opened || !activeRuntime || !FileSystem.documentDirectory) throw Error('FULL_SLH_QUALIFICATION_OWNER_MISSING');
          const snapshot = custody.getSnapshot(), catalogue = custody.getCatalogue();
          const owner = new AbortController();
          const appState = AppState.addEventListener('change', state => { if (state !== 'active') owner.abort(); });
          const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => owner.abort()) : undefined;
          const assertCurrent = () => {
            if (owner.signal.aborted || qualificationLifetime.signal.aborted || AppState.currentState !== 'active' ||
                capturedHost !== ring || storage !== opened || runtime !== activeRuntime || custody.getSnapshot() !== snapshot ||
                snapshot.phase !== 'ready' || custody.getCatalogue() !== catalogue || !ring.hasPublicSession())
              throw Error('FULL_SLH_QUALIFICATION_RETIRED');
          };
          try {
            assertCurrent();
            let previous: FullSlhEvidence | null = null;
            if (parameters.phase === 'restart') {
              const file = `${FileSystem.documentDirectory}pali-native-qualification-create.json`;
              const info = await FileSystem.getInfoAsync(file); assertCurrent();
              if (!info.exists || info.isDirectory || typeof info.size !== 'number' || info.size < 1 || info.size > 100000) throw Error('FULL_SLH_RESTART_REPORT_INVALID');
              const text = await FileSystem.readAsStringAsync(file); assertCurrent();
              if (text.length > 100000 || text.includes(PUBLIC_PHRASE) || text.includes(PUBLIC_PASSWORD)) throw Error('FULL_SLH_RESTART_REPORT_INVALID');
              const prior = JSON.parse(text);
              if (prior.version !== 1 || prior.phase !== 'create' || prior.scenario !== 'import' || prior.platform !== Platform.OS || prior.status !== 'passed' || prior.networkCalls !== 0) throw Error('FULL_SLH_RESTART_REPORT_INVALID');
              previous = readFullSlhEvidence(prior.fullSlh, 'create', build);
            }
            const { requireNativeModule } = await import('expo-modules-core');
            fullSlh = await check(FULL_SLH_CHECK, () => qualifyNativeSlhFull({
              phase: parameters!.phase as Phase, build, keyring: ring, storage: opened, pin: PUBLIC_PASSWORD,
              pinCredential: qualificationPinCredential, signal: owner.signal,
              productionCapability: qualificationSlhExecution, nativeModule: requireNativeModule('PaliWalletCrypto'), previous,
              assertCurrent, onStorageFault: () => { custody.lock(); },
              randomFill: bytes => { nativeCrypto.getRandomValues(bytes); },
              yield: () => new Promise(resolve => setTimeout(resolve, 0)),
              digest: async bytes => new Uint8Array(await nativeCrypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)),
              now: () => performance.now(),
            }));
            assertCurrent();
          } finally { owner.abort(); appState.remove(); blur?.remove(); }
        }
        const { qualifyNativeHdAccounts } = await import('./hd-accounts.ts');
        const hdEvidence = await qualifyNativeHdAccounts({
          phase: parameters.phase, authority, runtime: runtime!, storage: storage!, password: PUBLIC_PASSWORD,
          expectedSecondAddress: expectedHdAddress ?? (parameters.scenario === 'import' ? EXPECTED_HD_ADDRESS : undefined),
          expectedRestartAddress: parameters.address, check,
        });
        const { address } = hdEvidence;
        const { qualifyNativeErc20Transfer } = await import('./erc20-transfer.ts');
        const erc20Evidence = await qualifyNativeErc20Transfer({
          phase: parameters.phase, authority, runtime: runtime!, storage: storage!, password: PUBLIC_PASSWORD,
          expectedThirdAddress: expectedErc20Address ?? (parameters.scenario === 'import' ? EXPECTED_ERC20_HD_ADDRESS : undefined), check,
        });
        const { qualifyNativeNevmTransfer } = await import('./nevm-transfer.ts');
        const nevmEvidence = await qualifyNativeNevmTransfer({
          phase: parameters.phase, authority, runtime: runtime!, storage: storage!, password: PUBLIC_PASSWORD,
          expectedFourthAddress: expectedNevmAddress ?? (parameters.scenario === 'import' ? EXPECTED_NEVM_HD_ADDRESS : undefined), check,
        });
        const { qualifyNativeZksysTransfer } = await import('./zksys-transfer.ts');
        const zksysEvidence = await qualifyNativeZksysTransfer({
          phase: parameters.phase, authority, runtime: runtime!, storage: storage!, password: PUBLIC_PASSWORD,
          expectedFifthAddress: expectedZksysAddress ?? (parameters.scenario === 'import' ? EXPECTED_ZKSYS_HD_ADDRESS : undefined), check,
        });
        expect(authority.getSnapshot().account?.address === address && authority.getCatalogue()?.active.accountId === 'hd:60:1');
        const { qualifyNativeHdKeyReveal } = await import('./hd-key-reveal.ts');
        const keyRevealEvidence = await qualifyNativeHdKeyReveal({
          authority, runtime: runtime!, storage: storage!, password: PUBLIC_PASSWORD, expectedAddress: address, check,
        });
        const { qualifyNativeImportedEvm } = await import('./imported-evm.ts');
        const importedEvidence = await qualifyNativeImportedEvm({
          phase: parameters.phase, authority, runtime: runtime!, storage: storage!, password: PUBLIC_PASSWORD, check,
        });
        await check('synchronous lock and wrong password refusal', async () => {
          authority!.lock();
          expect(
            authority!.getSnapshot().phase === 'locked' &&
              authority!.getSnapshot().account === null
          );
          let rejected = false;
          try {
            await authority!.unlock('PUBLIC wrong password');
          } catch {
            rejected = true;
          }
          expect(rejected && authority!.getSnapshot().account === null);
          await authority!.unlock(PUBLIC_PASSWORD);
          expect(
            authority!.getSnapshot().phase === 'ready' &&
              authority!.getSnapshot().account?.address === address
          );
        });
        const fingerprint = await storage!.getWalletFingerprint();
        expect(/^[0-9a-f]{64}$/.test(fingerprint));
        if (parameters.phase === 'restart') {
          await check('seed reauthentication after cold restart', async () => {
            const presentation = await backup!.begin(PUBLIC_PASSWORD);
            expect(presentation.words.length === 12);
            if (parameters!.scenario === 'import')
              expect(presentation.words.join(' ') === PUBLIC_PHRASE);
            const { HDNodeWallet } = await import('ethers/wallet');
            expect(HDNodeWallet.fromPhrase(presentation.words.join(' '), undefined, "m/44'/60'/0'/0/1").address === address);
            backup!.cancel();
          });
          await check('lock and drain native database close', async () => {
            authority!.lock();
            backup!.dispose();
            await authority!.dispose();
          });
        }
        expect(networkCalls === 0);
        const report = {
          ...(parameters.physical ? physicalReportFields(parameters) : {}),
          version: 1,
          status: 'passed',
          phase: parameters.phase,
          scenario: parameters.scenario,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          sessionId: Constants.sessionId,
          fingerprint,
          checks,
          networkCalls,
          cryptoEvidence,
          cryptoDiagnostic: {
            bootstrap: qualificationLoadDiagnostic
              ? 'quick-crypto-load'
              : nativeCryptoCheckpoint(),
            ...(fullCryptoCase ? { fullCase: fullCryptoCase } : {}),
            ...(nativeCryptoInstallDiagnostic()
              ? { install: nativeCryptoInstallDiagnostic() }
              : {}),
            ...(qualificationLoadDiagnostic ?? nativeCryptoLoadDiagnostic()
              ? {
                  load:
                    qualificationLoadDiagnostic ?? nativeCryptoLoadDiagnostic(),
                }
              : {}),
          },
          mnemonicEntropyVerified,
          nativeBridgeExercised: true,
          sdkVersion: verifiedSdkVersion,
          ...(fullSlh ? { fullSlh } : {}),
          ...(verifiedQuickCryptoIdentity ? { quickCryptoIdentity: verifiedQuickCryptoIdentity } : {}),
          ...hdEvidence,
          ...erc20Evidence,
          ...nevmEvidence,
          ...zksysEvidence,
          ...keyRevealEvidence,
          ...importedEvidence,
          storageDiagnostic: storageDiagnostic.report(),
          pendingProcessTermination: parameters.phase === 'create',
        };
        await writeReport(parameters.phase, report);
        setStatus('QUALIFICATION PASSED');
      } catch (error) {
        if (stage === PRIVATE_PROOF_CHECK) privateProofDiagnostic.capture(error);
        if (stage === SENTRY_ISOLATED_CHECK) sentryIsolatedDiagnostic.capture(error);
        observingGeneration = false;
        mnemonicEntropy.forEach((bytes) => bytes.fill(0));
        mnemonicEntropy.length = 0;
        backup?.dispose();
        await authority?.dispose().catch(() => undefined);
        if (publicPoolConfiguration !== undefined && FileSystem.documentDirectory) {
          try {
            const destination = `${FileSystem.documentDirectory}${PUBLIC_POOL_FAILURE_FILE}`;
            await FileSystem.writeAsStringAsync(`${destination}.tmp`, JSON.stringify(makePublicPoolFailure(stage, error)));
            await FileSystem.moveAsync({ from: `${destination}.tmp`, to: destination });
            setStatus('QUALIFICATION FAILED');
            return;
          } catch { /* Preserve the existing failure marker if the dedicated receipt could not be written. */ }
        }
        const report = {
          ...(parameters?.physical ? physicalReportFields(parameters) : {}),
          version: 1,
          status: 'failed',
          phase: parameters?.phase ?? 'unknown',
          scenario: parameters?.scenario ?? 'unknown',
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          sessionId: Constants.sessionId,
          checks,
          networkCalls,
          failedStage: stage,
          ...(privateProofDiagnostic.report() ? { privateProofDiagnostic: privateProofDiagnostic.report() } : {}),
          ...(sentryIsolatedDiagnostic.report() ? { sentryIsolatedDiagnostic: sentryIsolatedDiagnostic.report() } : {}),
          ...(verifiedQuickCryptoIdentity ? { quickCryptoIdentity: verifiedQuickCryptoIdentity } : {}),
          ...(walletConnectDiagnostic ? { walletConnectDiagnostic } : {}),
          ...(cryptoEvidence ? { cryptoEvidence, nativeBridgeExercised: true } : {}),
          storageDiagnostic: storageDiagnostic.report(),
          cryptoDiagnostic: { bootstrap: qualificationLoadDiagnostic ? 'quick-crypto-load' : nativeCryptoCheckpoint(), ...(fullCryptoCase ? { fullCase: fullCryptoCase } : {}), ...(nativeCryptoInstallDiagnostic() ? { install: nativeCryptoInstallDiagnostic() } : {}), ...((qualificationLoadDiagnostic ?? nativeCryptoLoadDiagnostic()) ? { load: qualificationLoadDiagnostic ?? nativeCryptoLoadDiagnostic() } : {}) },
        };
        await writeReport(parameters?.phase ?? 'startup', report).catch(
          () => undefined
        );
        setStatus('QUALIFICATION FAILED');
      }
    };
    void run();
    return () => { qualificationLifetime.abort(); privateProofLifetime?.abort(); };
  }, []);
  return (
    <View
      style={{
        flex: 1,
        padding: 28,
        backgroundColor: '#102038',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: 'white', fontSize: 22 }}>
        Pali Native Qualification
      </Text>
      <Text
        accessibilityLabel="qualification-status"
        style={{ color: 'white', marginTop: 20 }}
      >
        {status}
      </Text>
      <Text style={{ color: '#b7c8d9', marginTop: 20 }}>
        Isolated public test fixtures. No real funds or broadcast.
      </Text>
    </View>
  );
}

async function writeReport(phase: Phase | 'startup' | 'reset', report: object) {
  if (!FileSystem.documentDirectory)
    throw Error('QUALIFICATION_REPORT_UNAVAILABLE');
  const runId = 'physicalRunId' in report ? report.physicalRunId : undefined;
  if (runId !== undefined && (typeof runId !== 'string' || !/^[0-9a-f]{32}$/.test(runId)))
    throw Error('PHYSICAL_REPORT_ID_INVALID');
  const output = `${FileSystem.documentDirectory}pali-native-qualification-${phase}${runId ? `-${runId}` : ''}.json`;
  await FileSystem.writeAsStringAsync(
    `${output}.tmp`,
    JSON.stringify(report, null, 2)
  );
  await FileSystem.moveAsync({ from: `${output}.tmp`, to: output });
}

registerRootComponent(QualificationApp);
