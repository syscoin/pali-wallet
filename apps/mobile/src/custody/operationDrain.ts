type Cleanup = () => void | Promise<void>;

/** Revoke synchronously, then join admitted operations and every cleanup. */
export class NativeOperationDrain {
  private readonly operations = new Set<Promise<void>>();
  private closing: Promise<void> | undefined;

  begin(): () => void {
    if (this.closing) throw new Error('NATIVE_OPERATION_CLOSED');
    let resolve!: () => void;
    const operation = new Promise<void>((accept) => {
      resolve = accept;
    });
    this.operations.add(operation);
    return () => {
      this.operations.delete(operation);
      resolve();
    };
  }

  close(retire: () => void, cleanup: readonly Cleanup[]): Promise<void> {
    if (this.closing) return this.closing;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const closing = new Promise<void>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    this.closing = closing;
    const operations = [...this.operations];
    const invoke = (action: Cleanup) => {
      try {
        const result = action();
        // A reentrant close already joins this operation's cleanup.
        return result === closing ? Promise.resolve() : Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const work = [invoke(retire), ...cleanup.map(invoke), ...operations];
    void Promise.allSettled(work).then((results) => {
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') reject(failure.reason);
      else resolve();
    });
    return closing;
  }
}
