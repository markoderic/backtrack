import { describe, it, expect } from "vitest";
import { siteAddress } from "./siteAddress";

describe("siteAddress", () => {
  it("removes https and a trailing slash", () => {
    expect(siteAddress("https://backtrack-ebon-sigma.vercel.app/")).toBe("backtrack-ebon-sigma.vercel.app");
  });
  it("removes http", () => {
    expect(siteAddress("http://localhost:3000")).toBe("localhost:3000");
  });
  it("leaves a bare address alone", () => {
    expect(siteAddress("backtrack-ebon-sigma.vercel.app")).toBe("backtrack-ebon-sigma.vercel.app");
  });
  it("throws when the address is not set", () => {
    expect(() => siteAddress(undefined)).toThrow("NEXT_PUBLIC_SITE_URL");
  });
});
