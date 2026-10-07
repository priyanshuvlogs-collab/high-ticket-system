import { describe, expect, it } from "vitest";
import { withLock } from "../src/lock.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withLock", () => {
  it("runs same-key work strictly in order, different keys concurrently", async () => {
    const log: string[] = [];
    const task = (key: string, name: string, ms: number) =>
      withLock(key, async () => {
        log.push(`${name}:start`);
        await sleep(ms);
        log.push(`${name}:end`);
        return name;
      });
    const results = await Promise.all([task("a", "a1", 30), task("a", "a2", 5), task("b", "b1", 5)]);
    expect(results).toEqual(["a1", "a2", "b1"]);
    expect(log.indexOf("a1:end")).toBeLessThan(log.indexOf("a2:start"));
    expect(log.indexOf("b1:end")).toBeLessThan(log.indexOf("a1:end"));
  });

  it("releases the lock when the task throws", async () => {
    await expect(withLock("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withLock("k", async () => "ok")).resolves.toBe("ok");
  });
});
