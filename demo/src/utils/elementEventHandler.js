export function toggleClass(className) {
  return function () {
    this.parentElement.classList.toggle(className);
  };
}

export function elementEventHandler(events, className, ...rest) {
  const callback = rest.find((param) => typeof param === "function");
  const listener = rest.find((param) => typeof param === "string");

  return (elem) => {
    events.forEach((event) =>
      listener === "remove"
        ? elem.removeEventListener(
            event,
            callback || toggleClass(className),
            false
          )
        : elem.addEventListener(
            event,
            callback || toggleClass(className),
            false
          )
    );
  };
}