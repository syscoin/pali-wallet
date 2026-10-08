// SYSCOIN: Navigation/focus can retain horizontal scroll in nested overflow
// containers even after window.scrollTo. Pin both axes before pixel capture.
export const resetVisualScroll = () => {
  window.scrollTo(0, 0);
  document.querySelectorAll('*').forEach((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
};
