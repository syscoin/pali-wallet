import * as Yup from 'yup';

export const schema = Yup.object().shape({
  password: Yup.string().required('Error: Password is a required field.'),
  // .matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/),
});
