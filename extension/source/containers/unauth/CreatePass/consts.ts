import * as Yup from 'yup';

export const CREATE_PASS_TITLE1 = `Create your Password`;
export const CREATE_PASS_TITLE2 = `Successfully set \nyour password!`;

export const CREATE_PASS_COMMENT1 = `Do not forget to save your password.\nYou will need this Password to unlock your wallet.`;
export const CREATE_PASS_COMMENT2 = `You can now see your balance and assets, send and receive Sys and SPT's`;

export const schema = Yup.object().shape({
  password: Yup.string()
    .required('Password is a required field!')
    .matches(
      /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
      'Please check the above requirements!'
    ),
  repassword: Yup.string()
    .required('Confirm password is a required field!')
    .oneOf([Yup.ref('password'), ''], 'Incorrect please re-enter password!')
    .matches(
      /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
      'Please check the above requirements!'
    ),
});
