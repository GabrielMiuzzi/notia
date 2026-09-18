import { describe, expect, it } from "vitest";
import { formatFinanceLoadedDate } from "./financeLoadedDate";

describe("formatFinanceLoadedDate", () => {
  it("formats native epoch seconds as a UTC calendar date", () => {
    expect(formatFinanceLoadedDate("1767225600")).toBe("01/01/2026");
  });

  it("formats SQLite timestamps as UTC even when the machine timezone differs", () => {
    expect(formatFinanceLoadedDate("2026-09-17 23:30:00")).toBe("17/09/2026");
    expect(formatFinanceLoadedDate("2026-09-18T01:30:00+02:00")).toBe("17/09/2026");
  });

  it("does not render a label for missing or invalid historical timestamps", () => {
    expect(formatFinanceLoadedDate(null)).toBeNull();
    expect(formatFinanceLoadedDate("not-a-timestamp")).toBeNull();
  });
});
