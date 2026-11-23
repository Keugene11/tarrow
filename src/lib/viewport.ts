/**
 * Keeps `--app-h` equal to the height actually visible above the on-screen keyboard, so full-height
 * shells (`.h-app`) put the composer right above it. 100dvh doesn't shrink for the keyboard in
 * mobile Safari or Android Chrome, and edge-to-edge Android WebViews may not resize at all.
 */
let nativeInset = 0;
let update: (() => void) | null = null;

export function installAppHeight() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  update = () => {
    const h = (vv?.height ?? window.innerHeight) - nativeInset;
    root.style.setProperty("--app-h", `${Math.round(h)}px`);
    root.dataset.keyboard = nativeInset > 0 || window.innerHeight - (vv?.height ?? window.innerHeight) > 120 ? "open" : "closed";
    // Safari pans the page to reveal a focused input; the shell already fits above the keyboard, so undo the pan.
    if (window.scrollY && document.querySelector("[data-app-shell]")) window.scrollTo(0, 0);
  };
  update();
  const onChange = () => update?.();
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
    update = null;
  };
}

/** Native shells: call with the viewport height before the keyboard opened and the keyboard's height. */
export function nativeKeyboardShown(heightBefore: number, keyboardHeight: number) {
  const now = window.visualViewport?.height ?? window.innerHeight;
  // If the WebView already shrank for the keyboard, there's nothing to make up.
  nativeInset = heightBefore - now < keyboardHeight / 2 ? keyboardHeight : 0;
  update?.();
}

export function nativeKeyboardHidden() {
  nativeInset = 0;
  update?.();
}
