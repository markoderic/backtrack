import { describe, it, expect } from "vitest";
import { followReducer, initialFollowState, type FollowEvent, type FollowState } from "./followState";

const run = (state: FollowState, ...events: FollowEvent[]) => events.reduce(followReducer, state);

describe("followReducer", () => {
  it("starts following the live slide", () => {
    expect(initialFollowState(3)).toEqual({ live: 3, viewing: 3, following: true, conn: "live", ended: false });
  });

  it("tracks the live slide while following", () => {
    const s = run(initialFollowState(3), { type: "liveChanged", n: 4 });
    expect(s).toMatchObject({ live: 4, viewing: 4, following: true });
  });

  it("back stops following and goes one slide back", () => {
    const s = run(initialFollowState(5), { type: "back" });
    expect(s).toMatchObject({ live: 5, viewing: 4, following: false });
  });

  it("does not move the view when the live slide changes after back", () => {
    const s = run(initialFollowState(5), { type: "back" }, { type: "liveChanged", n: 6 });
    expect(s).toMatchObject({ live: 6, viewing: 4, following: false });
  });

  it("back on slide 1 does nothing", () => {
    const start = initialFollowState(1);
    expect(run(start, { type: "back" })).toEqual(start);
  });

  it("forward moves one slide and follows again once it reaches live", () => {
    let s = run(initialFollowState(6), { type: "back" }, { type: "back" });
    expect(s).toMatchObject({ viewing: 4, following: false });
    s = run(s, { type: "forward" });
    expect(s).toMatchObject({ viewing: 5, following: false });
    s = run(s, { type: "forward" });
    expect(s).toMatchObject({ viewing: 6, following: true });
  });

  it("goTo moves the view to that slide and follows only when it is live", () => {
    let s = run(initialFollowState(8), { type: "goTo", n: 3 });
    expect(s).toMatchObject({ live: 8, viewing: 3, following: false });
    s = run(s, { type: "goTo", n: 8 });
    expect(s).toMatchObject({ live: 8, viewing: 8, following: true });
  });

  it("goTo never goes past live or before slide 1", () => {
    expect(run(initialFollowState(8), { type: "goTo", n: 9 })).toMatchObject({ viewing: 8, following: true });
    expect(run(initialFollowState(8), { type: "goTo", n: 0 })).toMatchObject({ viewing: 1, following: false });
    expect(run(initialFollowState(8), { type: "goTo", n: 2.5 })).toMatchObject({ viewing: 2, following: false });
  });

  it("forward at live does nothing", () => {
    const start = initialFollowState(6);
    expect(run(start, { type: "forward" })).toEqual(start);
  });

  it("jumpToLive goes to the live slide and follows again", () => {
    const s = run(initialFollowState(5), { type: "back" }, { type: "back" }, { type: "liveChanged", n: 6 }, { type: "jumpToLive" });
    expect(s).toMatchObject({ live: 6, viewing: 6, following: true });
  });

  it("follows again when the live slide comes back to where the student is", () => {
    const s = run(initialFollowState(5), { type: "back" }, { type: "liveChanged", n: 4 });
    expect(s).toMatchObject({ live: 4, viewing: 4, following: true });
  });

  it("never shows a slide past the live one when the teacher goes back", () => {
    const s = run(initialFollowState(8), { type: "back" }, { type: "liveChanged", n: 3 });
    expect(s).toMatchObject({ live: 3, viewing: 3, following: true });
  });

  it("disconnected shows reconnecting and keeps the view", () => {
    const s = run(initialFollowState(5), { type: "back" }, { type: "disconnected" });
    expect(s).toMatchObject({ conn: "reconnecting", viewing: 4, following: false });
  });

  it("reconnected jumps to the live slide and goes back to live", () => {
    const s = run(initialFollowState(5), { type: "back" }, { type: "disconnected" }, { type: "reconnected", n: 9 });
    expect(s).toEqual({ live: 9, viewing: 9, following: true, conn: "live", ended: false });
  });

  it("ended marks the lecture over and keeps the rest", () => {
    const s = run(initialFollowState(5), { type: "ended" });
    expect(s).toMatchObject({ ended: true, live: 5, viewing: 5 });
  });

  it("does not mutate the state it was given", () => {
    const start = initialFollowState(5);
    const copy = { ...start };
    run(start, { type: "back" }, { type: "liveChanged", n: 7 }, { type: "disconnected" });
    expect(start).toEqual(copy);
  });

  it("readOk: the connection is live again and the live slide moves, but a student who went back stays", () => {
    const behind = run(initialFollowState(5), { type: "back" }, { type: "disconnected" }, { type: "readOk", n: 6 });
    expect(behind).toEqual({ live: 6, viewing: 4, following: false, conn: "live", ended: false });
    const following = run(initialFollowState(5), { type: "disconnected" }, { type: "readOk", n: 6 });
    expect(following).toEqual({ live: 6, viewing: 6, following: true, conn: "live", ended: false });
  });
});
