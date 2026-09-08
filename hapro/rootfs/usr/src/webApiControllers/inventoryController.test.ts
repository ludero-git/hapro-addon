import { describe, expect, test } from "bun:test";
import { humanizeDomain, parseConfigEntries } from "./inventoryController";

describe("inventory storage parser", () => {
  test("preserves raw configuration values and tolerates unknown fields", () => {
    const entries = parseConfigEntries(JSON.stringify({
      version: 1,
      data: { entries: [{ entry_id: "one", domain: "hue", data: { api_key: "secret" }, options: { interval: 30 }, future_field: true }] },
    }));
    expect(entries).toHaveLength(1);
    expect((entries[0].data as { api_key: string }).api_key).toBe("secret");
    expect(entries[0].future_field).toBe(true);
  });

  test("rejects malformed storage", () => {
    expect(() => parseConfigEntries('{"data":{}}')).toThrow("unsupported structure");
  });

  test("creates a readable fallback name", () => {
    expect(humanizeDomain("home_connect")).toBe("Home Connect");
  });
});
