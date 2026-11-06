/** A host-authenticated request never becomes current again after retirement. */
export const createDappApprovalLifetime = (
  scopeIsCurrent: () => boolean,
  parentSignal?: AbortSignal
) => {
  const controller = new AbortController();
  const retire = () => controller.abort();
  parentSignal?.addEventListener('abort', retire, { once: true });
  if (parentSignal?.aborted) retire();

  return {
    signal: controller.signal,
    retire,
    isCurrent: () => {
      if (!controller.signal.aborted && !scopeIsCurrent()) retire();
      return !controller.signal.aborted;
    },
    dispose: () => {
      parentSignal?.removeEventListener('abort', retire);
      retire();
    },
  };
};
