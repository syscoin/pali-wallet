import Constants from 'expo-constants';
import { deriveDefaultSmartAccount } from '../../../source/utils/smartAccount/bootstrap.ts';
import { derivePaliSmartAccountDeployment } from '../../../source/utils/smartAccount/counterfactual.ts';
import { getPaliSmartAccountFactoryAddress, paliSmartAccountFactoryInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { NativeCredentialOwner, NativeCredentialPort } from '../src/custody/credentialVault.ts';
import { createNativeCredentialPort, isNativeCredentialPromptActive, nativeCredentialAuthentication } from '../src/platform/credential.native';
import { ensureNativeCryptoReady } from '../src/platform/cryptoBootstrap';
import { createNativeSlhCapability } from '../src/crypto/native.native.ts';
import { openNativeWalletStorage } from '../src/storage/native';
import { PHYSICAL_BUNDLES } from './physical-contract.ts';
import { qualifyNativeSlhActivation, type SlhActivationEvidence, type SlhActivationCounters } from './native-slh-activation.ts';

/** Actual OS/SDK/SQLCipher/native SLH. Only undeployed public factory reads are simulated. */
export async function createNativeSlhActivationProbe(owner: NativeCredentialOwner) {
  if (Constants.expoConfig?.ios?.bundleIdentifier !== PHYSICAL_BUNDLES.full_slh ||
      Constants.expoConfig?.android?.package !== 'com.paliwallet.qualification') throw Error('QUALIFICATION_BUILD_IDENTIFIER_REQUIRED');
  owner.assertCurrent();
  const crypto = await ensureNativeCryptoReady(); owner.assertCurrent();
  const actual = createNativeCredentialPort();
  const status = await actual.capabilities(null); owner.assertCurrent();
  if (status.deviceAuth !== 'ready') throw Error('SLH_ACTIVATION_DEVICE_AUTH_REQUIRED');
  const counts = { stages: 0, secretReads: 0, nativeOpens: 0, nativeActive: 0 };
  let active: AbortSignal | null = null, running = false;
  const tracked = async <T>(request: NativeCredentialOwner, work: () => Promise<T>): Promise<T> => {
    owner.assertCurrent(); if (active || owner.signal.aborted) throw Error('CANCELLED');
    active = request.signal;
    const cancel = () => { if (active === request.signal) nativeCredentialAuthentication.cancel(); };
    owner.signal.addEventListener('abort', cancel, { once: true });
    try { return await work(); }
    finally { owner.signal.removeEventListener('abort', cancel); if (active === request.signal) active = null; }
  };
  const credentialPort: NativeCredentialPort = {
    ...actual,
    stage: (reference, value, request) => tracked(request, async () => { counts.stages++; await actual.stage(reference, value, request); }),
    withSecret: (reference, request, consume) => tracked(request, async () => { counts.secretReads++; return actual.withSecret(reference, request, consume); }),
    authorize: (reference, request) => tracked(request, () => actual.authorize(reference, request)),
  };
  const native = createNativeSlhCapability(bytes => { crypto.getRandomValues(bytes); });
  const slhExecution = Object.freeze({ ...native, open(request: Parameters<typeof native.open>[0]) {
    const execution = native.open(request); counts.nativeOpens++; counts.nativeActive++;
    let retired = false;
    return Object.freeze({ ...execution, async retire() {
      try { await execution.retire(); }
      finally { if (!retired) { retired = true; counts.nativeActive--; } }
    } });
  } });
  const factory = createKeyringRuntimeFactory({
    assertActive: owner.assertCurrent, credentialPort, isAuthenticationActive: isNativeCredentialPromptActive,
    privacyServiceSettings: null, passkeys: null, slhExecution, readEvmRetirement: null,
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); owner.assertCurrent(); },
    openStorage: () => openNativeWalletStorage({
      randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
      digest: async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    }),
    prepareSmartAccount(network, accountIndex, managementAddress, signal, assertCurrent) {
      // Reuse the shared counterfactual derivation used by both hosts. This
      // fixture does not claim a deployment, installed SLH key or chain state.
      const check = () => { owner.assertCurrent(); assertCurrent(); if (signal.aborted) throw Error('CANCELLED'); };
      const chainId = Number(network.chainId), factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
      let auth: { validator: string; data: string } | null = null;
      return deriveDefaultSmartAccount({ accountIndex, chainId, managementAddress, assertCurrent: check,
        assertInfrastructureSupported: async () => { check(); }, provider: {
          async getNetwork() { check(); return { chainId: BigInt(chainId) }; },
          async verifyConfiguredChainId() { check(); },
          async call(transaction) {
            check();
            if (String(transaction.to).toLowerCase() !== factoryAddress.toLowerCase() || typeof transaction.data !== 'string') throw Error('UNEXPECTED_PUBLIC_FIXTURE_CALL');
            const parsed = paliSmartAccountFactoryInterface.parseTransaction({ data: transaction.data });
            if (parsed?.name === 'getInitData') {
              auth = { validator: parsed.args[0], data: parsed.args[1] };
              const deployment = derivePaliSmartAccountDeployment({ ...auth, deploySalt: `0x${'00'.repeat(32)}`, factoryAddress });
              return paliSmartAccountFactoryInterface.encodeFunctionResult(parsed.fragment, [deployment.initCode]);
            }
            if (parsed?.name !== 'getAddress' || !auth) throw Error('UNEXPECTED_PUBLIC_FIXTURE_CALL');
            const deployment = derivePaliSmartAccountDeployment({ ...auth, deploySalt: parsed.args[0], factoryAddress });
            if (deployment.initCode !== parsed.args[1]) throw Error('PUBLIC_FIXTURE_IDENTITY_MISMATCH');
            return paliSmartAccountFactoryInterface.encodeFunctionResult(parsed.fragment, [deployment.address]);
          },
        } });
    },
  });
  return Object.freeze({
    isAuthenticating: () => active !== null && !active.aborted && isNativeCredentialPromptActive(active),
    async run(phase: 'create' | 'restart', previous: SlhActivationEvidence | null,
      observe: Parameters<typeof qualifyNativeSlhActivation>[0]['observe'],
      progress?: Parameters<typeof qualifyNativeSlhActivation>[0]['progress']) {
      if (running) throw Error('SLH_ACTIVATION_ALREADY_STARTED');
      running = true;
      return qualifyNativeSlhActivation({ phase, previous, signal: owner.signal,
        open: async () => await factory.open() as KeyringRuntime,
        counts: (): SlhActivationCounters => Object.freeze({ ...counts }), assertCurrent: owner.assertCurrent, observe, progress });
    },
  });
}
