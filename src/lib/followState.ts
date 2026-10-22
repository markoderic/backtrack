export type FollowState = {
  /** The slide the teacher is on. */
  live: number;
  /** The slide the student is looking at. Never past `live`. */
  viewing: number;
  /** True while the student's view tracks the live slide. */
  following: boolean;
  conn: "live" | "reconnecting";
  ended: boolean;
};

export type FollowEvent =
  | { type: "liveChanged"; n: number }
  | { type: "back" }
  | { type: "forward" }
  | { type: "jumpToLive" }
  | { type: "disconnected" }
  | { type: "reconnected"; n: number }
  | { type: "ended" };

export function initialFollowState(live: number): FollowState {
  return { live, viewing: live, following: true, conn: "live", ended: false };
}

export function followReducer(state: FollowState, ev: FollowEvent): FollowState {
  switch (ev.type) {
    case "liveChanged": {
      // A student who is behind stays put, unless the live slide is now at or
      // before them: they can never be ahead of the teacher.
      if (state.following || state.viewing >= ev.n) {
        return { ...state, live: ev.n, viewing: ev.n, following: true };
      }
      return { ...state, live: ev.n };
    }
    case "back":
      if (state.viewing <= 1) return state;
      return { ...state, viewing: state.viewing - 1, following: false };
    case "forward": {
      if (state.viewing >= state.live) return state;
      const viewing = state.viewing + 1;
      return { ...state, viewing, following: viewing >= state.live };
    }
    case "jumpToLive":
      return { ...state, viewing: state.live, following: true };
    case "disconnected":
      return { ...state, conn: "reconnecting" };
    case "reconnected":
      return { ...state, live: ev.n, viewing: ev.n, following: true, conn: "live" };
    case "ended":
      return { ...state, ended: true };
  }
}
