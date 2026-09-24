import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { ConfirmationEngineProvider } from "../../../context/confirmation/ConfirmationEngine";
import { FinanceRecordsPanel } from "./FinanceRecordsPanel";

describe("FinanceRecordsPanel accessibility", () => {
  it("exposes a labelled region and visible touch actions", () => {
    const html = renderToStaticMarkup(
      createElement(
        ConfirmationEngineProvider,
        null,
        createElement(FinanceRecordsPanel, {
          library: { id: "library", name: "Personal", path: "C:/personal" },
          accounts: [],
          debtRatioSeries: { periods: [], series: [] },
          historyFrom: "2025-10",
          historyTo: "2026-09",
          onChanged: async () => undefined,
        }),
      ),
    );
    expect(html).toContain('aria-labelledby="finance-records-title"');
    expect(html).toContain("Cargar ticket");
    expect(html).toContain("Cargar sueldo");
    expect(html).toContain("Compra en cuotas");
    expect(html).toContain("Valuar activo/deuda");
  });
});
