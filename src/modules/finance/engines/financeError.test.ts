import { describe, expect, it } from "vitest";
import { financeErrorMessage } from "./financeError";

describe("financeErrorMessage", () => {
  it("reads the structured Tauri finance error contract", () => {
    expect(financeErrorMessage({ code: "validation", message: "Importe inválido" })).toBe("Importe inválido");
    expect(financeErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});
