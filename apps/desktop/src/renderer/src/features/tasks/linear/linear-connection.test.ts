// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  connectLinear,
  createLinearFixtureIssue,
  disconnectLinear,
  filterLinearIssues,
  isLinearConnected,
  linearFixtureIssues,
  readLinearConnection,
  readLinearIssues,
} from "./linear-connection";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

describe("linear fixture provider (no network)", () => {
  test("disconnected until a non-blank key connects, then disconnects", () => {
    const store = memoryStorage();
    expect(isLinearConnected(store)).toBe(false);
    expect(connectLinear("   ", store)).toBeNull();
    expect(isLinearConnected(store)).toBe(false);
    const connection = connectLinear("lin_api_test", store);
    expect(connection?.apiKey).toBe("lin_api_test");
    expect(isLinearConnected(store)).toBe(true);
    expect(readLinearConnection(store)?.apiKey).toBe("lin_api_test");
    disconnectLinear(store);
    expect(isLinearConnected(store)).toBe(false);
  });

  test("connect seeds the deterministic fixture collection once", () => {
    const store = memoryStorage();
    connectLinear("key", store);
    expect(readLinearIssues(store).map((issue) => issue.identifier)).toEqual(
      linearFixtureIssues().map((issue) => issue.identifier),
    );
    // A second connect leaves an edited collection alone.
    createLinearFixtureIssue({ identifier: "ENG-999", title: "Local only" }, store);
    connectLinear("other-key", store);
    expect(
      readLinearIssues(store).some((issue) => issue.identifier === "ENG-999"),
    ).toBe(true);
  });

  test("fixture rows are linear.app URLs and filter by key, title or label", () => {
    const issues = linearFixtureIssues();
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.provider).toBe("linear");
      expect(issue.url).toMatch(/^https:\/\/linear\.app\//);
    }
    expect(filterLinearIssues(issues, "eng-123")).toHaveLength(1);
    expect(filterLinearIssues(issues, "empty state")).toHaveLength(1);
    expect(filterLinearIssues(issues, "BACKEND")).toHaveLength(1);
    expect(filterLinearIssues(issues, "no-such-thing")).toHaveLength(0);
    expect(filterLinearIssues(issues, "")).toHaveLength(issues.length);
  });

  test("creating a fixture issue uppercases, dedupes and validates", () => {
    const store = memoryStorage();
    connectLinear("key", store);
    const created = createLinearFixtureIssue(
      { identifier: "eng-555", title: " Fresh work " },
      store,
    );
    expect(created?.identifier).toBe("ENG-555");
    expect(created?.title).toBe("Fresh work");
    expect(
      createLinearFixtureIssue({ identifier: "ENG-555", title: "Other" }, store)
        ?.title,
    ).toBe("Fresh work");
    expect(
      createLinearFixtureIssue({ identifier: "not-a-key", title: "X" }, store),
    ).toBeNull();
    expect(
      createLinearFixtureIssue({ identifier: "ENG-556", title: "  " }, store),
    ).toBeNull();
  });
});
