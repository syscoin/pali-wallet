import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SyscoinHDSigner } from '@pollum-io/sysweb3-utils';

export type ISignerState = { signer: any; hd: SyscoinHDSigner };

export const initialState: ISignerState = {
  hd: {} as SyscoinHDSigner,
  signer: null,
};

const SignerState = createSlice({
  name: 'signer',
  initialState,
  reducers: {
    setMainSigner(state: ISignerState, action: PayloadAction<any>) {
      state.signer = action.payload;
    },
    setHdSigner(state: ISignerState, action: PayloadAction<SyscoinHDSigner>) {
      state.hd = action.payload;
    },
  },
});

export const { setMainSigner, setHdSigner } = SignerState.actions;

export default SignerState.reducer;
