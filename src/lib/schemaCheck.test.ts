import { describe, it, expect } from "vitest";
import { classifyWrite, isMissingSchema } from "./schemaCheck";

describe("isMissingSchema", () => {
  it("is true for a table, column or function that is not there (Postgres or PostgREST)", () => {
    for (const code of ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]) {
      expect(isMissingSchema({ code, message: "missing" }), code).toBe(true);
    }
  });

  it("is false for anything else", () => {
    for (const code of ["42501", "23514", "BT429", "PGRST301", "", undefined, null]) {
      expect(isMissingSchema({ code, message: "x" }), String(code)).toBe(false);
    }
    expect(isMissingSchema(null)).toBe(false);
    expect(isMissingSchema(undefined)).toBe(false);
  });
});

describe("classifyWrite", () => {
  it("ok, missing, rejected, offline and throttled", () => {
    expect(classifyWrite({ error: null, status: 204 })).toBe("ok");
    expect(classifyWrite({ error: { code: "PGRST205", message: "no table" }, status: 404 })).toBe("missing");
    expect(classifyWrite({ error: { code: "PGRST202", message: "no function" }, status: 404 })).toBe("missing");
    expect(classifyWrite({ error: { code: "42501", message: "rls" }, status: 403 })).toBe("rejected");
    expect(classifyWrite({ error: { code: "23514", message: "check" }, status: 400 })).toBe("rejected");
    expect(classifyWrite({ error: { code: "", message: "Failed to fetch" }, status: 0 })).toBe("offline");
    expect(classifyWrite({ error: { code: "PGRST301", message: "JWT expired" }, status: 401 })).toBe("throttled");
  });

  it("a tap limit code is a refusal here (these writes never raise it as a tap)", () => {
    expect(classifyWrite({ error: { code: "BT429", message: "Too many taps." }, status: 400 })).toBe("rejected");
  });
});
