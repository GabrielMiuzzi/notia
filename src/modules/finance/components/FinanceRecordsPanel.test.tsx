import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { FinanceRecordsPanel } from "./FinanceRecordsPanel";

describe("FinanceRecordsPanel", () => {
  it("is a labelled, read-only region: loading happens through the assistant", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceRecordsPanel, {
        library: { id: "library", name: "Personal", path: "C:/personal" },
        accounts: [],
        debtRatioSeries: { periods: [], series: [] },
        historyFrom: "2025-10",
        historyTo: "2026-09",
      }),
    );
    expect(html).toContain('aria-labelledby="finance-records-title"');
    expect(html).toContain("Productos");
    expect(html).toContain("Cuotas pendientes");
    expect(html).not.toContain("Cargar ticket");
    expect(html).not.toContain("Relaciones y evidencia");
  });
});
