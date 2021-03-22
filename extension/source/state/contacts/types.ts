export interface IContactState {
  id: string;
  name: string;
  address: string;
  memo: string;
}

export default interface IContactBookState {
  [id: string]: IContactState;
}
