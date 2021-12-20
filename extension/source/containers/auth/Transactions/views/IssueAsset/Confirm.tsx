import React, { useEffect, useState } from 'react';
import { useController, useStore, useUtils, useFormat, useTransaction, useAccount, useBrowser } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Icon, Button } from 'components/index';

export const IssueAssetConfirm = () => {
  const controller = useController();
  const { mintSPT } = controller.wallet.account.getTransactionItem();

  const { issuingAsset } = useStore();
  const { ellipsis, formatURL } = useFormat();
  const { history } = useUtils();
  const { activeAccount } = useAccount();
  const { browser } = useBrowser();
  const { handleRejectTransaction, handleConfirmSiteTransaction } = useTransaction();

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const advancedOptionsArray = [
    'notarydetails',
    'notaryAddress',
    'auxfeedetails',
    'payoutAddress',
    'capabilityflags',
    'contract',
  ];

  useEffect(() => {
    if (mintSPT) {
      const newData: any = {};

      Object.entries(mintSPT).map(([key, value]) => {
        if (!newData[key]) {
          newData[key] = {
            label: key,
            value,
            advanced: advancedOptionsArray.includes(key),
          };
        }
      });

      setData(Object.values(newData));
    }
  }, [mintSPT]);

  const handleConfirm = async () => {
    const recommendedFee = await controller.wallet.account.getRecommendFee();

    try {
      handleConfirmSiteTransaction(
        setLoading,
        setConfirmed,
        activeAccount,
        formatURL,
        browser,
        mintSPT,
        alert,
        controller.wallet.account.confirmIssueSPT,
        'Can\'t create token. Try again later.',
        recommendedFee,
        confirmed
      )
    } catch (error) {
      console.log(error)
    }
  }

  return (
    <AuthViewLayout canGoBack={false} title="CONFIRM TOKEN MINT">
      {mintSPT ? (
        <div className="flex justify-center flex-col items-center">
          <ul className="text-xs overflow-auto w-full px-4 h-80 mt-4">
            {data && data.map((item: any) => (
              <>
                {!item.advanced && (
                  <li
                    key={item.label}
                    className="flex justify-between p-2 my-2 border-b border-dashed border-brand-royalBlue items-center w-full text-xs"
                  >
                    <p>{item.label}</p>
                    <p>{typeof item.value === 'string' && item.value.length > 10 ? ellipsis(item.value) : item.value}</p>
                  </li>
                )}
              </>
            ))}
          </ul>

          <div className="flex justify-between items-center absolute bottom-10 gap-3">
            <Button
              type="button"
              className="bg-brand-navydarker"
              onClick={() => handleRejectTransaction(browser, mintSPT, history)}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              loading={loading}
              className="bg-brand-navydarker"
              onClick={handleConfirm}
            >
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <Icon
          name="loading"
          wrapperClassname="absolute top-1/2 left-1/2"
          className="w-4 text-brand-white"
        />
      )}
    </AuthViewLayout>
  );
};
