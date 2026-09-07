import { describe, expect, test } from "vitest";
import {
  applyRemotePaneAction,
  initialRemotePaneState,
  type RemotePaneState,
} from "./remote-pane-state";
import type { HostDescriptor } from "./host-descriptor";

const host: HostDescriptor = {
  hostId: "ssh:bastro",
  kind: "ssh",
  label: "Bastrop build box",
};

function liveState(): RemotePaneState {
  let state = applyRemotePaneStateConnect();
  return applyRemotePaneAction(state, {
    type: "live-confirmed",
    incarnation: "inc-2",
  });
}

function applyRemotePaneStateConnect(): RemotePaneState {
  return applyRemotePaneAction(initialRemotePaneState(), {
    type: "connect-started",
    host,
  });
}

describe("transport loss", () => {
  test("a live pane that loses contact becomes unverifiable, never exited", () => {
    const state = applyRemotePaneAction(liveState(), {
      type: "transport-lost",
      message: "ssh channel closed",
    });
    expect(state.phase).toBe("unverifiable");
    expect(state.phase).not.toBe("exited");
    expect(state.message).toBe("ssh channel closed");
    // The incarnation is kept: the remote session may still be running.
    expect(state.incarnation).toBe("inc-2");
  });

  test("contact lost during connect is unverifiable too, with the same fixed vocabulary", () => {
    let state = applyRemotePaneStateConnect();
    state = applyRemotePaneAction(state, {
      type: "transport-lost",
      message: "handshake timeout",
    });
    expect(state.phase).toBe("unverifiable");
    expect(state.canRetry).toBe(true);
  });
});

describe("exit evidence", () => {
  test("a host-confirmed exit for the current incarnation is the only path to exited", () => {
    const state = applyRemotePaneAction(liveState(), {
      type: "host-confirmed-exited",
      incarnation: "inc-2",
    });
    expect(state.phase).toBe("exited");
    expect(state.canRetry).toBe(false);
  });

  test("a stale-incarnation exit event never marks the pane exited", () => {
    const live = liveState();
    const state = applyRemotePaneAction(live, {
      type: "host-confirmed-exited",
      incarnation: "inc-1",
    });
    expect(state).toBe(live);
    expect(state.phase).toBe("live");
  });

  test("an exit event with no attached incarnation is ignored", () => {
    let state = applyRemotePaneStateConnect();
    state = applyRemotePaneAction(state, {
      type: "host-confirmed-exited",
      incarnation: "inc-1",
    });
    expect(state.phase).toBe("connecting");
  });

  test("a client-side lookup failure cannot reach exited", () => {
    let state = applyRemotePaneStateConnect();
    state = applyRemotePaneAction(state, {
      type: "live-confirmed",
      incarnation: "inc-2",
    });
    state = applyRemotePaneAction(state, {
      type: "transport-lost",
      message: "pty not in client session map",
    });
    expect(state.phase).toBe("unverifiable");
  });
});

describe("retry affordance", () => {
  test("the unverifiable state preserves the retry affordance and retry restarts connecting", () => {
    let state = applyRemotePaneAction(liveState(), {
      type: "transport-lost",
      message: "link down",
    });
    expect(state.canRetry).toBe(true);
    state = applyRemotePaneAction(state, { type: "retry-started" });
    expect(state.phase).toBe("connecting");
    expect(state.canRetry).toBe(false);
    expect(state.incarnation).toBe("inc-2");
  });

  test("a failed reconnect lands back in unverifiable with retry still offered", () => {
    let state = applyRemotePaneAction(liveState(), {
      type: "transport-lost",
      message: "link down",
    });
    state = applyRemotePaneAction(state, { type: "retry-started" });
    state = applyRemotePaneAction(state, {
      type: "transport-lost",
      message: "relay socket refused",
    });
    expect(state.phase).toBe("unverifiable");
    expect(state.canRetry).toBe(true);
  });

  test("retry is refused from phases that do not offer it", () => {
    const state = applyRemotePaneAction(liveState(), {
      type: "retry-started",
    });
    expect(state.phase).toBe("live");
  });
});

describe("connect failure and reset", () => {
  test("an observed connect failure is an error (distinct from unverifiable) with retry", () => {
    let state = applyRemotePaneStateConnect();
    state = applyRemotePaneAction(state, {
      type: "connect-failed",
      message: "no registered provider for ssh:bastro",
    });
    expect(state.phase).toBe("error");
    expect(state.canRetry).toBe(true);
  });

  test("reset returns to idle", () => {
    const state = applyRemotePaneAction(liveState(), { type: "reset" });
    expect(state).toEqual(initialRemotePaneState());
  });
});
