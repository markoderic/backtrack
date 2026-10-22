import { describe, it, expect } from "vitest";
import { isMiamiEmail } from "./email";

describe("isMiamiEmail", () => {
  it("accepts miamioh.edu addresses, ignoring case and surrounding spaces", () => {
    expect(isMiamiEmail("dericm@miamioh.edu")).toBe(true);
    expect(isMiamiEmail("DericM@MiamiOH.edu ")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isMiamiEmail("x@gmail.com")).toBe(false);
    expect(isMiamiEmail("x@miamioh.edu.evil.com")).toBe(false);
    expect(isMiamiEmail("x@sub.miamioh.edu")).toBe(false);
    expect(isMiamiEmail("x@evilmiamioh.edu")).toBe(false);
    expect(isMiamiEmail("@miamioh.edu")).toBe(false);
    expect(isMiamiEmail("")).toBe(false);
    expect(isMiamiEmail(null)).toBe(false);
    expect(isMiamiEmail(undefined)).toBe(false);
  });
});
