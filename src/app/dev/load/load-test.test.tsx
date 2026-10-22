import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

type Options = { auth: { storage: Record<string, unknown>; persistSession: boolean; autoRefreshToken: boolean; storageKey?: string } };
const created: { url: string; key: string; options: Options; signIn: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }[] = [];
const signInImpl = vi.fn();
const rpcImpl = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: Options) => {
    const index = created.length;
    const signIn = vi.fn(() => signInImpl(index));
    const rpc = vi.fn((name: string, args: unknown) => rpcImpl(name, args));
    created.push({ url, key, options, signIn, rpc });
    return { auth: { signInAnonymously: signIn }, rpc };
  },
}));

const realClient = vi.fn(() => {
  throw new Error("the page's real session must not be touched");
});
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => realClient() }));

import { LoadTest } from "./load-test";

const run = () => screen.getByRole("button", { name: "Run" });
const code = () => screen.getByLabelText("Code") as HTMLInputElement;

beforeEach(() => {
  created.length = 0;
  realClient.mockClear();
  signInImpl.mockReset();
  rpcImpl.mockReset();
  signInImpl.mockResolvedValue({ data: { session: {} }, error: null });
  rpcImpl.mockResolvedValue({ data: "lecture-id", error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

describe("LoadTest", () => {
  it("needs a 6 digit code to run", () => {
    render(<LoadTest />);
    expect(run()).toBeDisabled();
    fireEvent.change(code(), { target: { value: "48a2916" } });
    expect(code().value).toBe("482916");
    expect(run()).toBeEnabled();
  });

  it("makes 40 separate clients with their own in-memory storage and keys", async () => {
    render(<LoadTest />);
    fireEvent.change(code(), { target: { value: "482916" } });
    fireEvent.click(run());
    await screen.findByText("40 of 40 joined");
    expect(created).toHaveLength(40);
    expect(new Set(created.map((c) => c.options.auth.storageKey)).size).toBe(40);
    expect(new Set(created.map((c) => c.options.auth.storage)).size).toBe(40);
    for (const c of created) {
      expect(c.url).toBe("https://x.supabase.co");
      expect(c.key).toBe("anon-key");
      expect(c.options.auth.persistSession).toBe(true);
      expect(c.options.auth.autoRefreshToken).toBe(false);
      expect(c.signIn).toHaveBeenCalledTimes(1);
      expect(c.rpc).toHaveBeenCalledWith("join_lecture", { p_code: "482916" });
    }
  });

  it("gives each client a working in-memory storage", async () => {
    render(<LoadTest />);
    fireEvent.change(code(), { target: { value: "482916" } });
    fireEvent.click(run());
    await screen.findByText("40 of 40 joined");
    const [a, b] = created.map((c) => c.options.auth.storage as { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void });
    a.setItem("k", "v");
    expect(a.getItem("k")).toBe("v");
    expect(b.getItem("k")).toBeNull();
    a.removeItem("k");
    expect(a.getItem("k")).toBeNull();
  });

  it("never touches the page's real session", async () => {
    render(<LoadTest />);
    fireEvent.change(code(), { target: { value: "482916" } });
    fireEvent.click(run());
    await screen.findByText("40 of 40 joined");
    expect(realClient).not.toHaveBeenCalled();
  });

  it("reports how many joined and the first error", async () => {
    signInImpl.mockImplementation(async (i: number) =>
      i % 10 === 0 ? { data: null, error: { message: `rate limit ${i}` } } : { data: { session: {} }, error: null },
    );
    rpcImpl.mockImplementation(async () => ({ data: "lecture-id", error: null }));
    render(<LoadTest />);
    fireEvent.change(code(), { target: { value: "482916" } });
    fireEvent.click(run());
    await screen.findByText(/^36 of 40 joined$/);
    expect(screen.getByRole("alert")).toHaveTextContent(/rate limit/);
  });

  it("counts a failed join and a thrown error as not joined", async () => {
    let n = 0;
    rpcImpl.mockImplementation(async () => {
      n++;
      if (n === 1) return { data: null, error: { message: "not_found" } };
      if (n === 2) throw new Error("network");
      return { data: "lecture-id", error: null };
    });
    render(<LoadTest />);
    fireEvent.change(code(), { target: { value: "482916" } });
    fireEvent.click(run());
    await screen.findByText("38 of 40 joined");
    expect(screen.getByRole("alert")).toHaveTextContent("not_found");
  });

  it("disables Run while it is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    rpcImpl.mockImplementation(async () => {
      await gate;
      return { data: "lecture-id", error: null };
    });
    render(<LoadTest />);
    fireEvent.change(code(), { target: { value: "482916" } });
    fireEvent.click(run());
    await waitFor(() => expect(screen.getByRole("button", { name: "Running..." })).toBeDisabled());
    release();
    await screen.findByText("40 of 40 joined");
    expect(run()).toBeEnabled();
  });
});
