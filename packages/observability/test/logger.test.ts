import { describe, expect, it } from "vitest";
import { createLogger, newCorrelationId } from "../src/index";

describe("createLogger", () => {
  it("emits one JSON line with level, msg, and bound fields", () => {
    const lines: string[] = [];
    const log = createLogger({ component: "test" }, (l) => lines.push(l));
    log.info("hello", { count: 2 });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.component).toBe("test");
    expect(parsed.count).toBe(2);
    expect(typeof parsed.ts).toBe("string");
  });

  it("child loggers inherit and extend context", () => {
    const lines: string[] = [];
    const log = createLogger({ component: "worker" }, (l) => lines.push(l));
    const child = log.child({ correlationId: "abc" });
    child.error("boom", { attempt: 3 });

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.component).toBe("worker");
    expect(parsed.correlationId).toBe("abc");
    expect(parsed.attempt).toBe(3);
    expect(parsed.level).toBe("error");
  });

  it("call-site fields override bound fields, msg/level stay authoritative", () => {
    const lines: string[] = [];
    const log = createLogger({ scope: "a" }, (l) => lines.push(l));
    log.warn("w", { scope: "b" });
    expect(JSON.parse(lines[0]!).scope).toBe("b");
  });
});

describe("newCorrelationId", () => {
  it("returns unique uuids", () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
    expect(newCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
