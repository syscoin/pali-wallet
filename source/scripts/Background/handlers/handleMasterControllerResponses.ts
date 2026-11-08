import { evmSubmissionFailure } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';

import { walletTokenReviewError } from '../../../shared/walletTokenReview';
import {
  EVM_SIGNED_RECORD_NONCE_CONFLICT,
  consumeSignedEvmCapacityRefusal,
} from '../../../wallet/evmSignedRecords';
import { captureStartedEoaSendCallsAttempt } from '../controllers/message-handler/sendCallsBundles';
import { IMasterController } from 'scripts/Background/controllers';
import {
  EVM_ASSET_REVIEW_REQUIRED,
  EVM_SIGNED_STORAGE_FULL,
  EVM_LEGACY_PENDING,
  EVM_LEGACY_VERIFICATION_UNAVAILABLE,
} from 'utils/evmTransactionContext';
import { isExternalWalletUrl } from 'utils/extensionContexts';
import { extractErrorMessage } from 'utils/index';

import {
  beginApprovalSubmission,
  captureDappEvmSubmission,
  captureDappSmartAccountSubmission,
  captureDappUtxoSubmission,
  transactionApprovalExpired,
} from './approvalSubmission';
import { isTrustedExtensionPageSender } from './internalMessageAuthorization';
import { requireMessageSignApproval } from './messageSignApproval';
import { assertWalletControllerRoute } from './walletControllerRoutes';

const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
// Guardian recovery module custom-error selectors. Revert data is dropped
// when errors are flattened to a message string at this boundary, so map
// known selectors to sentinels the UI error helpers recognize.
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_SELECTOR = '0x684d1639';
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR =
  'PALI_GUARDIAN_RECOVERY_ALREADY_SCHEDULED';
const GUARDIAN_RECOVERY_NOT_READY_SELECTOR = '0x201b632a';
const GUARDIAN_RECOVERY_NOT_READY_ERROR = 'PALI_GUARDIAN_RECOVERY_NOT_READY';
const GUARDIAN_RECOVERY_EXPIRED_SELECTOR = '0x80ba2533';
const GUARDIAN_RECOVERY_EXPIRED_ERROR = 'PALI_GUARDIAN_RECOVERY_EXPIRED';

const stringifyControllerError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

const getControllerErrorText = (error: unknown, depth = 0): string => {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    try {
      return [error, getControllerErrorText(JSON.parse(error), depth + 1)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    } catch {
      return error.toLowerCase();
    }
  }
  if (typeof error !== 'object') {
    return String(error).toLowerCase();
  }

  const errorRecord = error as Record<string, unknown>;
  const parts = [
    errorRecord.message,
    errorRecord.reason,
    errorRecord.code,
    errorRecord.data,
    errorRecord.error,
    errorRecord.body,
    errorRecord.response,
    errorRecord.info,
    errorRecord.transaction,
    errorRecord.tx,
    extractErrorMessage(error, ''),
    stringifyControllerError(error),
    ...Object.getOwnPropertyNames(error)
      .filter((key) => key !== 'stack')
      .map((key) => errorRecord[key]),
  ].flatMap((value) =>
    value ? [getControllerErrorText(value, depth + 1)] : []
  );

  return parts.filter(Boolean).join(' ').toLowerCase();
};

const normalizeControllerErrorMessage = (error: unknown): string => {
  const errorText = getControllerErrorText(error);
  if (
    errorText.includes('aa21') ||
    errorText.includes("didn't pay prefund") ||
    errorText.includes('did not pay prefund') ||
    errorText.includes(AA21_PREFUND_REASON_HEX)
  ) {
    return NATIVE_GAS_REQUIRED_ERROR;
  }
  if (errorText.includes(GUARDIAN_RECOVERY_ALREADY_SCHEDULED_SELECTOR)) {
    return GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR;
  }
  if (errorText.includes(GUARDIAN_RECOVERY_NOT_READY_SELECTOR)) {
    return GUARDIAN_RECOVERY_NOT_READY_ERROR;
  }
  if (errorText.includes(GUARDIAN_RECOVERY_EXPIRED_SELECTOR)) {
    return GUARDIAN_RECOVERY_EXPIRED_ERROR;
  }

  return extractErrorMessage(error, 'Unknown error');
};

export const controllerErrorResponse = (
  error: any,
  trustedBatchHash?: { hash?: string }
) => {
  const capacityRefusal =
    !trustedBatchHash?.hash &&
    consumeSignedEvmCapacityRefusal(error, evmSubmissionFailure);
  const message = capacityRefusal
    ? EVM_SIGNED_STORAGE_FULL
    : normalizeControllerErrorMessage(error);
  const submission: {
    code?: string;
    recipientBlockReason?: string;
    recipientBlockSeverity?: string;
    transactionHash?: string;
    transactionNotBroadcast?: boolean;
    txid?: string;
  } = {};
  if (capacityRefusal) {
    submission.code = EVM_SIGNED_STORAGE_FULL;
    submission.transactionNotBroadcast = true;
  } else if (trustedBatchHash?.hash) submission.transactionNotBroadcast = false;
  else if (typeof error?.transactionNotBroadcast === 'boolean')
    submission.transactionNotBroadcast = error.transactionNotBroadcast;
  if (
    error?.code === 'HARDWARE_REQUEST_CANCELLED' ||
    error?.code === 'UTXO_NETWORK_HAS_SAVED_TRANSFER' ||
    error?.code === 'UTXO_NETWORK_HAS_IMPORTED_ACCOUNTS' ||
    error?.code === 'UTXO_NETWORK_HAS_SENTRY_KEYS'
  )
    submission.code = error.code;
  if (
    error?.code === EVM_ASSET_REVIEW_REQUIRED &&
    submission.transactionNotBroadcast === true
  )
    submission.code = EVM_ASSET_REVIEW_REQUIRED;
  if (
    (error?.code === EVM_LEGACY_PENDING ||
      error?.code === EVM_LEGACY_VERIFICATION_UNAVAILABLE) &&
    error?.transactionNotBroadcast === true
  )
    submission.code = error.code;
  if (
    error?.code === EVM_SIGNED_RECORD_NONCE_CONFLICT &&
    error?.transactionNotBroadcast === true
  )
    submission.code = EVM_SIGNED_RECORD_NONCE_CONFLICT;
  if (
    (error?.code === 'UTXO_SUBMISSION_NOT_DISPATCHED' &&
      error.transactionNotBroadcast === true) ||
    (error?.code === 'UTXO_SUBMISSION_UNKNOWN' &&
      error.transactionNotBroadcast === false)
  ) {
    submission.code = error.code;
    if (typeof error.txid === 'string' && /^[a-f0-9]{64}$/.test(error.txid))
      submission.txid = error.txid;
  }
  if (
    error?.code === 'PALI_TOKEN_RECIPIENT_BLOCKED' &&
    error?.transactionNotBroadcast === true &&
    (error?.recipientBlockSeverity === 'critical' ||
      error?.recipientBlockSeverity === 'high')
  ) {
    submission.code = error.code;
    submission.recipientBlockSeverity = error.recipientBlockSeverity;
    if (typeof error.recipientBlockReason === 'string')
      submission.recipientBlockReason = error.recipientBlockReason;
  }
  const reportedHash = trustedBatchHash
    ? trustedBatchHash.hash
    : error?.transactionHash;
  if (
    typeof reportedHash === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(reportedHash)
  )
    submission.transactionHash = reportedHash;
  return {
    error: Object.keys(submission).length
      ? { message, ...submission }
      : message,
    success: false,
  };
};

let controllerMessageListener:
  | Parameters<typeof chrome.runtime.onMessage.addListener>[0]
  | undefined;

export const handleMasterControllerResponses = (
  MasterControllerInstance: IMasterController
) => {
  if (controllerMessageListener) {
    chrome.runtime.onMessage.removeListener(controllerMessageListener);
  }
  controllerMessageListener = (message: any, sender, sendResponse) => {
    const { type, data } = message;

    try {
      const isEventValid = type === 'CONTROLLER_ACTION';

      if (!isEventValid) {
        return false;
      }

      if (!isTrustedExtensionPageSender(sender)) {
        throw new Error(
          'Controller actions are not available from connected sites'
        );
      }

      const { methods, params } = data;
      if (
        Array.isArray(methods) &&
        methods[0] === 'wallet' &&
        methods[1] === 'sendAndSaveTokenTransaction'
      )
        throw walletTokenReviewError();
      const assertSetupAdmission = () => {
        if (!MasterControllerInstance.wallet?.getWalletSetupStatus?.()) return;
        // Member traversal also reaches SDK objects and TypeScript-private
        // members. During setup, permit only exact lifecycle/onboarding calls.
        if (
          !Array.isArray(methods) ||
          methods.length !== 2 ||
          methods[0] !== 'wallet' ||
          ![
            'getWalletSetupStatus',
            'getWalletSessionGeneration',
            'isUnlocked',
            'isAnyKeyringUnlocked',
            'isSeedValid',
            'createNewSeed',
            'beginWalletRecovery',
            'createWallet',
            'recoverWalletFromSeed',
            'unlock',
            'unlockFromController',
            'resetAutoLockTimer',
            'lock',
          ].includes(methods[1])
        )
          throw new Error(
            'Wallet setup is in progress. Signing is unavailable.'
          );
      };
      assertSetupAdmission();
      assertWalletControllerRoute(methods, params);
      const messageSignApproval = requireMessageSignApproval(
        sender,
        methods,
        params
      );

      let targetMethod: any = MasterControllerInstance;
      const manualNonceRoute =
        Array.isArray(methods) &&
        methods.length === 2 &&
        methods[0] === 'wallet' &&
        methods[1] === 'authorizeDappManualNonce';

      const signer = messageSignApproval?.signer;
      const route = signer ? ['wallet', signer.method] : methods;
      if (manualNonceRoute) {
        targetMethod = async (nonce: unknown) => {
          const approval = captureDappEvmSubmission(sender);
          if (!approval) throw transactionApprovalExpired();
          await approval.checkDocument();
          approval.approveManualNonce(nonce);
          return true;
        };
      } else
        for (const method of route) {
          if (targetMethod && method in targetMethod) {
            targetMethod = targetMethod[method];
          } else {
            throw new Error('Method not found');
          }
        }

      if (typeof targetMethod === 'function') {
        const finishSubmission = beginApprovalSubmission(sender, methods);
        let assertUtxoSignatureCurrent: (() => void) | undefined;
        let batchAttempt = false;
        let acknowledgedBatchHash: string | undefined;
        let nonceClaim:
          | ReturnType<
              NonNullable<
                ReturnType<typeof captureDappEvmSubmission>
              >['claimNonce']
            >
          | undefined;
        let retiredBatch:
          | {
              isSoleRetiredAttempt: () => boolean;
              release: () => Promise<void>;
            }
          | undefined;
        Promise.resolve()
          .then(async () => {
            if (messageSignApproval) await messageSignApproval.checkDocument();
            assertSetupAdmission();
            messageSignApproval?.assertCurrent();
            const walletMethod =
              route.length === 2 && route[0] === 'wallet'
                ? route[1]
                : undefined;
            const sendsEvm = walletMethod === 'sendAndSaveEthTransaction';
            const reviewsEvm = walletMethod === 'reviewDappEvmFee';
            const recommendsNonce =
              walletMethod === 'getRecommendedEvmNonce' ||
              walletMethod === 'getRecommendedNonceForBatch';
            const quoteApproval = recommendsNonce
              ? captureDappEvmSubmission(sender)
              : undefined;
            if (quoteApproval) await quoteApproval.checkDocument();
            const recordNonce = quoteApproval?.beginNonceRecommendation(
              params?.[0]
            );
            const dappApproval =
              sendsEvm || reviewsEvm
                ? captureDappEvmSubmission(sender)
                : undefined;
            if (sendsEvm && dappApproval?.batch) {
              batchAttempt = true;
              const release = await captureStartedEoaSendCallsAttempt(
                dappApproval.batch,
                dappApproval.context.chainId,
                params?.[4]?.sendCallsSubmissionId
              );
              if (!release) throw transactionApprovalExpired();
              retiredBatch = {
                isSoleRetiredAttempt: dappApproval.isSoleRetiredAttempt,
                release,
              };
            }
            if (dappApproval) {
              await dappApproval.checkDocument();
              if (sendsEvm) {
                if (
                  typeof params?.[4]?.genericReviewId !== 'string' ||
                  !/^[A-Za-z0-9_-]{1,128}$/.test(params[4].genericReviewId)
                )
                  throw Object.assign(
                    new Error('Reviewed transaction fees are required'),
                    { transactionNotBroadcast: true }
                  );
                nonceClaim = dappApproval.claimNonce(params?.[0]?.nonce);
              }
            } else if (
              reviewsEvm ||
              (sendsEvm && isExternalWalletUrl(sender.url))
            )
              throw transactionApprovalExpired();
            const smartMethod =
              walletMethod === 'submitSmartAccountExecution' ||
              walletMethod === 'registerSmartAccountOnChain'
                ? walletMethod
                : undefined;
            const smartApproval = smartMethod
              ? captureDappSmartAccountSubmission(sender, smartMethod)
              : undefined;
            if (smartApproval) await smartApproval.checkDocument();
            else if (smartMethod && isExternalWalletUrl(sender.url))
              throw transactionApprovalExpired();
            const utxoMethod =
              walletMethod === 'signSyscoinPsbt' ||
              walletMethod === 'signSendAndSaveTransaction'
                ? walletMethod
                : undefined;
            const utxoApproval = utxoMethod
              ? captureDappUtxoSubmission(sender, utxoMethod, params?.[0])
              : undefined;
            if (utxoApproval) await utxoApproval.checkDocument();
            else if (
              utxoMethod &&
              (utxoMethod === 'signSyscoinPsbt' ||
                isExternalWalletUrl(sender.url) ||
                params?.[0]?.ordinaryWalletSend !== true)
            )
              throw transactionApprovalExpired();

            let argumentsForCall = params;
            if (reviewsEvm) {
              if (!dappApproval) throw transactionApprovalExpired();
              argumentsForCall = [
                params?.[0],
                dappApproval.context,
                dappApproval.reviewNonce(params?.[0]?.nonce),
                dappApproval.assertCurrent,
                dappApproval.owner,
              ];
            } else if (sendsEvm) {
              argumentsForCall = [
                params?.[0],
                params?.[1],
                params?.[2],
                params?.[3],
                {
                  ...params?.[4],
                  // Background-only capabilities do not cross the UI boundary.
                  assertCurrentContext: undefined,
                  assertBeforeSign: undefined,
                  genericDispatchId: undefined,
                  authorizeDapp: dappApproval?.assertCurrent,
                  dappApprovalOwner: dappApproval?.owner,
                  dappNonceApproval: nonceClaim?.approval,
                  // This callback is injected by the worker, never the renderer.
                  // It sees only the SDK's acknowledged transaction response.
                  onBroadcast:
                    dappApproval?.batch && nonceClaim
                      ? async (response: {
                          hash?: unknown;
                          nonce?: unknown;
                        }) => {
                          if (
                            typeof response?.hash === 'string' &&
                            /^0x[0-9a-fA-F]{64}$/.test(response.hash) &&
                            response.nonce === nonceClaim?.approval.nonce
                          )
                            acknowledgedBatchHash = response.hash;
                        }
                      : undefined,
                  sendCallsSubmissionId: undefined,
                  ...(dappApproval && {
                    expectedContext: dappApproval.context,
                  }),
                },
              ];
            } else if (smartMethod) {
              // This capability belongs to the worker, not the renderer.
              argumentsForCall = [
                smartApproval?.context
                  ? { ...params?.[0], expectedContext: smartApproval.context }
                  : params?.[0],
                smartApproval?.assertCurrent,
              ];
            } else if (utxoApproval) {
              argumentsForCall = [utxoApproval.input, utxoApproval.authority];
            } else if (utxoMethod) {
              argumentsForCall = [params[0]];
            }
            // Always execute the method; never attempt to send functions over messaging
            dappApproval?.assertCurrent();
            smartApproval?.assertCurrent();
            utxoApproval?.authority.assertCurrent();
            const response = await (targetMethod as any)(
              ...(signer
                ? [
                    ...signer.args,
                    signer.method === 'signSLHDSAActionHash'
                      ? messageSignApproval
                      : messageSignApproval.assertCurrent,
                  ]
                : argumentsForCall)
            );
            recordNonce?.(response);
            // Hardware message signing can remain pending while wallet storage
            // becomes unavailable. Do not release that signature after the
            // existing admission gate closes. Transaction submissions retain
            // their acknowledged result even if readiness changes in flight.
            if (
              methods.length === 3 &&
              methods[0] === 'wallet' &&
              methods[1] === 'ethereumTransaction' &&
              ['ethSign', 'signPersonalMessage', 'signTypedData'].includes(
                methods[2]
              )
            )
              assertSetupAdmission();
            if (messageSignApproval) await messageSignApproval.checkDocument();
            if (utxoMethod === 'signSyscoinPsbt' && utxoApproval) {
              await utxoApproval.checkDocument();
              assertUtxoSignatureCurrent = utxoApproval.authority.assertCurrent;
            }
            return response;
          })
          .then((response) => {
            assertUtxoSignatureCurrent?.();
            if (messageSignApproval) {
              assertSetupAdmission();
              messageSignApproval.assertCurrent();
            }
            nonceClaim?.finish();
            finishSubmission();
            sendResponse(response);
          })
          .catch(async (error) => {
            const release =
              !acknowledgedBatchHash &&
              error instanceof Error &&
              Object.getOwnPropertyDescriptor(error, 'transactionNotBroadcast')
                ?.value === true &&
              !('transactionHash' in error) &&
              retiredBatch?.isSoleRetiredAttempt()
                ? retiredBatch.release
                : undefined;
            // Only an SDK ACK captured by the worker can advance a batch
            // after a later persistence/context error. An arbitrary error hash
            // is not evidence that this exact nonce was accepted.
            nonceClaim?.finish(acknowledgedBatchHash ? undefined : error);
            finishSubmission(acknowledgedBatchHash ? undefined : error);
            if (release) {
              try {
                await release();
              } catch (releaseError) {
                console.error(
                  'Failed to release retired sendCalls attempt:',
                  releaseError
                );
              }
            }
            console.error('Error executing method:', error);
            // Preserve structured errors from syscoinjs-lib
            if (
              !batchAttempt &&
              error &&
              typeof error === 'object' &&
              error.code &&
              error.code !== EVM_SIGNED_STORAGE_FULL &&
              error.error === true
            ) {
              // Pass through structured errors as-is
              sendResponse(error);
            } else {
              // For regular errors, wrap in error object
              sendResponse(
                controllerErrorResponse(
                  error,
                  batchAttempt ? { hash: acknowledgedBatchHash } : undefined
                )
              );
            }
            return false;
          });

        return true;
      } else {
        throw new Error('Method is not a function');
      }
    } catch (error) {
      console.error('Error in message handler:', error);
      // Preserve structured errors from syscoinjs-lib
      if (
        error &&
        typeof error === 'object' &&
        error.code &&
        error.code !== EVM_SIGNED_STORAGE_FULL &&
        error.error === true
      ) {
        // Pass through structured errors as-is
        sendResponse(error);
      } else {
        // For regular errors, wrap in error object
        sendResponse(controllerErrorResponse(error));
      }
      return false;
    }
  };
  chrome.runtime.onMessage.addListener(controllerMessageListener);
};
