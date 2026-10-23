/**
 * Data opened from the projector in fullscreen leaves fullscreen first (Marko, hand test 2: "If
 * I click on data, nothing will show"), so the data view opens in a normal window. This
 * remembers it for the lecture in sessionStorage, and Back to slides (a click, so the browser
 * allows it) puts the projector back in fullscreen.
 */
export const fullscreenReturnKey = (lectureId: string) => `backtrack:fullscreen:${lectureId}`;

/** Leaves fullscreen when the page is in it, and remembers to come back to it. */
export function leaveFullscreenFor(lectureId: string): void {
  if (typeof document === "undefined" || !document.fullscreenElement) return;
  try {
    window.sessionStorage.setItem(fullscreenReturnKey(lectureId), "1");
  } catch {
    // Storage blocked: Back to slides just stays out of fullscreen.
  }
  try {
    void Promise.resolve(document.exitFullscreen?.()).catch(() => {});
  } catch {
    // Nothing to leave.
  }
}

/** Back to slides: fullscreen again if Data left it. Call from the click itself. */
export function returnToFullscreen(lectureId: string): void {
  let wanted = false;
  try {
    wanted = window.sessionStorage.getItem(fullscreenReturnKey(lectureId)) !== null;
    window.sessionStorage.removeItem(fullscreenReturnKey(lectureId));
  } catch {
    return;
  }
  if (!wanted || typeof document === "undefined" || document.fullscreenElement) return;
  try {
    void Promise.resolve(document.documentElement.requestFullscreen?.()).catch(() => {});
  } catch {
    // Refused: the projector has its own Fullscreen button.
  }
}
