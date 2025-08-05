export class Queue {
  public readonly pool: number;
  public queue: Promise<any>[] = [];
  public waiting: (() => void)[] = [];
  public running: number;
  public allDone: boolean;
  public doneFn: () => void;

  constructor(pool: number) {
    if (pool <= 0) {
      throw new Error('Pool minimum is 1');
    }
    this.allDone = false;
    this.pool = pool;
    this.running = 0;
  }
  private async runFn(fn: () => any) {
    const ret = {
      success: true,
      result: null,
      error: null,
    };
    try {
      ret.result = await fn();
    } catch (err: any) {
      ret.error = err;
      ret.success = false;
    }
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      --this.running;
    }
    if (!this.running) {
      this.triggerDone();
    }
    return ret;
  }
  public execute(fn: () => any) {
    if (this.running < this.pool) {
      ++this.running;
      this.queue.push(this.runFn(fn));
    } else {
      this.queue.push(
        new Promise((resolve) => {
          new Promise<void>((resolvePromise) =>
            this.waiting.push(resolvePromise)
          ).then(async () => {
            const result = await this.runFn(fn);
            resolve(result);
          });
        })
      );
    }
  }
  public async done(): Promise<
    { error?: Error; result: any; success: boolean }[]
  > {
    if (this.allDone || !this.running) {
      return await Promise.all(this.queue);
    } else {
      return await new Promise((resolve) => {
        this.doneFn = () => this.done().then(resolve);
      });
    }
  }
  private triggerDone(): void {
    this.allDone = true;
    if (this.doneFn) {
      this.doneFn();
    }
  }
  get size(): number {
    return this.queue.length;
  }
}
