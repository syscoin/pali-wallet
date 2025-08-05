export interface IPromiseProps {
  cancel: () => void;
  promise: Promise<{}>;
}

// eslint-disable-next-line no-shadow
export enum PromiseTargets {
  ASSETS = 'assets',
  BALANCE = 'balance',
  NFTS = 'nfts',
  TRANSACTION = 'transaction',
}

export class CancellablePromises {
  public transactionPromise: IPromiseProps | null;
  public assetsPromise: IPromiseProps | null;
  public nftsPromise: IPromiseProps | null;
  public balancePromise: IPromiseProps | null;

  constructor() {
    this.transactionPromise = null;
    this.assetsPromise = null;
    this.nftsPromise = null;
    this.balancePromise = null;
  }

  public createCancellablePromise = <T>(
    executor: (
      resolve: (value: T) => void,
      reject: (reason?: any) => void
    ) => void
  ): { cancel: () => void; currentPromise: Promise<T> } => {
    let cancel = () => {
      //noop
    };

    const currentPromise: Promise<T> = new Promise((resolve, reject) => {
      cancel = () => {
        reject('Cancel by network changing');
      };
      executor(resolve, reject);
    });

    return { currentPromise, cancel };
  };

  public setPromise(target: PromiseTargets, promiseState: any) {
    switch (target) {
      case PromiseTargets.TRANSACTION:
        this.transactionPromise = promiseState;
        break;

      case PromiseTargets.ASSETS:
        this.assetsPromise = promiseState;
        break;
      case PromiseTargets.NFTS:
        this.nftsPromise = promiseState;
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
          throw transactionError;
        }

      case PromiseTargets.ASSETS:
        try {
          return await this.assetsPromise.promise;
        } catch (assetsError) {
          throw assetsError;
        }
      case PromiseTargets.NFTS:
        try {
          return await this.nftsPromise.promise;
        } catch (nftsError) {
          throw nftsError;
        }

      case PromiseTargets.BALANCE:
        try {
          return await this.balancePromise.promise;
        } catch (balanceError) {
          throw balanceError;
        }
    }
  }
}
