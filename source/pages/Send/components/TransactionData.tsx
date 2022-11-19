import React from 'react';

export const TransactionDataComponent = (props: any) => {
  const { decodedTx } = props;

  return (
    <>
      <p>{decodedTx.method}</p>
    </>
  );
};
