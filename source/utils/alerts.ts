export const showSuccessAlert = (
  condition: boolean,
  message: string,
  alert: any
) => {
  if (condition) {
    alert.removeAll();
    alert.success(message);
  }
};
