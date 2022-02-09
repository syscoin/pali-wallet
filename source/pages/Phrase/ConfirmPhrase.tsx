import React, {
  useState,
  // useMemo
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useController } from 'hooks/index';
import shuffle from 'lodash/shuffle';
import { Button, Modal, PrimaryButton } from 'components/index';
import { Layout } from 'pages/Layout';
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

    navigate('/');

    setPassed(true);
  };

  return (
    <Layout title="Confirm Recovery Phrase" onlySection>
      <div className="flex flex-col gap-4 items-center justify-center mt-2 text-brand-white transition-all duration-300 ease-in-out">
        <>
          <section className="flex flex-wrap gap-3 items-center justify-center p-3 w-11/12 border-b border-brand-graylight box-border transition-all duration-300">
            {newList.map((phrase, idx) => (
              <Button
                useDefaultWidth={false}
                className="flex gap-4 items-center justify-center px-3 py-1 min-w-xs h-7 text-brand-white text-xs font-bold tracking-normal leading-4 bg-brand-royalblue border border-brand-royalblue rounded-md"
                key={phrase}
                type="button"
                onClick={() => handleNewPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
          <section className="flex flex-wrap gap-3 items-center justify-center w-11/12 box-border transition-all duration-300">
            {orgList.map((phrase, idx) => (
              <Button
                useDefaultWidth={false}
                className="flex gap-4 items-center justify-center px-3 py-1 min-w-xs h-7 text-brand-white text-xs font-bold tracking-normal leading-4 bg-bkg-2 border border-bkg-4 rounded-md"
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
