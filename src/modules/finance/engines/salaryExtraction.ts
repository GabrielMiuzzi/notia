import type { FinanceCurrency, FinanceSalaryConcept } from "../types/financeTypes";

export interface SalaryExtractionDraft {
  period?: string;
  paymentDate?: string;
  employer?: string;
  grossAmount?: string;
  deductionsTotal?: string;
  netAmount?: string;
  currency?: FinanceCurrency;
  concepts?: FinanceSalaryConcept[];
}

function normalizedKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function objectCandidates(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objectCandidates);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [object, ...Object.values(object).flatMap(objectCandidates)];
}

function embeddedJson(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [value];
  return matches.flatMap((candidate) => {
    const cleaned = candidate.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    try { return [JSON.parse(cleaned) as unknown]; } catch { return []; }
  });
}

function findValue(candidates: Record<string, unknown>[], aliases: string[]): unknown {
  const keys = new Set(aliases.map(normalizedKey));
  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate)) if (keys.has(normalizedKey(key))) return value;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function money(value: unknown): string | undefined {
  const candidate = text(value)?.replace(/[^\d,.-]/g, "").replace(",", ".");
  return candidate && /^-?\d+(?:\.\d{1,2})?$/.test(candidate) ? candidate : undefined;
}

export function parseSalaryExtraction(rawResult: unknown): SalaryExtractionDraft {
  const roots = [rawResult, ...objectCandidates(rawResult).flatMap((object) => Object.values(object).flatMap(embeddedJson))];
  const candidates = roots.flatMap(objectCandidates);
  const currencyText = text(findValue(candidates, ["currency", "moneda"]))?.toUpperCase();
  const conceptsValue = findValue(candidates, ["concepts", "conceptos", "items"]);
  const concepts = Array.isArray(conceptsValue) ? conceptsValue.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const name = text(findValue([record], ["name", "nombre", "concept", "concepto"]));
    const amount = money(findValue([record], ["amount", "importe", "monto"]));
    const kind = normalizedKey(text(findValue([record], ["type", "tipo"])) ?? "");
    if (!name || !amount) return [];
    return [{ id: `extracted-${index}`, name, conceptType: kind.includes("deduc") || kind.includes("descu") ? "deduction" as const : "earning" as const, amount }];
  }) : undefined;
  return {
    period: text(findValue(candidates, ["period", "periodo"])),
    paymentDate: text(findValue(candidates, ["paymentDate", "fechaCobro", "fechaPago"])),
    employer: text(findValue(candidates, ["employer", "empleador", "company", "empresa"])),
    grossAmount: money(findValue(candidates, ["grossAmount", "gross", "bruto", "totalBruto"])),
    deductionsTotal: money(findValue(candidates, ["deductionsTotal", "deductions", "descuentos", "totalDescuentos"])),
    netAmount: money(findValue(candidates, ["netAmount", "net", "neto", "totalNeto"])),
    currency: currencyText === "ARS" || currencyText === "USD" ? currencyText : undefined,
    concepts,
  };
}
