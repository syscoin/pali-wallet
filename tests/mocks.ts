// import { initialState } from 'state/wallet';
// import IWalletState, {
//   Connection,
//   IAccountState,
//   ITab,
// } from 'state/wallet/types';
// import { Assets, Transaction } from 'types/transactions';

// export interface PsbtTransaction {
//   addInput(objectArg: any): void;
//   addOutput(objectArg: any): void;
//   getInputOutputCounts(): {
//     inputCount: number;
//     outputCount: number;
//   };
//   toBuffer(): Buffer;
// }

// export const FAKE_PASSWORD = 'Asdqwe123!';
// export const FAKE_INVALID_PASSWORD = '12345';
// export const FAKE_SEED_PHRASE =
//   'peace uncle grit essence stuff angle cruise annual fury letter snack globe';
// export const INVALID_SEED_PHRASE =
//   'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';

// export const FAKE_XPUB =
//   'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
// export const FAKE_XPRV =
//   'U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=';

// export const FAKE_ASSETS: Assets[] = [
//   {
//     type: 'SPTAllocated',
//     assetGuid: 1179191490,
//     symbol: 'asd',
//     balance: 1200000000,
//     decimals: 8,
//   },
//   {
//     type: 'SPTAllocated',
//     assetGuid: 1214075697,
//     symbol: 'nfttt',
//     balance: 100000000,
//     decimals: 8,
//   },
// ];

// export const FAKE_TRANSACTIONS: Transaction[] = [
//   {
//     tokenType: '',
//     txid: '278faced0d28ff8179dec9c6706c59c6a4375cdb03c7a873eb39ac2d66c54e0d',
//     value: 28968000,
//     confirmations: 3830,
//     fees: 215000,
//     blockTime: 1641427017,
//   },
//   {
//     tokenType: '',
//     txid: '1f30e6e4bebb900492984f31bc038e42f9e5d5b79a0001b3b8bb1eceddd80781',
//     value: 19638000,
//     confirmations: 3830,
//     fees: 147000,
//     blockTime: 1641427017,
//   },
// ];

// export const FAKE_ACCOUNT: IAccountState = {
//   address: {
//     main: 'sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax',
//   },
//   assets: [
//     {
//       type: 'SPTAllocated',
//       assetGuid: 3144265615,
//       symbol: 'NikBar',
//       balance: 200000000,
//       decimals: 8,
//     },
//     {
//       type: 'SPTAllocated',
//       assetGuid: 3569136514,
//       symbol: 'ads',
//       balance: 100000000,
//       decimals: 8,
//     },
//   ],
//   balance: 0.48430419,
//   connectedTo: ['sysmint.paliwallet.com', 'another.url'],
//   id: 15,
//   isTrezorWallet: false,
//   label: 'Account 15',
//   transactions: [
//     {
//       tokenType: '',
//       txid: 'ce57ad43942302b95f71008176bbf9648933c16bae678ab512f309616643604b',
//       value: 28323000,
//       confirmations: 3830,
//       fees: 283000,
//       blockTime: 1641427017,
//     },
//     {
//       tokenType: '',
//       txid: 'd81f315c74d2ddc1ab6b4b125b968d9236bb646c13e7036f26ecaa1b379f1ed6',
//       value: 29398000,
//       confirmations: 3831,
//       fees: 215000,
//       blockTime: 1641426442,
//     },
//   ],
//   xprv: FAKE_XPRV,
//   xpub: FAKE_XPUB,
// };

// export const FAKE_CONNECTION: Connection = {
//   accountId: FAKE_ACCOUNT.id,
//   url: 'sysmint.paliwallet.com',
// };

// export const FAKE_TAB: ITab = {
//   canConnect: false,
//   connections: [FAKE_CONNECTION],
//   currentSenderURL: 'https://sysmint.paliwallet.com/',
//   currentURL: 'https://sysmint.paliwallet.com/',
// };

// // state with an account
// export const STATE_W_ACCOUNT: IWalletState = {
//   ...initialState,
//   accounts: [FAKE_ACCOUNT],
// };

// export const WITNESS_UTXO = {
//   script: Buffer.from([
//     0, 20, 170, 182, 235, 123, 26, 239, 64, 130, 174, 135, 252, 151, 153, 203,
//     118, 82, 30, 223, 183, 103,
//   ]),
//   value: 41845537606,
// };

// export const PARTIAL_SIG = [
//   {
//     pubkey: Buffer.from([
//       2, 128, 200, 72, 47, 230, 29, 211, 241, 250, 100, 236, 91, 40, 32, 160,
//       138, 94, 30, 17, 112, 204, 215, 54, 185, 3, 195, 235, 118, 147, 170, 47,
//       244,
//     ]),
//     signature: Buffer.from([
//       48, 68, 2, 32, 91, 31, 18, 138, 243, 95, 166, 68, 50, 142, 44, 219, 103,
//       126, 26, 117, 16, 144, 250, 126, 177, 166, 248, 39, 199, 156, 163, 144,
//       66, 162, 148, 1, 2, 32, 106, 110, 77, 165, 232, 246, 81, 180, 204, 137,
//       194, 224, 15, 214, 65, 160, 224, 91, 97, 196, 215, 100, 102, 38, 220, 64,
//       43, 225, 120, 140, 20, 43, 1,
//     ]),
//   },
// ];

// export const BIP_32_DERIVATION = [
//   {
//     masterFingerprint: Buffer.from([107, 150, 207, 141]),
//     path: "m/84'/1'/0'/1/1443",
//     pubkey: Buffer.from([
//       2, 128, 200, 72, 47, 230, 29, 211, 241, 250, 100, 236, 91, 40, 32, 160,
//       138, 94, 30, 17, 112, 204, 215, 54, 185, 3, 195, 235, 118, 147, 170, 47,
//       244,
//     ]),
//   },
// ];

// export const FINAL_SCRIPT_WITNESS = Buffer.from([
//   2, 71, 48, 68, 2, 32, 91, 31, 18, 138, 243, 95, 166, 68, 50, 142, 44, 219,
//   103, 126, 26, 117, 16, 144, 250, 126, 177, 166, 248, 39, 199, 156, 163, 144,
//   66, 162, 148, 1, 2, 32, 106, 110, 77, 165, 232, 246, 81, 180, 204, 137, 194,
//   224, 15, 214, 65, 160, 224, 91, 97, 196, 215, 100, 102, 38, 220, 64, 43, 225,
//   120, 140, 20, 43, 1, 33, 2, 128, 200, 72, 47, 230, 29, 211, 241, 250, 100,
//   236, 91, 40, 32, 160, 138, 94, 30, 17, 112, 204, 215, 54, 185, 3, 195, 235,
//   118, 147, 170, 47, 244,
// ]);

// export const UNKNOWN_KEY_VALS = [
//   {
//     key: Buffer.from([97, 100, 100, 114, 101, 115, 115]),
//     value: Buffer.from([
//       116, 115, 121, 115, 49, 113, 52, 50, 109, 119, 107, 55, 99, 54, 97, 97,
//       113, 103, 57, 116, 53, 56, 108, 106, 116, 101, 110, 106, 109, 107, 50,
//       103, 48, 100, 108, 100, 109, 56, 117, 51, 110, 52, 121, 108,
//     ]),
//   },
//   {
//     key: Buffer.from([112, 97, 116, 104]),
//     value: Buffer.from([
//       109, 47, 56, 52, 39, 47, 49, 39, 47, 48, 39, 47, 49, 47, 49, 52, 52, 51,
//     ]),
//   },
// ];

// export const FAKE_PSBT: any = {
//   data: {
//     inputs: [
//       {
//         witnessUtxo: WITNESS_UTXO,
//         partialSig: PARTIAL_SIG,
//         bip32Derivation: BIP_32_DERIVATION,
//         finalScriptWitness: FINAL_SCRIPT_WITNESS,
//         unknownKeyVals: UNKNOWN_KEY_VALS,
//       },
//     ],
//     outputs: [{}, {}, {}],
//     globalMap: {
//       unsignedTx: undefined,
//     },
//   },
// };

export {};
