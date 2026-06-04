import type { PasskeyWebAuthnProof } from './validation';
import type { PasskeyAssertionResult } from './webauthn';
import { getPasskeyAssertion } from './webauthn';

type ControllerEmitter = (
  methods: string[],
  payload?: any[],
  timeout?: number
) => Promise<any>;

export type PasskeyExecutionIntent = {
  data?: string;
  target: string;
  value: string;
};

export type SubmitPasskeyExecutionsParams = {
  confirmedSponsor?: {
    mode?: string;
    policyText?: string;
    signer?: string;
    url?: string;
  } | null;
  controllerEmitter: ControllerEmitter;
  credentialId: string;
  executions: PasskeyExecutionIntent[];
  onAssertionResolved?: () => void;
  onPrepared?: () => void;
  sponsorProof?:
    | string
    | {
        r?: string;
        s?: string;
        signature?: string;
        v?: number | string;
      };
  waitForConfirmation?: boolean;
};

export const passkeyAssertionToProof = (
  assertion: PasskeyAssertionResult
): PasskeyWebAuthnProof => ({
  authenticatorData: assertion.authenticatorData,
  challengeOffset: assertion.challengeOffset,
  clientDataJSON: assertion.clientDataJSON,
  originOffset: assertion.originOffset,
  r: assertion.r,
  s: assertion.s,
  typeOffset: assertion.typeOffset,
});

export const signAndSubmitPasskeyExecutions = async (
  params: SubmitPasskeyExecutionsParams
) => {
  const {
    controllerEmitter,
    credentialId,
    executions,
    onAssertionResolved,
    onPrepared,
    sponsorProof,
    waitForConfirmation,
  } = params;
  const prepared = (await controllerEmitter(
    ['wallet', 'preparePasskeyExecutions'],
    [executions],
    300000
  )) as any;
  onPrepared?.();

  const assertion = await getPasskeyAssertion(
    credentialId,
    prepared.actionHash
  );
  onAssertionResolved?.();

  return controllerEmitter(
    ['wallet', 'submitPasskeyExecution'],
    [
      {
        actionHash: prepared.actionHash,
        ...(Object.prototype.hasOwnProperty.call(params, 'confirmedSponsor')
          ? { confirmedSponsor: params.confirmedSponsor }
          : {}),
        execution: prepared.execution,
        executions: prepared.executions,
        proof: passkeyAssertionToProof(assertion),
        sponsorProof,
        waitForConfirmation,
      },
    ],
    300000
  );
};
