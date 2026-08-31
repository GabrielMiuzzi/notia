import { describe, expect, it } from "vitest";
import { validateTicketArithmetic } from "./ticketValidation";
import type { FinancePurchaseRecord } from "../types/financeTypes";

const ticket: FinancePurchaseRecord = {
  id: "purchase-1", accountId: "account-1", merchantName: "Comercio", observedAt: "2026-08-29",
  currency: "ARS", subtotalAmount: "0.30", discountAmount: "0.05", taxAmount: "0.01", totalAmount: "0.26",
  status: "confirmed", items: [{ id: "line-1", originalDescription: "Producto", quantity: "1", unitPrice: "0.30", discountAmount: "0", lineTotal: "0.30" }],
};

describe("validateTicketArithmetic", () => {
  it("calcula centavos sin errores de coma flotante", () => expect(validateTicketArithmetic(ticket)).toEqual({ valid: true, calculatedTotal: "0.26", discrepancy: "0.00" }));
  it("expone discrepancias antes de confirmar", () => expect(validateTicketArithmetic({ ...ticket, totalAmount: "0.27" })?.discrepancy).toBe("0.01"));
  it("acepta impuestos informativos ya incluidos en las lineas", () => expect(validateTicketArithmetic({
    ...ticket,
    subtotalAmount: "48000",
    discountAmount: "0",
    taxAmount: "8330.58",
    totalAmount: "48000",
    items: [{ ...ticket.items[0]!, unitPrice: "48000", lineTotal: "48000" }],
  })).toEqual({ valid: true, calculatedTotal: "48000.00", discrepancy: "0.00" }));
});
