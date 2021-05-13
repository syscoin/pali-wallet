import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import Dropzone from 'react-dropzone-uploader';
import FormMintNFT from "./Form/FormMintNFT";
import Header from "../components/Header";

const MintNFT = () => {
  const [preview, setPreview] = useState("");
  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState('');

  useEffect(() => {
    const callback = async (event) => {
      if (event.detail.SyscoinInstalled) {
        setIsInstalled(true);

        if (event.detail.ConnectionsController) {
          setController(window.ConnectionsController);

          return;
        }

        return;
      }

      setIsInstalled(false);

      window.removeEventListener('SyscoinStatus', callback);
    }

    window.addEventListener('SyscoinStatus', callback);
  }, []);

  const setup = async () => {
    const state = await controller.getWalletState();

    if (state.accounts.length > 0) {
      controller.getConnectedAccount()
        .then((data) => {
          if (data) {
            setConnectedAccount(data);
            setConnectedAccountAddress(data.address.main);
            setBalance(data.balance);
          } else {
            setConnectedAccount({});
            setConnectedAccountAddress('');
            setBalance(0);
          }
      
          return;
        });
    }
  };

  useEffect(() => {
    if (controller) {
      setup();

      controller.onWalletUpdate(setup);
    }
  }, [
    controller,
  ]);

  const handleMessageExtension = async () => {
    await controller.connectWallet();
    await setup();
  }

  const getUploadParams = () => ({
    url: 'https://api.nft.storage/upload',  
    headers: { "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweGJiNUM1NzJkYmFlNDQ1MkFDOGFiZWZlMjk3ZTljREIyRmEzRjRlNzIiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxOTcxMjM0MTgzNCwibmFtZSI6InN5cyJ9.KmVoWH8Sa0FNsPyWrPYEr1zCAdFw8bJwVnmzPsp_fg4"
    }
  });
  
  //"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5ASDASDAXCZg0NTY5MDEiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxODU5NzczODM5NCwibmFtZSI6ImtleTEifQ.uNeFoDDU_M8uzTNTVQ3uYnxejjVNldno5nFuxzoOWMk"

  const handleChangeStatus = ({ meta, file, xhr }, status) => {
    if (xhr?.response){
      const {value: {cid}} = JSON.parse(xhr.response);

      setPreview(`https://ipfs.io/ipfs/${cid}/${file.name}`);

      console.log(`CID:${cid}`)
      console.log('meta: ', meta)
      console.log('file', file)
      console.log(`other information: `, JSON.parse(xhr.response));
      document.getElementById('out').innerHTML+= `${JSON.stringify(`CID:${cid}`)}\n`;
    }; 
  };

  const handleMintNFT = (event, {
    nftName,
    description,
    maxShares,
    editions,
    royalites,
    property1,
    property2,
    property3,
    attribute1,
    attribute2,
    attribute3
  }) => {
    event.preventDefault();

    // call controller function and send parameters to use in the messages
    // await controller.handleMintNFT(
    //   nftName,
    //   description,
    //   maxShares,
    //   editions,
    //   royalites,
    //   property1,
    //   property2,
    //   property3,
    //   attribute1,
    //   attribute1,
    //   attribute1
    // )

    console.log('items nft mint', nftName, description, maxShares, editions, royalites, property1, property2, property3, attribute1, attribute2, attribute3)
    console.log('handle issue asset mint nft');
  }

  return (
    <div className="app">
      {controller ? (  
        <div>  
          <Header
            canConnect={canConnect}
            handleMessageExtension={handleMessageExtension}
            isInstalled={isInstalled}
            connectedAccountAddress={connectedAccountAddress}
          />

          <div>
            <Dropzone
              getUploadParams={getUploadParams}
              onChangeStatus={handleChangeStatus}
              accept='image/*, image/gif, audio/*, video/*, gif/*, .gif, .pdf, .mp3'
              inputContent={() => ( 'Drag Files')}
            />

            <pre
              className="cid"
              id="out"
            ></pre> 
          </div> 
          
          <iframe
            className="iframe"
            src={preview}
            href={preview}
          ></iframe>

          <div>
            <a
              className="button-2"
              href="/sysmint"
            >
              Clear
            </a>
          </div>

          <div className="form"> 
            <FormMintNFT formCallback={handleMintNFT} />          
          </div>
        </div>
      ) : (
        <div>
          <p>...</p>
        </div>
      )}
  </div>
  )
}
  
export default MintNFT;