// import reducer, {
//   registerListeningSite,
//   deregisterListeningSite,
//   listNewDapp,
//   unlistDapp,
//   initialState,
// } from '.';
// import { IDAppInfo } from './types';
// /*  ----- Tests ----- */

// describe('dapp store actions', () => {
//   describe('Listening sites tests', () => {
//     //* registerListenerSite
//     it('should register listening site', () => {
//       const payload = {
//         eventName: 'fake event',
//         origin: 'fake origin',
//       };
//       const newState = reducer(initialState, registerListeningSite(payload));
//       expect(newState.listening[payload.origin]).toContain(payload.eventName);
//     });

//     //* deregisterListenerSite
//     it('should deregister listening site ', () => {
//       const payload = {
//         eventName: 'fake event',
//         origin: 'fake origin',
//       };

//       const customState = reducer(initialState, registerListeningSite(payload));

//       const newState = reducer(customState, deregisterListeningSite(payload));

//       expect(newState.listening).not.toContain(payload.origin);
//     });
//   });

//   describe('Dapp tests', () => {
//     const FAKE_IDAPPINFO: IDAppInfo = {
//       logo: 'fake logo',
//       origin: 'fake origin',
//       title: 'fake title',
//     };
//     //* listNewDapp
//     it('should list new dapp', () => {
//       const payload = {
//         dapp: FAKE_IDAPPINFO,
//         id: 'fake id',
//         network: 'main',
//       };

//       const newState = reducer(initialState, listNewDapp(payload));
//       console.log(newState);
//       // expect(newState.trustedApps[payload.id]).toEqual(payload.dapp);
//     });

//     it('should unlist dapp', () => {
//       const listPayload = {
//         dapp: FAKE_IDAPPINFO,
//         id: 'fake id',
//         network: 'main',
//       };

//       const unlistPayload = {
//         id: 'fake id',
//       };

//       const customState = reducer(initialState, listNewDapp(listPayload));
//       const newState = reducer(customState, unlistDapp(unlistPayload));
//       expect(newState.trustedApps).toEqual(initialState.trustedApps);
//     });
//   });
// });

export {};
