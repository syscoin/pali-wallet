/** A popup may close itself before Playwright acknowledges its successful click. */
export async function clickClosingPopup(options: {
  click: () => Promise<unknown>;
  isClosed: () => boolean;
}): Promise<void> {
  try {
    await options.click();
  } catch (error) {
    // window.close() can destroy the target before Playwright acknowledges
    // the successful click. Never suppress other click failures, or a
    // purported close while the original popup is still open.
    if (
      !(error instanceof Error) ||
      !/^(?:locator\.click: )?Target page, context or browser has been closed(?:\r?\n|$)/.test(
        error.message
      ) ||
      !options.isClosed()
    ) {
      throw error;
    }
  }
}

/** Dismiss a verified rejection popup without mistaking its own close for a failed click. */
export async function dismissRejectedApproval<
  T extends {
    error?: { code?: unknown };
    result?: unknown;
  }
>(options: {
  click: () => Promise<unknown>;
  isClosed: () => boolean;
  settle: () => Promise<T>;
}): Promise<T> {
  await clickClosingPopup(options);
  // The caller binds this callback to the original request ID. Closing a
  // window alone is never evidence that the signing request was rejected.
  const rejected = await options.settle();
  if (
    !options.isClosed() ||
    !Number.isSafeInteger(rejected?.error?.code) ||
    rejected.result !== undefined
  ) {
    throw new Error(
      'Dismissed approval did not close and reject without a result'
    );
  }
  return rejected;
}
