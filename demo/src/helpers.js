export const setFormState = (event, state, item, setState) => {
  return setState({
    ...state,
    [item]: event.target.value
  });
}