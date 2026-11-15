import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueue, flushQueue, listOperations, outcomeFromResponse, removeOperation, type SendOutcome } from "./queue";

const op = (id: string) => ({ id, kind: "voice_draft" as const, businessId: "biz-1", label: `Draft ${id}`, payload: { transcript: "two milk left" } });

describe("offline queue", () => {
  beforeEach(async () => {
    for (const o of await listOperations()) await removeOperation(o.id);
  });

  it("stores each operation once even if submitted repeatedly", async () => {
    expect(await enqueue(op("a"))).toBe(true);
    expect(await enqueue(op("a"))).toBe(false);
    expect(await listOperations()).toHaveLength(1);
  });

  it("flushes in order and removes sent operations", async () => {
    await enqueue(op("1"));
    await enqueue(op("2"));
    const sent: string[] = [];
    const summary = await flushQueue(async (o) => {
      sent.push(o.id);
      return { result: "done" };
    });
    expect(sent).toEqual(["1", "2"]);
    expect(summary).toEqual({ sent: 2, failed: 0, remaining: 0 });
  });

  it("keeps operations when offline and stops to preserve order", async () => {
    await enqueue(op("x"));
    await enqueue(op("y"));
    const calls: string[] = [];
    const summary = await flushQueue(async (o) => {
      calls.push(o.id);
      throw new TypeError("Failed to fetch");
    });
    expect(calls).toEqual(["x"]);
    expect(summary.remaining).toBe(2);
    const [first] = await listOperations();
    expect(first).toMatchObject({ id: "x", attempts: 1, status: "pending", lastError: "Failed to fetch" });
  });

  it("marks definitive rejections as failed and continues", async () => {
    await enqueue(op("bad"));
    await enqueue(op("good"));
    const summary = await flushQueue(async (o): Promise<SendOutcome> => (o.id === "bad" ? { result: "rejected", error: "forbidden" } : { result: "done" }));
    expect(summary).toEqual({ sent: 1, failed: 1, remaining: 0 });
    expect((await listOperations())[0]).toMatchObject({ id: "bad", status: "failed" });
  });

  it("shares a single flush between concurrent callers (no double submit)", async () => {
    await enqueue(op("once"));
    let count = 0;
    const send = async (): Promise<SendOutcome> => {
      count++;
      await new Promise((r) => setTimeout(r, 10));
      return { result: "done" };
    };
    await Promise.all([flushQueue(send), flushQueue(send), flushQueue(send)]);
    expect(count).toBe(1);
  });

  it("maps HTTP status codes to retry or rejection", () => {
    expect(outcomeFromResponse(new Response(null, { status: 200 }))).toEqual({ result: "done" });
    expect(outcomeFromResponse(new Response(null, { status: 503 }), "busy").result).toBe("retry");
    expect(outcomeFromResponse(new Response(null, { status: 429 }), "slow").result).toBe("retry");
    expect(outcomeFromResponse(new Response(null, { status: 403 }), "no").result).toBe("rejected");
  });
});
