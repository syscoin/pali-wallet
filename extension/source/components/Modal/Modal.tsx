import React, { FC } from 'react';
import { useFormat, useUtils, useBrowser, useStore } from 'hooks/index';

interface IModal {
  callback?: any;
  connected?: boolean;
  message?: any;
  title: any;
}

export const Modal: FC<IModal> = ({ title, message, connected, callback }) => {
  const { accounts } = useStore();
  const { ellipsis, formatURL } = useFormat();
  const { getHost } = useUtils();
  const { browser } = useBrowser();
  
  const handleDisconnect = (id: number) => {
    browser.runtime.sendMessage({
      type: 'RESET_CONNECTION_INFO',
      target: 'background',
      id,
      url: title,
    });
  };

  const connectedAccounts = accounts.filter((account) => {
    return account.connectedTo.find((url: any) => url === getHost(title));
  });

  return (
    <div>
      <div>
        <small>{formatURL(title)}</small>

        {connected && (
          <small>
            You have {connectedAccounts.length} account connected to this site
          </small>
        )}
      </div>

      <p>{message}</p>

      {!connected && (
        <div>
          <button
            type="button"
            onClick={() => callback()
          }>
            Close
          </button>
        </div>
      )}

      {connected && (
        <div>
          {connectedAccounts.map((item) => {
            return (
              <div key={item.id}>
                <div >
                  <p>{item.label}</p>
                  <small>{ellipsis(item.address.main)}</small>
                </div>

                <svg
                  onClick={() => handleDisconnect(item.id)}
                  width="13"
                  height="16"
                  viewBox="0 0 13 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12.3077 0.888889H9.23077L8.35165 0H3.95604L3.07692 0.888889H0V2.66667H12.3077V0.888889ZM0.879121 3.55556V14.2222C0.879121 15.2 1.67033 16 2.63736 16H9.67033C10.6374 16 11.4286 15.2 11.4286 14.2222V3.55556H0.879121ZM7.91209 9.77778V13.3333H4.3956V9.77778H2.63736L6.15385 6.22222L9.67033 9.77778H7.91209Z"
                    fill="#4ca1cf"
                  />
                </svg>
              </div>
            );
          })}

          <div>
            <p>Permissions</p>

            <div>
              <input
                disabled
                type="checkbox"
                name="permission"
                id="permission"
                checked
              />
              <small>View the adresses of your permitted accounts.</small>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => callback()
            }>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
