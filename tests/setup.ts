import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(async () => {
  cleanup();
  // The shared queues live for the page (module level); each test starts with fresh ones. Imported here,
  // not at the top, so it is the test file's own copy (with that file's mocks).
  const { forgetSharedQueues } = await import("@/lib/sharedQueues");
  forgetSharedQueues();
  // Slides measured for the marks' look (lib/slideTone) are kept per url for the page; each test starts fresh.
  const { forgetSamples } = await import("@/lib/slideTone");
  forgetSamples();
});
