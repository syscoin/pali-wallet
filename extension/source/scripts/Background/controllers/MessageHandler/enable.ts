/* eslint-disable */
import { browser, Runtime } from 'webextension-polyfill-ts';
import { v4 as uuid } from 'uuid';
import { IMasterController } from '../';

export const enable = async (
    port: Runtime.Port,
    masterController: IMasterController,
    origin: string,
    setPendingWindow: (isPending: boolean) => void,
    isPendingWindow: () => boolean
) => {
    // const { asset } = message?.data;
    // const provider = asset === 'SYS' && masterController;

    const allowed = masterController?.dapp?.isDAppConnected(origin);

    if (origin && !allowed) {
        if (isPendingWindow()) {
            console.log('isPendingWindow returning null')
            return Promise.resolve(null);
        }

        const windowId = uuid();
        const popup = await masterController.createPopup(
            windowId,
            // message.data.network,
            'selectAccounts'
        );
        setPendingWindow(true);

        window.addEventListener(
            'connectWallet',
            (ev: any) => {
                if (ev.detail.windowId === windowId) {
                    port.postMessage({
                        // id: message.id,
                        data: {
                            result: true,
                            // data: { accounts: provider?.getAccounts() }
                        },
                    });
                    setPendingWindow(false);
                }
            },
            { once: true, passive: true }
        );

        browser.windows.onRemoved.addListener((id) => {
            if (popup && id === popup.id) {
                port.postMessage({ data: { result: origin && allowed } });
                setPendingWindow(false);
            }
        });

        console.log('returning Promise.resolve null');
        return Promise.resolve(null);
    }

    console.log('Sending message id')
    return Promise.resolve({ result: origin && allowed });
}