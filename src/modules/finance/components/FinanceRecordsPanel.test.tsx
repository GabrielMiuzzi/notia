import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinanceRecordsPanel } from "./FinanceRecordsPanel";

describe("FinanceRecordsPanel accessibility", () => {
  it("exposes a labelled region and visible touch actions", () => {
    const html = renderToStaticMarkup(<FinanceRecordsPanel library={{ id: "library", name: "Personal", path: "C:/personal" }} accounts={[]} onChanged={async () => undefined} />);
    expect(html).toContain('aria-labelledby="finance-records-title"');
    expect(html).toContain("Cargar ticket");
    expect(html).toContain("Cargar sueldo");
    expect(html).toContain("Compra en cuotas");
    expect(html).toContain("Valuar activo/deuda");
  });
});
