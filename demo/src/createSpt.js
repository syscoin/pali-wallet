import React, { Component, useEffect, useState, useCallback } from "react";
import logo from "./assets/images/logosys.svg";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css'
import Dropzone from 'react-dropzone-uploader'
import FormCrtSpt from "./FormCrtSpt"


import {SyscoinJSLib} from 'syscoinjs-lib';
  const CreateSPT = () => { 

const utils = require('./utils')
const syscointx = require('syscointx-js')
const BN = require('bn.js')
    const sjs = require('syscoinjs-lib')
    const mnemonic = 'air leader stone antenna first shrug panic before nut sport bench keen'
// blockbook URL
const backendURL = 'https://sys-explorer.tk/' // if using localhost you don't need SSL see use 'systemctl edit --full blockbook-syscoin.service' to remove SSL from blockbook
// 'null' for no password encryption for local storage and 'true' for testnet
const HDSigner = new sjs.utils.HDSigner(mnemonic, null, true)

const syscoinjs = new sjs.SyscoinJSLib(HDSigner, backendURL)

    const [preview, setPreview] = useState("");
    const [isInstalled, setIsInstalled] = useState(false);
    const [canConnect, setCanConnect] = useState(true);
    const [balance, setBalance] = useState(0);
    const [controller, setController] = useState();
    const [connectedAccount, setConnectedAccount] = useState({});
    const [connectedAccountAddress, setConnectedAccountAddress] = useState('');
    const [amount, setAmount] = useState(0);
    const [fee, setFee] = useState(0.00001);
    const [toAddress, setToAddress] = useState('');
    const [selectedAsset,setSelectedAsset] = useState(null);
    const [checked, setChecked] = useState(false);

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

    const handleTypeChanged = useCallback((checked) => {
        setChecked(checked)
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
      if (controller){
        
      }
    })
    useEffect(() => {
      if (controller) {
        setup();
  
        controller.onWalletUpdate(setup);
      }
    }, [
      controller,
    ]);
  
    const handleAssetSelected = (event) => {
      if (connectedAccount) {
        const selectedAsset = connectedAccount.assets.filter((asset) => asset.assetGuid == event.target.value);
  
        if (selectedAsset[0]) {
          setSelectedAsset(selectedAsset[0]);
  
          return;
        }
  
        setSelectedAsset(null);
      }
    };
  
    const handleMessageExtension = async () => {
      await controller.connectWallet();
      await setup();
    }
  
    const handleGetWalletState = async () => {
      return await controller.getWalletState();
    }
  
    const clearData = (inputs) => {
      for (let input of inputs) {
        input.value = '';
      }
  
      setToAddress('');
      setAmount(0);
      setFee(0.00001);
    }


    const handleSendToken = async (sender, receiver, amount, fee, token) => {
      const inputs = document.querySelectorAll('input');
  
      if (token !== null) {
        await controller.handleSendToken(sender, receiver, amount, fee, token, true, !checked);
  
        clearData(inputs);
  
        return;
      }
  
      await controller.handleSendToken(sender, receiver, amount, fee, null, false, !checked);
  
      clearData(inputs);
  
      return;
    }
    const getUploadParams = () => ({ url: 'https://api.nft.storage/upload',  
headers: { "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweGJiNUM1NzJkYmFlNDQ1MkFDOGFiZWZlMjk3ZTljREIyRmEzRjRlNzIiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxOTcxMjM0MTgzNCwibmFtZSI6InN5cyJ9.KmVoWH8Sa0FNsPyWrPYEr1zCAdFw8bJwVnmzPsp_fg4"
 }})
;//"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5ASDASDAXCZg0NTY5MDEiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxODU5NzczODM5NCwibmFtZSI6ImtleTEifQ.uNeFoDDU_M8uzTNTVQ3uYnxejjVNldno5nFuxzoOWMk"
const handleChangeStatus = ({ meta, file, xhr }, status) => {
 if (xhr?.response){
  const {value: {cid}} = JSON.parse(xhr.response)
  setPreview(`https://ipfs.io/ipfs/${cid}/${file.name}`)

  console.log(`CID:${cid}`)
  console.log('meta: ', meta)
  console.log('file', file)
  console.log(`other information: `, JSON.parse(xhr.response));
   document.getElementById('out').innerHTML+= `${JSON.stringify(
    `CID:${cid}`
  )}\n` 
 
}; 
};  
async function issueAssetNFT1 () {
  const feeRate = new sjs.utils.BN(10)
  const txOpts = { rbf: true }
  const assetGuid = '2441957158'
  const NFTID = sjs.utils.createAssetID('1', assetGuid)
  // mint 1000 satoshi (not COINS)
  // if assets need change sent, set this address. null to let HDSigner find a new address for you
  const assetChangeAddress = null
  const assetMap = new Map([
    [NFTID, { changeAddress: assetChangeAddress, outputs: [{ value: new sjs.utils.BN(1), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
  ])
  // if SYS need change sent, set this address. null to let HDSigner find a new address for you
  const sysChangeAddress = null
  const psbt = await syscoinjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate)
  if (!psbt) {
    console.log('Could not create transaction, not enough funds?')
  }
}
SyscoinJSLib.prototype.assetSend = async function (txOpts, assetMapIn, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (!utxos) {
    if (sysFromXpubOrAddress) {
      utxos = await utils.fetchBackendUTXOS(this.blockbookURL, sysFromXpubOrAddress)
    } else if (this.HDSigner) {
      utxos = await utils.fetchBackendUTXOS(this.blockbookURL, this.HDSigner.getAccountXpub())
    }
  }
  if (this.HDSigner) {
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  const BN_ZERO = new BN(0)
  const assetMap = new Map()
  // create new map with base ID's setting zero val output in the base asset outputs array
  for (const [assetGuid, valueAssetObj] of assetMapIn.entries()) {
    const baseAssetID = utils.getBaseAssetID(assetGuid)
    // if NFT
    if (baseAssetID !== assetGuid) {
      // likely NFT issuance only with no base value asset issued, create new base value object so assetSend can perform proof of ownership
      if (!assetMapIn.has(baseAssetID)) {
        const valueBaseAssetObj = { outputs: [{ address: sysChangeAddress, value: BN_ZERO }] }
        valueBaseAssetObj.changeAddress = sysChangeAddress
        assetMap.set(baseAssetID, valueBaseAssetObj)
      }
      assetMap.set(assetGuid, valueAssetObj)
    // regular FT
    } else {
      valueAssetObj.outputs.push({ address: sysChangeAddress, value: BN_ZERO })
      valueAssetObj.changeAddress = sysChangeAddress
      assetMap.set(assetGuid, valueAssetObj)
    }
  }
  if (this.HDSigner) {
    for (const valueAssetObj of assetMap.values()) {
      if (!valueAssetObj.changeAddress) {
        valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
      }
    }
  }
  // true last param for filtering out 0 conf UTXO
  utxos = utils.sanitizeBlockbookUTXOs(sysFromXpubOrAddress, utxos, this.network, txOpts, assetMap, true)
  const res = syscointx.assetSend(txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  if (sysFromXpubOrAddress) {
    return { res: res, assets: utils.getAssetsRequiringNotarizationFromRes(res, utxos.assets) }
  }
  return await this.signAndSend(res, utils.getAssetsRequiringNotarizationFromRes(res, utxos.assets))
}


    return (
      
             <div className="app">
     
             {controller ? (  
       <div>  
       <nav class="navbar navbar-expand-lg navbar-light  static-top">
         <div class="container">
           <a class="navbar-brand" href="https://syscoin.org/">
           <img src={logo} alt="logo" className="header__logo"></img>
               </a>
               <a class="button" href="/">Home</a>
          
              <div class="collapse navbar-collapse" id="navbarResponsive">
             <ul class="navbar-nav ml-auto">
              <button
                className="button"
                onClick={canConnect ? handleMessageExtension : undefined}
                disabled={!isInstalled}>
                {connectedAccountAddress === '' ? 'Connect to Syscoin Wallet' : connectedAccountAddress}
              </button>
             </ul>
           </div>
         </div>
       </nav>  
            {!isInstalled && (<h1 className="app__title">You need to install Syscoin Wallet.</h1>)}


 <div className="form"> 
  <FormCrtSpt></FormCrtSpt>         
  </div>
          </div>
        ) : (
          <div>
            <p>...</p>
            <h1>You need to install Syscoin Wallet.</h1>
          </div>
        )}
      </div>
    );
  }
  
  export default CreateSPT;
  
  
  