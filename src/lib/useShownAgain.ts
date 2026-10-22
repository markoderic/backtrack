"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `onShownAgain` when Next shows a page again that it kept alive while hidden.
 *
 * With cacheComponents, Next keeps recently visited pages mounted but hidden (React Activity)
 * and shows them again on Back, Forward or a link to the same page, with the state they had
 * and, on Back, the server data they had. Their effects are taken down while hidden and run
 * again when shown. This tells that apart from the first mount: the cleanup marks the page
 * hidden a moment later, which a development double run (cleanup, then setup at once) never
 * reaches. The callback runs in an effect, after the page is back on screen.
 */
export function useShownAgain(onShownAgain: () => void): void {
  const callback = useRef(onShownAgain);
  const hidden = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    callback.current = onShownAgain;
  });
  useEffect(() => {
    clearTimeout(timer.current);
    if (hidden.current) {
      hidden.current = false;
      callback.current();
    }
    return () => {
      timer.current = setTimeout(() => {
        hidden.current = true;
      }, 0);
    };
  }, []);
}
