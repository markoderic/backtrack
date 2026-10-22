// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { openChannel } from "./realtime";

// The real supabase-js, realtime-js and phoenix, over a fake WebSocket that opens
// after a short wait and acks every join. The session is already stored (as after
// a reload), so the only question is what the join carries.
type Sent = { topic: string; event: string; payload: Record<string, unknown> };

function realClient() {
  const sent: Sent[] = [];
  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    binaryType = "arraybuffer";
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor(public url: string) {
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({});
      }, 20);
    }
    send(raw: string) {
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
      sent.push({ topic, event, payload });
      const reply = (response: unknown) =>
        setTimeout(
          () =>
            this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]) }),
          20,
        );
      if (event === "phx_join") {
        const filters = (payload.config?.postgres_changes ?? []) as object[];
        reply({ postgres_changes: filters.map((f, i) => ({ id: i + 1, ...f })) });
      } else {
        reply({});
      }
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const anonKey = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "anon" })}.sig`;
  const userJwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", role: "authenticated", exp })}.sig`;
  const store = new Map<string, string>([
    [
      "sb-test-auth-token",
      JSON.stringify({
        access_token: userJwt,
        refresh_token: "r",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: exp,
        user: { id: "u1", aud: "authenticated", role: "authenticated" },
      }),
    ],
  ]);
  const supabase = createClient("https://test.supabase.co", anonKey, {
    auth: {
      storageKey: "sb-test-auth-token",
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
    realtime: { transport: FakeSocket as never },
  });
  return { supabase, sent, userJwt };
}

const lectureChannel = (supabase: SupabaseClient, onStatus: (s: string) => void) => () =>
  supabase
    .channel("lecture-x")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lectures", filter: "id=eq.x" }, () => {})
    .subscribe(onStatus);

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
};

let cleanup: (() => void) | undefined;
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
});

describe("openChannel with the real supabase-js", () => {
  it("joins the channel with the signed-in user's token, so row level security sees the user and not anon", async () => {
    const { supabase, sent, userJwt } = realClient();
    let status = "";
    // Called right after the client is made, as a page does on a reload.
    const close = openChannel(
      supabase,
      lectureChannel(supabase, (s) => (status = s)),
    );
    cleanup = () => {
      close();
      void supabase.realtime.disconnect();
    };
    await until(() => status === "SUBSCRIBED");
    expect(status).toBe("SUBSCRIBED");
    const join = sent.find((m) => m.topic === "realtime:lecture-x" && m.event === "phx_join");
    expect(join?.payload.access_token).toBe(userJwt);
  });
});

describe("openChannel", () => {
  function fakeClient() {
    let resolveAuth: () => void = () => {};
    const setAuth = vi.fn(() => new Promise<void>((r) => (resolveAuth = r)));
    const removeChannel = vi.fn();
    const supabase = { realtime: { setAuth }, removeChannel } as unknown as SupabaseClient;
    return { supabase, setAuth, removeChannel, resolveAuth: () => resolveAuth() };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("opens the channel only after Realtime has the token", async () => {
    const { supabase, setAuth, resolveAuth } = fakeClient();
    const channel = {} as RealtimeChannel;
    const open = vi.fn(() => channel);
    openChannel(supabase, open);
    expect(setAuth).toHaveBeenCalledWith();
    await flush();
    expect(open).not.toHaveBeenCalled();
    resolveAuth();
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("still opens the channel when getting the token fails", async () => {
    const { supabase, setAuth } = fakeClient();
    setAuth.mockRejectedValueOnce(new Error("no session"));
    const open = vi.fn(() => ({}) as RealtimeChannel);
    openChannel(supabase, open);
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("removes the channel it opened when closed", async () => {
    const { supabase, removeChannel, resolveAuth } = fakeClient();
    const channel = {} as RealtimeChannel;
    const close = openChannel(supabase, () => channel);
    resolveAuth();
    await flush();
    close();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("never opens a channel when closed before the token arrives", async () => {
    const { supabase, removeChannel, resolveAuth } = fakeClient();
    const open = vi.fn(() => ({}) as RealtimeChannel);
    const close = openChannel(supabase, open);
    close();
    resolveAuth();
    await flush();
    expect(open).not.toHaveBeenCalled();
    expect(removeChannel).not.toHaveBeenCalled();
  });
});
