import React, {
  useState,
  // useMemo
} from 'react';
import { useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';

import shuffle from 'lodash/shuffle';
// import isEqual from 'lodash/isEqual';
import { Layout } from '../../common/Layout';
import { Button } from 'components/index';

export const ConfirmPhrase = () => {
  const history = useHistory();
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
    if (!passed) {
      setPassed(true);

      return;
    }

    controller.wallet.createWallet();

    history.push('/app.html');
  };

  return (
    <Layout
      title="Confirm Recovery Phrase"
      onlySection
    >
      <div
        className="text-brand-white transition-all duration-300 ease-in-out flex justify-center items-center flex-col gap-4 mt-2"
      >
        <>
          <section
            className="flex p-4 flex-wrap box-border min-h-full transition-all duration-300 items-center justify-center gap-4 border-b border-brand-graylight w-11/12"
          >
            {newList.map((phrase, idx) => (
              <Button
                noStandard
                type="button"
                className="px-6 text-brand-white min-w-xs h-7 text-xs flex items-center justify-center tracking-normal bg-brand-royalBlue border border-brand-royalBlue rounded-md"
                key={idx}
                onClick={() => handleNewPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>

          <section
            className="flex p-6 w-full flex-wrap box-border min-h-full transition-all duration-300 items-center justify-center gap-4 pb-10"
          >
            {orgList.map((phrase, idx) => (
              <Button
                noStandard
                type="button"
                className="px-2 min-w-xs h-7 text-xs leading-4 flex items-center justify-center tracking-normal bg-brand-navy p-1 border-2 border-brand-royalBlue rounded-md text-brand-white"
                key={idx}
                onClick={() => handleOrgPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>

          <Button
            type="button"
            onClick={handleConfirm}
            classNameBorder="absolute bottom-12"
          >
            Validate
          </Button>
        </>

        {passed && (
          <div className="transition-all duration-300 ease-in-out">
            <div
              className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
            />

            <div
              className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-navymedium top-1/3 left-8 right-8 p-6 rounded-3xl"
            >
              <h2
                className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4"
              >
                YOUR WALLET IS READY
              </h2>

              <span
                className="font-light text-brand-graylight text-xs"
              >
                You should now have your recovery phrase and your wallet
                password written down for future reference.
              </span>

              <Button
                type="button"
                className="tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navymedium text-brand-white font-light border border-brand-white hover:bg-brand-white hover:text-brand-navymedium transition-all duration-300 mt-8"
                onClick={handleConfirm}
                noStandard
              >
                Ok, let's get started
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default ConfirmPhrase;
