import React, { useState } from 'react';
import CreatePass from './CreatePass';
import ImportPhrase from './ImportPhrase';

const Import = () => {
  const [registered, setRegistered] = useState(false);

  return registered ? (
    <CreatePass />
  ) : (
    <ImportPhrase onRegister={() => setRegistered(true)} />
  );
};

export default Import;
