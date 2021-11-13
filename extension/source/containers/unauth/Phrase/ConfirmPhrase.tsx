import React, { useState, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';
import { Button } from 'components/index';;
import shuffle from 'lodash/shuffle';
import isEqual from 'lodash/isEqual';

import {Layout} from '../../common/Layout';

const ConfirmPhrase = () => {
  const history = useHistory();
  const controller = useController();
  const phrases = controller.wallet.generatePhrase();

  const [orgList, setOrgList] = useState<Array<string>>(
    shuffle((phrases || '').split(' '))
  );

  const [newList, setNewList] = useState<Array<string>>([]);
  const [passed, setPassed] = useState<boolean>(false);

  const isNotEqualArrays = useMemo((): boolean => {
    if (!phrases) return true;
    return !isEqual(phrases.split(' '), newList);
  }, [phrases, newList]);

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
    <Layout title="Verify your recovery phrase" onlySection>
      <div className="transition-all duration-300 ease-in-out flex justify-center items-center flex-col gap-4 mt-8">
        <>
          <span className="font-light text-brand-graylight text-xs">
            Select the words in the correct order.
          </span>
          <section className="flex p-4 flex-wrap box-border min-h-full transition-all duration-300 items-center justify-center gap-4 border-b border-brand-graylight w-11/12">
            {newList.map((phrase, idx) => (
              <Button
                className="min-w-xs h-7 font-bold text-xs leading-4 flex items-center justify-center tracking-normal bg-brand-royalBlue p-1 border border-brand-royalBlue gap-4 rounded-md text-brand-navy"
                key={idx}
                type="button"
                onClick={() => handleNewPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
          <section className="flex p-4 w-full flex-wrap box-border min-h-full transition-all duration-300 items-center justify-center gap-4">
            {orgList.map((phrase, idx) => (
              <Button
                className="min-w-xs h-7 font-bold text-xs leading-4 flex items-center justify-center tracking-normal bg-brand-navy p-1 border border-brand-navymedium gap-4 rounded-md text-brand-white"
                key={idx}
                type="button"
                onClick={() => handleOrgPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
          <Button
            type="button"
            className="absolute bottom-12 tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navy text-brand-white font-light border border-brand-royalBlue hover:bg-brand-royalBlue hover:text-brand-navy transition-all duration-300"
            onClick={handleConfirm}
          >
            Validate
          </Button>
        </>
        {passed && (
          <div className="transition-all duration-300 ease-in-out">
            <div className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"></div>

            <div className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-deepPink top-1/3 left-8 right-8 p-6 rounded-3xl">
              <h2 className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4">YOUR WALLET IS READY</h2>

              <span className="font-light text-brand-graylight text-xs">
                You should now have your recovery phrase and your wallet password written down for future reference.
              </span>

              <Button
                type="button"
                className="tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-deepPink text-brand-white font-light border border-brand-white hover:bg-brand-white hover:text-brand-deepPink transition-all duration-300 mt-8"
                onClick={handleConfirm}
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
