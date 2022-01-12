const { browser } = require('webextension-polyfill-ts');
const {initialMockState, SYS_NETWORK} = require('../../state/store');
const initializator = require('../initializator');
const sys = require('syscoinjs-lib');
const { fromZPub } = require('bip84');
const {default: axios} = require('axios')


const { accounts, tabs } = initialMockState;
const { currentURL } = tabs;

const getConnectedAccount = () => {

  return accounts.find((account) => {
    return account.connectedTo.find((url) => {
      return url === new URL(currentURL).host;
    });
  });
};

const transactionData = () => {
  const transactionItem = initialMockState.temporaryTransactionState.type === 'sendAsset';

  console.log('calling update tx data', transactionItem)

  const transactions = transactionItem ? accounts[0].transactions : getConnectedAccount().transactions;
  
  console.log('calling update tx data account', transactions)

  if(transactions){
    return true;
  }else{
    return false;
  }
};

const getConnectedAccountXpub = () => {
  return getConnectedAccount() ? getConnectedAccount().xpub : null;
};

const fetchAccountInfo = async (isHardwareWallet, xpub) => {
  let response = null;
  let sysjs;

  if (isHardwareWallet) {
    response = await axios.get(`${SYS_NETWORK.testnet.beUrl}/api/v2/xpub/${xpub}?tokens=nonzero&details=txs/`)

    const account0 = new fromZPub(xpub, sysjs?.Signer.Signer.pubtypes, sysjs?.Signer.Signer.networks);
    let receivingIndex = -1;

    if (response.tokens) {
      response.tokens.forEach((token) => {
        if (token.path) {
          const splitPath = token.path.split('/');

          if (splitPath.length >= 6) {
            const change = parseInt(splitPath[4], 10);
            const index = parseInt(splitPath[5], 10);

            if (change === 1) {
              return;
            }

            if (index > receivingIndex) {
              receivingIndex = index;
            }
          }
        }
      });
    }


    return {
      response,
    };
  }

  response = await axios.get(`${SYS_NETWORK.testnet.beUrl}/api/v2/xpub/${xpub}?tokens=nonzero&details=txs/`);

  return {
    response,
  };
}

describe('Account Controller test', () => {
  it('should return connected accounts', async () => {
    await initializator()

    const ConnectedAccounts = getConnectedAccount();

    if(ConnectedAccounts){
      console.log('Found connected account')
    }else{
      console.log('Not found connected account')
    }

    driver.quit();
  });

  it('should return true or false if account has a transaction', async () => {
    await initializator()

    const transaction = transactionData();
    if(transaction){
      console.log('Found transaction in account.')
    }else{
      console.log('Not found transaction in account.')
    }
    driver.quit();
  });

  it('should return xpub account', async () => {
    await initializator();
    const xpub = getConnectedAccountXpub();
    if(xpub){
      console.log('xpub account found: ', xpub);
    } else {
      console.log('xpub account not found');
    }
    driver.quit();
  });
  it('should return an account details', async () => {
    await initializator();
    const xpub = 'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
    const accountInfo = await fetchAccountInfo(initialMockState.accounts.isTrezorWallet, xpub);
    if(accountInfo.response.data && accountInfo.response.data.address){
      console.log('Found account info');
    } else{
      console.log('Not found account info');
    }
  });
  
}); 
