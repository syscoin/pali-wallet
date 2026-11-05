import {
  WALLET_ERC20_REVIEW_PORT,
  walletErc20ReviewError,
  type WalletErc20ReviewRequest,
} from '../../shared/walletErc20Review';

export function openWalletErc20Review(request: WalletErc20ReviewRequest) {
  const port = chrome.runtime.connect({ name: WALLET_ERC20_REVIEW_PORT });
  let close!: () => void;
  const ready = new Promise<string>((resolve, reject) => {
    let open = true;
    const retire = () => {
      if (!open) return;
      open = false;
      clearTimeout(timeout);
      reject(walletErc20ReviewError());
    };
    close = () => {
      if (!open) return;
      retire();
      port.disconnect();
    };
    const timeout = setTimeout(close, 10_000);
    port.onDisconnect.addListener(retire);
    port.onMessage.addListener((reply: unknown) => {
      if (
        !open ||
        typeof reply !== 'string' ||
        !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(reply)
      ) {
        close();
        return;
      }
      clearTimeout(timeout);
      resolve(reply);
    });
    try {
      port.postMessage(request);
    } catch {
      close();
    }
  });
  return { ready, close };
}
