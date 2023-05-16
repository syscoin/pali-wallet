export interface IPromiseProps {
  cancel: () => void;
  promise: Promise<{}>;
}

export enum PromiseTargets {
  ASSETS = 'assets',
  BALANCE = 'balance',
  TRANSACTION = 'transaction',
}

export class CancellablePromises {
  public transactionPromise: IPromiseProps | null;
  public assetsPromise: IPromiseProps | null;
  public balancePromise: IPromiseProps | null;

  constructor() {
    this.transactionPromise = null;
    this.assetsPromise = null;
    this.balancePromise = null;
  }

  public createCancellablePromise = <T>(
    executor: (
      resolve: (value: T) => void,
      reject: (reason?: any) => void
    ) => void
  ): { cancel: () => void; currentPromise: Promise<T> } => {
    let cancel = () => {};

    const currentPromise: Promise<T> = new Promise((resolve, reject) => {
      cancel = () => {
        reject('Cancel by network changing');
      };
      executor(resolve, reject);
    });

    return { currentPromise, cancel };
  };

  public cancelAllPromises = () => {
    if (this.transactionPromise) {
      console.log('transaction existe', this.transactionPromise);
      this.transactionPromise.cancel();
      this.transactionPromise = null;
      console.log('transaction depois de cancelar', this.transactionPromise);
    }

    if (this.assetsPromise) {
      console.log('assets existe', this.assetsPromise);
      this.assetsPromise.cancel();
      this.assetsPromise = null;
      console.log('assets depois de cancelar', this.assetsPromise);
    }

    if (this.balancePromise) {
      console.log('balance existe', this.balancePromise);
      this.balancePromise.cancel();
      this.balancePromise = null;
      console.log('balance depois de cancelar', this.balancePromise);
    }
  };

  public setPromise(target: PromiseTargets, promiseState: any) {
    switch (target) {
      case PromiseTargets.TRANSACTION:
        this.transactionPromise = promiseState;
        break;

      case PromiseTargets.ASSETS:
        this.assetsPromise = promiseState;
        break;

      case PromiseTargets.BALANCE:
        this.balancePromise = promiseState;
        break;
    }
  }

  public async runPromise(promiseTarget: PromiseTargets) {
    switch (promiseTarget) {
      case PromiseTargets.TRANSACTION:
        try {
          return await this.transactionPromise.promise;
        } catch (transactionError) {
          throw new Error(transactionError);
        }

      case PromiseTargets.ASSETS:
        try {
          return await this.assetsPromise.promise;
        } catch (assetsError) {
          throw new Error(assetsError);
        }

      case PromiseTargets.BALANCE:
        try {
          return await this.balancePromise.promise;
        } catch (balanceError) {
          throw new Error(balanceError);
        }
    }
  }
}
