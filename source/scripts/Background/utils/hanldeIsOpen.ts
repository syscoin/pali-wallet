export const handleIsOpen = (isOpen: boolean) =>
  chrome.storage.local.set({ isPopupOpen: isOpen });
