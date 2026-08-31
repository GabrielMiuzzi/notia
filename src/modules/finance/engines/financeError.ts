export interface FinanceCommandError {
  code: "validation" | "notFound" | "conflict" | "storage" | string;
  message: string;
}

export function financeErrorMessage(reason: unknown, fallback = "No se pudo completar la operación financiera."): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason && typeof reason.message === "string") return reason.message;
  return typeof reason === "string" && reason.trim() ? reason : fallback;
}
