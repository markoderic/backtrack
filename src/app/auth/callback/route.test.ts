// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const supabase = {
  auth: {
    exchangeCodeForSession: vi.fn(),
    getUser: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
};
const upsert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => supabase,
}));

import { GET } from "./route";

type TestUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  identities?: { provider: string; identity_data?: Record<string, unknown> }[];
};

function signedInAs(user: TestUser, displayName: string | null = null) {
  supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  maybeSingle.mockResolvedValue({ data: { display_name: displayName }, error: null });
}

function call(url = "https://backtrack.test/auth/callback?code=abc") {
  return GET(new Request(url) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  supabase.auth.signOut.mockResolvedValue({ error: null });
  upsert.mockResolvedValue({ data: null, error: null });
  supabase.from.mockReturnValue({ upsert, select });
});

describe("GET /auth/callback", () => {
  it("sends a non Miami account to /teach/not-miami and signs it out", async () => {
    signedInAs({ id: "u1", email: "someone@gmail.com" });
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach/not-miami");
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a Miami email when Google says the hosted domain is something else", async () => {
    signedInAs({
      id: "u1",
      email: "x@miamioh.edu",
      user_metadata: { custom_claims: { hd: "evil.com" } },
    });
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach/not-miami");
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects when only the Google identity carries a wrong hosted domain", async () => {
    signedInAs({
      id: "u1",
      email: "x@miamioh.edu",
      identities: [{ provider: "google", identity_data: { custom_claims: { hd: "evil.com" } } }],
    });
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach/not-miami");
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("lets a Miami email through when there is no hd claim at all", async () => {
    signedInAs({ id: "u1", email: "dericm@miamioh.edu" });
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach/setup");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith("teachers");
    // Insert once, never rewrite a returning teacher's row (0014: only the name can change).
    expect(upsert).toHaveBeenCalledWith(
      { id: "u1", email: "dericm@miamioh.edu" },
      { onConflict: "id", ignoreDuplicates: true },
    );
    expect(select).toHaveBeenCalledWith("display_name");
    expect(eq).toHaveBeenCalledWith("id", "u1");
  });

  it("accepts a matching hd claim and sends a teacher with a name to /teach", async () => {
    signedInAs(
      {
        id: "u1",
        email: "dericm@miamioh.edu",
        user_metadata: { custom_claims: { hd: "miamioh.edu" } },
        identities: [{ provider: "google", identity_data: { custom_claims: { hd: "miamioh.edu" } } }],
      },
      "Marko",
    );
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("signs out and goes to /teach?error=signin when the teachers insert fails", async () => {
    signedInAs({ id: "u1", email: "dericm@miamioh.edu" });
    upsert.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach?error=signin");
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("signs out when the row can not be read back, or is not there", async () => {
    signedInAs({ id: "u1", email: "dericm@miamioh.edu" });
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await call()).headers.get("location")).toBe("https://backtrack.test/teach?error=signin");
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await call()).headers.get("location")).toBe("https://backtrack.test/teach?error=signin");
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(2);
  });

  it("goes back to /teach without a code, and does not sign anyone in", async () => {
    const res = await call("https://backtrack.test/auth/callback");
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach");
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("goes back to /teach when the code exchange fails", async () => {
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: new Error("bad code") });
    const res = await call();
    expect(res.headers.get("location")).toBe("https://backtrack.test/teach");
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });
});
