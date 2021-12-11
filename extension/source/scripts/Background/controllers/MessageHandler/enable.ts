import { browser, Runtime } from 'webextension-polyfill-ts';
import { v4 as uuid } from 'uuid';
import { Message } from './types';
import { IMasterController } from '../';

export const enable = async (
    port: Runtime.Port,
    masterController: IMasterController,
    message: Message,
    origin: string,
    setPendingWindow: (isPending: boolean) => void,
    isPendingWindow: () => boolean
) => {
    const { asset } = message.data;
    const provider = asset === 'SYS' && masterController.syscoinProvider;

    const allowed = masterController.dapp.isDAppConnected(origin);

    if (origin && !allowed) {
        if (isPendingWindow()) {
            console.log('isPendingWindow returning null')
            return Promise.resolve(null);
        }

        const windowId = uuid();
        const popup = await masterController.createPopup(
            windowId,
            message.data.network,
            'selectAccounts'
        );
        setPendingWindow(true);

        window.addEventListener(
            'connectWallet',
            (ev: any) => {
                if (ev.detail.windowId === windowId) {
                    port.postMessage({
                        id: message.id,
                        data: {
                            result: true,
                            data: { accounts: provider.getAccounts() }
                        },
                    });
                    setPendingWindow(false);
                }
            },
            { once: true, passive: true }
        );

        browser.windows.onRemoved.addListener((id) => {
            if (popup && id === popup.id) {
                port.postMessage({ id: message.id, data: { result: origin && allowed } });
                setPendingWindow(false);
            }
        });

        console.log('returning Promise.resolve null');
        return Promise.resolve(null);
    }

    console.log('Sending message id')
    return Promise.resolve({ id: message.id, result: origin && allowed });
}