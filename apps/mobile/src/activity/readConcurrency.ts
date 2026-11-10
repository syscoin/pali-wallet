import { ActivityError } from './types.ts';

/** One budget shared by every network in an account Activity controller. */
export class ActivityReadConcurrency {
  private active = 0;
  private readonly waiting: { start(): void }[] = [];

  run<T>(signal: AbortSignal, assertCurrent: () => void, read: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const check = () => {
        if (signal.aborted) throw new ActivityError('CANCELLED');
        assertCurrent();
        if (signal.aborted) throw new ActivityError('CANCELLED');
      };
      try { check(); } catch (error) { reject(error); return; }
      let queued = true;
      const abort = () => {
        if (!queued) return;
        queued = false;
        const index = this.waiting.indexOf(entry);
        if (index !== -1) this.waiting.splice(index, 1);
        signal.removeEventListener('abort', abort);
        reject(new ActivityError('CANCELLED'));
      };
      const entry = { start: () => {
        queued = false;
        signal.removeEventListener('abort', abort);
        try { check(); } catch (error) { reject(error); return; }
        this.active++;
        // Recheck at invocation, including a cancellation after slot admission.
        void Promise.resolve().then(() => { check(); return read(); }).then(value => { check(); return value; }).then(resolve, reject).finally(() => {
          // An aborted in-flight read owns its slot until the delegate settles.
          this.active--;
          this.drain();
        });
      } };
      this.waiting.push(entry);
      signal.addEventListener('abort', abort, { once: true });
      this.drain();
    });
  }

  private drain() {
    while (this.active < 4 && this.waiting.length) this.waiting.shift()!.start();
  }
}
