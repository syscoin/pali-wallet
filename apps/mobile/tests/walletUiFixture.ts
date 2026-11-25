import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED } from '../../../source/shared/smartAccountFeeQuote.ts';
import * as recoveryPhrase from '../../../source/shared/recoveryPhrase.ts';

let smartSubmissionLeaveCode: string | undefined;

/** Leaf tests retain their native event ports; the real host has its own tests. */
export function walletUiFixture(name: string, ports: Record<string, any>): Record<string, unknown> | undefined {
  if (name === '../../../../source/shared/recoveryPhrase') return recoveryPhrase;
  if (name === './SecretQr' && !Object.hasOwn(ports, name))
    return { SecretQrReveal: 'SecretQrReveal', SecretScanButton: 'SecretScanButton', SecretQrScanner: 'SecretQrScanner' };
  if (name === '../platform/cameraPermission' && !Object.hasOwn(ports, name))
    return { isCameraPermissionPromptActive: () => false };
  if (name === '../../../../source/shared/smartAccountFeeQuote.ts')
    return { SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED };
  if (name === '../ui/WalletBackHandler' || name === './src/ui/WalletBackHandler')
    return { get WalletBackHandler() { return ports['react-native'].BackHandler; } };
  if (name === '../ui/WalletModal' || name === './src/ui/WalletModal')
    return { WalletModal: ports['react-native'].Modal ?? 'Modal', WalletModalHost: 'WalletModalHost' };
  if (name === './SubmissionLeavePrompt' && !Object.hasOwn(ports, name)) return { SubmissionLeavePrompt: 'SubmissionLeavePrompt' };
  if (name === './useSmartAccountSubmissionLeave') {
    smartSubmissionLeaveCode ??= ts.transpileModule(
      readFileSync(new URL('../src/screens/useSmartAccountSubmissionLeave.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
    ).outputText;
    const exports = {};
    runInNewContext(smartSubmissionLeaveCode, { exports, require: () => ports.react });
    return exports;
  }
  return undefined;
}
