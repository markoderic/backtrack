// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  rpc: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: h.rpc,
    storage: { from: h.from },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { deleteLecture } from "./lecture-actions";
import { LIVE_LECTURE_ERROR, DELETE_FAILED_ERROR } from "./delete-lecture-copy";

const LECTURE = "6b2895f2-5ffc-47ed-9065-8168a678f1ce";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  h.user = { id: "u1" };
  h.rpc.mockReset().mockResolvedValue({
    data: [{ course_id: COURSE, image_paths: [`${LECTURE}/1.webp`, `${LECTURE}/2.jpg`] }],
    error: null,
  });
  h.remove.mockReset().mockResolvedValue({ data: [], error: null });
  h.from.mockReset().mockReturnValue({ remove: h.remove });
  h.revalidatePath.mockReset();
});

describe("deleteLecture", () => {
  it("deletes the rows, removes the images from the slides bucket and goes back to the course", async () => {
    await expect(deleteLecture(LECTURE)).rejects.toThrow(`REDIRECT:/teach/c/${COURSE}?deleted=1`);
    expect(h.rpc).toHaveBeenCalledWith("delete_lecture", { p_lecture_id: LECTURE });
    expect(h.from).toHaveBeenCalledWith("slides");
    expect(h.remove).toHaveBeenCalledWith([`${LECTURE}/1.webp`, `${LECTURE}/2.jpg`]);
    expect(h.revalidatePath).toHaveBeenCalledWith(`/teach/c/${COURSE}`);
  });

  it("removes the images only after the rows are gone", async () => {
    const order: string[] = [];
    h.rpc.mockImplementation(async () => {
      order.push("rpc");
      return { data: [{ course_id: COURSE, image_paths: [`${LECTURE}/1.webp`] }], error: null };
    });
    h.remove.mockImplementation(async () => {
      order.push("remove");
      return { data: [], error: null };
    });
    await expect(deleteLecture(LECTURE)).rejects.toThrow(/REDIRECT/);
    expect(order).toEqual(["rpc", "remove"]);
  });

  it("never removes a path outside the lecture's own folder", async () => {
    h.rpc.mockResolvedValue({
      data: [{ course_id: COURSE, image_paths: [`${LECTURE}/1.webp`, "demo/placeholder.webp"] }],
      error: null,
    });
    await expect(deleteLecture(LECTURE)).rejects.toThrow(/REDIRECT/);
    expect(h.remove).toHaveBeenCalledWith([`${LECTURE}/1.webp`]);
  });

  it("sends a long deck in batches of 100", async () => {
    const paths = Array.from({ length: 205 }, (_, i) => `${LECTURE}/${i + 1}.webp`);
    h.rpc.mockResolvedValue({ data: [{ course_id: COURSE, image_paths: paths }], error: null });
    await expect(deleteLecture(LECTURE)).rejects.toThrow(/REDIRECT/);
    expect(h.remove.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 5]);
  });

  it("still finishes the delete when the images can not be removed (left for the orphan cleanup)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.remove.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(deleteLecture(LECTURE)).rejects.toThrow(`REDIRECT:/teach/c/${COURSE}?deleted=1`);
    h.remove.mockRejectedValue(new TypeError("fetch failed"));
    await expect(deleteLecture(LECTURE)).rejects.toThrow(`REDIRECT:/teach/c/${COURSE}?deleted=1`);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("says a live lecture must end first and removes nothing", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "live_lecture" } });
    expect(await deleteLecture(LECTURE)).toEqual({ error: LIVE_LECTURE_ERROR });
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("gives a plain error when the database refuses (not the owner) and removes nothing", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Not allowed." } });
    expect(await deleteLecture(LECTURE)).toEqual({ error: DELETE_FAILED_ERROR });
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("refuses a malformed id without calling the database", async () => {
    expect(await deleteLecture("not-a-uuid")).toEqual({ error: DELETE_FAILED_ERROR });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("sends a signed out caller to /teach", async () => {
    h.user = null;
    await expect(deleteLecture(LECTURE)).rejects.toThrow("REDIRECT:/teach");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

import { cleanupOrphanUploads } from "./lecture-actions";

describe("cleanupOrphanUploads", () => {
  it("removes the teacher's own leftovers that my_orphan_slide_images lists", async () => {
    h.rpc.mockResolvedValue({ data: ["d1/1.webp", "d1/2.webp"], error: null });
    expect(await cleanupOrphanUploads()).toBe(2);
    expect(h.rpc).toHaveBeenCalledWith("my_orphan_slide_images");
    expect(h.from).toHaveBeenCalledWith("slides");
    expect(h.remove).toHaveBeenCalledWith(["d1/1.webp", "d1/2.webp"]);
  });

  it("does nothing with no leftovers, signed out, or when the list fails", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await cleanupOrphanUploads()).toBe(0);
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await cleanupOrphanUploads()).toBe(0);
    h.user = null;
    expect(await cleanupOrphanUploads()).toBe(0);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("never throws: a failed remove is logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: ["d1/1.webp"], error: null });
    h.remove.mockResolvedValue({ data: null, error: { message: "denied" } });
    expect(await cleanupOrphanUploads()).toBe(0);
    h.remove.mockRejectedValue(new TypeError("fetch failed"));
    expect(await cleanupOrphanUploads()).toBe(0);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
