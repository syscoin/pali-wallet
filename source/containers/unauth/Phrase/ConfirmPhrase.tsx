import React, {
  useState,
  // useMemo
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useController } from 'hooks/index';
import shuffle from 'lodash/shuffle';
import { Button, Modal, PrimaryButton } from 'components/index';

import { Layout } from '../../common/Layout';
// import isEqual from 'lodash/isEqual';

export const ConfirmPhrase = () => {
  const navigate = useNavigate();
  const controller = useController();
  const phrases = controller.wallet.generatePhrase();

  const [orgList, setOrgList] = useState<Array<string>>(
    shuffle((phrases || '').split(' '))
  );

  const [newList, setNewList] = useState<Array<string>>([]);
  const [passed, setPassed] = useState<boolean>(false);

  // const isNotEqualArrays = useMemo((): boolean => {
  //   if (!phrases) return true;
  //   return !isEqual(phrases.split(' '), newList);
  // }, [phrases, newList]);

  const handleOrgPhrase = (idx: number) => {
    const tempList = [...orgList];
    setNewList([...newList, orgList[idx]]);
    tempList.splice(idx, 1);
    setOrgList([...tempList]);
  };

  const handleNewPhrase = (idx: number) => {
    const tempList = [...newList];
    setOrgList([...orgList, newList[idx]]);
    tempList.splice(idx, 1);
    setNewList([...tempList]);
  };

  const handleConfirm = () => {
    controller.wallet.createWallet();

    navigate('/app.html');

    setPassed(true);
  };

  return (
    <Layout title="Confirm Recovery Phrase" onlySection>
      <div className="text-brand-white transition-all duration-300 ease-in-out flex justify-center items-center flex-col gap-4 mt-2">
        <>
          <section className="flex flex-wrap box-border transition-all duration-300 p-3 border-b border-brand-graylight items-center justify-center gap-3 w-11/12">
            {newList.map((phrase, idx) => (
              <Button
                useDefaultWidth={false}
                className="min-w-xs h-7 font-bold text-xs leading-4 flex items-center justify-center tracking-normal bg-brand-royalblue py-1 px-3 border border-brand-royalblue gap-4 rounded-md text-brand-white"
                key={phrase}
                type="button"
                onClick={() => handleNewPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
          <section className="flex flex-wrap box-border transition-all duration-300 items-center justify-center gap-3 w-11/12">
            {orgList.map((phrase, idx) => (
              <Button
                useDefaultWidth={false}
                className="min-w-xs h-7 font-bold text-xs leading-4 flex items-center justify-center tracking-normal bg-bkg-2 py-1 px-3 border border-bkg-4 gap-4 rounded-md text-brand-white"
                key={phrase}
                type="button"
                onClick={() => handleOrgPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>

          <div className="absolute bottom-12">
            <PrimaryButton type="button" onClick={handleConfirm}>
              Validate
            </PrimaryButton>
          </div>
        </>

        {passed && (
          <Modal
            type="default"
            title="YOUR WALLET IS READY"
            description="You should now have your recovery phrase and your wallet password written down for future reference."
            open={passed}
            onClose={handleConfirm}
          />
        )}
      </div>
    </Layout>
  );
};

export default ConfirmPhrase;
