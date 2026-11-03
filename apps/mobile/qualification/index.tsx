import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { assertQualificationBuild, parseQualificationLaunch } from './launch-parameters.ts';

import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import { ensureNativeCryptoReady } from '../src/platform/cryptoBootstrap';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import type { FullCryptoQualification } from '../src/crypto/qualificationFull.ts';

// Public BIP39 fixture only. This entry is selected exclusively by the isolated
// qualification configuration and never imported by the production entry.
const PUBLIC_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = 'PUBLIC native qualification password 2026';
const EXPECTED_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
type Phase = 'create' | 'restart';
type Scenario = 'import' | 'generate';
type Check = { name: string; durationMs: number };
const expect = (value: unknown) => {
  if (!value) throw Error('QUALIFICATION_ASSERTION_FAILED');
};

async function launchParameters(): Promise<{
  phase: Phase;
  scenario: Scenario;
  address: string | null;
}> {
  assertQualificationBuild(Constants.expoConfig?.ios?.bundleIdentifier, Constants.expoConfig?.android?.package);
  if (Platform.OS === 'ios') {
    // NSArgumentDomain is read only by this dedicated fixture entry. Direct
    // simctl launch avoids SpringBoard's confirmation for external URL opens.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Settings } = require('react-native') as typeof import('react-native');
    return parseQualificationLaunch(Settings.get('PaliQualificationURL'));
  }
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
    const run = async () => {
      if (started) return;
      started = true;
      const checks: Check[] = [];
      let stage = 'parameters';
      let parameters: Awaited<ReturnType<typeof launchParameters>> | undefined;
      let storage: OpenWalletStorage | undefined;
      let runtime: KeyringRuntime | undefined;
      let authority: NativeCustodyAuthority | undefined;
      let backup: SeedBackupFlow | undefined;
      let cryptoEvidence: FullCryptoQualification | undefined;
      const mnemonicEntropy: Uint8Array[] = [];
      let observingGeneration = false;
      let mnemonicEntropyVerified = false;
      let networkCalls = 0;
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
            const provider = await ensureNativeCryptoReady();
            const { createNativeWalletCrypto } = await import('../src/crypto/native');
            const { qualifyWalletCryptoFull } = await import('../src/crypto/qualificationFull.ts');
            cryptoEvidence = await qualifyWalletCryptoFull(
              provider,
              createNativeWalletCrypto
            );
            return provider;
          }
        );
        // The observer delegates every request to the qualified native CSPRNG.
        // Install it before importing any wallet/ethers/BIP39 graph, because
        // noble retains the global crypto object from module evaluation.
        const observedCrypto: Crypto = Object.freeze({
          subtle: nativeCrypto.subtle,
          getRandomValues<T extends ArrayBufferView>(array: T): T {
            const result = nativeCrypto.getRandomValues(array);
            if (observingGeneration && result?.byteLength === 16) {
              if (mnemonicEntropy.length >= 32) throw Error('QUALIFICATION_ENTROPY_BOUND');
              mnemonicEntropy.push(new Uint8Array(result.buffer, result.byteOffset, result.byteLength).slice());
            }
            return result;
          },
          randomUUID: () => nativeCrypto.randomUUID(),
        });
        Object.defineProperty(globalThis, 'crypto', { value: observedCrypto, configurable: true, enumerable: true, writable: false });
        const [{ NativeCustodyAuthority }, { createKeyringRuntimeFactory }, { SeedBackupFlow }, { openNativeWalletStorage }, bip39] = await Promise.all([
          import('../src/custody/authority.ts'),
          import('../src/custody/keyringRuntime.ts'),
          import('../src/custody/seedBackup.ts'),
          import('../src/storage/native'),
          import('bip39'),
        ]);
        const factory = createKeyringRuntimeFactory({
          ensureCryptoReady: async () => {
            await ensureNativeCryptoReady();
          },
          openStorage: async () => {
            storage = await openNativeWalletStorage({
              randomBytes: (length) =>
                nativeCrypto.getRandomValues(new Uint8Array(length)),
              digest: async (bytes) =>
                new Uint8Array(
                  await nativeCrypto.subtle.digest('SHA-256', bytes)
                ),
            });
            return storage;
          },
        });
        authority = new NativeCustodyAuthority({
          async open() {
            runtime = (await factory.open()) as KeyringRuntime;
            return runtime;
          },
        });
        backup = new SeedBackupFlow(authority, () => runtime?.backup);
        await check('open SQLCipher and device key', () =>
          authority!.initialize()
        );
        if (parameters.phase === 'create') {
          expect(authority.getSnapshot().phase === 'empty');
          await check('create or import real SDK wallet', async () => {
            if (parameters!.scenario === 'import')
              await authority!.importPhrase(PUBLIC_PHRASE, PUBLIC_PASSWORD);
            else {
              observingGeneration = true;
              try { await authority!.create(PUBLIC_PASSWORD); }
              finally { observingGeneration = false; }
            }
          });
          expect(authority.getSnapshot().phase === 'backup-required');
          await check('fresh password-backed seed confirmation', async () => {
            const presentation = await backup!.begin(PUBLIC_PASSWORD);
            expect(presentation.words.length === 12);
            if (parameters!.scenario === 'import')
              expect(presentation.words.join(' ') === PUBLIC_PHRASE);
            else {
              const generatedEntropy = bip39.mnemonicToEntropy(presentation.words.join(' '));
              mnemonicEntropyVerified = mnemonicEntropy.some((bytes) =>
                Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') === generatedEntropy);
              expect(mnemonicEntropyVerified && mnemonicEntropy.length > 0);
              mnemonicEntropy.forEach((bytes) => bytes.fill(0));
              mnemonicEntropy.length = 0;
            }
            let rejected = false;
            try {
              await backup!.confirm(presentation.id, [
                'incorrect',
                'incorrect',
                'incorrect',
              ]);
            } catch {
              rejected = true;
            }
            expect(
              rejected && authority!.getSnapshot().backup === 'unconfirmed'
            );
            await backup!.confirm(
              presentation.id,
              presentation.positions.map(
                (position) => presentation.words[position]!
              )
            );
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
        const address = authority.getSnapshot().account?.address;
        expect(address && /^0x[0-9a-fA-F]{40}$/.test(address));
        if (parameters.scenario === 'import')
          expect(address === EXPECTED_ADDRESS);
        if (parameters.phase === 'restart')
          expect(address === parameters.address);
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
          version: 1,
          status: 'passed',
          phase: parameters.phase,
          scenario: parameters.scenario,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          sessionId: Constants.sessionId,
          address,
          fingerprint,
          checks,
          networkCalls,
          cryptoEvidence,
          mnemonicEntropyVerified,
          nativeBridgeExercised: true,
          sdkVersion: '1.0.628',
          pendingProcessTermination: parameters.phase === 'create',
        };
        await writeReport(parameters.phase, report);
        setStatus('QUALIFICATION PASSED');
      } catch {
        observingGeneration = false;
        mnemonicEntropy.forEach((bytes) => bytes.fill(0));
        mnemonicEntropy.length = 0;
        backup?.dispose();
        await authority?.dispose().catch(() => undefined);
        const report = {
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
        };
        if (parameters)
          await writeReport(parameters.phase, report).catch(() => undefined);
        setStatus('QUALIFICATION FAILED');
      }
    };
    void run();
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

async function writeReport(phase: Phase, report: object) {
  if (!FileSystem.documentDirectory)
    throw Error('QUALIFICATION_REPORT_UNAVAILABLE');
  const output = `${FileSystem.documentDirectory}pali-native-qualification-${phase}.json`;
  await FileSystem.writeAsStringAsync(
    `${output}.tmp`,
    JSON.stringify(report, null, 2)
  );
  await FileSystem.moveAsync({ from: `${output}.tmp`, to: output });
}

registerRootComponent(QualificationApp);
