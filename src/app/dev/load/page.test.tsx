import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("./load-test", () => ({ LoadTest: () => <div data-testid="load-test" /> }));

import LoadPage from "./page";

afterEach(() => vi.unstubAllEnvs());

describe("/dev/load", () => {
  it("is a 404 unless the flag is exactly 1", () => {
    for (const value of [undefined, "", "0", "true", "yes"]) {
      if (value === undefined) vi.stubEnv("NEXT_PUBLIC_ENABLE_LOAD_PAGE", undefined as unknown as string);
      else vi.stubEnv("NEXT_PUBLIC_ENABLE_LOAD_PAGE", value);
      expect(() => LoadPage()).toThrow("NOT_FOUND");
    }
  });

  it("renders the load test when the flag is 1", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LOAD_PAGE", "1");
    render(LoadPage());
    expect(screen.getByTestId("load-test")).toBeInTheDocument();
  });
});
