import { describe, expect, it } from "vitest";
import { parseSalaryExtraction } from "./salaryExtraction";

describe("parseSalaryExtraction", () => {
  it("normalizes a structured salary extraction without inventing fields", () => {
    expect(parseSalaryExtraction({ result: { periodo: "2026-08", empleador: "Notia SA", bruto: "$ 1000.00", descuentos: "100.00", neto: "900.00", moneda: "ars", conceptos: [{ concepto: "Jubilación", tipo: "descuento", importe: "100.00" }] } })).toMatchObject({
      period: "2026-08", employer: "Notia SA", grossAmount: "1000.00", deductionsTotal: "100.00", netAmount: "900.00", currency: "ARS",
      concepts: [{ name: "Jubilación", conceptType: "deduction", amount: "100.00" }],
    });
  });

  it("reads JSON embedded in markdown", () => {
    expect(parseSalaryExtraction({ markdown: '```json\n{"period":"2026-07","netAmount":"42.50"}\n```' })).toMatchObject({ period: "2026-07", netAmount: "42.50" });
  });
});
