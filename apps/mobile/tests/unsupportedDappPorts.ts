import type { NativeConnectionHost, NativeConnectionSigningHost } from '../src/connections/host.ts';
import type { NativeConnectionsView } from '../src/connections/types.ts';

const unused = (): never => { throw new Error('This explicit capability is outside this fixture'); };
const unusedAsync = async (): Promise<never> => unused();

/** Signing fixtures intentionally refuse the unrelated request families. */
export function signingFixtureHost(host: NativeConnectionSigningHost): NativeConnectionHost {
  return { ...host, controls: { context: () => null, prepare: unusedAsync },
    reads: { read: unusedAsync }, syscoin: { registration: unused, anchor: unused, read: unusedAsync },
    sentry: { prepare: unusedAsync, revalidate() {} }, psbt: { prepare: unusedAsync, cancelHandoff: unusedAsync } };
}
export const unsupportedDappViews: Pick<NativeConnectionsView,
  'previewEncryption' | 'approveControl' | 'rejectControl' | 'approveSentry' | 'rejectSentry' | 'returnToDapp' | 'approvePsbt' | 'rejectPsbt' | 'backgroundSigning' | 'cancelSigningHandoff' | 'resumeSigning'> = {
  previewEncryption: unusedAsync, approveControl: unusedAsync, rejectControl: unusedAsync, approveSentry: unusedAsync, rejectSentry: unusedAsync, returnToDapp: unusedAsync,
  approvePsbt: unusedAsync, rejectPsbt: unusedAsync, backgroundSigning: unused, cancelSigningHandoff: unusedAsync, resumeSigning: unusedAsync,
};
