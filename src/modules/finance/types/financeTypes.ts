import type { NotiaLibrary } from "../../../types/notia";

export type FinanceCurrency = "ARS" | "USD";

export interface FinanceDevTable {
  name: string;
}

export interface FinanceDevQueryResult {
  columns: string[];
  rows: Array<Array<string | null>>;
  totalRows: number;
  page: number;
  pageSize: number;
}
export type FinanceTransactionType =
  "income" | "expense" | "transfer" | "adjustment";
export type FinanceTransactionStatus =
  "pending" | "confirmed" | "corrected" | "discarded";

export interface FinanceAccount {
  id: string;
  name: string;
  accountType: string;
  currency: FinanceCurrency;
  active: boolean;
}

export interface FinanceCategory {
  id: string;
  name: string;
  kind: "income" | "expense";
  active: boolean;
  parentId?: string | null;
  description?: string | null;
}

export interface FinanceTransaction {
  id: string;
  transactionType: FinanceTransactionType;
  amount: string;
  currency: FinanceCurrency;
  effectiveDate: string;
  accountId: string;
  destinationAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  source: string;
  status: FinanceTransactionStatus;
  actorUserId?: number | null;
  /** Stable library_users identity. actorUserId is legacy Telegram audit data. */
  actorLibraryUserId?: string | null;
  sourceArtifactId?: string | null;
  serviceId?: string | null;
  merchantId?: string | null;
  operationFingerprint?: string | null;
  installmentId?: string | null;
  sourceReference?: string | null;
  rawSource?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinancePurchaseItem {
  id: string;
  originalDescription: string;
  normalizedDescription?: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineTotal: string;
  categoryId?: string | null;
}

export interface FinancePurchaseRecord {
  id: string;
  accountId: string;
  /** Categoría del gasto asociado al ticket. Las líneas pueden conservar su propia categoría. */
  categoryId?: string | null;
  serviceId?: string | null;
  merchantName: string;
  observedAt: string;
  currency: FinanceCurrency;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  status: Exclude<FinanceTransactionStatus, "discarded">;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  contentHash?: string | null;
  items: FinancePurchaseItem[];
}

export interface FinancePurchaseValidation {
  valid: boolean;
  calculatedTotal: string;
  discrepancy: string;
}

export interface FinanceSavedPurchase {
  purchase: FinancePurchaseRecord;
  validation: FinancePurchaseValidation;
}

export interface FinanceExtractionResult {
  artifactId: string;
  extractor: string;
  status: string;
  rawResult: unknown;
}

export interface FinancePurchaseSummary {
  id: string;
  accountId: string | null;
  transactionId: string | null;
  serviceId?: string | null;
  merchantName: string;
  observedAt: string;
  currency: FinanceCurrency;
  totalAmount: string;
  status: FinanceTransactionStatus;
  itemCount: number;
}

export interface FinancePriceObservation {
  id: string;
  productId: string;
  productName: string;
  merchantName?: string | null;
  observedAt: string;
  currency: FinanceCurrency;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  finalAmount: string;
  status: FinanceTransactionStatus;
}

export interface FinanceSalaryConcept {
  id: string;
  name: string;
  conceptType: "earning" | "deduction";
  amount: string;
}

export interface FinanceSalaryReceipt {
  id: string;
  period: string;
  paymentDate: string;
  employer: string;
  grossAmount: string;
  deductionsTotal: string;
  netAmount: string;
  currency: FinanceCurrency;
  accountId: string;
  status: Exclude<FinanceTransactionStatus, "discarded">;
  signedDocument?: boolean;
  /** Native SQLite timestamp; it is returned by reads and never supplied by callers. */
  readonly createdAt?: string | null;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  concepts: FinanceSalaryConcept[];
}

export type FinanceSalaryReceiptInput = Omit<FinanceSalaryReceipt, "createdAt">;

export interface FinanceSalaryEvolution {
  salary: FinanceSalaryReceipt;
  grossChange: string;
  netChange: string;
  deductionsChange: string;
  netChangePercent?: string | null;
}

export type FinanceCreditCardStatementItemType =
  | "purchase"
  | "fee"
  | "interest"
  | "tax"
  | "payment"
  | "credit";

export interface FinanceCreditCardStatementItem {
  id: string;
  purchaseDate: string;
  description: string;
  amount: string;
  currency: FinanceCurrency;
  itemType: FinanceCreditCardStatementItemType;
  installmentNumber?: number | null;
  installmentCount?: number | null;
  transactionId?: string | null;
}

export interface FinanceCreditCardStatement {
  id: string;
  accountId: string;
  issuer: string;
  cardLastFour?: string | null;
  period: string;
  closingDate: string;
  dueDate: string;
  currency: FinanceCurrency;
  previousBalance: string;
  paymentsAmount: string;
  creditsAmount: string;
  purchasesAmount: string;
  feesAmount: string;
  interestAmount: string;
  taxesAmount: string;
  totalDue: string;
  minimumPayment?: string | null;
  status: Exclude<FinanceTransactionStatus, "discarded">;
  /** Native SQLite timestamp; it is returned by reads and never supplied by callers. */
  readonly createdAt?: string | null;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  items: FinanceCreditCardStatementItem[];
}

export type FinanceCreditCardStatementInput = Omit<FinanceCreditCardStatement, "createdAt">;

export interface FinanceSavedCreditCardStatement {
  statement: FinanceCreditCardStatement;
  matchedExistingTransactions: number;
  createdTransactions: number;
  reconciliation: FinanceCardServiceReconciliation;
  occurrences: FinanceServiceOccurrence[];
}

export interface FinanceInstallmentPlan {
  id: string;
  accountId: string;
  merchantName: string;
  description: string;
  purchaseDate: string;
  currency: FinanceCurrency;
  totalAmount: string;
  installmentCount: number;
}

export interface FinanceInstallment {
  id: string;
  planId: string;
  installmentNumber: number;
  dueDate: string;
  amount: string;
  status: FinanceTransactionStatus;
}

export interface FinanceInvestment {
  id: string;
  accountId?: string | null;
  name: string;
  assetType: "asset" | "debt" | "cash" | "security";
  currency: FinanceCurrency;
  active: boolean;
  valuationDate: string;
  valuationAmount: string;
}

export interface FinanceNetWorth {
  asOf: string;
  byCurrency: Record<FinanceCurrency, string | undefined>;
}

export type FinanceNetWorthHistoryPoint = FinanceNetWorth;

export interface FinanceDebtRatioHistoryPoint {
  period: string;
  debtByCurrency: Record<string, string>;
  salaryByCurrency: Record<string, string>;
}

export interface FinanceDashboard {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  transactions: FinanceTransaction[];
  transactionsTruncated: boolean;
  incomeTotal: string;
  expenseTotal: string;
  netTotal: string;
  incomeByCurrency: Record<string, string>;
  expenseByCurrency: Record<string, string>;
  netByCurrency: Record<string, string>;
  debtByCurrency: Record<string, string>;
  salaryByCurrency: Record<string, string>;
  debtRatioHistory: FinanceDebtRatioHistoryPoint[];
  savings: FinanceSavingsReserve[];
  savingsMovements: FinanceSavingsMovement[];
  savingsMovementsTruncated: boolean;
  merchants: FinanceMerchant[];
}

export type FinanceServiceModality = "fixed" | "variable";
export type FinanceServiceOccurrenceStatus =
  | "pending" | "current" | "accepted" | "rejected" | "discarded" | "failed" | "outdated";
export type FinanceAuditStatus = "pending" | "running" | "completed" | "failed" | "outdated";
export type FinanceAuditProposalStatus =
  | "pending" | "accepted" | "rejected" | "cancelled" | "outdated" | "failed";

export interface FinanceService {
  id: string;
  name: string;
  categoryId: string;
  currency: FinanceCurrency;
  expectedAmount: string;
  dueDay?: number | null;
  defaultAccountId?: string | null;
  provider?: string | null;
  modality: FinanceServiceModality;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface FinanceServiceOccurrence {
  id: string;
  serviceId: string;
  period: string;
  expectedAmount: string;
  paidAmount?: string | null;
  effectiveDate?: string | null;
  status: FinanceServiceOccurrenceStatus;
  transactionId?: string | null;
  artifactId?: string | null;
  sourceReference?: string | null;
  rawSource?: string | null;
  actorLibraryUserId?: string | null;
  source: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface FinanceServiceOccurrenceVersion extends FinanceServiceOccurrence {
  occurrenceId: string;
  versionNumber: number;
  reason?: string | null;
}

export interface FinanceServiceInvoice {
  id: string;
  serviceId?: string | null;
  period: string;
  dueDate?: string | null;
  provider?: string | null;
  amount: string;
  currency: FinanceCurrency;
  transactionId?: string | null;
  artifactId?: string | null;
  validationStatus: "pending" | "valid" | "invalid" | "duplicate";
  sourceReference?: string | null;
  rawExtraction?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface FinanceAuditRun {
  id: string;
  period: string;
  triggerFingerprint: string;
  status: FinanceAuditStatus;
  actorLibraryUserId?: string | null;
  source: string;
  reason?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
}

export interface FinanceAuditProposal {
  id: string;
  auditRunId: string;
  proposalType: string;
  status: FinanceAuditProposalStatus;
  ruleKey: string;
  dataFingerprint: string;
  serviceId?: string | null;
  period: string;
  reason: string;
  currentData: string;
  suggestedChange: string;
  evidence?: string | null;
  actorLibraryUserId?: string | null;
  source: string;
  createdAt?: string | null;
  decidedAt?: string | null;
}

export type FinanceRelationRepairType = "purchase-transaction" | "statement-item-transaction" | "savings-movement-transaction";

export interface FinanceRelationRepair {
  id: string;
  operationId: string;
  relationType: FinanceRelationRepairType;
  relationId: string;
  previousTransactionId?: string | null;
  newTransactionId?: string | null;
  actorLibraryUserId?: string | null;
  source: string;
  reason?: string | null;
  createdAt?: string | null;
}

export interface FinanceCardServiceAssignment {
  statementId: string;
  lineId: string;
  serviceId: string;
  transactionId: string;
  purchaseDate: string;
  period: string;
  amount: string;
  currency: FinanceCurrency;
  assignmentStatus: "new" | "already-reconciled";
  evidence: Record<string, unknown>;
}

export interface FinanceCardServiceReason {
  code: string;
  message: string;
  lineIds: string[];
  candidateServiceIds: string[];
}

export interface FinanceCardServiceAmbiguousGroup {
  statementId: string;
  serviceId?: string | null;
  lineIds: string[];
  candidateServiceIds: string[];
  statementPeriod: string;
  reason: FinanceCardServiceReason;
}

export interface FinanceCardServiceReconciliation {
  status: "no-matches" | "ready" | "partial" | "ambiguous" | "applied" | "partial-applied";
  assignments: FinanceCardServiceAssignment[];
  ambiguousGroups: FinanceCardServiceAmbiguousGroup[];
  reasons: FinanceCardServiceReason[];
}

export type FinanceCardServiceResolution = FinanceCardServiceAssignment;

function previewText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function previewRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Renders the native reconciliation preview without exposing JSON as the only UI. */
export function formatFinanceAuditProposalPreview(
  proposal: FinanceAuditProposal,
  services: readonly FinanceService[] = [],
  statements: readonly FinanceCreditCardStatement[] = [],
): string {
  if (proposal.proposalType !== "service-card-reconciliation") return proposal.currentData;
  let data: Record<string, unknown> | null = null;
  try { data = previewRecord(JSON.parse(proposal.currentData)); } catch { return proposal.currentData; }
  if (!data) return proposal.currentData;

  const statementId = previewText(data.statementId);
  const statement = statements.find((candidate) => candidate.id === statementId);
  const statementPeriod = previewText(data.statementPeriod) || statement?.period || proposal.period;
  const lineById = new Map((statement?.items ?? []).map((line) => [line.id, line]));
  const serviceName = (serviceId: string) => (services.find((service) => service.id === serviceId)?.name ?? serviceId) || "Servicio no identificado";
  const lineText = (lineId: string, details: Record<string, unknown> | null, targetPeriod?: string) => {
    const line = lineById.get(lineId);
    const serviceId = previewText(details?.serviceId);
    const purchaseDate = previewText(details?.purchaseDate) || line?.purchaseDate || "fecha desconocida";
    const amount = previewText(details?.amount) || line?.amount || "importe desconocido";
    const currency = previewText(details?.currency) || line?.currency || "moneda desconocida";
    const description = previewText(details?.description) || line?.description || "línea sin descripción";
    const evidence = previewRecord(details?.evidence);
    const evidenceText = [
      previewText(evidence?.matching),
      previewText(evidence?.provider),
      previewText(evidence?.normalizedDescription),
    ].filter(Boolean).join(", ");
    const transactionId = previewText(details?.transactionId) || line?.transactionId || "transacción desconocida";
    return `línea ${lineId} (${description}), servicio ${serviceName(serviceId)}, compra ${purchaseDate}, período del resumen ${statementPeriod}, período destino ${targetPeriod || "sin asignar"}, importe ${amount} ${currency}, transacción ${transactionId}${evidenceText ? `, evidencia ${evidenceText}` : ""}`;
  };

  const assignments = Array.isArray(data.assignments)
    ? data.assignments.flatMap((value) => {
      const assignment = previewRecord(value);
      const lineId = previewText(assignment?.lineId);
      return lineId ? [lineText(lineId, assignment, previewText(assignment?.period))] : [];
    })
    : [];
  const ambiguousGroups = Array.isArray(data.ambiguousGroups)
    ? data.ambiguousGroups.flatMap((value) => {
      const group = previewRecord(value);
      const reason = previewRecord(group?.reason);
      const lineIds = Array.isArray(group?.lineIds) ? group.lineIds.map(previewText).filter(Boolean) : [];
      const candidateIds = Array.isArray(group?.candidateServiceIds) ? group.candidateServiceIds.map(previewText).filter(Boolean) : [];
      const groupLines = lineIds.map((lineId) => lineText(lineId, { serviceId: previewText(group?.serviceId) }, "requiere decisión"));
      const message = previewText(reason?.message) || "El grupo requiere una decisión manual.";
      return [`grupo ambiguo: ${groupLines.join("; ") || `líneas ${lineIds.join(", ") || "no identificadas"}`}, candidatos ${candidateIds.map(serviceName).join(", ") || "sin coincidencia única"}, motivo ${message}. No se aplicará automáticamente.`];
    })
    : [];
  const reasons = Array.isArray(data.reasons)
    ? data.reasons.flatMap((value) => {
      const reason = previewRecord(value);
      const message = previewText(reason?.message);
      return message ? [`motivo: ${message}`] : [];
    })
    : [];
  const status = ambiguousGroups.length > 0
    ? assignments.length > 0 ? "parcial, con grupos ambiguos" : "ambiguo"
    : assignments.length > 0 ? "listo para aplicar" : "sin coincidencias";
  return [
    `Tipo de propuesta: ${proposal.proposalType}`,
    `Resumen ${statementId || "no identificado"}, período real ${statementPeriod}`,
    `Conciliación: ${status}; ${assignments.length} asignación(es), ${ambiguousGroups.length} grupo(s) ambiguo(s)`,
    `Motivo general: ${proposal.reason}`,
    ...assignments,
    ...ambiguousGroups,
    ...reasons,
  ].join(" | ");
}

export interface FinanceMerchant {
  id: string;
  name: string;
}

export type FinanceSavingsMovementType =
  "contribution" | "withdrawal" | "return" | "loss" | "adjustment";

export interface FinanceSavingsReserve {
  id: string;
  name: string;
  currency: FinanceCurrency;
  openingBalance: string;
  objective?: string | null;
  active: boolean;
  balance: string;
}

export interface FinanceSavingsMovement {
  id: string;
  reserveId: string;
  accountId?: string | null;
  movementType: FinanceSavingsMovementType;
  amount: string;
  currency: FinanceCurrency;
  effectiveDate: string;
  description: string;
  reason?: string | null;
  source: string;
  status: FinanceTransactionStatus;
  actorUserId?: number | null;
  actorLibraryUserId?: string | null;
  linkedTransactionId?: string | null;
}

export interface FinanceSavingsExchange {
  id: string;
  reserveId: string;
  sourceAccountId: string;
  sourceAmount: string;
  sourceCurrency: FinanceCurrency;
  savingsAmount: string;
  savingsCurrency: FinanceCurrency;
  effectiveDate: string;
  description: string;
  actorUserId?: number | null;
  actorLibraryUserId?: string | null;
  sourceReference?: string | null;
  rawSource?: string | null;
}

export interface FinanceSavedSavingsExchange {
  movement: FinanceSavingsMovement;
  transaction: FinanceTransaction;
}

export interface FinanceContext {
  libraryPath: string;
  androidDirectoryUri?: string;
  actorLibraryUserId: string;
  source: 'app' | 'public-url' | 'telegram';
}

export function financeContext(
  library: NotiaLibrary,
  actorLibraryUserId = 'user-owner',
  source: FinanceContext['source'] = 'app',
): FinanceContext {
  return {
    libraryPath: library.path,
    androidDirectoryUri: library.androidTreeUri,
    actorLibraryUserId,
    source,
  };
}
