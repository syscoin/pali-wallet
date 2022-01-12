const SYS_NETWORK = {
  main: {
    id: 'main',
    label: 'Mainnet',
    beUrl: 'https://blockbook.elint.services/',
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    beUrl: 'https://blockbook-dev.elint.services/',
  },
};

const initialMockState = {
  status: 0,
  accounts: [{
    "id": 0,
    "label": "Account 1",
    "balance": 0.57316579,
    "transactions": [
        {
            "txid": "89f20ae3ba21792b60dc32007b273dde4ffa7b9c389bbb688772974fbeb38962",
            "value": "26603000",
            "confirmations": 1339,
            "fees": "215000",
            "blockTime": 1641798437
        },
        {
            "txid": "23c90a6eec014c145c761943ba82238c5198b984d61ce5d9c43886d871b26419",
            "value": "26818000",
            "confirmations": 3803,
            "fees": "283000",
            "blockTime": 1641431322
        },
        {
            "txid": "bf26409839deb3e822b6f2b06b51875698db74b25eb81ccb9528ac3ce7ff859b",
            "value": "19423000",
            "confirmations": 3821,
            "fees": "215000",
            "blockTime": 1641427718
        },
        {
            "txid": "33c84232b9a5ac1c7efa4014d946c1ffed80b3a5fd5874b58cbf53422c0233c1",
            "value": "19638000",
            "confirmations": 3823,
            "fees": "147000",
            "blockTime": 1641427595
        },
        {
            "txid": "0dc19c75089151f33a95a1ef3971dca0a41a9f339e32572d8c116d9b16d40dc5",
            "value": "27678000",
            "confirmations": 3828,
            "fees": "215000",
            "blockTime": 1641427333
        },
        {
            "txid": "be171e754c823c27de7fb80f77961f12d81bc4db53e2ae74717d0d6185dbf0d6",
            "value": "27463000",
            "confirmations": 3828,
            "fees": "215000",
            "blockTime": 1641427333
        },
        {
            "txid": "d45bfc1e2d64afc821949b8320fa7022cbde0953217f4df98d0486af2ea09b88",
            "value": "27893000",
            "confirmations": 3829,
            "fees": "215000",
            "blockTime": 1641427248
        },
        {
            "txid": "f07346cce622747b2a7b4fb7d6f215c1b5dfa4bcbe9ecdff1caeaef53d2bc1b2",
            "value": "28108000",
            "confirmations": 3829,
            "fees": "215000",
            "blockTime": 1641427248
        },
        {
            "txid": "278faced0d28ff8179dec9c6706c59c6a4375cdb03c7a873eb39ac2d66c54e0d",
            "value": "28968000",
            "confirmations": 3830,
            "fees": "215000",
            "blockTime": 1641427017
        },
        {
            "txid": "1f30e6e4bebb900492984f31bc038e42f9e5d5b79a0001b3b8bb1eceddd80781",
            "value": "19638000",
            "confirmations": 3830,
            "fees": "147000",
            "blockTime": 1641427017
        },
        {
            "txid": "4be6546db192573ca6237b1dca3ced60d0c2c3ca10988cfc6501c6ec543f65dc",
            "value": "19423000",
            "confirmations": 3830,
            "fees": "215000",
            "blockTime": 1641427017
        },
        {
            "txid": "ce57ad43942302b95f71008176bbf9648933c16bae678ab512f309616643604b",
            "value": "28323000",
            "confirmations": 3830,
            "fees": "283000",
            "blockTime": 1641427017
        },
        {
            "txid": "d81f315c74d2ddc1ab6b4b125b968d9236bb646c13e7036f26ecaa1b379f1ed6",
            "value": "29398000",
            "confirmations": 3831,
            "fees": "215000",
            "blockTime": 1641426442
        },
        {
            "txid": "5e72869070cfac1834709bb0c8ea7078e94530b485b5dbba7f3da8b1d32a97e1",
            "value": "29183000",
            "confirmations": 3831,
            "fees": "215000",
            "blockTime": 1641426442
        },
        {
            "txid": "a7a0eb9c690ddef8530500dced959ac10821322bcdecd72b0a85cd2430569967",
            "value": "29613000",
            "confirmations": 3831,
            "fees": "147000",
            "blockTime": 1641426442
        },
        {
            "txid": "2f6c19c4f117cb28ffaf0ae8d7aab02921f1470f4f8decf41af0297a97da63cd",
            "value": "46708000",
            "confirmations": 3835,
            "fees": "240000",
            "blockTime": 1641425958,
            "tokenType": "SPTAssetAllocationSend"
        },
        {
            "txid": "c61453c388b9ae865ab54c775d24c07fccfb04238558da20d87c5f783247115a",
            "value": "35143579",
            "confirmations": 3836,
            "fees": "444000",
            "blockTime": 1641425923,
            "tokenType": "SPTAssetAllocationSend"
        },
        {
            "txid": "8e7038abfedebe682e5415667e349fd1c1f3a7f67b1bb09afea226025ee431f3",
            "value": "117460000",
            "confirmations": 5584,
            "fees": "257000",
            "blockTime": 1641153722,
            "tokenType": "SPTAssetActivate"
        },
        {
            "txid": "abd576103b8af44fee1eb1f5ab949cc31bd70e57ee8a39ddc7f094022fb7a075",
            "value": "198068000",
            "confirmations": 5587,
            "fees": "257000",
            "blockTime": 1641153278,
            "tokenType": "SPTAssetActivate"
        },
        {
            "txid": "fd49b0bdd57736c4440a7c11148480a0cb34e453890fdfcc7017e68758620960",
            "value": "99218000",
            "confirmations": 5591,
            "fees": "239000",
            "blockTime": 1641152817,
            "tokenType": "SPTAssetSend"
        }
    ],
    "xpub": "zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2",
    "xprv": "U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=",
    "address": {
        "main": "sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax"
    },
    "assets": [
        {
            "type": "SPTAllocated",
            "assetGuid": "70131121",
            "symbol": "asd",
            "balance": 100000000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "82173258",
            "symbol": "newt",
            "balance": 2999909993924,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "90296248",
            "symbol": "345",
            "balance": 13300000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "897866765",
            "symbol": "321",
            "balance": 2398010100,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "976849119",
            "symbol": "ASD",
            "balance": 1300000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "1179191490",
            "symbol": "asd",
            "balance": 1200000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "1214075697",
            "symbol": "nfttt",
            "balance": 100000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "1788053152",
            "symbol": "outroSPT",
            "balance": 1022599871,
            "decimals": 5
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "1823436190",
            "symbol": "LARALA2",
            "balance": 200000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "2028120594",
            "symbol": "asd",
            "balance": 100000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "2299200480",
            "symbol": "ads",
            "balance": 12400000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "2473318578",
            "symbol": "ads",
            "balance": 1200000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "2512785514",
            "symbol": "asd",
            "balance": 10,
            "decimals": 1
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "2751065500",
            "symbol": "NikBar",
            "balance": 300000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "2751956844",
            "symbol": "SYSToken",
            "balance": 100000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "3144265615",
            "symbol": "NikBar",
            "balance": 200000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "3569136514",
            "symbol": "ads",
            "balance": 100000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "3598927669",
            "symbol": "LARALA",
            "balance": 504000000,
            "decimals": 8
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "4018027960",
            "symbol": "nftt",
            "balance": 10,
            "decimals": 1
        },
        {
            "type": "SPTAllocated",
            "assetGuid": "5271816415",
            "symbol": "ASD",
            "balance": 3,
            "decimals": 8
        }
    ],
    "connectedTo": ["sysmint.paliwallet.com"],
    "isTrezorWallet": false
}],
  activeAccountId: 0,
  activeNetwork: SYS_NETWORK.main.id,
  encriptedMnemonic: null,
  confirmingTransaction: false,
  changingNetwork: false,
  signingTransaction: false,
  signingPSBT: false,
  walletTokens: [],
  tabs: {
    currentSenderURL: "https://sysmint.paliwallet.com/",
    currentURL: "https://sysmint.paliwallet.com/",
    canConnect: false,
    connections: [],
  },
  timer: 5,
  currentBlockbookURL: 'https://blockbook.elint.services/',
  networks: {
    main: {
      id: 'main',
      label: 'Main Network',
      beUrl: 'https://blockbook.elint.services/',
    },
    testnet: {
      id: 'testnet',
      label: 'Test Network',
      beUrl: 'https://blockbook-dev.elint.services/',
    },
  },
  trustedApps: {
    'app.uniswap.org': 'app.uniswap.org',
    'trello.com': 'https://trello.com/b/0grd7QPC/dev',
    'twitter.com': 'https://twitter.com/home',
    'maps.google.com': 'https://maps.google.com/',
    'facebook.com': 'https://accounts.google.com/b/0/AddMailService',
    'sysmint.paliwallet.com': 'sysmint.paliwallet.com',
  },
  temporaryTransactionState: {
    executing: false,
    type: 'sendAsset',
  },
};

module.exports = {initialMockState, SYS_NETWORK};
