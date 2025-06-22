import { toSvg } from 'jdenticon';
import React, { useEffect } from 'react';

type FaucetCardAccountProps = {
  accountAddress: string;
  accountName: string;
  accountXpub: string;
};
export const FaucetCardAccount: React.FC<FaucetCardAccountProps> = ({
  accountName,
  accountAddress,
  accountXpub,
}) => {
  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(accountXpub, 50, {
      backColor: '#07152B',
      padding: 1,
    });
  }, [accountXpub]);

  return (
    <>
      <div className="mt-6 w-[352px] h-[70px] rounded-[20px] p-4 flex items-center border-dashed border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100">
        <div className="add-identicon ml-1 mr-2 my-2" />
        <div className="flex flex-col">
          <h1 className="text-white text-base font-medium">{accountName}</h1>
          <p className="text-white text-xs">{accountAddress}</p>
        </div>
      </div>
    </>
  );
};
