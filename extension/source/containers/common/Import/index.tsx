import React, { useState } from 'react';

import CreatePass from './CreatePass';
import ImportPhrase from './ImportPhrase';

export const Import = () => {
  const [registered, setRegistered] = useState<boolean>(false);

  return registered ? (
    <CreatePass />
  ) : (
    <ImportPhrase onRegister={() => setRegistered(true)} />
  );
};
