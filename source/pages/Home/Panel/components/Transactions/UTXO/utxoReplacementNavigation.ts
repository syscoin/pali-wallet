const UTXO_ACTIVITY_TXID = 'utxoTxid';

export function readUtxoReplacementTabTxid(search: string) {
  const id = new URLSearchParams(search).get(UTXO_ACTIVITY_TXID);
  return id && /^[0-9a-f]{64}$/.test(id) ? id : undefined;
}

export async function openUtxoReplacementTab(txid: string) {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Invalid UTXO activity ID');
  const url = chrome.runtime.getURL(
    `app.html#/home/details?${UTXO_ACTIVITY_TXID}=${txid}`
  );
  await new Promise<void>((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error || !tab)
        reject(error ?? new Error('Could not open wallet tab'));
      else resolve();
    });
  });
}
