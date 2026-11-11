import type { NativeCredentialOwner } from './credentialVault.ts';

/** Private to one admitted action. This is never a wallet/app-session cache. */
export class NativeCredentialAction {
  private secret: string | null = null;
  private owner: AbortSignal | null = null;
  private epoch = 0;
  private closed = false;
  private busy = false;
  private readonly abort = () => this.clear();
  private readonly assertActionCurrent: () => void;
  constructor(assertActionCurrent: () => void) { this.assertActionCurrent = assertActionCurrent; }

  clear(): void {
    this.epoch++;
    this.secret = null;
    this.owner?.removeEventListener('abort', this.abort);
    this.owner = null;
  }
  dispose(): void { this.closed = true; this.clear(); }

  async withSecret<T>(owner: NativeCredentialOwner,
    read: (consume: (secret: string) => Promise<T>) => Promise<T>,
    consume: (secret: string) => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('BUSY');
    this.busy = true;
    const check = () => {
      if (this.closed || owner.signal.aborted) throw new Error('CANCELLED');
      this.assertActionCurrent(); owner.assertCurrent();
      if (this.closed || owner.signal.aborted) throw new Error('CANCELLED');
    };
    try {
      check();
      if (this.owner !== owner.signal) {
        this.clear(); this.owner = owner.signal;
        owner.signal.addEventListener('abort', this.abort, { once: true });
      }
      const epoch = this.epoch;
      const consumeCurrent = async (secret: string) => {
        check(); if (epoch !== this.epoch) throw new Error('CANCELLED');
        const result = await consume(secret);
        check(); if (epoch !== this.epoch) throw new Error('CANCELLED');
        return result;
      };
      if (this.secret !== null) return await consumeCurrent(this.secret);
      return await read(async secret => {
        check(); if (epoch !== this.epoch) throw new Error('CANCELLED');
        this.secret = secret;
        return consumeCurrent(secret);
      });
    } catch (error) { this.clear(); throw error; }
    finally { this.busy = false; }
  }
}
