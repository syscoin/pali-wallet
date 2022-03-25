export const openNotificationsPopup = (title: string, message: string) => {
  chrome.notifications.create(new Date().getTime().toString(), {
    type: 'basic',
    iconUrl: 'assets/icons/favicon-48.png',
    title,
    message,
  });
};
