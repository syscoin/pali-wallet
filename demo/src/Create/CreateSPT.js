import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css'
import Header from "../components/Header";
import FormCreateToken from '../components/FormCreateToken';

const CreateSPT = () => {
  const handleCreateToken = async (event, { precision, maxSupply, description, symbol, fee, receiver, rbf }) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    console.log('handle create spt', precision, maxSupply, description, symbol, fee, receiver, rbf)

    await await window.ConnectionsController.handleCreateToken(
      Number(precision),
      symbol,
      Number(maxSupply),
      Number(fee),
      description,
      receiver,
      false
    );
  }

  return (
    <div className="app">
      <Header />

      <div className="form">
        <FormCreateToken
          formCallback={handleCreateToken}
          token="SPT"
        />
      </div>
    </div>
  );
}
export default CreateSPT;




