use std::{
    collections::{BTreeMap, BTreeSet},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::finance_reconciliation::{
    assignment_keys, normalize_service_text, reconcile_card_service_consumption,
    reconciliation_fingerprint, resolve_card_service_assignments, CardServiceAssignment,
    ReconciliationInput, ReconciliationLine, ReconciliationOccurrence, ReconciliationService,
};
use crate::finance_records::persist_card_reconciliation;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceCommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<String> for FinanceCommandError {
    fn from(message: String) -> Self {
        let lower = message.to_lowercase();
        let code = if lower.contains("no existe") || lower.contains("no est") {
            "notFound"
        } else if lower.contains("duplic")
            || lower.contains("ya existe")
            || lower.contains("ya fue registrado")
            || lower.contains("registrado anteriormente")
        {
            "conflict"
        } else if lower.contains("requiere")
            || lower.contains("inválid")
            || lower.contains("debe")
            || lower.contains("diferencia")
            || lower.contains("no coincide")
            || lower.contains("suma de líneas")
            || lower.contains("importe")
        {
            "validation"
        } else {
            "storage"
        };
        Self { code, message }
    }
}

impl From<&str> for FinanceCommandError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

pub type FinanceCommandResult<T> = Result<T, FinanceCommandError>;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::database::open_library_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceContext {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
    pub actor_library_user_id: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAccount {
    pub id: String,
    pub name: String,
    pub account_type: String,
    pub currency: String,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceCategory {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub active: bool,
    pub parent_id: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceTransaction {
    pub id: String,
    pub transaction_type: String,
    pub amount: String,
    pub currency: String,
    pub effective_date: String,
    pub account_id: String,
    pub destination_account_id: Option<String>,
    pub category_id: Option<String>,
    pub description: String,
    pub source: String,
    pub status: String,
    pub actor_user_id: Option<i64>,
    #[serde(default)]
    pub actor_library_user_id: Option<String>,
    pub source_artifact_id: Option<String>,
    pub service_id: Option<String>,
    pub merchant_id: Option<String>,
    pub operation_fingerprint: Option<String>,
    pub installment_id: Option<String>,
    pub source_reference: Option<String>,
    pub raw_source: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceDashboard {
    pub accounts: Vec<FinanceAccount>,
    pub categories: Vec<FinanceCategory>,
    pub transactions: Vec<FinanceTransaction>,
    pub transactions_truncated: bool,
    pub income_total: String,
    pub expense_total: String,
    pub net_total: String,
    pub income_by_currency: BTreeMap<String, String>,
    pub expense_by_currency: BTreeMap<String, String>,
    pub net_by_currency: BTreeMap<String, String>,
    pub debt_by_currency: BTreeMap<String, String>,
    pub salary_by_currency: BTreeMap<String, String>,
    pub debt_ratio_history: Vec<FinanceDebtRatioHistoryPoint>,
    pub savings: Vec<FinanceSavingsReserve>,
    pub savings_movements: Vec<FinanceSavingsMovement>,
    pub savings_movements_truncated: bool,
    pub merchants: Vec<FinanceMerchant>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceService {
    pub id: String,
    pub name: String,
    pub category_id: String,
    pub currency: String,
    pub expected_amount: String,
    pub due_day: Option<i64>,
    pub default_account_id: Option<String>,
    pub provider: Option<String>,
    pub modality: String,
    pub active: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceServiceOccurrence {
    pub id: String,
    pub service_id: String,
    pub period: String,
    pub expected_amount: String,
    pub paid_amount: Option<String>,
    pub effective_date: Option<String>,
    pub status: String,
    pub transaction_id: Option<String>,
    pub artifact_id: Option<String>,
    pub source_reference: Option<String>,
    pub raw_source: Option<String>,
    pub actor_library_user_id: Option<String>,
    pub source: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// Paid minus expected, when the occurrence was paid.
    #[serde(default, skip_deserializing)]
    pub difference: Option<String>,
}

/// Paid minus expected amount of a paid service occurrence.
pub(crate) fn occurrence_difference(expected: &str, paid: Option<&str>) -> Option<String> {
    let paid = paid?.trim().parse::<f64>().ok().filter(|value| value.is_finite())?;
    let expected = expected.trim().parse::<f64>().ok().filter(|value| value.is_finite())?;
    Some(format!("{:.2}", paid - expected))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceServiceOccurrenceVersion {
    pub id: String,
    pub occurrence_id: String,
    pub version_number: i64,
    pub expected_amount: String,
    pub paid_amount: Option<String>,
    pub effective_date: Option<String>,
    pub status: String,
    pub transaction_id: Option<String>,
    pub artifact_id: Option<String>,
    pub source_reference: Option<String>,
    pub raw_source: Option<String>,
    pub actor_library_user_id: Option<String>,
    pub source: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceServiceInvoice {
    pub id: String,
    pub service_id: Option<String>,
    pub period: String,
    pub due_date: Option<String>,
    pub provider: Option<String>,
    pub amount: String,
    pub currency: String,
    pub transaction_id: Option<String>,
    pub artifact_id: Option<String>,
    pub validation_status: String,
    pub source_reference: Option<String>,
    pub raw_extraction: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAuditRun {
    pub id: String,
    pub period: String,
    pub trigger_fingerprint: String,
    pub status: String,
    pub actor_library_user_id: Option<String>,
    pub source: String,
    pub reason: Option<String>,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAuditProposal {
    pub id: String,
    pub audit_run_id: String,
    pub proposal_type: String,
    pub status: String,
    pub rule_key: String,
    pub data_fingerprint: String,
    pub service_id: Option<String>,
    pub period: String,
    pub reason: String,
    pub current_data: String,
    pub suggested_change: String,
    pub evidence: Option<String>,
    pub actor_library_user_id: Option<String>,
    pub source: String,
    pub created_at: Option<String>,
    pub decided_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceRelationRepair {
    pub id: String,
    pub operation_id: String,
    pub relation_type: String,
    pub relation_id: String,
    pub previous_transaction_id: Option<String>,
    pub new_transaction_id: Option<String>,
    pub actor_library_user_id: Option<String>,
    pub source: String,
    pub reason: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceDebtRatioHistoryPoint {
    pub period: String,
    pub debt_by_currency: BTreeMap<String, String>,
    pub salary_by_currency: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceMerchant {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSavingsReserve {
    pub id: String,
    pub name: String,
    pub currency: String,
    pub opening_balance: String,
    pub objective: Option<String>,
    pub active: bool,
    pub balance: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSavingsMovement {
    pub id: String,
    pub reserve_id: String,
    pub account_id: Option<String>,
    pub movement_type: String,
    pub amount: String,
    pub currency: String,
    pub effective_date: String,
    pub description: String,
    pub reason: Option<String>,
    pub source: String,
    pub status: String,
    pub actor_user_id: Option<i64>,
    #[serde(default)]
    pub actor_library_user_id: Option<String>,
    pub linked_transaction_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSavingsExchange {
    pub id: String,
    pub reserve_id: String,
    pub source_account_id: String,
    pub source_amount: String,
    pub source_currency: String,
    pub savings_amount: String,
    pub savings_currency: String,
    pub effective_date: String,
    pub description: String,
    pub actor_user_id: Option<i64>,
    pub source_reference: Option<String>,
    pub raw_source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSavedSavingsExchange {
    pub movement: FinanceSavingsMovement,
    pub transaction: FinanceTransaction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAccountPayload {
    pub context: FinanceContext,
    pub account: FinanceAccount,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCategoryPayload {
    pub context: FinanceContext,
    pub category: FinanceCategory,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTransactionPayload {
    pub context: FinanceContext,
    pub transaction: FinanceTransaction,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFinanceServicePayload {
    pub context: FinanceContext,
    pub service: FinanceService,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFinanceServiceActivePayload {
    pub context: FinanceContext,
    pub id: String,
    pub active: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFinanceServiceOccurrencePayload {
    pub context: FinanceContext,
    pub occurrence: FinanceServiceOccurrence,
    pub reason: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFinanceServiceInvoicePayload {
    pub context: FinanceContext,
    pub invoice: FinanceServiceInvoice,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFinanceAuditRunPayload {
    pub context: FinanceContext,
    pub run: FinanceAuditRun,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFinanceAuditProposalPayload {
    pub context: FinanceContext,
    pub proposal: FinanceAuditProposal,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideFinanceAuditProposalPayload {
    pub context: FinanceContext,
    pub proposal_id: String,
    pub decision: String,
    #[serde(default)]
    pub expected_data_fingerprint: Option<String>,
    #[serde(default)]
    pub resolution_assignments: Option<Vec<CardServiceAssignment>>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFinanceAuditPayload {
    pub context: FinanceContext,
    pub period: String,
    pub trigger_fingerprint: String,
    pub reason: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairFinanceRelationPayload {
    pub context: FinanceContext,
    pub operation_id: String,
    pub relation_type: String,
    pub relation_id: String,
    #[serde(default)]
    pub new_transaction_id: Option<String>,
    #[serde(default)]
    pub expected_transaction_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAuditResult {
    pub run: FinanceAuditRun,
    pub proposals: Vec<FinanceAuditProposal>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSavingsReservePayload {
    pub context: FinanceContext,
    pub reserve: FinanceSavingsReserve,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSavingsMovementPayload {
    pub context: FinanceContext,
    pub movement: FinanceSavingsMovement,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSavingsExchangePayload {
    pub context: FinanceContext,
    pub exchange: FinanceSavingsExchange,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFinanceEntityPayload {
    pub context: FinanceContext,
    pub id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSavingsAccountPayload {
    pub context: FinanceContext,
    pub reserve_id: String,
    pub account_id: String,
}

const FINANCE_DEV_TABLES: &[&str] = &[
    "finance_accounts",
    "finance_categories",
    "finance_transactions",
    "finance_merchants",
    "finance_source_artifacts",
    "finance_extraction_results",
    "finance_receipts",
    "finance_purchases",
    "finance_products",
    "finance_purchase_items",
    "finance_salary_receipts",
    "finance_salary_concepts",
    "finance_savings_reserves",
    "finance_savings_movements",
    "finance_savings_accounts",
    "finance_investments",
    "finance_valuations",
    "finance_price_observations",
    "finance_installment_plans",
    "finance_installments",
    "finance_credit_card_statements",
    "finance_credit_card_statement_items",
    "finance_services",
    "finance_service_occurrences",
    "finance_service_occurrence_versions",
    "finance_service_invoices",
    "finance_audit_runs",
    "finance_audit_proposals",
    "finance_audit_decisions",
];
const FINANCE_DEV_PAGE_SIZE: u32 = 50;
const FINANCE_DEV_MAX_PAGE_SIZE: u32 = 200;
const FINANCE_DEV_MAX_SQL_CHARS: usize = 20_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceDevTable {
    pub name: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceDevQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub total_rows: i64,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceDevTableQueryPayload {
    pub context: FinanceContext,
    pub table_name: String,
    pub page: u32,
    pub page_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceDevSqlQueryPayload {
    pub context: FinanceContext,
    pub sql: String,
    pub page: u32,
    pub page_size: Option<u32>,
}

pub(crate) fn now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn finance_dev_page_size(value: Option<u32>) -> u32 {
    value
        .unwrap_or(FINANCE_DEV_PAGE_SIZE)
        .clamp(1, FINANCE_DEV_MAX_PAGE_SIZE)
}

fn validate_finance_dev_sql(sql: &str) -> Result<String, String> {
    let normalized = sql.trim().trim_end_matches(';').trim();
    if normalized.is_empty() || normalized.len() > FINANCE_DEV_MAX_SQL_CHARS {
        return Err("La consulta SQL debe tener entre 1 y 20000 caracteres.".to_string());
    }
    if sql.trim_end().ends_with(';') && sql.trim_end_matches(';').contains(';') {
        return Err("La consola Dev admite una única consulta SQL.".to_string());
    }
    let lower = normalized.to_ascii_lowercase();
    if !(lower.starts_with("select") || lower.starts_with("with")) {
        return Err(
            "La consola Dev solo admite consultas SELECT o WITH de solo lectura.".to_string(),
        );
    }
    for keyword in [
        "insert", "update", "delete", "replace", "drop", "alter", "create", "attach", "detach",
        "vacuum", "pragma",
    ] {
        if lower
            .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
            .any(|token| token == keyword)
        {
            return Err(
                "La consola Dev no admite sentencias que modifiquen la base de datos.".to_string(),
            );
        }
    }
    Ok(normalized.to_string())
}

fn finance_dev_value(value: ValueRef<'_>) -> Option<String> {
    match value {
        ValueRef::Null => None,
        ValueRef::Integer(value) => Some(value.to_string()),
        ValueRef::Real(value) => Some(value.to_string()),
        ValueRef::Text(value) => Some(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Some(format!("<blob: {} bytes>", value.len())),
    }
}

fn finance_dev_query(
    connection: &Connection,
    sql: &str,
    page: u32,
    page_size: u32,
) -> Result<FinanceDevQueryResult, String> {
    let total_rows: i64 = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM ({sql}) AS finance_dev_count"),
            [],
            |row| row.get(0),
        )
        .map_err(|_| "No se pudo contar el resultado de la consulta SQL.".to_string())?;
    let offset = i64::from(page) * i64::from(page_size);
    let mut statement = connection
        .prepare(&format!(
            "SELECT * FROM ({sql}) AS finance_dev_result LIMIT ?1 OFFSET ?2"
        ))
        .map_err(|_| "La consulta SQL no es válida.".to_string())?;
    let columns = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let rows = statement
        .query_map(params![page_size, offset], |row| {
            (0..row.as_ref().column_count())
                .map(|index| row.get_ref(index).map(finance_dev_value))
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|_| "No se pudo ejecutar la consulta SQL.".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "No se pudo leer el resultado de la consulta SQL.".to_string())?;
    Ok(FinanceDevQueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
    })
}

pub fn finance_dev_list_tables() -> Vec<FinanceDevTable> {
    FINANCE_DEV_TABLES
        .iter()
        .map(|name| FinanceDevTable { name })
        .collect()
}

pub fn finance_dev_query_table(
    app: crate::host::AppHandle,
    payload: FinanceDevTableQueryPayload,
) -> FinanceCommandResult<FinanceDevQueryResult> {
    if !FINANCE_DEV_TABLES.contains(&payload.table_name.as_str()) {
        return Err("La entidad financiera solicitada no existe.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    finance_dev_query(
        &connection,
        &format!("SELECT * FROM {}", payload.table_name),
        payload.page,
        finance_dev_page_size(payload.page_size),
    )
    .map_err(Into::into)
}

pub fn finance_dev_query_sql(
    app: crate::host::AppHandle,
    payload: FinanceDevSqlQueryPayload,
) -> FinanceCommandResult<FinanceDevQueryResult> {
    let sql = validate_finance_dev_sql(&payload.sql)?;
    let connection = validate_context(&payload.context, &app)?;
    finance_dev_query(
        &connection,
        &sql,
        payload.page,
        finance_dev_page_size(payload.page_size),
    )
    .map_err(Into::into)
}

fn seed_finance_demo_data(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "INSERT OR IGNORE INTO finance_accounts (id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES
                ('dev-account-cash','Efectivo demo','cash','ARS','12500.00',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-account-bank','Cuenta bancaria demo','bank','ARS','85000.00',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-account-card','Tarjeta demo','credit_card','ARS','0.00',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-account-savings','Caja de ahorro demo','savings_reserve','ARS','0.00',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-account-usd','Cuenta USD inactiva','bank','USD','150.00',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_categories (id,name,kind,parent_id,active,description,created_at,updated_at) VALUES
                ('dev-category-food','Alimentos','expense',NULL,1,'Compras de comida y supermercado.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-category-coffee','Cafetería','expense','dev-category-food',1,'Consumos pequeños fuera de casa.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-category-transport','Transporte','expense',NULL,1,'Traslados cotidianos.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-category-salary','Sueldo','income',NULL,1,'Ingresos por empleo.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-category-old','Categoría inactiva','expense',NULL,0,'Ejemplo de categoría desactivada.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_merchants (id,name,normalized_name,created_at,updated_at) VALUES
                ('dev-merchant-market','Mercado Central','mercado central',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-merchant-coffee','Café de la Plaza','cafe de la plaza',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_source_artifacts (id,source_type,reference,raw_text,content_hash,created_at) VALUES
                ('dev-art-ticket-jul','ticket','ticket-demo-julio.pdf','Ticket demo de supermercado de julio.','demo-ticket-jul',CURRENT_TIMESTAMP),
                ('dev-art-ticket-aug','ticket','ticket-demo-agosto.pdf','Ticket demo de supermercado de agosto.','demo-ticket-aug',CURRENT_TIMESTAMP),
                ('dev-art-salary-jul','salary','recibo-demo-julio.pdf','Recibo de sueldo demo julio.','demo-salary-jul',CURRENT_TIMESTAMP),
                ('dev-art-salary-aug','salary','recibo-demo-agosto.pdf','Recibo de sueldo demo agosto.','demo-salary-aug',CURRENT_TIMESTAMP),
                ('dev-art-card-jul','credit_card_statement','resumen-demo-julio.pdf','Resumen de tarjeta demo julio.','demo-card-jul',CURRENT_TIMESTAMP),
                ('dev-art-card-aug','credit_card_statement','resumen-demo-agosto.pdf','Resumen de tarjeta demo agosto.','demo-card-aug',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_transactions (id,transaction_type,amount,currency,effective_date,account_id,destination_account_id,category_id,description,source,status,source_artifact_id,merchant_id,operation_fingerprint,installment_id,created_at,updated_at) VALUES
                ('dev-tx-salary-jul','income','120000.00','ARS','2026-07-31','dev-account-bank',NULL,'dev-category-salary','Sueldo julio 2026','salary','confirmed','dev-art-salary-jul',NULL,'demo-salary-jul',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-ticket-jul','expense','18500.00','ARS','2026-07-18','dev-account-bank',NULL,'dev-category-food','Compra supermercado julio','ticket','confirmed','dev-art-ticket-jul','dev-merchant-market','demo-ticket-jul',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-card-jul','expense','12000.00','ARS','2026-07-20','dev-account-card',NULL,'dev-category-transport','Viaje demo julio','credit_card_statement','confirmed',NULL,NULL,'demo-card-jul',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-salary-aug','income','128000.00','ARS','2026-08-28','dev-account-bank',NULL,'dev-category-salary','Sueldo agosto 2026','salary','confirmed','dev-art-salary-aug',NULL,'demo-salary-aug',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-ticket-aug','expense','24100.00','ARS','2026-08-12','dev-account-bank',NULL,'dev-category-food','Compra supermercado agosto','ticket','corrected','dev-art-ticket-aug','dev-merchant-market','demo-ticket-aug',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-transfer-aug','transfer','30000.00','ARS','2026-08-15','dev-account-bank','dev-account-savings',NULL,'Aporte a ahorro','manual','confirmed',NULL,NULL,'demo-transfer-aug',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-installment-aug','expense','15000.00','ARS','2026-08-10','dev-account-card',NULL,'dev-category-food','Cuota 1 de compra demo','manual','pending',NULL,'dev-merchant-market','demo-installment-aug','dev-installment-1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-tx-coffee-aug','expense','3500.00','ARS','2026-08-22','dev-account-cash',NULL,'dev-category-coffee','Café demo','manual','discarded',NULL,'dev-merchant-coffee','demo-coffee-aug',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_extraction_results (id,source_artifact_id,extractor,raw_result,confidence,status,created_at) VALUES
                ('dev-extraction-ticket-jul','dev-art-ticket-jul','demo','{\"merchant\":\"Mercado Central\",\"total\":18500}',0.98,'confirmed',CURRENT_TIMESTAMP),
                ('dev-extraction-salary-aug','dev-art-salary-aug','demo','{\"employer\":\"Empresa Demo SA\",\"net\":128000}',0.96,'confirmed',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_receipts (id,source_artifact_id,receipt_type,validation_status,created_at,updated_at) VALUES
                ('dev-receipt-ticket-jul','dev-art-ticket-jul','ticket','confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-receipt-salary-aug','dev-art-salary-aug','salary','corrected',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_purchases (id,transaction_id,merchant_id,observed_at,currency,total_amount,source_artifact_id,subtotal_amount,discount_amount,tax_amount,validation_status,created_at,updated_at) VALUES
                ('dev-purchase-jul','dev-tx-ticket-jul','dev-merchant-market','2026-07-18','ARS','18500.00','dev-art-ticket-jul','19000.00','500.00','0.00','confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-purchase-aug','dev-tx-ticket-aug','dev-merchant-market','2026-08-12','ARS','24100.00','dev-art-ticket-aug','24100.00','0.00','0.00','corrected',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_products (id,name,normalized_name,created_at,updated_at) VALUES
                ('dev-product-milk','Leche entera 1 L','leche entera 1 l',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-product-bread','Pan lactal','pan lactal',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_purchase_items (id,purchase_id,product_id,original_description,normalized_description,quantity,unit_price,discount_amount,line_total,currency,category_id,created_at) VALUES
                ('dev-item-jul-milk','dev-purchase-jul','dev-product-milk','Leche entera 1 L','leche entera 1 l','2','4500.00','0.00','9000.00','ARS','dev-category-food',CURRENT_TIMESTAMP),
                ('dev-item-jul-bread','dev-purchase-jul','dev-product-bread','Pan lactal','pan lactal','1','10000.00','500.00','9500.00','ARS','dev-category-food',CURRENT_TIMESTAMP),
                ('dev-item-aug-milk','dev-purchase-aug','dev-product-milk','Leche entera 1 L','leche entera 1 l','2','5200.00','0.00','10400.00','ARS','dev-category-food',CURRENT_TIMESTAMP),
                ('dev-item-aug-bread','dev-purchase-aug','dev-product-bread','Pan lactal','pan lactal','1','13700.00','0.00','13700.00','ARS','dev-category-food',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_price_observations (id,purchase_item_id,product_id,merchant_id,observed_at,currency,quantity,unit_price,discount_amount,final_amount,status,created_at) VALUES
                ('dev-price-jul-milk','dev-item-jul-milk','dev-product-milk','dev-merchant-market','2026-07-18','ARS','2','4500.00','0.00','9000.00','confirmed',CURRENT_TIMESTAMP),
                ('dev-price-aug-milk','dev-item-aug-milk','dev-product-milk','dev-merchant-market','2026-08-12','ARS','2','5200.00','0.00','10400.00','corrected',CURRENT_TIMESTAMP),
                ('dev-price-aug-bread','dev-item-aug-bread','dev-product-bread','dev-merchant-market','2026-08-12','ARS','1','13700.00','0.00','13700.00','pending',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_salary_receipts (id,period,payment_date,employer,gross_amount,deductions_total,net_amount,currency,account_id,transaction_id,source_artifact_id,validation_status,created_at,updated_at) VALUES
                ('dev-salary-jul','2026-07','2026-07-31','Empresa Demo SA','150000.00','30000.00','120000.00','ARS','dev-account-bank','dev-tx-salary-jul','dev-art-salary-jul','confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-salary-aug','2026-08','2026-08-28','Empresa Demo SA','160000.00','32000.00','128000.00','ARS','dev-account-bank','dev-tx-salary-aug','dev-art-salary-aug','corrected',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_salary_concepts (id,salary_receipt_id,name,concept_type,amount,currency,created_at) VALUES
                ('dev-salary-concept-jul-gross','dev-salary-jul','Sueldo básico','earning','150000.00','ARS',CURRENT_TIMESTAMP),
                ('dev-salary-concept-jul-deduction','dev-salary-jul','Aportes jubilatorios','deduction','30000.00','ARS',CURRENT_TIMESTAMP),
                ('dev-salary-concept-aug-gross','dev-salary-aug','Sueldo básico','earning','160000.00','ARS',CURRENT_TIMESTAMP),
                ('dev-salary-concept-aug-deduction','dev-salary-aug','Aportes jubilatorios','deduction','32000.00','ARS',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_savings_reserves (id,name,currency,opening_balance,objective,active,ledger_account_id,created_at,updated_at) VALUES
                ('dev-reserve-emergency','Fondo de emergencia','ARS','50000.00','Cubrir tres meses de gastos.',1,'dev-account-savings',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_savings_accounts (reserve_id,account_id,created_at) VALUES
                ('dev-reserve-emergency','dev-account-bank',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_savings_movements (id,reserve_id,account_id,movement_type,amount,currency,effective_date,description,reason,source,status,linked_transaction_id,created_at,updated_at) VALUES
                ('dev-savings-jul','dev-reserve-emergency','dev-account-bank','contribution','10000.00','ARS','2026-07-25','Aporte mensual',NULL,'manual','confirmed',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-savings-aug','dev-reserve-emergency','dev-account-bank','contribution','30000.00','ARS','2026-08-15','Aporte desde cuenta bancaria',NULL,'manual','confirmed','dev-tx-transfer-aug',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-savings-loss','dev-reserve-emergency',NULL,'loss','500.00','ARS','2026-08-20','Ajuste demo','Diferencia de caja','manual','pending',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_investments (id,account_id,name,asset_type,currency,active,created_at,updated_at) VALUES
                ('dev-investment-fund','dev-account-bank','Fondo común demo','fund','ARS',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_valuations (id,investment_id,valuation_date,amount,currency,source,created_at) VALUES
                ('dev-valuation-jul','dev-investment-fund','2026-07-31','75000.00','ARS','manual',CURRENT_TIMESTAMP),
                ('dev-valuation-aug','dev-investment-fund','2026-08-31','82000.00','ARS','manual',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_installment_plans (id,account_id,merchant_id,description,purchase_date,currency,total_amount,installment_count,created_at,updated_at) VALUES
                ('dev-plan-market','dev-account-card','dev-merchant-market','Compra demo en 3 cuotas','2026-08-10','ARS','45000.00',3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_installments (id,plan_id,installment_number,due_date,amount,status,transaction_id,created_at,updated_at) VALUES
                ('dev-installment-1','dev-plan-market',1,'2026-08-10','15000.00','pending','dev-tx-installment-aug',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-installment-2','dev-plan-market',2,'2026-09-10','15000.00','confirmed',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-installment-3','dev-plan-market',3,'2026-10-10','15000.00','discarded',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_credit_card_statements (id,account_id,issuer,card_last_four,period,closing_date,due_date,currency,previous_balance,payments_amount,credits_amount,purchases_amount,fees_amount,interest_amount,taxes_amount,total_due,minimum_payment,source_artifact_id,validation_status,created_at,updated_at) VALUES
                ('dev-statement-jul','dev-account-card','Banco Demo','1234','2026-07','2026-07-25','2026-08-05','ARS','0.00','0.00','0.00','12000.00','500.00','0.00','0.00','12500.00','1250.00','dev-art-card-jul','confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-statement-aug','dev-account-card','Banco Demo','1234','2026-08','2026-08-25','2026-09-05','ARS','12500.00','12500.00','0.00','15000.00','0.00','250.00','0.00','15250.00','1525.00','dev-art-card-aug','corrected',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_credit_card_statement_items (id,statement_id,transaction_id,purchase_date,description,amount,currency,item_type,installment_number,installment_count,created_at) VALUES
                ('dev-statement-item-jul-purchase','dev-statement-jul','dev-tx-card-jul','2026-07-20','Viaje demo julio','12000.00','ARS','purchase',NULL,NULL,CURRENT_TIMESTAMP),
                ('dev-statement-item-jul-fee','dev-statement-jul',NULL,'2026-07-25','Mantenimiento','500.00','ARS','fee',NULL,NULL,CURRENT_TIMESTAMP),
                ('dev-statement-item-aug-installment','dev-statement-aug','dev-tx-installment-aug','2026-08-10','Cuota 1 compra demo','15000.00','ARS','purchase',1,3,CURRENT_TIMESTAMP),
                ('dev-statement-item-aug-interest','dev-statement-aug',NULL,'2026-08-25','Interés demo','250.00','ARS','interest',NULL,NULL,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_services (id,name,normalized_name,category_id,currency,expected_amount,due_day,default_account_id,provider,normalized_provider,modality,active,created_at,updated_at) VALUES
                ('dev-service-internet','Internet demo','internet demo','dev-category-food','ARS','18000.00',10,'dev-account-bank','Fibra Demo','fibra demo','fixed',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-service-power','Luz demo','luz demo','dev-category-food','ARS','9500.00',15,'dev-account-bank','Energía Demo','energia demo','variable',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_service_occurrences (id,service_id,period,expected_amount,paid_amount,effective_date,status,source,created_at,updated_at) VALUES
                ('dev-occurrence-internet-jul','dev-service-internet','2026-07','18000.00','18000.00','2026-07-10','accepted','dev-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-occurrence-internet-aug','dev-service-internet','2026-08','18000.00',NULL,NULL,'pending','dev-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('dev-occurrence-power-aug','dev-service-power','2026-08','9500.00','10240.00','2026-08-15','accepted','dev-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_service_occurrence_versions (id,occurrence_id,version_number,expected_amount,paid_amount,effective_date,status,source,reason,created_at) VALUES
                ('dev-occurrence-internet-jul-v1','dev-occurrence-internet-jul',1,'18000.00',NULL,NULL,'pending','dev-seed','Alta del período',CURRENT_TIMESTAMP),
                ('dev-occurrence-internet-jul-v2','dev-occurrence-internet-jul',2,'18000.00','18000.00','2026-07-10','accepted','dev-seed','Pago registrado',CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_service_invoices (id,service_id,period,due_date,provider,amount,currency,validation_status,created_at,updated_at) VALUES
                ('dev-invoice-power-aug','dev-service-power','2026-08','2026-08-15','Energía Demo','10240.00','ARS','valid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_audit_runs (id,period,trigger_fingerprint,status,source,reason,created_at,completed_at) VALUES
                ('dev-audit-aug','2026-08','dev-seed-audit-aug','completed','dev-seed','Auditoría de ejemplo',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_audit_proposals (id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,source,created_at,decided_at) VALUES
                ('dev-audit-proposal-aug','dev-audit-aug','service-unpaid','rejected','service-unpaid','dev-seed-internet-aug','dev-service-internet','2026-08','Internet demo no tiene pago en agosto.','{}','{}','dev-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT OR IGNORE INTO finance_audit_decisions (id,proposal_id,decision,source,created_at) VALUES
                ('dev-audit-decision-aug','dev-audit-proposal-aug','rejected','dev-seed',CURRENT_TIMESTAMP);",
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn finance_dev_seed_demo_data(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<()> {
    let mut connection = validate_context(&context, &app)?;
    seed_finance_demo_data(&mut connection)?;
    sync_context(&context, &app)?;
    Ok(())
}
pub(crate) fn validate_context(
    context: &FinanceContext,
    app: &crate::host::AppHandle,
) -> Result<Connection, String> {
    #[cfg(target_os = "android")]
    {
        let directory_uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La biblioteca perdió su URI SAF. Volvé a seleccionarla.".to_string())?;
        let connection = crate::database::open_mobile_library_connection(app, directory_uri)?;
        validate_finance_actor(&connection, context)?;
        Ok(connection)
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (context, app);
        Err("Finanzas todavía no está disponible en iOS.".to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        if context.library_path.trim().is_empty() {
            return Err("La librería es obligatoria.".to_string());
        }
        let connection = open_library_connection(&context.library_path)?;
        validate_finance_actor(&connection, context)?;
        Ok(connection)
    }
}

fn validate_finance_actor(connection: &Connection, context: &FinanceContext) -> Result<(), String> {
    if !matches!(context.source.as_str(), "app" | "public-url" | "telegram") {
        return Err("El origen de la operación financiera no es válido.".to_string());
    }
    let actor_id = context.actor_library_user_id.trim();
    if actor_id.is_empty() {
        return Err(
            "El usuario de la biblioteca es obligatorio para acceder a Finanzas.".to_string(),
        );
    }
    let role_id: Option<String> = connection
        .query_row(
            "SELECT role_id FROM library_users WHERE id=?1",
            [actor_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(role_id) = role_id else {
        return Err("El usuario de la biblioteca no está autorizado para Finanzas.".to_string());
    };
    if role_id != "role-owner" {
        let has_confidential_context: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_user_contexts WHERE user_id=?1 AND lower(context_tag)=lower('#Confidencial'))",
                [actor_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !has_confidential_context {
            return Err(
                "El usuario no tiene el contexto #Confidencial requerido para Finanzas."
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub(crate) fn sync_context(context: &FinanceContext, app: &crate::host::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let directory_uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La biblioteca perdió su URI SAF. Volvé a seleccionarla.".to_string())?;
        crate::database::sync_mobile_library_connection(app, directory_uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (context, app);
        Ok(())
    }
}
fn valid_amount(value: &str) -> bool {
    parse_cents(value).is_ok()
}

pub(crate) fn parse_cents(value: &str) -> Result<i128, ()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 32 {
        return Err(());
    }
    let mut parts = trimmed.split('.');
    let whole = parts.next().ok_or(())?;
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.chars().all(|c| c.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.chars().all(|c| c.is_ascii_digit())
    {
        return Err(());
    }
    let cents = format!("{fraction:0<2}").parse::<i128>().map_err(|_| ())?;
    let result = whole
        .parse::<i128>()
        .map_err(|_| ())?
        .checked_mul(100)
        .and_then(|value| value.checked_add(cents))
        .ok_or(())?;
    Ok(result)
}

pub(crate) fn valid_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes[..4]
            .iter()
            .chain(&bytes[5..7])
            .chain(&bytes[8..])
            .all(u8::is_ascii_digit)
    {
        return false;
    }
    let year = value[0..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    };
    days_in_month > 0 && (1..=days_in_month).contains(&day)
}

fn valid_bounded_text(value: &str, max: usize, required: bool) -> bool {
    let trimmed = value.trim();
    (!required || !trimmed.is_empty()) && trimmed.chars().count() <= max
}

pub(crate) fn format_cents(value: i128) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let absolute = value.abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

fn add_currency_total(totals: &mut BTreeMap<String, i128>, currency: &str, amount: &str) {
    if let Ok(cents) = parse_cents(amount) {
        *totals.entry(currency.to_string()).or_default() += cents;
    }
}

fn apply_savings_movement(balance: &mut i128, movement_type: &str, amount: &str, status: &str) {
    if !matches!(status, "confirmed" | "corrected") {
        return;
    }
    let amount = parse_cents(amount).unwrap_or_default();
    if matches!(movement_type, "contribution" | "return" | "adjustment") {
        *balance += amount;
    } else if matches!(movement_type, "withdrawal" | "loss") {
        *balance -= amount;
    }
}

pub(crate) fn valid_service_period(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().all(|byte| byte.is_ascii_digit())
        && bytes[5..].iter().all(|byte| byte.is_ascii_digit())
        && (1..=12).contains(&value[5..].parse::<u8>().unwrap_or(0))
}

fn valid_finance_source(value: &str) -> bool {
    matches!(value, "app" | "public-url" | "telegram")
}

fn validate_service(service: &FinanceService, connection: &Connection) -> Result<(), String> {
    if service.id.trim().is_empty()
        || service.name.trim().is_empty()
        || service.name.chars().count() > 160
        || !valid_amount(&service.expected_amount)
        || !matches!(service.currency.as_str(), "ARS" | "USD")
        || !matches!(service.modality.as_str(), "fixed" | "variable")
        || service
            .due_day
            .map(|day| !(1..=31).contains(&day))
            .unwrap_or(false)
    {
        return Err("El servicio requiere nombre, importe, moneda y modalidad válidos.".into());
    }
    if service.provider.as_deref().map(str::len).unwrap_or(0) > 160 {
        return Err("El proveedor del servicio es demasiado largo.".into());
    }
    let category_kind: String = connection
        .query_row(
            "SELECT kind FROM finance_categories WHERE id=?1 AND active=1",
            [&service.category_id],
            |row| row.get(0),
        )
        .map_err(|_| "La categoría del servicio no existe o está inactiva.".to_string())?;
    if category_kind != "expense" {
        return Err("Un servicio solo puede usar una categoría de gasto.".into());
    }
    if let Some(account_id) = service
        .default_account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let account_currency: String = connection
            .query_row(
                "SELECT currency FROM finance_accounts WHERE id=?1 AND active=1",
                [account_id],
                |row| row.get(0),
            )
            .map_err(|_| "La cuenta predeterminada no existe o está inactiva.".to_string())?;
        if account_currency != service.currency {
            return Err("La cuenta predeterminada debe usar la moneda del servicio.".into());
        }
    }
    Ok(())
}

fn service_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FinanceService> {
    Ok(FinanceService {
        id: row.get(0)?,
        name: row.get(1)?,
        category_id: row.get(2)?,
        currency: row.get(3)?,
        expected_amount: row.get(4)?,
        due_day: row.get(5)?,
        default_account_id: row.get(6)?,
        provider: row.get(7)?,
        modality: row.get(8)?,
        active: row.get::<_, i32>(9)? != 0,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn occurrence_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FinanceServiceOccurrence> {
    Ok(FinanceServiceOccurrence {
        id: row.get(0)?,
        service_id: row.get(1)?,
        period: row.get(2)?,
        expected_amount: row.get(3)?,
        paid_amount: row.get(4)?,
        effective_date: row.get(5)?,
        status: row.get(6)?,
        transaction_id: row.get(7)?,
        artifact_id: row.get(8)?,
        source_reference: row.get(9)?,
        raw_source: row.get(10)?,
        actor_library_user_id: row.get(11)?,
        source: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        difference: None,
    })
    .map(|mut occurrence: FinanceServiceOccurrence| {
        occurrence.difference = occurrence_difference(&occurrence.expected_amount, occurrence.paid_amount.as_deref());
        occurrence
    })
}

fn transaction_query_occurrence(
    connection: &Connection,
    service_id: &str,
    period: &str,
) -> Result<FinanceServiceOccurrence, String> {
    connection
        .query_row(
            "SELECT id,service_id,period,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,created_at,updated_at FROM finance_service_occurrences WHERE service_id=?1 AND period=?2",
            params![service_id, period],
            occurrence_from_row,
        )
        .map_err(|error| error.to_string())
}

fn service_unpaid_fingerprint(
    transaction: &rusqlite::Transaction<'_>,
    service_id: &str,
    period: &str,
) -> Result<String, String> {
    let (expected, paid, status): (String, Option<String>, String) = transaction
        .query_row(
            "SELECT COALESCE(o.expected_amount,s.expected_amount),o.paid_amount,COALESCE(o.status,'missing') FROM finance_services s LEFT JOIN finance_service_occurrences o ON o.service_id=s.id AND o.period=?2 WHERE s.id=?1",
            params![service_id, period],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "El servicio de la propuesta no existe.".to_string())?;
    let active: bool = transaction
        .query_row(
            "SELECT active FROM finance_services WHERE id=?1",
            [service_id],
            |row| row.get::<_, i32>(0),
        )
        .map_err(|_| "El servicio de la propuesta no existe.".to_string())?
        != 0;
    Ok(format!(
        "service-unpaid:{period}:{service_id}:{}:{}:{status}:{}",
        paid.clone().unwrap_or_default(),
        expected,
        if active { "active" } else { "inactive" }
    ))
}

fn amount_variation_fingerprint(
    transaction: &rusqlite::Transaction<'_>,
    service_id: &str,
    period: &str,
) -> Result<String, String> {
    let (paid, expected, modality, active): (Option<String>, Option<String>, Option<String>, Option<i32>) = transaction
        .query_row(
            "SELECT o.paid_amount,o.expected_amount,s.modality,s.active FROM finance_service_occurrences o JOIN finance_services s ON s.id=o.service_id WHERE o.service_id=?1 AND o.period=?2",
            params![service_id, period],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or((None, None, None, None));
    Ok(format!(
        "amount-variation:{period}:{service_id}:{}:{}:{}:{}",
        paid.unwrap_or_default(),
        expected.unwrap_or_default(),
        modality.unwrap_or_default(),
        if active.unwrap_or_default() != 0 {
            "active"
        } else {
            "inactive"
        }
    ))
}

fn orphan_service_link_fingerprint(
    transaction: &rusqlite::Transaction<'_>,
    period: &str,
    ids: &[String],
) -> Result<String, String> {
    let mut entries = Vec::with_capacity(ids.len());
    for id in ids {
        let entry: (String, Option<String>, String, String, String, Option<String>, String) = transaction
            .query_row(
                "SELECT id,service_id,amount,currency,effective_date,category_id,status FROM finance_transactions WHERE id=?1 AND deleted_at IS NULL",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
            )
            .map_err(|_| "Uno de los gastos de la propuesta ya no existe o fue eliminado.".to_string())?;
        if entry.1.is_none() {
            return Err(
                "La propuesta quedó obsoleta porque uno de los gastos ya fue desvinculado.".into(),
            );
        }
        entries.push(format!(
            "{}:{}:{}:{}:{}:{}:{}",
            entry.0,
            entry.1.unwrap_or_default(),
            entry.2,
            entry.3,
            entry.4,
            entry.5.unwrap_or_default(),
            entry.6
        ));
    }
    entries.sort();
    Ok(format!(
        "orphan-service-link:{period}:{}",
        entries.join("|")
    ))
}

pub fn finance_list_services(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceService>> {
    let connection = validate_context(&context, &app)?;
    let result = connection
        .prepare("SELECT id,name,category_id,currency,expected_amount,due_day,default_account_id,provider,modality,active,created_at,updated_at FROM finance_services ORDER BY active DESC, name")
        .map_err(|error| error.to_string())?
        .query_map([], service_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into());
    result
}

pub fn finance_save_service(
    app: crate::host::AppHandle,
    payload: SaveFinanceServicePayload,
) -> FinanceCommandResult<FinanceService> {
    let connection = validate_context(&payload.context, &app)?;
    validate_service(&payload.service, &connection)?;
    let timestamp = now();
    let provider = payload
        .service
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_name = normalize_service_text(&payload.service.name);
    let normalized_provider = provider.map(normalize_service_text);
    connection.execute(
        "INSERT INTO finance_services(id,name,normalized_name,category_id,currency,expected_amount,due_day,default_account_id,provider,normalized_provider,modality,active,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,category_id=excluded.category_id,currency=excluded.currency,expected_amount=excluded.expected_amount,due_day=excluded.due_day,default_account_id=excluded.default_account_id,provider=excluded.provider,normalized_provider=excluded.normalized_provider,modality=excluded.modality,active=excluded.active,updated_at=excluded.updated_at",
        params![payload.service.id, payload.service.name.trim(), normalized_name, payload.service.category_id, payload.service.currency, payload.service.expected_amount, payload.service.due_day, payload.service.default_account_id, provider, normalized_provider, payload.service.modality, i32::from(payload.service.active), timestamp],
    ).map_err(|error| if error.to_string().contains("UNIQUE") { FinanceCommandError::from("Ya existe un servicio con ese nombre y proveedor.") } else { error.to_string().into() })?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    let connection = validate_context(&payload.context, &app)?;
    let persisted = connection.query_row("SELECT id,name,category_id,currency,expected_amount,due_day,default_account_id,provider,modality,active,created_at,updated_at FROM finance_services WHERE id=?1", [&payload.service.id], service_from_row).map_err(|error| error.to_string())?;
    Ok(persisted)
}

pub fn finance_set_service_active(
    app: crate::host::AppHandle,
    payload: SetFinanceServiceActivePayload,
) -> FinanceCommandResult<()> {
    let connection = validate_context(&payload.context, &app)?;
    let changed = connection
        .execute(
            "UPDATE finance_services SET active=?1,updated_at=?2 WHERE id=?3",
            params![i32::from(payload.active), now(), payload.id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("El servicio no existe.".into());
    }
    drop(connection);
    sync_context(&payload.context, &app).map_err(FinanceCommandError::from)
}

pub fn finance_list_service_occurrences(
    app: crate::host::AppHandle,
    context: FinanceContext,
    period: String,
) -> FinanceCommandResult<Vec<FinanceServiceOccurrence>> {
    if !valid_service_period(&period) {
        return Err("El período debe tener formato YYYY-MM.".into());
    }
    let connection = validate_context(&context, &app)?;
    let result = connection.prepare("SELECT id,service_id,period,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,created_at,updated_at FROM finance_service_occurrences WHERE period=?1 ORDER BY service_id").map_err(|error| error.to_string())?
        .query_map([period], occurrence_from_row).map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string().into());
    result
}

pub fn finance_list_all_service_occurrences(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceServiceOccurrence>> {
    let connection = validate_context(&context, &app)?;
    let result = connection
        .prepare("SELECT id,service_id,period,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,created_at,updated_at FROM finance_service_occurrences ORDER BY period DESC,service_id")
        .map_err(|error| error.to_string())?
        .query_map([], occurrence_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into());
    result
}

pub fn finance_save_service_occurrence(
    app: crate::host::AppHandle,
    payload: SaveFinanceServiceOccurrencePayload,
) -> FinanceCommandResult<FinanceServiceOccurrence> {
    let occurrence = &payload.occurrence;
    if occurrence.id.trim().is_empty()
        || !valid_service_period(&occurrence.period)
        || !valid_amount(&occurrence.expected_amount)
        || occurrence
            .paid_amount
            .as_deref()
            .map(|value| !valid_amount(value))
            .unwrap_or(false)
        || occurrence
            .effective_date
            .as_deref()
            .map(|value| !valid_iso_date(value))
            .unwrap_or(false)
        || !matches!(
            occurrence.status.as_str(),
            "pending" | "current" | "accepted" | "rejected" | "discarded" | "failed" | "outdated"
        )
        || occurrence.source.trim().is_empty()
    {
        return Err("La ocurrencia requiere período, importe y estado válidos.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let service_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_services WHERE id=?1",
            [&occurrence.service_id],
            |row| row.get(0),
        )
        .map_err(|_| "El servicio no existe.".to_string())?;
    if let Some(transaction_id) = occurrence.transaction_id.as_deref() {
        let (transaction_currency, transaction_type): (String, String) = connection
            .query_row("SELECT currency,transaction_type FROM finance_transactions WHERE id=?1 AND deleted_at IS NULL", [transaction_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|_| "La transacción asociada no existe.".to_string())?;
        if transaction_currency != service_currency {
            return Err("La transacción asociada debe usar la moneda del servicio.".into());
        }
        if transaction_type != "expense" {
            return Err("La ocurrencia solo puede vincularse a un gasto.".into());
        }
        let transaction_amount: String = connection
            .query_row(
                "SELECT amount FROM finance_transactions WHERE id=?1 AND deleted_at IS NULL",
                [transaction_id],
                |row| row.get(0),
            )
            .map_err(|_| "La transacción asociada no existe.".to_string())?;
        if occurrence
            .paid_amount
            .as_deref()
            .and_then(|value| parse_cents(value).ok())
            != parse_cents(&transaction_amount).ok()
        {
            return Err("El importe pagado debe coincidir con el gasto asociado.".into());
        }
        let already_linked: Option<String> = connection
            .query_row(
                "SELECT service_id FROM finance_service_occurrences WHERE transaction_id=?1 AND NOT (service_id=?2 AND period=?3)",
                params![transaction_id, occurrence.service_id, occurrence.period],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if already_linked.is_some() {
            return Err("El gasto ya está vinculado a otra ocurrencia de servicio.".into());
        }
    }
    if let Some(artifact_id) = occurrence.artifact_id.as_deref() {
        let artifact_exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM finance_source_artifacts WHERE id=?1)",
                [artifact_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !artifact_exists {
            return Err("El artefacto asociado no existe.".into());
        }
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let old: Option<FinanceServiceOccurrence> = transaction.query_row("SELECT id,service_id,period,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,created_at,updated_at FROM finance_service_occurrences WHERE service_id=?1 AND period=?2", params![occurrence.service_id, occurrence.period], occurrence_from_row).optional().map_err(|error| error.to_string())?;
    if let Some(persisted) = old.as_ref().filter(|previous| {
        let same_expected_amount = parse_cents(&previous.expected_amount).ok()
            == parse_cents(&occurrence.expected_amount).ok();
        let same_paid_amount = match (&previous.paid_amount, &occurrence.paid_amount) {
            (Some(previous), Some(current)) => parse_cents(previous) == parse_cents(current),
            (None, None) => true,
            _ => false,
        };
        same_expected_amount
            && same_paid_amount
            && previous.effective_date == occurrence.effective_date
            && previous.status == occurrence.status
            && previous.transaction_id == occurrence.transaction_id
            && previous.artifact_id == occurrence.artifact_id
            && previous.source_reference == occurrence.source_reference
            && previous.raw_source == occurrence.raw_source
    }) {
        let persisted = persisted.clone();
        if let Some(transaction_id) = occurrence.transaction_id.as_deref() {
            transaction
                .execute(
                    "UPDATE finance_transactions SET service_id=?1 WHERE id=?2 AND deleted_at IS NULL",
                    params![occurrence.service_id, transaction_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE finance_purchases SET service_id=?1,updated_at=?2 WHERE transaction_id=?3",
                    params![occurrence.service_id, now(), transaction_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        drop(connection);
        sync_context(&payload.context, &app)?;
        return Ok(persisted);
    }
    if let Some(transaction_id) = occurrence.transaction_id.as_deref() {
        if let Some(previous) = old
            .as_ref()
            .and_then(|value| value.transaction_id.as_deref())
        {
            if previous != transaction_id {
                transaction.execute("UPDATE finance_transactions SET service_id=NULL WHERE id=?1 AND service_id=?2", params![previous, occurrence.service_id]).map_err(|error| error.to_string())?;
                transaction.execute("UPDATE finance_purchases SET service_id=NULL,updated_at=?1 WHERE transaction_id=?2 AND service_id=?3", params![now(), previous, occurrence.service_id]).map_err(|error| error.to_string())?;
            }
        }
        let changed = transaction
            .execute(
                "UPDATE finance_transactions SET service_id=?1 WHERE id=?2 AND deleted_at IS NULL",
                params![occurrence.service_id, transaction_id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("La transacción asociada no existe.".into());
        }
        transaction
            .execute(
                "UPDATE finance_purchases SET service_id=?1,updated_at=?2 WHERE transaction_id=?3",
                params![occurrence.service_id, now(), transaction_id],
            )
            .map_err(|error| error.to_string())?;
    } else if let Some(previous) = old
        .as_ref()
        .and_then(|value| value.transaction_id.as_deref())
    {
        transaction
            .execute(
                "UPDATE finance_transactions SET service_id=NULL WHERE id=?1 AND service_id=?2",
                params![previous, occurrence.service_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.execute("UPDATE finance_purchases SET service_id=NULL,updated_at=?1 WHERE transaction_id=?2 AND service_id=?3", params![now(), previous, occurrence.service_id]).map_err(|error| error.to_string())?;
    }
    let occurrence_id = old
        .as_ref()
        .map(|previous| previous.id.clone())
        .unwrap_or_else(|| occurrence.id.clone());
    let timestamp = now();
    if let Some(previous) = old {
        let version: i64 = transaction.query_row("SELECT COALESCE(MAX(version_number),0)+1 FROM finance_service_occurrence_versions WHERE occurrence_id=?1", [&previous.id], |row| row.get(0)).map_err(|error| error.to_string())?;
        transaction.execute("INSERT INTO finance_service_occurrence_versions(id,occurrence_id,version_number,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)", params![new_id(), previous.id, version, previous.expected_amount, previous.paid_amount, previous.effective_date, previous.status, previous.transaction_id, previous.artifact_id, previous.source_reference, previous.raw_source, previous.actor_library_user_id, previous.source, payload.reason, timestamp]).map_err(|error| error.to_string())?;
    }
    transaction.execute("INSERT INTO finance_service_occurrences(id,service_id,period,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,COALESCE((SELECT created_at FROM finance_service_occurrences WHERE service_id=?2 AND period=?3),?15),?15) ON CONFLICT(service_id,period) DO UPDATE SET expected_amount=excluded.expected_amount,paid_amount=excluded.paid_amount,effective_date=excluded.effective_date,status=excluded.status,transaction_id=excluded.transaction_id,artifact_id=excluded.artifact_id,source_reference=excluded.source_reference,raw_source=excluded.raw_source,actor_library_user_id=excluded.actor_library_user_id,source=excluded.source,updated_at=excluded.updated_at", params![occurrence_id, occurrence.service_id, occurrence.period, occurrence.expected_amount, occurrence.paid_amount, occurrence.effective_date, occurrence.status, occurrence.transaction_id, occurrence.artifact_id, occurrence.source_reference, occurrence.raw_source, payload.context.actor_library_user_id, payload.context.source, timestamp]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    sync_context(&payload.context, &app)?;
    let persisted =
        transaction_query_occurrence(&connection, &occurrence.service_id, &occurrence.period)?;
    drop(connection);
    Ok(persisted)
}

pub fn finance_list_service_occurrence_versions(
    app: crate::host::AppHandle,
    context: FinanceContext,
    occurrence_id: String,
) -> FinanceCommandResult<Vec<FinanceServiceOccurrenceVersion>> {
    let connection = validate_context(&context, &app)?;
    let result = connection.prepare("SELECT id,occurrence_id,version_number,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,reason,created_at FROM finance_service_occurrence_versions WHERE occurrence_id=?1 ORDER BY version_number DESC").map_err(|error| error.to_string())?
        .query_map([occurrence_id], |row| Ok(FinanceServiceOccurrenceVersion { id: row.get(0)?, occurrence_id: row.get(1)?, version_number: row.get(2)?, expected_amount: row.get(3)?, paid_amount: row.get(4)?, effective_date: row.get(5)?, status: row.get(6)?, transaction_id: row.get(7)?, artifact_id: row.get(8)?, source_reference: row.get(9)?, raw_source: row.get(10)?, actor_library_user_id: row.get(11)?, source: row.get(12)?, reason: row.get(13)?, created_at: row.get(14)? })).map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string().into());
    result
}

pub fn finance_list_all_service_occurrence_versions(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceServiceOccurrenceVersion>> {
    let connection = validate_context(&context, &app)?;
    let result = connection
        .prepare("SELECT id,occurrence_id,version_number,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,reason,created_at FROM finance_service_occurrence_versions ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?
        .query_map([], |row| Ok(FinanceServiceOccurrenceVersion { id: row.get(0)?, occurrence_id: row.get(1)?, version_number: row.get(2)?, expected_amount: row.get(3)?, paid_amount: row.get(4)?, effective_date: row.get(5)?, status: row.get(6)?, transaction_id: row.get(7)?, artifact_id: row.get(8)?, source_reference: row.get(9)?, raw_source: row.get(10)?, actor_library_user_id: row.get(11)?, source: row.get(12)?, reason: row.get(13)?, created_at: row.get(14)? }))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into());
    result
}

pub fn finance_save_service_invoice(
    app: crate::host::AppHandle,
    payload: SaveFinanceServiceInvoicePayload,
) -> FinanceCommandResult<FinanceServiceInvoice> {
    let invoice = &payload.invoice;
    if invoice.id.trim().is_empty()
        || !valid_service_period(&invoice.period)
        || !valid_amount(&invoice.amount)
        || !matches!(invoice.currency.as_str(), "ARS" | "USD")
        || !matches!(
            invoice.validation_status.as_str(),
            "pending" | "valid" | "invalid" | "duplicate"
        )
        || invoice
            .service_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        || invoice
            .due_date
            .as_deref()
            .map(|value| !valid_iso_date(value))
            .unwrap_or(false)
        || invoice
            .provider
            .as_deref()
            .map(|value| !valid_bounded_text(value, 160, false))
            .unwrap_or(false)
        || invoice
            .source_reference
            .as_deref()
            .map(|value| !valid_bounded_text(value, 512, false))
            .unwrap_or(false)
        || invoice
            .raw_extraction
            .as_deref()
            .map(|value| !valid_bounded_text(value, 20_000, false))
            .unwrap_or(false)
    {
        return Err(
            "La factura requiere servicio, período, importe, moneda y datos válidos.".into(),
        );
    }
    let connection = validate_context(&payload.context, &app)?;
    let Some(service_id) = invoice.service_id.as_deref() else {
        return Err("La factura requiere un servicio válido.".into());
    };
    let (service_currency, service_provider): (String, Option<String>) = connection
        .query_row(
            "SELECT currency,provider FROM finance_services WHERE id=?1",
            [service_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "El servicio de la factura no existe.".to_string())?;
    if service_currency != invoice.currency {
        return Err("La moneda de la factura no coincide con el servicio.".into());
    }
    if let (Some(invoice_provider), Some(service_provider)) =
        (invoice.provider.as_deref(), service_provider.as_deref())
    {
        if normalize_service_text(invoice_provider) != normalize_service_text(service_provider) {
            return Err("El proveedor de la factura no coincide con el servicio.".into());
        }
    }
    if let Some(transaction_id) = invoice.transaction_id.as_deref() {
        let (transaction_currency, transaction_type, transaction_amount, linked_service): (String, String, String, Option<String>) = connection.query_row("SELECT currency,transaction_type,amount,service_id FROM finance_transactions WHERE id=?1 AND deleted_at IS NULL", [transaction_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))).map_err(|_| "La transacción asociada a la factura no existe.".to_string())?;
        if transaction_currency != invoice.currency {
            return Err("La moneda de la factura no coincide con la transacción.".into());
        }
        if transaction_type != "expense" {
            return Err("La factura solo puede vincularse a un gasto.".into());
        }
        if transaction_amount != invoice.amount {
            return Err(
                "El importe de la factura debe coincidir exactamente con el gasto asociado.".into(),
            );
        }
        if linked_service
            .as_deref()
            .is_some_and(|linked| linked != service_id)
        {
            return Err("El gasto ya está vinculado a otro servicio.".into());
        }
    }
    if let Some(artifact_id) = invoice.artifact_id.as_deref() {
        let artifact_type: Option<String> = connection
            .query_row(
                "SELECT source_type FROM finance_source_artifacts WHERE id=?1",
                [artifact_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if artifact_type.as_deref() != Some("service_invoice") {
            return Err("El comprobante debe ser un artefacto de factura de servicio.".into());
        }
    }
    let mut database_transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let old_transaction: Option<String> = database_transaction
        .query_row(
            "SELECT transaction_id FROM finance_service_invoices WHERE id=?1",
            [&invoice.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    let timestamp = now();
    if let Some(old_transaction) = old_transaction.as_deref() {
        if invoice.transaction_id.as_deref() != Some(old_transaction) {
            database_transaction
                .execute(
                    "UPDATE finance_transactions SET service_id=NULL WHERE id=?1 AND service_id=?2",
                    params![old_transaction, service_id],
                )
                .map_err(|error| error.to_string())?;
            database_transaction.execute("UPDATE finance_purchases SET service_id=NULL,updated_at=?1 WHERE transaction_id=?2 AND service_id=?3", params![timestamp, old_transaction, service_id]).map_err(|error| error.to_string())?;
        }
    }
    database_transaction.execute("INSERT INTO finance_service_invoices(id,service_id,period,due_date,provider,amount,currency,transaction_id,artifact_id,validation_status,source_reference,raw_extraction,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13) ON CONFLICT(id) DO UPDATE SET service_id=excluded.service_id,period=excluded.period,due_date=excluded.due_date,provider=excluded.provider,amount=excluded.amount,currency=excluded.currency,transaction_id=excluded.transaction_id,artifact_id=excluded.artifact_id,validation_status=excluded.validation_status,source_reference=excluded.source_reference,raw_extraction=excluded.raw_extraction,updated_at=excluded.updated_at", params![invoice.id, service_id, invoice.period, invoice.due_date, invoice.provider, invoice.amount, invoice.currency, invoice.transaction_id, invoice.artifact_id, invoice.validation_status, invoice.source_reference, invoice.raw_extraction, timestamp]).map_err(|error| if error.to_string().contains("UNIQUE") { FinanceCommandError::from("El comprobante o la factura ya fue registrado.") } else { error.to_string().into() })?;
    if let Some(transaction_id) = invoice.transaction_id.as_deref() {
        database_transaction
            .execute(
                "UPDATE finance_transactions SET service_id=?1 WHERE id=?2 AND deleted_at IS NULL",
                params![service_id, transaction_id],
            )
            .map_err(|error| error.to_string())?;
        database_transaction
            .execute(
                "UPDATE finance_purchases SET service_id=?1,updated_at=?2 WHERE transaction_id=?3",
                params![service_id, timestamp, transaction_id],
            )
            .map_err(|error| error.to_string())?;
    }
    database_transaction
        .commit()
        .map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    let connection = validate_context(&payload.context, &app)?;
    let persisted = connection.query_row("SELECT id,service_id,period,due_date,provider,amount,currency,transaction_id,artifact_id,validation_status,source_reference,raw_extraction,created_at,updated_at FROM finance_service_invoices WHERE id=?1", [&invoice.id], |row| Ok(FinanceServiceInvoice { id: row.get(0)?, service_id: row.get(1)?, period: row.get(2)?, due_date: row.get(3)?, provider: row.get(4)?, amount: row.get(5)?, currency: row.get(6)?, transaction_id: row.get(7)?, artifact_id: row.get(8)?, validation_status: row.get(9)?, source_reference: row.get(10)?, raw_extraction: row.get(11)?, created_at: row.get(12)?, updated_at: row.get(13)? })).map_err(|error| error.to_string())?;
    Ok(persisted)
}

pub fn finance_list_service_invoices(
    app: crate::host::AppHandle,
    context: FinanceContext,
    period: Option<String>,
) -> FinanceCommandResult<Vec<FinanceServiceInvoice>> {
    if let Some(value) = period.as_deref() {
        if !valid_service_period(value) {
            return Err("El período debe tener formato YYYY-MM.".into());
        }
    }
    let connection = validate_context(&context, &app)?;
    let mut statement = connection.prepare("SELECT id,service_id,period,due_date,provider,amount,currency,transaction_id,artifact_id,validation_status,source_reference,raw_extraction,created_at,updated_at FROM finance_service_invoices WHERE (?1 IS NULL OR period=?1) ORDER BY period DESC,created_at DESC LIMIT 500").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![period], |row| {
            Ok(FinanceServiceInvoice {
                id: row.get(0)?,
                service_id: row.get(1)?,
                period: row.get(2)?,
                due_date: row.get(3)?,
                provider: row.get(4)?,
                amount: row.get(5)?,
                currency: row.get(6)?,
                transaction_id: row.get(7)?,
                artifact_id: row.get(8)?,
                validation_status: row.get(9)?,
                source_reference: row.get(10)?,
                raw_extraction: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into())
}

pub fn finance_save_audit_run(
    app: crate::host::AppHandle,
    payload: SaveFinanceAuditRunPayload,
) -> FinanceCommandResult<FinanceAuditRun> {
    let run = &payload.run;
    if run.id.trim().is_empty()
        || run.trigger_fingerprint.trim().is_empty()
        || !valid_service_period(&run.period)
        || !matches!(
            run.status.as_str(),
            "pending" | "running" | "completed" | "failed" | "outdated"
        )
        || !valid_finance_source(&run.source)
    {
        return Err("La auditoría requiere período, huella y estado válidos.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    connection.execute("INSERT INTO finance_audit_runs(id,period,trigger_fingerprint,status,actor_library_user_id,source,reason,error_message,created_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(trigger_fingerprint) DO UPDATE SET status=excluded.status,reason=excluded.reason,error_message=excluded.error_message,completed_at=excluded.completed_at", params![run.id, run.period, run.trigger_fingerprint, run.status, payload.context.actor_library_user_id, payload.context.source, run.reason, run.error_message, timestamp, run.completed_at]).map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    let connection = validate_context(&payload.context, &app)?;
    let persisted = connection.query_row("SELECT id,period,trigger_fingerprint,status,actor_library_user_id,source,reason,error_message,created_at,completed_at FROM finance_audit_runs WHERE trigger_fingerprint=?1", [&run.trigger_fingerprint], audit_run_from_row).map_err(|error| error.to_string())?;
    Ok(persisted)
}

pub fn finance_list_audit_runs(
    app: crate::host::AppHandle,
    context: FinanceContext,
    period: Option<String>,
    status: Option<String>,
) -> FinanceCommandResult<Vec<FinanceAuditRun>> {
    if let Some(value) = period.as_deref() {
        if !valid_service_period(value) {
            return Err("El período debe tener formato YYYY-MM.".into());
        }
    }
    let connection = validate_context(&context, &app)?;
    let mut statement = connection.prepare("SELECT id,period,trigger_fingerprint,status,actor_library_user_id,source,reason,error_message,created_at,completed_at FROM finance_audit_runs WHERE (?1 IS NULL OR period=?1) AND (?2 IS NULL OR status=?2) ORDER BY created_at DESC LIMIT 200").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![period, status], |row| {
            Ok(FinanceAuditRun {
                id: row.get(0)?,
                period: row.get(1)?,
                trigger_fingerprint: row.get(2)?,
                status: row.get(3)?,
                actor_library_user_id: row.get(4)?,
                source: row.get(5)?,
                reason: row.get(6)?,
                error_message: row.get(7)?,
                created_at: row.get(8)?,
                completed_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into())
}

fn audit_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FinanceAuditRun> {
    Ok(FinanceAuditRun {
        id: row.get(0)?,
        period: row.get(1)?,
        trigger_fingerprint: row.get(2)?,
        status: row.get(3)?,
        actor_library_user_id: row.get(4)?,
        source: row.get(5)?,
        reason: row.get(6)?,
        error_message: row.get(7)?,
        created_at: row.get(8)?,
        completed_at: row.get(9)?,
    })
}

fn relation_repair_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FinanceRelationRepair> {
    Ok(FinanceRelationRepair {
        id: row.get(0)?,
        operation_id: row.get(1)?,
        relation_type: row.get(2)?,
        relation_id: row.get(3)?,
        previous_transaction_id: row.get(4)?,
        new_transaction_id: row.get(5)?,
        actor_library_user_id: row.get(6)?,
        source: row.get(7)?,
        reason: row.get(8)?,
        created_at: row.get(9)?,
    })
}

pub fn finance_repair_relation(
    app: crate::host::AppHandle,
    payload: RepairFinanceRelationPayload,
) -> FinanceCommandResult<FinanceRelationRepair> {
    let relation_type = payload.relation_type.as_str();
    if !matches!(
        relation_type,
        "purchase-transaction" | "statement-item-transaction" | "savings-movement-transaction"
    ) || payload.operation_id.trim().is_empty()
        || payload.operation_id.len() > 160
        || payload.relation_id.trim().is_empty()
        || payload
            .new_transaction_id
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        || payload
            .reason
            .as_deref()
            .is_some_and(|value| value.chars().count() > 500)
        || !valid_finance_source(&payload.context.source)
    {
        return Err("La reparación requiere una relación, operación y origen válidos.".into());
    }
    if relation_type == "purchase-transaction" && payload.new_transaction_id.is_none() {
        return Err("Un ticket no puede quedar sin movimiento; elegí el gasto correcto.".into());
    }

    let connection = validate_context(&payload.context, &app)?;
    if let Some(existing) = connection
        .query_row(
            "SELECT id,operation_id,relation_type,relation_id,previous_transaction_id,new_transaction_id,actor_library_user_id,source,reason,created_at FROM finance_relation_repairs WHERE operation_id=?1",
            [&payload.operation_id],
            relation_repair_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())?
    {
        if existing.relation_type != payload.relation_type
            || existing.relation_id != payload.relation_id
            || existing.new_transaction_id != payload.new_transaction_id
        {
            return Err("El operationId ya fue usado para otra reparación.".into());
        }
        return Ok(existing);
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let (current_transaction_id, amount, currency, movement_kind, source) = match relation_type {
        "purchase-transaction" => transaction
            .query_row(
                "SELECT transaction_id,total_amount,currency,'purchase','ticket' FROM finance_purchases WHERE id=?1",
                [&payload.relation_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "El ticket no existe.".to_string())?,
        "statement-item-transaction" => transaction
            .query_row(
                "SELECT transaction_id,amount,currency,item_type,'statement' FROM finance_credit_card_statement_items WHERE id=?1",
                [&payload.relation_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "La línea del resumen no existe.".to_string())?,
        "savings-movement-transaction" => transaction
            .query_row(
                "SELECT linked_transaction_id,amount,currency,movement_type,source FROM finance_savings_movements WHERE id=?1",
                [&payload.relation_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "El movimiento de ahorro no existe.".to_string())?,
        _ => unreachable!(),
    };
    if payload.expected_transaction_id != current_transaction_id {
        return Err("La relación cambió desde la revisión; volvé a cargar la auditoría.".into());
    }
    if let Some(new_transaction_id) = payload.new_transaction_id.as_deref() {
        let (transaction_type, transaction_amount, transaction_currency, status, _transaction_source): (String, String, String, String, String) = transaction
            .query_row(
                "SELECT transaction_type,amount,currency,status,source FROM finance_transactions WHERE id=?1 AND deleted_at IS NULL",
                [new_transaction_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .map_err(|_| "El movimiento elegido no existe o fue eliminado.".to_string())?;
        if !matches!(status.as_str(), "confirmed" | "corrected") {
            return Err("Solo se pueden asociar movimientos confirmados o corregidos.".into());
        }
        if relation_type == "statement-item-transaction"
            && !matches!(
                movement_kind.as_str(),
                "purchase" | "fee" | "interest" | "tax"
            )
        {
            return Err("Los pagos y créditos del resumen no son gastos asociables.".into());
        }
        let savings_exchange =
            relation_type == "savings-movement-transaction" && source == "savings_exchange";
        if !savings_exchange && (transaction_amount != amount || transaction_currency != currency) {
            return Err(
                "El importe y la moneda del movimiento no coinciden con la evidencia.".into(),
            );
        }
        if relation_type == "savings-movement-transaction" && !savings_exchange {
            let expected_type = if movement_kind == "withdrawal" {
                "expense"
            } else {
                "expense"
            };
            if transaction_type != expected_type {
                return Err("El movimiento de ahorro requiere un gasto compatible.".into());
            }
        } else if relation_type != "savings-movement-transaction" && transaction_type != "expense" {
            return Err("La relación financiera requiere un movimiento de gasto.".into());
        }
        let (table, column) = match relation_type {
            "purchase-transaction" => ("finance_purchases", "transaction_id"),
            "statement-item-transaction" => {
                ("finance_credit_card_statement_items", "transaction_id")
            }
            _ => ("finance_savings_movements", "linked_transaction_id"),
        };
        let query = format!("SELECT COUNT(*) FROM {table} WHERE {column}=?1 AND id<>?2");
        let already_linked: i64 = transaction
            .query_row(
                &query,
                params![new_transaction_id, &payload.relation_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if already_linked > 0 {
            return Err("El movimiento ya está asociado a otra evidencia del mismo tipo.".into());
        }
    }
    let update = match relation_type {
        "purchase-transaction" => "UPDATE finance_purchases SET transaction_id=?1,updated_at=?2 WHERE id=?3",
        "statement-item-transaction" => "UPDATE finance_credit_card_statement_items SET transaction_id=?1 WHERE id=?2",
        _ => "UPDATE finance_savings_movements SET linked_transaction_id=?1,updated_at=?2 WHERE id=?3",
    };
    if relation_type == "statement-item-transaction" {
        transaction
            .execute(
                update,
                params![payload.new_transaction_id, &payload.relation_id],
            )
            .map_err(|error| error.to_string())?;
    } else {
        transaction
            .execute(
                update,
                params![payload.new_transaction_id, now(), &payload.relation_id],
            )
            .map_err(|error| error.to_string())?;
    }
    let repair = FinanceRelationRepair {
        id: Uuid::new_v4().to_string(),
        operation_id: payload.operation_id,
        relation_type: payload.relation_type,
        relation_id: payload.relation_id,
        previous_transaction_id: current_transaction_id,
        new_transaction_id: payload.new_transaction_id,
        actor_library_user_id: Some(payload.context.actor_library_user_id.clone()),
        source: payload.context.source.clone(),
        reason: payload.reason,
        created_at: Some(now()),
    };
    transaction
        .execute(
            "INSERT INTO finance_relation_repairs(id,operation_id,relation_type,relation_id,previous_transaction_id,new_transaction_id,actor_library_user_id,source,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![repair.id, repair.operation_id, repair.relation_type, repair.relation_id, repair.previous_transaction_id, repair.new_transaction_id, repair.actor_library_user_id, repair.source, repair.reason, repair.created_at],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(repair)
}

pub fn finance_list_relation_repairs(
    app: crate::host::AppHandle,
    context: FinanceContext,
    relation_type: Option<String>,
    relation_id: Option<String>,
) -> FinanceCommandResult<Vec<FinanceRelationRepair>> {
    let connection = validate_context(&context, &app)?;
    let mut statement = connection
        .prepare("SELECT id,operation_id,relation_type,relation_id,previous_transaction_id,new_transaction_id,actor_library_user_id,source,reason,created_at FROM finance_relation_repairs WHERE (?1 IS NULL OR relation_type=?1) AND (?2 IS NULL OR relation_id=?2) ORDER BY created_at DESC LIMIT 500")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![relation_type, relation_id],
            relation_repair_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into())
}

fn audit_proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FinanceAuditProposal> {
    Ok(FinanceAuditProposal {
        id: row.get(0)?,
        audit_run_id: row.get(1)?,
        proposal_type: row.get(2)?,
        status: row.get(3)?,
        rule_key: row.get(4)?,
        data_fingerprint: row.get(5)?,
        service_id: row.get(6)?,
        period: row.get(7)?,
        reason: row.get(8)?,
        current_data: row.get(9)?,
        suggested_change: row.get(10)?,
        evidence: row.get(11)?,
        actor_library_user_id: row.get(12)?,
        source: row.get(13)?,
        created_at: row.get(14)?,
        decided_at: row.get(15)?,
    })
}

fn load_audit_result(connection: &Connection, run_id: &str) -> Result<FinanceAuditResult, String> {
    let run = connection.query_row("SELECT id,period,trigger_fingerprint,status,actor_library_user_id,source,reason,error_message,created_at,completed_at FROM finance_audit_runs WHERE id=?1", [run_id], audit_run_from_row).map_err(|error| error.to_string())?;
    let mut statement = connection.prepare("SELECT id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at FROM finance_audit_proposals WHERE audit_run_id=?1 ORDER BY created_at,id").map_err(|error| error.to_string())?;
    let proposals = statement
        .query_map([run_id], audit_proposal_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(FinanceAuditResult { run, proposals })
}

fn load_card_reconciliation_context(
    transaction: &rusqlite::Transaction<'_>,
) -> Result<(Vec<ReconciliationService>, Vec<ReconciliationOccurrence>), String> {
    let services = transaction
        .prepare("SELECT id,name,provider,currency FROM finance_services ORDER BY id")
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok(ReconciliationService {
                id: row.get(0)?,
                name: row.get(1)?,
                provider: row.get(2)?,
                currency: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let occurrences = transaction
        .prepare(
            "SELECT id,service_id,period,expected_amount,paid_amount,effective_date,status,
                    transaction_id,artifact_id,source_reference,raw_source,updated_at
             FROM finance_service_occurrences",
        )
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok(ReconciliationOccurrence {
                id: row.get(0)?,
                service_id: row.get(1)?,
                period: row.get(2)?,
                paid_amount: row.get(4)?,
                transaction_id: row.get(7)?,
                snapshot: format!(
                    "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    row.get::<_, String>(11)?
                ),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok((services, occurrences))
}

fn load_card_reconciliation_input(
    transaction: &rusqlite::Transaction<'_>,
    statement_id: &str,
    statement_period: &str,
    statement_snapshot: &str,
    services: &[ReconciliationService],
    occurrences: &[ReconciliationOccurrence],
) -> Result<ReconciliationInput, String> {
    let mut statement = transaction
        .prepare(
            "SELECT i.id,i.transaction_id,i.purchase_date,i.description,i.amount,i.currency,
                    i.item_type,t.transaction_type,t.status,t.amount,t.currency,t.effective_date,
                    t.service_id,t.operation_fingerprint,t.updated_at,
                    CASE WHEN s.validation_status IN ('confirmed','corrected')
                              AND t.transaction_type='expense'
                              AND t.status IN ('confirmed','corrected')
                              AND t.amount=i.amount AND t.currency=i.currency
                         THEN 1 ELSE 0 END
             FROM finance_credit_card_statement_items i
             JOIN finance_credit_card_statements s ON s.id=i.statement_id
             LEFT JOIN finance_transactions t ON t.id=i.transaction_id AND t.deleted_at IS NULL
             WHERE i.statement_id=?1 ORDER BY i.purchase_date,i.id",
        )
        .map_err(|error| error.to_string())?;
    let lines = statement
        .query_map([statement_id], |row| {
            Ok(ReconciliationLine {
                id: row.get(0)?,
                transaction_id: row.get(1)?,
                purchase_date: row.get(2)?,
                description: row.get(3)?,
                amount: row.get(4)?,
                currency: row.get(5)?,
                item_type: row.get(6)?,
                confirmed: row.get::<_, i32>(15)? != 0,
                transaction_snapshot: format!(
                    "{}:{}:{}:{}:{}:{}:{}:{}",
                    row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(14)?.unwrap_or_default()
                ),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(ReconciliationInput {
        statement_id: statement_id.to_string(),
        statement_period: statement_period.to_string(),
        statement_snapshot: statement_snapshot.to_string(),
        lines,
        services: services.to_vec(),
        occurrences: occurrences.to_vec(),
    })
}

fn execute_deterministic_audit(
    connection: &mut Connection,
    payload: &RunFinanceAuditPayload,
) -> Result<FinanceAuditResult, String> {
    let database_transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let timestamp = now();
    let existing_id: Option<String> = database_transaction
        .query_row(
            "SELECT id FROM finance_audit_runs WHERE trigger_fingerprint=?1",
            [&payload.trigger_fingerprint],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let run_id = existing_id.unwrap_or_else(new_id);
    database_transaction.execute("INSERT INTO finance_audit_runs(id,period,trigger_fingerprint,status,actor_library_user_id,source,reason,error_message,created_at,completed_at) VALUES(?1,?2,?3,'running',?4,?5,?6,NULL,?7,NULL) ON CONFLICT(trigger_fingerprint) DO UPDATE SET status='running',actor_library_user_id=excluded.actor_library_user_id,source=excluded.source,reason=excluded.reason,error_message=NULL,completed_at=NULL", params![run_id, payload.period, payload.trigger_fingerprint, payload.context.actor_library_user_id, payload.context.source, payload.reason, timestamp]).map_err(|error| error.to_string())?;
    database_transaction
        .execute(
            "DELETE FROM finance_audit_proposals WHERE audit_run_id=?1 AND status='pending'",
            [&run_id],
        )
        .map_err(|error| error.to_string())?;

    let mut services = database_transaction.prepare("SELECT id,name,provider,expected_amount,currency,modality FROM finance_services WHERE active=1 ORDER BY id").map_err(|error| error.to_string())?;
    let service_rows = services
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(services);
    let (reconciliation_services, reconciliation_occurrences) =
        load_card_reconciliation_context(&database_transaction)?;
    let mut covered_service_periods = BTreeSet::new();
    let mut blocked_service_periods = BTreeSet::new();
    let mut statement_query = database_transaction
        .prepare(
            "SELECT id,period,account_id,issuer,card_last_four,closing_date,due_date,currency,
                    previous_balance,payments_amount,credits_amount,purchases_amount,fees_amount,
                    interest_amount,taxes_amount,total_due,minimum_payment,validation_status,
                    source_artifact_id,updated_at
             FROM finance_credit_card_statements ORDER BY id",
        )
        .map_err(|error| error.to_string())?;
    let statement_rows = statement_query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                format!(
                    "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, String>(15)?,
                    row.get::<_, Option<String>>(16)?.unwrap_or_default(),
                    row.get::<_, String>(17)?,
                    row.get::<_, String>(18)?,
                    row.get::<_, String>(19)?,
                ),
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement_query);
    for (statement_id, statement_period, statement_snapshot) in statement_rows {
        let input = load_card_reconciliation_input(
            &database_transaction,
            &statement_id,
            &statement_period,
            &statement_snapshot,
            &reconciliation_services,
            &reconciliation_occurrences,
        )?;
        let reconciliation = reconcile_card_service_consumption(&input);
        for assignment in &reconciliation.assignments {
            if assignment.period == payload.period {
                covered_service_periods
                    .insert((assignment.service_id.clone(), assignment.period.clone()));
            }
        }
        if statement_period != payload.period {
            continue;
        }
        for group in &reconciliation.ambiguous_groups {
            if let Some(service_id) = group.service_id.as_deref() {
                blocked_service_periods.insert((service_id.to_string(), payload.period.clone()));
            }
        }
        let has_new_assignment = reconciliation
            .assignments
            .iter()
            .any(|assignment| assignment.assignment_status == "new");
        if !has_new_assignment && reconciliation.ambiguous_groups.is_empty() {
            continue;
        }
        let service_id = reconciliation
            .assignments
            .iter()
            .map(|assignment| assignment.service_id.clone())
            .chain(
                reconciliation
                    .ambiguous_groups
                    .iter()
                    .filter_map(|group| group.service_id.clone()),
            )
            .collect::<BTreeSet<_>>();
        let service_id = if service_id.len() == 1 {
            service_id.into_iter().next()
        } else {
            None
        };
        let fingerprint = reconciliation_fingerprint(&input, &reconciliation);
        let current_data = serde_json::json!({
            "statementId": statement_id.clone(),
            "statementPeriod": statement_period.clone(),
            "assignments": reconciliation.assignments.clone(),
            "ambiguousGroups": reconciliation.ambiguous_groups.clone(),
            "reasons": reconciliation.reasons.clone(),
        });
        let action = serde_json::json!({
            "operation": "reconcile_card_service_consumption",
            "parameters": {
                "statementId": input.statement_id,
                "assignments": reconciliation.assignments.clone(),
                "ambiguousGroups": reconciliation.ambiguous_groups.clone()
            },
            "description": "Reconciliar consumos purchase del resumen con sus ocurrencias mensuales, conservando importe y evidencia."
        });
        database_transaction
            .execute(
                "INSERT OR IGNORE INTO finance_audit_proposals(
                 id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,
                 reason,current_data,suggested_change,evidence,actor_library_user_id,source,
                 created_at,decided_at)
                 VALUES(?1,?2,'service-card-reconciliation','pending','service-card-reconciliation',
                        ?3,?4,?5,?6,?7,?8,?7,?9,?10,?11,NULL)",
                params![
                    new_id(),
                    run_id,
                    fingerprint,
                    service_id,
                    payload.period,
                    if reconciliation.ambiguous_groups.is_empty() {
                        "Existe un consumo inequívoco sin reconciliar con su ocurrencia mensual."
                    } else {
                        "La distribución de consumos del resumen es ambigua y requiere decisión."
                    },
                    current_data.to_string(),
                    action.to_string(),
                    payload.context.actor_library_user_id,
                    payload.context.source,
                    timestamp,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    for (service_id, service_name, _provider, service_expected, currency, modality) in service_rows
    {
        let occurrence: Option<(String, String, Option<String>, Option<String>, String)> = database_transaction.query_row("SELECT id,expected_amount,paid_amount,effective_date,status FROM finance_service_occurrences WHERE service_id=?1 AND period=?2", params![service_id, payload.period], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))).optional().map_err(|error| error.to_string())?;
        let paid = occurrence.as_ref().and_then(|value| value.2.as_deref());
        let covered_by_statement =
            covered_service_periods.contains(&(service_id.clone(), payload.period.clone()));
        let blocked_by_statement =
            blocked_service_periods.contains(&(service_id.clone(), payload.period.clone()));
        if paid.is_some() || covered_by_statement || blocked_by_statement {
            // A previous unpaid proposal is no longer actionable once a payment,
            // a reconciliation, or an explicit reconciliation ambiguity exists.
            // Leaving it pending would let the agent discard a payment after the
            // newer evidence was already imported.
            database_transaction
                .execute(
                    "UPDATE finance_audit_proposals
                     SET status='outdated',decided_at=?1
                     WHERE proposal_type='service-unpaid' AND service_id=?2
                       AND period=?3 AND status='pending'",
                    params![timestamp, service_id, payload.period],
                )
                .map_err(|error| error.to_string())?;
        }
        if paid.is_none() && !covered_by_statement && !blocked_by_statement {
            let current_data = serde_json::json!({"serviceId": service_id, "serviceName": service_name, "period": payload.period, "occurrenceId": occurrence.as_ref().map(|value| value.0.clone()), "expectedAmount": occurrence.as_ref().map(|value| value.1.clone()).unwrap_or(service_expected.clone()), "status": occurrence.as_ref().map(|value| value.4.clone()).unwrap_or_else(|| "missing".into())});
            let suggested = serde_json::json!({"operation":"mark_occurrence_discarded","parameters":{"serviceId":service_id,"period":payload.period},"description":"Marcar la ocurrencia sin pago como descartada, conservando el historial."});
            let fingerprint =
                service_unpaid_fingerprint(&database_transaction, &service_id, &payload.period)?;
            database_transaction.execute("INSERT OR IGNORE INTO finance_audit_proposals(id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at) VALUES(?1,?2,'service-unpaid','pending','active-service-without-payment',?3,?4,?5,?6,?7,?8,NULL,?9,?10,?11,NULL)", params![new_id(), run_id, fingerprint, service_id, payload.period, format!("El servicio activo {service_name} no tiene un pago registrado."), current_data.to_string(), suggested.to_string(), payload.context.actor_library_user_id, payload.context.source, timestamp]).map_err(|error| error.to_string())?;
        } else if let Some(paid) = paid.filter(|_| modality == "fixed") {
            let expected = occurrence
                .as_ref()
                .map(|value| value.1.as_str())
                .unwrap_or(service_expected.as_str());
            let expected_cents = parse_cents(expected)
                .map_err(|_| "El importe esperado de una ocurrencia no es válido.".to_string())?;
            let paid_cents = parse_cents(paid)
                .map_err(|_| "El importe pagado de una ocurrencia no es válido.".to_string())?;
            if (paid_cents - expected_cents).abs() * 100 > expected_cents.max(1).abs() * 20 {
                let current_data = serde_json::json!({"serviceId":service_id,"period":payload.period,"expected":expected,"paid":paid,"currency":currency});
                let suggested = serde_json::json!({"operation":"set_occurrence_expected_amount","parameters":{"serviceId":service_id,"period":payload.period,"expectedAmount":paid},"description":format!("Ajustar el importe esperado de esta ocurrencia a {paid} {currency}, sin modificar el gasto registrado.")});
                let fingerprint = amount_variation_fingerprint(
                    &database_transaction,
                    &service_id,
                    &payload.period,
                )?;
                database_transaction.execute("INSERT OR IGNORE INTO finance_audit_proposals(id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at) VALUES(?1,?2,'amount-variation','pending','fixed-service-amount-variation',?3,?4,?5,?6,?7,?8,NULL,?9,?10,?11,NULL)", params![new_id(), run_id, fingerprint, service_id, payload.period, format!("El pago de {service_name} varía significativamente del importe esperado."), current_data.to_string(), suggested.to_string(), payload.context.actor_library_user_id, payload.context.source, timestamp]).map_err(|error| error.to_string())?;
            }
        }
    }
    let mut orphan_statement = database_transaction.prepare("SELECT id,service_id,amount,currency,effective_date,category_id,status FROM finance_transactions WHERE transaction_type='expense' AND status='confirmed' AND deleted_at IS NULL AND effective_date LIKE ?1 || '%' AND service_id IS NOT NULL AND service_id NOT IN (SELECT id FROM finance_services)").map_err(|error| error.to_string())?;
    let orphan_rows = orphan_statement
        .query_map([&payload.period], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for chunk in orphan_rows.chunks(50) {
        let ids = chunk.iter().map(|row| row.0.clone()).collect::<Vec<_>>();
        let entries = chunk.iter().map(|row| serde_json::json!({"id":row.0,"serviceId":row.1,"amount":row.2,"currency":row.3,"effectiveDate":row.4,"categoryId":row.5,"status":row.6})).collect::<Vec<_>>();
        let fingerprint =
            orphan_service_link_fingerprint(&database_transaction, &payload.period, &ids)?;
        let suggested = serde_json::json!({"operation":"unlink_transaction_service","parameters":{"transactionIds":ids},"description":"Desvincular los gastos del servicio inexistente sin eliminar los movimientos."});
        database_transaction.execute("INSERT OR IGNORE INTO finance_audit_proposals(id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at) VALUES(?1,?2,'orphan-service-link','pending','transaction-service-reference-missing',?3,NULL,?4,?5,?6,?7,NULL,?8,?9,?10,NULL)", params![new_id(), run_id, fingerprint, payload.period, "Existe un gasto con referencia a un servicio inexistente.", serde_json::Value::Array(entries).to_string(), suggested.to_string(), payload.context.actor_library_user_id, payload.context.source, timestamp]).map_err(|error| error.to_string())?;
    }
    drop(orphan_statement);
    database_transaction.execute("UPDATE finance_audit_runs SET status='completed',completed_at=?1,error_message=NULL WHERE id=?2", params![timestamp, run_id]).map_err(|error| error.to_string())?;
    database_transaction
        .commit()
        .map_err(|error| error.to_string())?;
    load_audit_result(connection, &run_id)
}

pub fn finance_run_audit(
    app: crate::host::AppHandle,
    payload: RunFinanceAuditPayload,
) -> FinanceCommandResult<FinanceAuditResult> {
    if !valid_service_period(&payload.period)
        || payload.trigger_fingerprint.trim().is_empty()
        || payload.trigger_fingerprint.len() > 2_000
        || payload
            .reason
            .as_deref()
            .map(|value| value.len() > 500)
            .unwrap_or(false)
    {
        return Err("La auditoría requiere período y huella válidos.".into());
    }
    let mut connection = validate_context(&payload.context, &app)?;
    if let Some(run_id) = connection
        .query_row(
            "SELECT id FROM finance_audit_runs WHERE trigger_fingerprint=?1 AND status='completed'",
            [&payload.trigger_fingerprint],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
    {
        return load_audit_result(&connection, &run_id).map_err(FinanceCommandError::from);
    }
    let result = execute_deterministic_audit(&mut connection, &payload);
    if let Err(error) = &result {
        let _ = connection.execute("UPDATE finance_audit_runs SET status='failed',error_message=?1 WHERE trigger_fingerprint=?2", params![error, payload.trigger_fingerprint]);
    }
    let result = result?;
    drop(connection);
    sync_context(&payload.context, &app).map_err(FinanceCommandError::from)?;
    Ok(result)
}

pub fn finance_save_audit_proposal(
    app: crate::host::AppHandle,
    payload: SaveFinanceAuditProposalPayload,
) -> FinanceCommandResult<FinanceAuditProposal> {
    let proposal = &payload.proposal;
    if proposal.id.trim().is_empty()
        || proposal.id.len() > 160
        || proposal.audit_run_id.trim().is_empty()
        || proposal.audit_run_id.len() > 160
        || proposal.rule_key.trim().is_empty()
        || proposal.rule_key.len() > 160
        || proposal.data_fingerprint.trim().is_empty()
        || proposal.data_fingerprint.len() > 2_000
        || !valid_service_period(&proposal.period)
        || proposal.reason.trim().is_empty()
        || proposal.reason.chars().count() > 500
        || !matches!(
            proposal.proposal_type.as_str(),
            "service-unpaid"
                | "amount-variation"
                | "orphan-service-link"
                | "service-card-reconciliation"
        )
        || !matches!(
            proposal.status.as_str(),
            "pending" | "accepted" | "rejected" | "cancelled" | "outdated" | "failed"
        )
        || proposal.current_data.len() > 20_000
        || proposal.suggested_change.len() > 20_000
        || proposal
            .evidence
            .as_deref()
            .map(|value| value.len() > 20_000)
            .unwrap_or(false)
    {
        return Err("La propuesta de auditoría tiene datos obligatorios inválidos.".into());
    }
    let current_data: serde_json::Value = serde_json::from_str(&proposal.current_data)
        .map_err(|_| "Los datos actuales de la propuesta no son JSON válido.".to_string())?;
    if !current_data.is_object() && !current_data.is_array() {
        return Err(
            "Los datos actuales de la propuesta deben ser un objeto o una lista JSON.".into(),
        );
    }
    let suggested_change: serde_json::Value = serde_json::from_str(&proposal.suggested_change)
        .map_err(|_| "El cambio sugerido de la propuesta no es JSON válido.".to_string())?;
    let operation = suggested_change
        .get("operation")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "La propuesta no define una operación.".to_string())?;
    let parameters = suggested_change
        .get("parameters")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "La propuesta no define parámetros.".to_string())?;
    let expected_operation = match proposal.proposal_type.as_str() {
        "service-unpaid" => "mark_occurrence_discarded",
        "amount-variation" => "set_occurrence_expected_amount",
        "orphan-service-link" => "unlink_transaction_service",
        "service-card-reconciliation" => "reconcile_card_service_consumption",
        _ => return Err("El tipo de propuesta de auditoría no está permitido.".into()),
    };
    if operation != expected_operation {
        return Err("La operación no corresponde al tipo de propuesta.".into());
    }
    if suggested_change
        .get("description")
        .and_then(serde_json::Value::as_str)
        .map_or(true, |value| {
            value.trim().is_empty() || value.chars().count() > 500
        })
    {
        return Err("La propuesta debe tener una descripción legible.".into());
    }
    if proposal.proposal_type != "orphan-service-link"
        && proposal.proposal_type != "service-card-reconciliation"
        && proposal
            .service_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .is_none()
    {
        return Err("La propuesta requiere un servicio afectado.".into());
    }
    if proposal.proposal_type != "orphan-service-link"
        && proposal.proposal_type != "service-card-reconciliation"
    {
        let service_id = parameters
            .get("serviceId")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La propuesta no identifica el servicio afectado.".to_string())?;
        if proposal.service_id.as_deref() != Some(service_id) {
            return Err("El servicio de los parámetros no coincide con la propuesta.".into());
        }
        if parameters.get("period").and_then(serde_json::Value::as_str)
            != Some(proposal.period.as_str())
        {
            return Err("El período de los parámetros no coincide con la propuesta.".into());
        }
        if proposal.proposal_type == "amount-variation"
            && parameters
                .get("expectedAmount")
                .and_then(serde_json::Value::as_str)
                .map_or(true, |value| !valid_amount(value))
        {
            return Err("El importe esperado propuesto no es válido.".into());
        }
    }
    if proposal.proposal_type == "service-card-reconciliation" {
        let statement_id = parameters
            .get("statementId")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La propuesta no identifica el resumen de tarjeta.".to_string())?;
        let assignments = parameters
            .get("assignments")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "La propuesta no contiene asignaciones estructuradas.".to_string())?;
        if statement_id.len() > 160 || assignments.len() > 300 {
            return Err("La propuesta de reconciliación excede sus límites.".into());
        }
        for assignment in assignments {
            let object = assignment
                .as_object()
                .ok_or_else(|| "La propuesta contiene una asignación inválida.".to_string())?;
            for field in [
                "lineId",
                "serviceId",
                "transactionId",
                "purchaseDate",
                "period",
                "amount",
                "currency",
            ] {
                if object
                    .get(field)
                    .and_then(serde_json::Value::as_str)
                    .is_none()
                {
                    return Err("La propuesta contiene una asignación incompleta.".into());
                }
            }
        }
    }
    if proposal.proposal_type == "orphan-service-link" {
        let ids = parameters
            .get("transactionIds")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "La propuesta no identifica los gastos afectados.".to_string())?;
        if ids.is_empty()
            || ids.len() > 50
            || ids.iter().any(|value| {
                value
                    .as_str()
                    .map_or(true, |id| id.trim().is_empty() || id.len() > 160)
            })
        {
            return Err("La propuesta contiene una lista de gastos inválida.".into());
        }
    }
    let connection = validate_context(&payload.context, &app)?;
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM finance_audit_runs WHERE id=?1",
            [&proposal.audit_run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("La ejecución de auditoría no existe.".into());
    }
    let timestamp = now();
    if let Some(service_id) = proposal.service_id.as_deref() {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM finance_services WHERE id=?1)",
                [service_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists && proposal.proposal_type != "orphan-service-link" {
            return Err("El servicio de la propuesta no existe.".into());
        }
    }
    connection.execute("INSERT INTO finance_audit_proposals(id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) ON CONFLICT(id) DO UPDATE SET status=excluded.status,reason=excluded.reason,current_data=excluded.current_data,suggested_change=excluded.suggested_change,evidence=excluded.evidence,decided_at=excluded.decided_at ON CONFLICT(rule_key,data_fingerprint) DO NOTHING", params![proposal.id, proposal.audit_run_id, proposal.proposal_type, proposal.status, proposal.rule_key, proposal.data_fingerprint, proposal.service_id, proposal.period, proposal.reason, proposal.current_data, proposal.suggested_change, proposal.evidence, payload.context.actor_library_user_id, payload.context.source, timestamp, proposal.decided_at]).map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    let connection = validate_context(&payload.context, &app)?;
    let persisted = connection.query_row("SELECT id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at FROM finance_audit_proposals WHERE rule_key=?1 AND data_fingerprint=?2", params![proposal.rule_key, proposal.data_fingerprint], audit_proposal_from_row).map_err(|error| error.to_string())?;
    Ok(persisted)
}

pub fn finance_list_audit_proposals(
    app: crate::host::AppHandle,
    context: FinanceContext,
    period: Option<String>,
    status: Option<String>,
) -> FinanceCommandResult<Vec<FinanceAuditProposal>> {
    if let Some(value) = period.as_deref() {
        if !valid_service_period(value) {
            return Err("El período debe tener formato YYYY-MM.".into());
        }
    }
    let connection = validate_context(&context, &app)?;
    let mut statement = connection.prepare("SELECT id,audit_run_id,proposal_type,status,rule_key,data_fingerprint,service_id,period,reason,current_data,suggested_change,evidence,actor_library_user_id,source,created_at,decided_at FROM finance_audit_proposals WHERE (?1 IS NULL OR period=?1) AND (?2 IS NULL OR status=?2) ORDER BY created_at DESC LIMIT 500").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![period, status], |row| {
            Ok(FinanceAuditProposal {
                id: row.get(0)?,
                audit_run_id: row.get(1)?,
                proposal_type: row.get(2)?,
                status: row.get(3)?,
                rule_key: row.get(4)?,
                data_fingerprint: row.get(5)?,
                service_id: row.get(6)?,
                period: row.get(7)?,
                reason: row.get(8)?,
                current_data: row.get(9)?,
                suggested_change: row.get(10)?,
                evidence: row.get(11)?,
                actor_library_user_id: row.get(12)?,
                source: row.get(13)?,
                created_at: row.get(14)?,
                decided_at: row.get(15)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string().into())
}

fn apply_audit_proposal_change(
    transaction: &rusqlite::Transaction<'_>,
    proposal_type: &str,
    proposal_service_id: Option<&str>,
    period: &str,
    current_data: &str,
    suggested_change: &str,
    actor_library_user_id: Option<&str>,
    source: &str,
    resolution_assignments: Option<&[CardServiceAssignment]>,
) -> Result<(), String> {
    let action: serde_json::Value = serde_json::from_str(suggested_change).map_err(|_| {
        "La propuesta aceptada no contiene una acción estructurada válida.".to_string()
    })?;
    let operation = action
        .get("operation")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "La propuesta aceptada no define una operación segura.".to_string())?;
    let parameters = action
        .get("parameters")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "La propuesta aceptada no define parámetros seguros.".to_string())?;
    let parameter_string = |name: &str| {
        parameters
            .get(name)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    let service_id = parameter_string("serviceId").or(proposal_service_id);
    if let (Some(parameter_service_id), Some(proposal_service_id)) =
        (parameter_string("serviceId"), proposal_service_id)
    {
        if parameter_service_id != proposal_service_id {
            return Err("La propuesta no coincide con el servicio auditado.".into());
        }
    }
    let action_period = parameter_string("period").unwrap_or(period);
    let timestamp = now();

    let operation_allowed = match proposal_type {
        "service-unpaid" => operation == "mark_occurrence_discarded",
        "amount-variation" => operation == "set_occurrence_expected_amount",
        "orphan-service-link" => operation == "unlink_transaction_service",
        "service-card-reconciliation" => operation == "reconcile_card_service_consumption",
        _ => false,
    };
    if !operation_allowed {
        return Err("La operación no corresponde al tipo de propuesta auditada.".into());
    }

    match operation {
        "reconcile_card_service_consumption" => {
            if proposal_type != "service-card-reconciliation" {
                return Err("La operación no corresponde al tipo de propuesta auditada.".into());
            }
            let statement_id = parameter_string("statementId")
                .ok_or_else(|| "La propuesta no identifica el resumen de tarjeta.".to_string())?;
            let assignment_values = parameters
                .get("assignments")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| {
                    "La propuesta no contiene asignaciones estructuradas.".to_string()
                })?;
            let preview_assignments = assignment_values
                .iter()
                .cloned()
                .map(serde_json::from_value::<CardServiceAssignment>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "La propuesta contiene asignaciones inválidas.".to_string())?;
            let (statement_period, artifact_id, source_reference, raw_source): (
                String,
                String,
                Option<String>,
                Option<String>,
            ) = transaction
                .query_row(
                    "SELECT s.period,s.source_artifact_id,a.reference,a.raw_text
                     FROM finance_credit_card_statements s
                     JOIN finance_source_artifacts a ON a.id=s.source_artifact_id
                     WHERE s.id=?1",
                    [statement_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|_| "El resumen de tarjeta de la propuesta no existe.".to_string())?;
            let (services, occurrences) = load_card_reconciliation_context(transaction)?;
            let input = load_card_reconciliation_input(
                transaction,
                statement_id,
                &statement_period,
                &statement_period,
                &services,
                &occurrences,
            )?;
            let current = reconcile_card_service_consumption(&input);
            let effective = if current.ambiguous_groups.is_empty() {
                if let Some(resolution) = resolution_assignments {
                    if assignment_keys(resolution) != assignment_keys(&current.assignments) {
                        return Err("La resolución no coincide con el preview.".into());
                    }
                }
                current.clone()
            } else {
                let Some(resolution) = resolution_assignments else {
                    return Err(
                        "La reconciliación es ambigua y requiere una selección manual.".into(),
                    );
                };
                resolve_card_service_assignments(&input, &current, resolution)?
            };
            let requested = if resolution_assignments.is_some() {
                effective.assignments.clone()
            } else {
                preview_assignments
            };
            if assignment_keys(&requested) != assignment_keys(&effective.assignments) {
                return Err(
                    "La propuesta quedó obsoleta porque sus asignaciones no coinciden con el preview."
                        .into(),
                );
            }
            persist_card_reconciliation(
                transaction,
                source_reference.as_deref(),
                raw_source.as_deref(),
                &artifact_id,
                &effective,
                actor_library_user_id.unwrap_or_default(),
                source,
            )?;
            for assignment in &effective.assignments {
                transaction
                    .execute(
                        "UPDATE finance_audit_proposals
                         SET status='outdated',decided_at=?1
                         WHERE proposal_type='service-unpaid' AND service_id=?2
                           AND period=?3 AND status='pending'",
                        params![now(), assignment.service_id, assignment.period],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        "mark_occurrence_discarded" => {
            let service_id =
                service_id.ok_or_else(|| "La propuesta no identifica el servicio.".to_string())?;
            if action_period != period {
                return Err("La propuesta no coincide con el período auditado.".into());
            }
            let (expected_amount, active): (String, i32) = transaction
                .query_row(
                    "SELECT expected_amount,active FROM finance_services WHERE id=?1",
                    [service_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| "El servicio de la propuesta no existe.".to_string())?;
            if active == 0 {
                return Err(
                    "La propuesta quedó obsoleta porque el servicio ya no está activo.".into(),
                );
            }
            let previous: Option<(String, Option<String>, Option<String>)> = transaction
                .query_row(
                    "SELECT id,transaction_id,paid_amount FROM finance_service_occurrences WHERE service_id=?1 AND period=?2",
                    params![service_id, period],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some((occurrence_id, transaction_id, paid_amount)) = previous {
                if paid_amount.is_some() {
                    return Err(
                        "La propuesta quedó obsoleta porque la ocurrencia ya tiene un pago.".into(),
                    );
                }
                let version: i64 = transaction
                    .query_row(
                        "SELECT COALESCE(MAX(version_number),0)+1 FROM finance_service_occurrence_versions WHERE occurrence_id=?1",
                        [&occurrence_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                transaction.execute(
                    "INSERT INTO finance_service_occurrence_versions(id,occurrence_id,version_number,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,reason,created_at)
                     SELECT ?1,id,?2,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,'Auditoría financiera',?3
                     FROM finance_service_occurrences WHERE id=?4",
                    params![new_id(), version, timestamp, occurrence_id],
                ).map_err(|error| error.to_string())?;
                transaction.execute(
                    "UPDATE finance_service_occurrences SET paid_amount=NULL,effective_date=NULL,status='discarded',transaction_id=NULL,updated_at=?1 WHERE id=?2",
                    params![timestamp, occurrence_id],
                ).map_err(|error| error.to_string())?;
                if let Some(transaction_id) = transaction_id {
                    transaction
                        .execute(
                            "UPDATE finance_transactions SET service_id=NULL WHERE id=?1",
                            [transaction_id.clone()],
                        )
                        .map_err(|error| error.to_string())?;
                    transaction
                        .execute(
                            "UPDATE finance_purchases SET service_id=NULL WHERE transaction_id=?1",
                            [transaction_id],
                        )
                        .map_err(|error| error.to_string())?;
                }
            } else {
                transaction.execute(
                    "INSERT INTO finance_service_occurrences(id,service_id,period,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,NULL,NULL,'discarded',NULL,NULL,NULL,NULL,?5,?6,?7,?7)",
                    params![new_id(), service_id, period, expected_amount, actor_library_user_id, source, timestamp],
                ).map_err(|error| error.to_string())?;
            }
        }
        "set_occurrence_expected_amount" => {
            let service_id =
                service_id.ok_or_else(|| "La propuesta no identifica el servicio.".to_string())?;
            let expected_amount = parameter_string("expectedAmount")
                .ok_or_else(|| "La propuesta no identifica el importe esperado.".to_string())?;
            if action_period != period || !valid_amount(expected_amount) {
                return Err("El ajuste de importe de la propuesta no es válido.".into());
            }
            let occurrence_id: String = transaction
                .query_row(
                    "SELECT id FROM finance_service_occurrences WHERE service_id=?1 AND period=?2",
                    params![service_id, period],
                    |row| row.get(0),
                )
                .map_err(|_| "La ocurrencia de la propuesta no existe.".to_string())?;
            let (paid_amount, modality, active): (Option<String>, String, i32) = transaction
                .query_row("SELECT o.paid_amount,s.modality,s.active FROM finance_service_occurrences o JOIN finance_services s ON s.id=o.service_id WHERE o.id=?1", [&occurrence_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|error| error.to_string())?;
            if paid_amount.as_deref() != Some(expected_amount) || modality != "fixed" || active == 0
            {
                return Err("La propuesta quedó obsoleta porque cambió el importe pagado.".into());
            }
            let version: i64 = transaction
                .query_row("SELECT COALESCE(MAX(version_number),0)+1 FROM finance_service_occurrence_versions WHERE occurrence_id=?1", [&occurrence_id], |row| row.get(0))
                .map_err(|error| error.to_string())?;
            transaction.execute(
                "INSERT INTO finance_service_occurrence_versions(id,occurrence_id,version_number,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,reason,created_at)
                 SELECT ?1,id,?2,expected_amount,paid_amount,effective_date,status,transaction_id,artifact_id,source_reference,raw_source,actor_library_user_id,source,'Auditoría financiera',?3
                 FROM finance_service_occurrences WHERE id=?4",
                params![new_id(), version, timestamp, occurrence_id],
            ).map_err(|error| error.to_string())?;
            transaction.execute("UPDATE finance_service_occurrences SET expected_amount=?1,updated_at=?2 WHERE id=?3", params![expected_amount, timestamp, occurrence_id]).map_err(|error| error.to_string())?;
        }
        "unlink_transaction_service" => {
            let ids = parameters
                .get("transactionIds")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| {
                    "La propuesta no identifica los gastos a desvincular.".to_string()
                })?;
            if ids.is_empty() || ids.len() > 50 {
                return Err("La propuesta no contiene una cantidad válida de gastos.".into());
            }
            for value in ids {
                let transaction_id = value
                    .as_str()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        "La propuesta contiene un identificador de gasto inválido.".to_string()
                    })?;
                let service_id: Option<String> = transaction
                    .query_row("SELECT service_id FROM finance_transactions WHERE id=?1 AND deleted_at IS NULL", [transaction_id], |row| row.get(0))
                    .optional()
                    .map_err(|error| error.to_string())?
                    .flatten();
                let Some(service_id) = service_id else {
                    return Err(
                        "Uno de los gastos de la propuesta ya no existe o fue desvinculado.".into(),
                    );
                };
                let service_exists: bool = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM finance_services WHERE id=?1)",
                        [&service_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                if service_exists {
                    return Err(
                        "La propuesta quedó obsoleta porque el servicio volvió a existir.".into(),
                    );
                }
                transaction
                    .execute(
                        "UPDATE finance_transactions SET service_id=NULL,updated_at=?1 WHERE id=?2",
                        params![timestamp, transaction_id],
                    )
                    .map_err(|error| error.to_string())?;
                transaction.execute("UPDATE finance_purchases SET service_id=NULL,updated_at=?1 WHERE transaction_id=?2", params![timestamp, transaction_id]).map_err(|error| error.to_string())?;
            }
        }
        _ => {
            return Err(format!(
                "La operación de auditoría no está permitida: {operation}."
            ))
        }
    }

    let _: serde_json::Value = serde_json::from_str(current_data)
        .map_err(|_| "Los datos actuales de la propuesta no son JSON válido.".to_string())?;
    Ok(())
}

pub fn finance_decide_audit_proposal(
    app: crate::host::AppHandle,
    payload: DecideFinanceAuditProposalPayload,
) -> FinanceCommandResult<()> {
    if payload.proposal_id.trim().is_empty()
        || !matches!(
            payload.decision.as_str(),
            "accepted" | "rejected" | "cancelled"
        )
    {
        return Err("La decisión de auditoría no es válida.".into());
    }
    let mut connection = validate_context(&payload.context, &app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let current: (String, String, String, String, Option<String>, String, String, String) = transaction.query_row("SELECT status,COALESCE(actor_library_user_id,''),data_fingerprint,proposal_type,service_id,period,current_data,suggested_change FROM finance_audit_proposals WHERE id=?1", [&payload.proposal_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).map_err(|_| "La propuesta de auditoría no existe.".to_string())?;
    if current.0 != "pending" {
        return Err("La propuesta ya fue decidida o quedó obsoleta.".into());
    }
    if !current.1.is_empty() && payload.context.actor_library_user_id != current.1 {
        return Err("El actor de la propuesta no coincide con el actor actual.".into());
    }
    if payload.expected_data_fingerprint.as_deref() != Some(current.2.as_str()) {
        return Err("La propuesta quedó obsoleta porque cambió su huella de datos.".into());
    }
    let current_fingerprint = match (current.3.as_str(), current.4.as_deref()) {
        ("service-unpaid", Some(service_id)) => Some(service_unpaid_fingerprint(
            &transaction,
            service_id,
            &current.5,
        )?),
        ("amount-variation", Some(service_id)) => Some(amount_variation_fingerprint(
            &transaction,
            service_id,
            &current.5,
        )?),
        ("orphan-service-link", None) => {
            let action: serde_json::Value = serde_json::from_str(&current.7).map_err(|_| {
                "La propuesta aceptada no contiene una acción estructurada válida.".to_string()
            })?;
            let ids = action
                .get("parameters")
                .and_then(|value| value.get("transactionIds"))
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| "La propuesta no identifica los gastos afectados.".to_string())?;
            let ids = ids
                .iter()
                .map(|value| {
                    value.as_str().map(str::to_owned).ok_or_else(|| {
                        "La propuesta contiene un identificador inválido.".to_string()
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Some(orphan_service_link_fingerprint(
                &transaction,
                &current.5,
                &ids,
            )?)
        }
        ("service-card-reconciliation", _) => {
            let action: serde_json::Value = serde_json::from_str(&current.7).map_err(|_| {
                "La propuesta aceptada no contiene una acción estructurada válida.".to_string()
            })?;
            let statement_id = action
                .get("parameters")
                .and_then(|value| value.get("statementId"))
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "La propuesta no identifica el resumen de tarjeta.".to_string())?;
            let (statement_period, statement_snapshot): (String, String) = transaction
                .query_row(
                    "SELECT period,account_id,issuer,card_last_four,closing_date,due_date,currency,
                            previous_balance,payments_amount,credits_amount,purchases_amount,fees_amount,
                            interest_amount,taxes_amount,total_due,minimum_payment,validation_status,
                            source_artifact_id,updated_at
                     FROM finance_credit_card_statements WHERE id=?1",
                    [statement_id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            format!(
                                "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                                row.get::<_, String>(4)?,
                                row.get::<_, String>(5)?,
                                row.get::<_, String>(6)?,
                                row.get::<_, String>(7)?,
                                row.get::<_, String>(8)?,
                                row.get::<_, String>(9)?,
                                row.get::<_, String>(10)?,
                                row.get::<_, String>(11)?,
                                row.get::<_, String>(12)?,
                                row.get::<_, String>(13)?,
                                row.get::<_, String>(14)?,
                                row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                                row.get::<_, String>(16)?,
                                row.get::<_, String>(17)?,
                                row.get::<_, String>(18)?,
                            ),
                        ))
                    },
                )
                .map_err(|_| "El resumen de tarjeta de la propuesta no existe.".to_string())?;
            let (services, occurrences) = load_card_reconciliation_context(&transaction)?;
            let input = load_card_reconciliation_input(
                &transaction,
                statement_id,
                &statement_period,
                &statement_snapshot,
                &services,
                &occurrences,
            )?;
            Some(reconciliation_fingerprint(
                &input,
                &reconcile_card_service_consumption(&input),
            ))
        }
        _ => None,
    };
    if let Some(fingerprint) = current_fingerprint {
        if fingerprint != current.2 {
            let timestamp = now();
            transaction.execute("UPDATE finance_audit_proposals SET status='outdated',decided_at=?1 WHERE id=?2", params![timestamp, payload.proposal_id]).map_err(|error| error.to_string())?;
            transaction.execute("INSERT INTO finance_audit_decisions(id,proposal_id,decision,actor_library_user_id,source,created_at) VALUES(?1,?2,'outdated',?3,?4,?5)", params![new_id(), payload.proposal_id, payload.context.actor_library_user_id, payload.context.source, timestamp]).map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())?;
            drop(connection);
            sync_context(&payload.context, &app).map_err(FinanceCommandError::from)?;
            return Err(
                "La propuesta quedó obsoleta porque cambiaron los datos financieros.".into(),
            );
        }
    }
    let timestamp = now();
    if payload.decision == "accepted" {
        apply_audit_proposal_change(
            &transaction,
            &current.3,
            current.4.as_deref(),
            &current.5,
            &current.6,
            &current.7,
            Some(payload.context.actor_library_user_id.as_str()),
            &payload.context.source,
            payload.resolution_assignments.as_deref(),
        )?;
        if current.3 == "service-card-reconciliation" {
            let action: serde_json::Value = serde_json::from_str(&current.7).map_err(|_| {
                "La propuesta aceptada no contiene una acción estructurada válida.".to_string()
            })?;
            let action_assignments = action
                .get("parameters")
                .and_then(|value| value.get("assignments"))
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| "La propuesta no contiene asignaciones estructuradas.".to_string())?
                .iter()
                .cloned()
                .map(serde_json::from_value::<CardServiceAssignment>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "La propuesta contiene asignaciones inválidas.".to_string())?;
            let assignments = payload
                .resolution_assignments
                .as_deref()
                .unwrap_or(&action_assignments);
            let mut affected = BTreeSet::new();
            for assignment in assignments {
                affected.insert((assignment.service_id.clone(), assignment.period.clone()));
            }
            for (service_id, period) in affected {
                let stale = transaction
                    .prepare(
                        "SELECT id FROM finance_audit_proposals
                         WHERE status='pending' AND id<>?1 AND service_id=?2 AND period=?3",
                    )
                    .map_err(|error| error.to_string())?
                    .query_map(params![payload.proposal_id, service_id, period], |row| {
                        row.get::<_, String>(0)
                    })
                    .map_err(|error| error.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?;
                for proposal_id in stale {
                    transaction
                        .execute(
                            "UPDATE finance_audit_proposals SET status='outdated',decided_at=?1
                             WHERE id=?2",
                            params![timestamp, proposal_id],
                        )
                        .map_err(|error| error.to_string())?;
                    transaction
                        .execute(
                            "INSERT INTO finance_audit_decisions(
                             id,proposal_id,decision,actor_library_user_id,source,created_at)
                             VALUES(?1,?2,'outdated',?3,?4,?5)",
                            params![
                                new_id(),
                                proposal_id,
                                payload.context.actor_library_user_id,
                                payload.context.source,
                                timestamp
                            ],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    transaction
        .execute(
            "UPDATE finance_audit_proposals SET status=?1,decided_at=?2 WHERE id=?3",
            params![payload.decision, timestamp, payload.proposal_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO finance_audit_decisions(id,proposal_id,decision,actor_library_user_id,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)", params![new_id(), payload.proposal_id, payload.decision, payload.context.actor_library_user_id, payload.context.source, timestamp]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app).map_err(FinanceCommandError::from)
}

pub fn finance_get_dashboard(
    app: crate::host::AppHandle,
    context: FinanceContext,
    month: String,
) -> FinanceCommandResult<FinanceDashboard> {
    let connection = validate_context(&context, &app)?;
    let accounts = finance_list_accounts_inner(&connection)?;
    let categories = finance_list_categories_inner(&connection)?;
    let transaction_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM finance_transactions WHERE deleted_at IS NULL AND effective_date LIKE ?1 || '%'", [&month], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let savings_movement_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM finance_savings_movements WHERE effective_date LIKE ?1 || '%'",
            [&month],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let mut statement = connection.prepare("SELECT t.id, t.transaction_type, t.amount, t.currency, t.effective_date, t.account_id, t.destination_account_id, t.category_id, t.description, t.source, t.status, t.actor_user_id, t.source_artifact_id, t.service_id, t.merchant_id, t.operation_fingerprint, t.installment_id, a.reference, a.raw_text, t.created_at, t.updated_at, t.actor_library_user_id FROM finance_transactions t LEFT JOIN finance_source_artifacts a ON a.id=t.source_artifact_id WHERE t.deleted_at IS NULL AND t.effective_date LIKE ?1 || '%' ORDER BY t.effective_date DESC, t.created_at DESC LIMIT 500") .map_err(|e| e.to_string())?;
    let transactions = statement
        .query_map([&month], |row| {
            Ok(FinanceTransaction {
                id: row.get(0)?,
                transaction_type: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                effective_date: row.get(4)?,
                account_id: row.get(5)?,
                destination_account_id: row.get(6)?,
                category_id: row.get(7)?,
                description: row.get(8)?,
                source: row.get(9)?,
                status: row.get(10)?,
                actor_user_id: row.get(11)?,
                service_id: row.get(13)?,
                actor_library_user_id: row.get(21)?,
                source_artifact_id: row.get(12)?,
                merchant_id: row.get(14)?,
                operation_fingerprint: row.get(15)?,
                installment_id: row.get(16)?,
                source_reference: row.get(17)?,
                raw_source: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut income_by_currency = BTreeMap::new();
    let mut expense_by_currency = BTreeMap::new();
    for transaction in transactions
        .iter()
        .filter(|item| matches!(item.status.as_str(), "confirmed" | "corrected"))
    {
        if transaction.transaction_type == "income" {
            add_currency_total(
                &mut income_by_currency,
                &transaction.currency,
                &transaction.amount,
            );
        } else if transaction.transaction_type == "expense" {
            add_currency_total(
                &mut expense_by_currency,
                &transaction.currency,
                &transaction.amount,
            );
        }
    }
    let mut net_by_currency = BTreeMap::new();
    for currency in income_by_currency.keys().chain(expense_by_currency.keys()) {
        let income = income_by_currency
            .get(currency)
            .copied()
            .unwrap_or_default();
        let expense = expense_by_currency
            .get(currency)
            .copied()
            .unwrap_or_default();
        net_by_currency.insert(currency.clone(), format_cents(income - expense));
    }
    let debt_by_currency = finance_debt_by_currency(&connection, &month)?;
    let salary_by_currency = finance_salary_by_currency(&connection, &month)?;
    Ok(FinanceDashboard {
        accounts,
        categories,
        transactions,
        transactions_truncated: transaction_count > 500,
        income_total: income_by_currency
            .iter()
            .map(|(currency, value)| format!("{currency} {}", format_cents(*value)))
            .collect::<Vec<_>>()
            .join(" · "),
        expense_total: expense_by_currency
            .iter()
            .map(|(currency, value)| format!("{currency} {}", format_cents(*value)))
            .collect::<Vec<_>>()
            .join(" · "),
        net_total: net_by_currency
            .iter()
            .map(|(currency, value)| format!("{currency} {value}"))
            .collect::<Vec<_>>()
            .join(" · "),
        income_by_currency: income_by_currency
            .into_iter()
            .map(|(currency, value)| (currency, format_cents(value)))
            .collect(),
        expense_by_currency: expense_by_currency
            .into_iter()
            .map(|(currency, value)| (currency, format_cents(value)))
            .collect(),
        net_by_currency,
        debt_by_currency: debt_by_currency
            .into_iter()
            .map(|(currency, value)| (currency, format_cents(value)))
            .collect(),
        salary_by_currency: salary_by_currency
            .into_iter()
            .map(|(currency, value)| (currency, format_cents(value)))
            .collect(),
        debt_ratio_history: finance_debt_ratio_history(&connection, &month)?,
        savings: finance_list_savings_inner(&connection)?,
        savings_movements: finance_list_savings_movements_inner(&connection, &month)?,
        savings_movements_truncated: savings_movement_count > 500,
        merchants: finance_list_merchants_inner(&connection)?,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetFinanceRecordPayload {
    pub context: FinanceContext,
    pub id: String,
}

pub fn finance_get_transaction(
    app: crate::host::AppHandle,
    payload: GetFinanceRecordPayload,
) -> FinanceCommandResult<FinanceTransaction> {
    if payload.id.trim().is_empty() {
        return Err("El movimiento requiere un identificador.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    connection
        .query_row(
            "SELECT t.id,t.transaction_type,t.amount,t.currency,t.effective_date,t.account_id,t.destination_account_id,t.category_id,t.description,t.source,t.status,t.actor_user_id,t.source_artifact_id,t.service_id,t.merchant_id,t.operation_fingerprint,t.installment_id,a.reference,a.raw_text,t.created_at,t.updated_at,t.actor_library_user_id
             FROM finance_transactions t LEFT JOIN finance_source_artifacts a ON a.id=t.source_artifact_id
             WHERE t.id=?1 AND t.deleted_at IS NULL",
            [&payload.id],
            |row| {
                Ok(FinanceTransaction {
                    id: row.get(0)?, transaction_type: row.get(1)?, amount: row.get(2)?, currency: row.get(3)?, effective_date: row.get(4)?, account_id: row.get(5)?, destination_account_id: row.get(6)?, category_id: row.get(7)?, description: row.get(8)?, source: row.get(9)?, status: row.get(10)?, actor_user_id: row.get(11)?, source_artifact_id: row.get(12)?, service_id: row.get(13)?, merchant_id: row.get(14)?, operation_fingerprint: row.get(15)?, installment_id: row.get(16)?, source_reference: row.get(17)?, raw_source: row.get(18)?, created_at: row.get(19)?, updated_at: row.get(20)?, actor_library_user_id: row.get(21)?,
                })
            },
        )
        .map_err(|_| "El movimiento no existe.".into())
}

pub fn finance_list_all_transactions(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceTransaction>> {
    let connection = validate_context(&context, &app)?;
    let mut statement = connection
        .prepare("SELECT t.id,t.transaction_type,t.amount,t.currency,t.effective_date,t.account_id,t.destination_account_id,t.category_id,t.description,t.source,t.status,t.actor_user_id,t.source_artifact_id,t.service_id,t.merchant_id,t.operation_fingerprint,t.installment_id,a.reference,a.raw_text,t.created_at,t.updated_at,t.actor_library_user_id FROM finance_transactions t LEFT JOIN finance_source_artifacts a ON a.id=t.source_artifact_id WHERE t.deleted_at IS NULL ORDER BY t.effective_date DESC,t.created_at DESC LIMIT 5000")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(FinanceTransaction {
                id: row.get(0)?,
                transaction_type: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                effective_date: row.get(4)?,
                account_id: row.get(5)?,
                destination_account_id: row.get(6)?,
                category_id: row.get(7)?,
                description: row.get(8)?,
                source: row.get(9)?,
                status: row.get(10)?,
                actor_user_id: row.get(11)?,
                source_artifact_id: row.get(12)?,
                service_id: row.get(13)?,
                merchant_id: row.get(14)?,
                operation_fingerprint: row.get(15)?,
                installment_id: row.get(16)?,
                source_reference: row.get(17)?,
                raw_source: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
                actor_library_user_id: row.get(21)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

pub fn finance_list_all_savings_movements(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceSavingsMovement>> {
    let connection = validate_context(&context, &app)?;
    finance_list_savings_movements_all_inner(&connection).map_err(Into::into)
}

pub fn finance_list_accounts(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceAccount>> {
    let connection = validate_context(&context, &app)?;
    finance_list_accounts_inner(&connection).map_err(Into::into)
}

pub fn finance_list_categories(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceCategory>> {
    let connection = validate_context(&context, &app)?;
    finance_list_categories_inner(&connection).map_err(Into::into)
}

fn finance_salary_by_currency(
    connection: &Connection,
    period: &str,
) -> Result<BTreeMap<String, i128>, String> {
    let mut statement = connection
        .prepare("SELECT currency,net_amount FROM finance_salary_receipts WHERE period=?1")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([period], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut totals = BTreeMap::new();
    for row in rows {
        let (currency, amount) = row.map_err(|error| error.to_string())?;
        add_currency_total(&mut totals, &currency, &amount);
    }
    Ok(totals)
}

fn finance_debt_by_currency(
    connection: &Connection,
    period: &str,
) -> Result<BTreeMap<String, i128>, String> {
    let mut totals = BTreeMap::new();
    let mut card_statement = connection
        .prepare("SELECT currency,total_due FROM finance_credit_card_statements WHERE period=?1")
        .map_err(|error| error.to_string())?;
    let card_rows = card_statement
        .query_map([period], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in card_rows {
        let (currency, amount) = row.map_err(|error| error.to_string())?;
        add_currency_total(&mut totals, &currency, &amount);
    }
    drop(card_statement);
    let period_end = format!("{period}-31");
    let mut valuation_statement = connection
        .prepare("SELECT i.currency,v.amount FROM finance_investments i JOIN finance_valuations v ON v.investment_id=i.id WHERE i.active=1 AND i.asset_type='debt' AND v.valuation_date=(SELECT MAX(v2.valuation_date) FROM finance_valuations v2 WHERE v2.investment_id=i.id AND v2.valuation_date<=?1)")
        .map_err(|error| error.to_string())?;
    let valuation_rows = valuation_statement
        .query_map([&period_end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in valuation_rows {
        let (currency, amount) = row.map_err(|error| error.to_string())?;
        add_currency_total(&mut totals, &currency, &amount);
    }
    Ok(totals)
}

fn finance_debt_ratio_history(
    connection: &Connection,
    end_period: &str,
) -> Result<Vec<FinanceDebtRatioHistoryPoint>, String> {
    let start_period = finance_history_start_period(end_period)?;
    let mut statement = connection
        .prepare("SELECT period FROM finance_salary_receipts WHERE period BETWEEN ?1 AND ?2 UNION SELECT period FROM finance_credit_card_statements WHERE period BETWEEN ?1 AND ?2 UNION SELECT substr(valuation_date,1,7) FROM finance_valuations WHERE substr(valuation_date,1,7) BETWEEN ?1 AND ?2 ORDER BY 1")
        .map_err(|error| error.to_string())?;
    let periods = statement
        .query_map(params![start_period, end_period], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    periods
        .into_iter()
        .map(|period| {
            let debt_by_currency = finance_debt_by_currency(connection, &period)?
                .into_iter()
                .map(|(currency, value)| (currency, format_cents(value)))
                .collect();
            let salary_by_currency = finance_salary_by_currency(connection, &period)?
                .into_iter()
                .map(|(currency, value)| (currency, format_cents(value)))
                .collect();
            Ok(FinanceDebtRatioHistoryPoint {
                period,
                debt_by_currency,
                salary_by_currency,
            })
        })
        .collect()
}

fn finance_history_start_period(end_period: &str) -> Result<String, String> {
    let (year, month) = end_period
        .split_once('-')
        .ok_or_else(|| "El período financiero es inválido.".to_string())?;
    let year = year
        .parse::<i32>()
        .map_err(|_| "El período financiero es inválido.".to_string())?;
    let month = month
        .parse::<i32>()
        .map_err(|_| "El período financiero es inválido.".to_string())?;
    if !(1..=12).contains(&month) {
        return Err("El período financiero es inválido.".into());
    }
    let months = year * 12 + month - 1 - 11;
    Ok(format!(
        "{:04}-{:02}",
        months.div_euclid(12),
        months.rem_euclid(12) + 1
    ))
}

pub fn finance_save_savings_reserve(
    app: crate::host::AppHandle,
    payload: SaveSavingsReservePayload,
) -> FinanceCommandResult<FinanceSavingsReserve> {
    let reserve = &payload.reserve;
    if reserve.name.trim().is_empty()
        || !valid_amount(&reserve.opening_balance)
        || !matches!(reserve.currency.as_str(), "ARS" | "USD")
    {
        return Err("La reserva requiere nombre, moneda e importe válidos.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    let ledger_account_id = format!("savings:{}", reserve.id);
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT OR IGNORE INTO finance_accounts (id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES (?1,?2,'savings_reserve',?3,'0',?4,?5,?5)", params![ledger_account_id, reserve.name.trim(), reserve.currency, reserve.active as i32, timestamp]).map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO finance_savings_reserves (id,name,currency,opening_balance,objective,active,ledger_account_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,currency=excluded.currency,opening_balance=excluded.opening_balance,objective=excluded.objective,active=excluded.active,ledger_account_id=COALESCE(finance_savings_reserves.ledger_account_id, excluded.ledger_account_id),updated_at=excluded.updated_at", params![reserve.id, reserve.name.trim(), reserve.currency, reserve.opening_balance, reserve.objective, reserve.active as i32, ledger_account_id, timestamp]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(reserve.clone())
}

pub fn finance_save_savings_movement(
    app: crate::host::AppHandle,
    payload: SaveSavingsMovementPayload,
) -> FinanceCommandResult<FinanceSavingsMovement> {
    let movement = &payload.movement;
    validate_savings_movement(movement)?;
    let connection = validate_context(&payload.context, &app)?;
    let reserve_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_savings_reserves WHERE id = ?1 AND active = 1",
            [&movement.reserve_id],
            |row| row.get(0),
        )
        .map_err(|_| "La reserva no existe o está inactiva.".to_string())?;
    if reserve_currency != movement.currency {
        return Err("La moneda del movimiento no coincide con la reserva.".into());
    }
    let ledger_account_id: String = connection
        .query_row(
            "SELECT ledger_account_id FROM finance_savings_reserves WHERE id = ?1",
            [&movement.reserve_id],
            |row| row.get(0),
        )
        .map_err(|_| "La reserva no tiene cuenta contable interna.".to_string())?;
    if let Some(account_id) = movement.account_id.as_deref() {
        let linked: i64 = connection.query_row("SELECT COUNT(*) FROM finance_savings_accounts WHERE reserve_id = ?1 AND account_id = ?2", params![movement.reserve_id, account_id], |row| row.get(0)).map_err(|error| error.to_string())?;
        if linked == 0 {
            return Err("La cuenta no está vinculada a la reserva.".into());
        }
    }
    let timestamp = now();
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO finance_savings_movements (id,reserve_id,account_id,movement_type,amount,currency,effective_date,description,reason,source,status,actor_user_id,linked_transaction_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14) ON CONFLICT(id) DO UPDATE SET reserve_id=excluded.reserve_id,account_id=excluded.account_id,movement_type=excluded.movement_type,amount=excluded.amount,currency=excluded.currency,effective_date=excluded.effective_date,description=excluded.description,reason=excluded.reason,source=excluded.source,status=excluded.status,actor_user_id=excluded.actor_user_id,linked_transaction_id=excluded.linked_transaction_id,updated_at=excluded.updated_at", params![movement.id, movement.reserve_id, movement.account_id, movement.movement_type, movement.amount, movement.currency, movement.effective_date, movement.description, movement.reason, movement.source, movement.status, movement.actor_user_id, movement.linked_transaction_id, timestamp]).map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE finance_savings_movements SET actor_library_user_id=?1 WHERE id=?2",
            params![movement.actor_library_user_id, movement.id],
        )
        .map_err(|error| error.to_string())?;
    if movement.status == "confirmed"
        && matches!(
            movement.movement_type.as_str(),
            "contribution" | "withdrawal"
        )
    {
        let account_id = movement.account_id.as_deref().ok_or_else(|| {
            "Los aportes y retiros confirmados requieren una cuenta vinculada.".to_string()
        })?;
        let (source_account, destination_account) = if movement.movement_type == "contribution" {
            (account_id, ledger_account_id.as_str())
        } else {
            (ledger_account_id.as_str(), account_id)
        };
        transaction.execute("INSERT INTO finance_transactions (id,transaction_type,amount,currency,effective_date,account_id,destination_account_id,description,source,status,actor_user_id,created_at,updated_at) VALUES (?1,'transfer',?2,?3,?4,?5,?6,?7,'savings',?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,effective_date=excluded.effective_date,account_id=excluded.account_id,destination_account_id=excluded.destination_account_id,description=excluded.description,status=excluded.status,actor_user_id=excluded.actor_user_id,updated_at=excluded.updated_at", params![format!("savings-movement:{}", movement.id), movement.amount, movement.currency, movement.effective_date, source_account, destination_account, movement.description, movement.status, movement.actor_user_id, timestamp]).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE finance_transactions SET actor_library_user_id=?1 WHERE id=?2",
                params![
                    movement.actor_library_user_id,
                    format!("savings-movement:{}", movement.id)
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(movement.clone())
}

pub fn finance_save_savings_exchange(
    app: crate::host::AppHandle,
    payload: SaveSavingsExchangePayload,
) -> FinanceCommandResult<FinanceSavedSavingsExchange> {
    let exchange = &payload.exchange;
    let actor_library_user_id = payload.context.actor_library_user_id.clone();
    if exchange.id.trim().is_empty()
        || exchange.reserve_id.trim().is_empty()
        || exchange.source_account_id.trim().is_empty()
        || exchange.description.trim().is_empty()
        || !valid_amount(&exchange.source_amount)
        || !valid_amount(&exchange.savings_amount)
        || exchange.effective_date.len() < 10
        || !matches!(exchange.source_currency.as_str(), "ARS" | "USD")
        || !matches!(exchange.savings_currency.as_str(), "ARS" | "USD")
        || exchange.source_currency == exchange.savings_currency
    {
        return Err(
            "La compra para ahorro requiere importes, monedas, fecha y cuentas válidos.".into(),
        );
    }
    let connection = validate_context(&payload.context, &app)?;
    let reserve_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_savings_reserves WHERE id = ?1 AND active = 1",
            [&exchange.reserve_id],
            |row| row.get(0),
        )
        .map_err(|_| "La reserva no existe o está inactiva.".to_string())?;
    if reserve_currency != exchange.savings_currency {
        return Err("La moneda acreditada no coincide con la reserva.".into());
    }
    let source_account_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_accounts WHERE id = ?1 AND active = 1 AND account_type <> 'savings_reserve'",
            [&exchange.source_account_id],
            |row| row.get(0),
        )
        .map_err(|_| "La cuenta de origen no existe, está inactiva o no es una cuenta de pago.".to_string())?;
    if source_account_currency != exchange.source_currency {
        return Err("La moneda de salida no coincide con la cuenta de origen.".into());
    }

    let timestamp = now();
    let movement_id = format!("savings-exchange:{}", exchange.id);
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let source_artifact_id = exchange
        .source_reference
        .as_deref()
        .filter(|reference| !reference.trim().is_empty())
        .map(|_| format!("savings-exchange-source:{}", exchange.id));
    if let (Some(artifact_id), Some(reference)) = (
        source_artifact_id.as_deref(),
        exchange.source_reference.as_deref(),
    ) {
        transaction.execute("INSERT INTO finance_source_artifacts(id,source_type,reference,raw_text,created_at) VALUES(?1,'telegram',?2,?3,?4) ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,raw_text=excluded.raw_text", params![artifact_id, reference, exchange.raw_source, timestamp]).map_err(|error| error.to_string())?;
    }
    transaction.execute("INSERT INTO finance_transactions (id,transaction_type,amount,currency,effective_date,account_id,destination_account_id,category_id,description,source,status,actor_user_id,source_artifact_id,created_at,updated_at) VALUES (?1,'expense',?2,?3,?4,?5,NULL,NULL,?6,'savings_exchange','confirmed',?7,?8,?9,?9) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,effective_date=excluded.effective_date,account_id=excluded.account_id,description=excluded.description,status=excluded.status,actor_user_id=excluded.actor_user_id,source_artifact_id=excluded.source_artifact_id,updated_at=excluded.updated_at", params![exchange.id, exchange.source_amount, exchange.source_currency, exchange.effective_date, exchange.source_account_id, exchange.description, exchange.actor_user_id, source_artifact_id, timestamp]).map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE finance_transactions SET actor_library_user_id=?1 WHERE id=?2",
            params![&actor_library_user_id, exchange.id],
        )
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO finance_savings_movements (id,reserve_id,account_id,movement_type,amount,currency,effective_date,description,reason,source,status,actor_user_id,linked_transaction_id,created_at,updated_at) VALUES (?1,?2,NULL,'contribution',?3,?4,?5,?6,NULL,'savings_exchange','confirmed',?7,?8,?9,?9) ON CONFLICT(id) DO UPDATE SET reserve_id=excluded.reserve_id,amount=excluded.amount,currency=excluded.currency,effective_date=excluded.effective_date,description=excluded.description,status=excluded.status,actor_user_id=excluded.actor_user_id,linked_transaction_id=excluded.linked_transaction_id,updated_at=excluded.updated_at", params![movement_id, exchange.reserve_id, exchange.savings_amount, exchange.savings_currency, exchange.effective_date, exchange.description, exchange.actor_user_id, exchange.id, timestamp]).map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE finance_savings_movements SET actor_library_user_id=?1 WHERE id=?2",
            params![&actor_library_user_id, movement_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(FinanceSavedSavingsExchange {
        movement: FinanceSavingsMovement {
            id: movement_id,
            reserve_id: exchange.reserve_id.clone(),
            account_id: None,
            movement_type: "contribution".into(),
            amount: exchange.savings_amount.clone(),
            currency: exchange.savings_currency.clone(),
            effective_date: exchange.effective_date.clone(),
            description: exchange.description.clone(),
            reason: None,
            source: "savings_exchange".into(),
            status: "confirmed".into(),
            actor_user_id: exchange.actor_user_id,
            actor_library_user_id: Some(actor_library_user_id.clone()),
            linked_transaction_id: Some(exchange.id.clone()),
        },
        transaction: FinanceTransaction {
            id: exchange.id.clone(),
            transaction_type: "expense".into(),
            amount: exchange.source_amount.clone(),
            currency: exchange.source_currency.clone(),
            effective_date: exchange.effective_date.clone(),
            account_id: exchange.source_account_id.clone(),
            destination_account_id: None,
            category_id: None,
            description: exchange.description.clone(),
            source: "savings_exchange".into(),
            status: "confirmed".into(),
            actor_user_id: exchange.actor_user_id,
            actor_library_user_id: Some(actor_library_user_id),
            source_artifact_id,
            service_id: None,
            merchant_id: None,
            operation_fingerprint: None,
            installment_id: None,
            source_reference: exchange.source_reference.clone(),
            raw_source: exchange.raw_source.clone(),
            created_at: None,
            updated_at: None,
        },
    })
}

fn validate_savings_movement(movement: &FinanceSavingsMovement) -> Result<(), String> {
    if !valid_amount(&movement.amount)
        || movement.effective_date.len() < 10
        || !matches!(
            movement.movement_type.as_str(),
            "contribution" | "withdrawal" | "return" | "loss" | "adjustment"
        )
        || !matches!(movement.currency.as_str(), "ARS" | "USD")
        || (movement.movement_type == "withdrawal"
            && movement.reason.as_deref().unwrap_or("").trim().is_empty())
    {
        return Err(
            "El movimiento de ahorro requiere datos válidos y motivo para retiros.".to_string(),
        );
    }
    Ok(())
}

pub fn finance_link_savings_account(
    app: crate::host::AppHandle,
    payload: LinkSavingsAccountPayload,
) -> FinanceCommandResult<()> {
    if payload.reserve_id.trim().is_empty() || payload.account_id.trim().is_empty() {
        return Err("La reserva y la cuenta son obligatorias.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let reserve_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_savings_reserves WHERE id = ?1 AND active = 1",
            [&payload.reserve_id],
            |row| row.get(0),
        )
        .map_err(|_| "La reserva no existe o está inactiva.".to_string())?;
    let account_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_accounts WHERE id = ?1 AND active = 1",
            [&payload.account_id],
            |row| row.get(0),
        )
        .map_err(|_| "La cuenta no existe o está inactiva.".to_string())?;
    if reserve_currency != account_currency {
        return Err("La reserva y la cuenta deben usar la misma moneda.".into());
    }
    connection.execute("INSERT OR IGNORE INTO finance_savings_accounts (reserve_id,account_id,created_at) VALUES (?1,?2,?3)", params![payload.reserve_id, payload.account_id, now()]).map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(())
}

pub fn finance_save_account(
    app: crate::host::AppHandle,
    payload: SaveAccountPayload,
) -> FinanceCommandResult<FinanceAccount> {
    if payload.account.name.trim().is_empty()
        || !matches!(payload.account.currency.as_str(), "ARS" | "USD")
    {
        return Err("La cuenta requiere nombre y moneda válidos.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    connection.execute("INSERT INTO finance_accounts (id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES (?1,?2,?3,?4,'0',?5,?6,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name, account_type=excluded.account_type, currency=excluded.currency, active=excluded.active, updated_at=excluded.updated_at", params![payload.account.id, payload.account.name.trim(), payload.account.account_type, payload.account.currency, payload.account.active as i32, timestamp]).map_err(|e| e.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(payload.account)
}

pub fn finance_save_category(
    app: crate::host::AppHandle,
    payload: SaveCategoryPayload,
) -> FinanceCommandResult<FinanceCategory> {
    if payload.category.name.trim().is_empty()
        || !matches!(payload.category.kind.as_str(), "income" | "expense")
    {
        return Err("La categoría requiere nombre.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    if payload.category.parent_id.as_deref() == Some(payload.category.id.as_str()) {
        return Err("Una categoría no puede ser su propia categoría padre.".into());
    }
    if let Some(parent_id) = payload.category.parent_id.as_deref() {
        let parent_kind: String = connection
            .query_row(
                "SELECT kind FROM finance_categories WHERE id=?1 AND active=1",
                [parent_id],
                |row| row.get(0),
            )
            .map_err(|_| "La categoría padre no existe o está inactiva.".to_string())?;
        if parent_kind != payload.category.kind {
            return Err("La categoría padre debe tener el mismo tipo.".into());
        }
    }
    connection.execute("INSERT INTO finance_categories (id,name,kind,parent_id,active,description,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, parent_id=excluded.parent_id, active=excluded.active, description=excluded.description, updated_at=excluded.updated_at", params![payload.category.id, payload.category.name.trim(), payload.category.kind, payload.category.parent_id, payload.category.active as i32, payload.category.description, timestamp]).map_err(|e| e.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(payload.category)
}

pub fn finance_delete_transaction(
    app: crate::host::AppHandle,
    payload: DeleteFinanceEntityPayload,
) -> FinanceCommandResult<()> {
    if payload.id.trim().is_empty() {
        return Err("El movimiento es obligatorio.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let changed = connection.execute("UPDATE finance_transactions SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![now(), payload.id]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("El movimiento no existe o ya fue eliminado.".into());
    }
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(())
}

pub fn finance_delete_account(
    app: crate::host::AppHandle,
    payload: DeleteFinanceEntityPayload,
) -> FinanceCommandResult<()> {
    if payload.id.trim().is_empty() {
        return Err("La cuenta es obligatoria.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let changed = connection
        .execute(
            "UPDATE finance_accounts SET active = 0, updated_at = ?1 WHERE id = ?2 AND active = 1",
            params![now(), payload.id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("La cuenta no existe o ya está inactiva.".into());
    }
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(())
}

pub fn finance_delete_category(
    app: crate::host::AppHandle,
    payload: DeleteFinanceEntityPayload,
) -> FinanceCommandResult<()> {
    if payload.id.trim().is_empty() {
        return Err("La categoría es obligatoria.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let changed = connection.execute("UPDATE finance_categories SET active = 0, updated_at = ?1 WHERE id = ?2 AND active = 1", params![now(), payload.id]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("La categoría no existe o ya está inactiva.".into());
    }
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(())
}

fn clear_finance_data(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "DELETE FROM finance_audit_decisions;
             DELETE FROM finance_audit_proposals;
             DELETE FROM finance_audit_runs;
             DELETE FROM finance_service_occurrence_versions;
             DELETE FROM finance_service_occurrences;
             DELETE FROM finance_service_invoices;
             DELETE FROM finance_price_observations;
             DELETE FROM finance_extraction_results;
             DELETE FROM finance_salary_concepts;
             DELETE FROM finance_purchase_items;
             DELETE FROM finance_credit_card_statement_items;
             DELETE FROM finance_installments;
             DELETE FROM finance_valuations;
             DELETE FROM finance_savings_accounts;
             DELETE FROM finance_savings_movements;
             DELETE FROM finance_salary_receipts;
             DELETE FROM finance_purchases;
             DELETE FROM finance_credit_card_statements;
             DELETE FROM finance_receipts;
             DELETE FROM finance_installment_plans;
             DELETE FROM finance_investments;
             DELETE FROM finance_transactions;
             DELETE FROM finance_source_artifacts;
             DELETE FROM finance_products;
             DELETE FROM finance_merchants;
             DELETE FROM finance_services;
             DELETE FROM finance_savings_reserves;
             DELETE FROM finance_categories;
             DELETE FROM finance_accounts;",
        )
        .map_err(|error| error.to_string())?;
    crate::database::ensure_default_finance_categories(&transaction)
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn finance_clear_all_data(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<()> {
    let mut connection = validate_context(&context, &app)?;
    clear_finance_data(&mut connection)?;
    drop(connection);
    sync_context(&context, &app)?;
    Ok(())
}

pub fn finance_save_transaction(
    app: crate::host::AppHandle,
    payload: SaveTransactionPayload,
) -> FinanceCommandResult<FinanceTransaction> {
    let transaction = &payload.transaction;
    if !valid_amount(&transaction.amount)
        || !valid_iso_date(&transaction.effective_date)
        || transaction.account_id.trim().is_empty()
        || transaction.account_id.len() > 160
        || !valid_bounded_text(&transaction.description, 1_000, true)
        || transaction
            .source_reference
            .as_deref()
            .map(|value| !valid_bounded_text(value, 512, false))
            .unwrap_or(false)
        || transaction
            .raw_source
            .as_deref()
            .map(|value| !valid_bounded_text(value, 20_000, false))
            .unwrap_or(false)
        || !matches!(
            transaction.transaction_type.as_str(),
            "income" | "expense" | "transfer" | "adjustment"
        )
        || !matches!(transaction.currency.as_str(), "ARS" | "USD")
        || !matches!(
            transaction.status.as_str(),
            "pending" | "confirmed" | "corrected" | "discarded"
        )
    {
        return Err("El movimiento requiere importe, fecha y cuenta válidos.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let account_currency: String = connection
        .query_row(
            "SELECT currency FROM finance_accounts WHERE id = ?1 AND active = 1",
            [&transaction.account_id],
            |row| row.get(0),
        )
        .map_err(|_| "La cuenta de origen no existe o está inactiva.".to_string())?;
    if account_currency != transaction.currency {
        return Err("La moneda del movimiento no coincide con la cuenta.".into());
    }
    if let Some(category_id) = transaction
        .category_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let category_kind: String = connection
            .query_row(
                "SELECT kind FROM finance_categories WHERE id=?1 AND active=1",
                [category_id],
                |row| row.get(0),
            )
            .map_err(|_| "La categoría no existe o está inactiva.".to_string())?;
        if matches!(transaction.transaction_type.as_str(), "income" | "expense")
            && category_kind != transaction.transaction_type
        {
            return Err("La categoría no coincide con el tipo de movimiento.".into());
        }
    }
    if let Some(service_id) = transaction
        .service_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let service_currency: String = connection
            .query_row(
                "SELECT currency FROM finance_services WHERE id=?1 AND active=1",
                [service_id],
                |row| row.get(0),
            )
            .map_err(|_| "El servicio no existe o está inactivo.".to_string())?;
        if transaction.transaction_type != "expense" || service_currency != transaction.currency {
            return Err("El servicio solo puede asociarse a un gasto de su misma moneda.".into());
        }
    }
    if transaction.transaction_type == "transfer" {
        let destination_id = transaction
            .destination_account_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Una transferencia requiere cuenta destino.".to_string())?;
        if destination_id == transaction.account_id {
            return Err("La transferencia debe tener cuentas diferentes.".into());
        }
        let destination_currency: String = connection
            .query_row(
                "SELECT currency FROM finance_accounts WHERE id = ?1 AND active = 1",
                [destination_id],
                |row| row.get(0),
            )
            .map_err(|_| "La cuenta destino no existe o está inactiva.".to_string())?;
        if destination_currency != transaction.currency {
            return Err("Las cuentas de una transferencia deben usar la misma moneda.".into());
        }
    }
    let timestamp = now();
    let mut source_artifact_id = transaction.source_artifact_id.clone();
    let database_transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    if let Some(reference) = transaction
        .source_reference
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let artifact_id = source_artifact_id
            .get_or_insert_with(|| format!("transaction-source:{}", transaction.id));
        database_transaction.execute("INSERT INTO finance_source_artifacts(id,source_type,reference,raw_text,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,raw_text=excluded.raw_text", params![artifact_id.as_str(), payload.context.source, reference, transaction.raw_source, timestamp]).map_err(|error| error.to_string())?;
    }
    database_transaction.execute("INSERT INTO finance_transactions (id,transaction_type,amount,currency,effective_date,account_id,destination_account_id,category_id,description,source,status,actor_user_id,source_artifact_id,service_id,merchant_id,operation_fingerprint,installment_id,source_reference,raw_source,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?20) ON CONFLICT(id) DO UPDATE SET transaction_type=excluded.transaction_type,amount=excluded.amount,currency=excluded.currency,effective_date=excluded.effective_date,account_id=excluded.account_id,destination_account_id=excluded.destination_account_id,category_id=excluded.category_id,description=excluded.description,source=excluded.source,status=excluded.status,actor_user_id=excluded.actor_user_id,source_artifact_id=excluded.source_artifact_id,service_id=excluded.service_id,merchant_id=excluded.merchant_id,operation_fingerprint=COALESCE(excluded.operation_fingerprint,finance_transactions.operation_fingerprint),installment_id=COALESCE(excluded.installment_id,finance_transactions.installment_id),source_reference=excluded.source_reference,raw_source=excluded.raw_source,updated_at=excluded.updated_at", params![transaction.id, transaction.transaction_type, transaction.amount, transaction.currency, transaction.effective_date, transaction.account_id, transaction.destination_account_id, transaction.category_id, transaction.description, payload.context.source, transaction.status, transaction.actor_user_id, source_artifact_id, transaction.service_id, transaction.merchant_id, transaction.operation_fingerprint, transaction.installment_id, transaction.source_reference, transaction.raw_source, timestamp]).map_err(|e| e.to_string())?;
    database_transaction
        .execute(
            "UPDATE finance_transactions SET actor_library_user_id=?1 WHERE id=?2",
            params![payload.context.actor_library_user_id, transaction.id],
        )
        .map_err(|e| e.to_string())?;
    database_transaction
        .commit()
        .map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(transaction.clone())
}

fn finance_list_accounts_inner(connection: &Connection) -> Result<Vec<FinanceAccount>, String> {
    let mut statement = connection.prepare("SELECT id,name,account_type,currency,active FROM finance_accounts WHERE account_type <> 'savings_reserve' ORDER BY name").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(FinanceAccount {
                id: row.get(0)?,
                name: row.get(1)?,
                account_type: row.get(2)?,
                currency: row.get(3)?,
                active: row.get::<_, i32>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn finance_list_savings_inner(
    connection: &Connection,
) -> Result<Vec<FinanceSavingsReserve>, String> {
    let mut statement = connection.prepare("SELECT id,name,currency,opening_balance,objective,active FROM finance_savings_reserves ORDER BY name").map_err(|error| error.to_string())?;
    let reserves = statement
        .query_map([], |row| {
            Ok(FinanceSavingsReserve {
                id: row.get(0)?,
                name: row.get(1)?,
                currency: row.get(2)?,
                opening_balance: row.get(3)?,
                objective: row.get(4)?,
                active: row.get::<_, i32>(5)? != 0,
                balance: "0".to_string(),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    reserves.into_iter().map(|mut reserve| {
        let mut balance = parse_cents(&reserve.opening_balance).unwrap_or_default();
        let mut movements = connection.prepare("SELECT movement_type,amount,status FROM finance_savings_movements WHERE reserve_id = ?1").map_err(|error| error.to_string())?;
        let rows = movements.query_map([&reserve.id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))).map_err(|error| error.to_string())?;
        for row in rows {
            let (kind, amount, status) = row.map_err(|error| error.to_string())?;
            apply_savings_movement(&mut balance, &kind, &amount, &status);
        }
        reserve.balance = format_cents(balance);
        Ok(reserve)
    }).collect()
}

fn finance_list_savings_movements_inner(
    connection: &Connection,
    month: &str,
) -> Result<Vec<FinanceSavingsMovement>, String> {
    let mut statement=connection.prepare("SELECT id,reserve_id,account_id,movement_type,amount,currency,effective_date,description,reason,source,status,actor_user_id,linked_transaction_id,actor_library_user_id FROM finance_savings_movements WHERE effective_date LIKE ?1 || '%' ORDER BY effective_date DESC,created_at DESC LIMIT 500").map_err(|error|error.to_string())?;
    let movements = statement
        .query_map([month], |row| {
            Ok(FinanceSavingsMovement {
                id: row.get(0)?,
                reserve_id: row.get(1)?,
                account_id: row.get(2)?,
                movement_type: row.get(3)?,
                amount: row.get(4)?,
                currency: row.get(5)?,
                effective_date: row.get(6)?,
                description: row.get(7)?,
                reason: row.get(8)?,
                source: row.get(9)?,
                status: row.get(10)?,
                actor_user_id: row.get(11)?,
                actor_library_user_id: row.get(13)?,
                linked_transaction_id: row.get(12)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(movements)
}

fn finance_list_savings_movements_all_inner(
    connection: &Connection,
) -> Result<Vec<FinanceSavingsMovement>, String> {
    let mut statement = connection
        .prepare("SELECT id,reserve_id,account_id,movement_type,amount,currency,effective_date,description,reason,source,status,actor_user_id,linked_transaction_id,actor_library_user_id FROM finance_savings_movements ORDER BY effective_date DESC,created_at DESC LIMIT 5000")
        .map_err(|error| error.to_string())?;
    let result = statement
        .query_map([], |row| {
            Ok(FinanceSavingsMovement {
                id: row.get(0)?,
                reserve_id: row.get(1)?,
                account_id: row.get(2)?,
                movement_type: row.get(3)?,
                amount: row.get(4)?,
                currency: row.get(5)?,
                effective_date: row.get(6)?,
                description: row.get(7)?,
                reason: row.get(8)?,
                source: row.get(9)?,
                status: row.get(10)?,
                actor_user_id: row.get(11)?,
                linked_transaction_id: row.get(12)?,
                actor_library_user_id: row.get(13)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string());
    result
}

fn finance_list_merchants_inner(connection: &Connection) -> Result<Vec<FinanceMerchant>, String> {
    connection
        .prepare("SELECT id,name FROM finance_merchants ORDER BY name")
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok(FinanceMerchant {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn finance_list_categories_inner(connection: &Connection) -> Result<Vec<FinanceCategory>, String> {
    connection
        .prepare("SELECT id,name,kind,active,parent_id,description FROM finance_categories ORDER BY name")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok(FinanceCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                active: row.get::<_, i32>(3)? != 0,
                parent_id: row.get(4)?,
                description: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[allow(dead_code)]
fn new_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        apply_audit_proposal_change, apply_savings_movement, clear_finance_data,
        execute_deterministic_audit, finance_dev_query, finance_list_accounts_inner, format_cents,
        parse_cents, seed_finance_demo_data, valid_amount, validate_finance_dev_sql,
        validate_savings_movement, FinanceCommandError, FinanceContext, FinanceSavingsMovement,
        RunFinanceAuditPayload, FINANCE_DEV_TABLES,
    };
    use rusqlite::{params, Connection};

    #[test]
    fn accepts_exact_decimal_amounts_without_float_conversion() {
        assert!(valid_amount("1500.25"));
        assert!(valid_amount("0"));
        assert!(!valid_amount("1,500"));
        assert!(!valid_amount(""));
    }

    #[test]
    fn keeps_decimal_values_in_minor_units() {
        assert_eq!(parse_cents("1500.25"), Ok(150025));
        assert_eq!(parse_cents("-0.50"), Err(()));
        assert_eq!(parse_cents("12.345"), Err(()));
        assert_eq!(format_cents(-50), "-0.50");
    }

    #[test]
    fn rejects_invalid_calendar_dates_without_panicking() {
        assert!(super::valid_iso_date("2024-02-29"));
        assert!(!super::valid_iso_date("2023-02-29"));
        assert!(!super::valid_iso_date("2026-04-31"));
        assert!(!super::valid_iso_date("2026-1-01"));
        assert!(!super::valid_iso_date("á2026-01-01"));
    }

    #[test]
    fn payment_accounts_are_references_and_hide_internal_savings_ledgers() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        crate::database::migrate(&connection).expect("finance migrations");
        connection.execute("INSERT INTO finance_accounts(id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES('account','Digital','bank','ARS','100.00',1,'now','now')", []).expect("account fixture");
        for (id, kind, amount, date) in [
            ("old-salary", "income", "900.00", "2026-07-31"),
            ("current-salary", "income", "200.00", "2026-08-01"),
            ("current-expense", "expense", "50.00", "2026-08-02"),
        ] {
            connection.execute("INSERT INTO finance_transactions(id,transaction_type,amount,currency,effective_date,account_id,description,source,status,created_at,updated_at) VALUES(?1,?2,?3,'ARS',?4,'account','Prueba','manual','confirmed','now','now')", params![id, kind, amount, date]).expect("transaction fixture");
        }

        connection.execute("INSERT INTO finance_accounts(id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES('savings:reserve','Reserva','savings_reserve','ARS','0',1,'now','now')", []).expect("savings ledger fixture");

        let accounts =
            finance_list_accounts_inner(&connection).expect("payment account references");

        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "account");
        assert_eq!(
            serde_json::to_value(&accounts[0]).expect("serialize account reference"),
            serde_json::json!({
                "id": "account",
                "name": "Digital",
                "accountType": "bank",
                "currency": "ARS",
                "active": true
            })
        );
    }

    #[test]
    fn finance_dev_queries_are_paginated_and_read_only() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch("CREATE TABLE finance_test(id INTEGER, label TEXT); INSERT INTO finance_test VALUES(1, 'uno'), (2, 'dos');").expect("fixture");

        let result = finance_dev_query(
            &connection,
            "SELECT id, label FROM finance_test ORDER BY id",
            1,
            1,
        )
        .expect("dev query");

        assert_eq!(result.columns, ["id", "label"]);
        assert_eq!(result.total_rows, 2);
        assert_eq!(
            result.rows,
            vec![vec![Some("2".into()), Some("dos".into())]]
        );
        assert!(validate_finance_dev_sql("DELETE FROM finance_test").is_err());
        assert!(
            validate_finance_dev_sql("SELECT * FROM finance_test; DELETE FROM finance_test")
                .is_err()
        );
    }

    #[test]
    fn finance_dev_seed_populates_every_entity_for_two_months_without_duplicates() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        crate::database::migrate(&connection).expect("finance migrations");

        seed_finance_demo_data(&mut connection).expect("first demo seed");
        seed_finance_demo_data(&mut connection).expect("idempotent demo seed");

        for table in FINANCE_DEV_TABLES {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("finance table count");
            assert!(count > 0, "{table} should contain demo data");
        }
        let periods: i64 = connection
            .query_row(
                "SELECT COUNT(DISTINCT substr(effective_date, 1, 7)) FROM finance_transactions WHERE id LIKE 'dev-%'",
                [],
                |row| row.get(0),
            )
            .expect("demo transaction periods");
        assert_eq!(periods, 2);
        let salary_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM finance_salary_receipts WHERE id LIKE 'dev-%'",
                [],
                |row| row.get(0),
            )
            .expect("demo salaries");
        assert_eq!(salary_count, 2);
    }

    #[test]
    fn classifies_ticket_arithmetic_errors_as_validation() {
        let error = FinanceCommandError::from(
            "La compra no puede confirmarse: existe una diferencia de 10.00.".to_string(),
        );
        assert_eq!(error.code, "validation");
    }

    #[test]
    fn classifies_an_already_registered_ticket_as_conflict() {
        let error = FinanceCommandError::from("El ticket ya fue registrado anteriormente.");

        assert_eq!(error.code, "conflict");
    }

    #[test]
    fn clears_finance_data_and_restores_default_categories_without_removing_migrations() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        crate::database::migrate(&connection).expect("finance migrations");
        connection
            .execute(
                "INSERT INTO finance_accounts(id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES(?1,'Efectivo','cash','ARS','100',1,'now','now')",
                params!["account"],
            )
            .expect("account fixture");
        connection
            .execute(
                "INSERT INTO finance_transactions(id,transaction_type,amount,currency,effective_date,account_id,description,source,status,created_at,updated_at) VALUES('transaction','expense','10','ARS','2026-08-31',?1,'Prueba','manual','confirmed','now','now')",
                params!["account"],
            )
            .expect("transaction fixture");

        clear_finance_data(&mut connection).expect("clear finance data");

        for table in [
            "finance_accounts",
            "finance_transactions",
            "finance_source_artifacts",
            "finance_purchases",
            "finance_salary_receipts",
            "finance_savings_reserves",
            "finance_installment_plans",
            "finance_investments",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("finance table count");
            assert_eq!(count, 0, "{table} should be empty");
        }
        let categories: Vec<String> = connection
            .prepare("SELECT name FROM finance_categories ORDER BY name")
            .expect("default category query")
            .query_map([], |row| row.get(0))
            .expect("default category rows")
            .collect::<Result<_, _>>()
            .expect("default categories");
        assert_eq!(categories.len(), 10);
        assert!(categories.iter().any(|name| name == "Alimentación"));
        assert!(categories.iter().any(|name| name == "Otros"));
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM notia_schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");
        assert!(migration_count > 0);
    }

    #[test]
    fn calculates_savings_from_confirmed_and_corrected_movements_only() {
        let mut balance = parse_cents("100.00").expect("opening balance");
        apply_savings_movement(&mut balance, "contribution", "50.25", "confirmed");
        apply_savings_movement(&mut balance, "withdrawal", "10.00", "confirmed");
        apply_savings_movement(&mut balance, "loss", "5.25", "pending");
        apply_savings_movement(&mut balance, "return", "1.00", "corrected");
        assert_eq!(format_cents(balance), "141.25");
    }

    #[test]
    fn savings_transfers_do_not_become_income_or_expense() {
        let movement_types = ["contribution", "withdrawal"];
        assert!(movement_types
            .iter()
            .all(|kind| !matches!(*kind, "income" | "expense")));
    }

    #[test]
    fn withdrawals_require_an_auditable_reason() {
        let movement = FinanceSavingsMovement {
            id: "movement".into(),
            reserve_id: "reserve".into(),
            account_id: Some("account".into()),
            movement_type: "withdrawal".into(),
            amount: "10.00".into(),
            currency: "ARS".into(),
            effective_date: "2026-08-29".into(),
            description: "Retiro".into(),
            reason: None,
            source: "manual".into(),
            status: "confirmed".into(),
            actor_user_id: None,
            actor_library_user_id: None,
            linked_transaction_id: None,
        };
        assert!(validate_savings_movement(&movement).is_err());
        assert!(validate_savings_movement(&FinanceSavingsMovement {
            reason: Some("Compra futura".into()),
            ..movement
        })
        .is_ok());
    }

    #[test]
    fn currencies_are_accumulated_independently() {
        let mut totals = std::collections::BTreeMap::new();
        super::add_currency_total(&mut totals, "ARS", "10.25");
        super::add_currency_total(&mut totals, "USD", "2.50");
        assert_eq!(totals.get("ARS"), Some(&1025));
        assert_eq!(totals.get("USD"), Some(&250));
    }

    #[test]
    fn limits_finance_history_to_twelve_months() {
        assert_eq!(
            super::finance_history_start_period("2026-09"),
            Ok("2025-10".into())
        );
        assert_eq!(
            super::finance_history_start_period("2026-01"),
            Ok("2025-02".into())
        );
    }

    #[test]
    fn applies_structured_audit_change_and_preserves_occurrence_history() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        crate::database::migrate(&connection).expect("finance migrations");
        connection.execute("INSERT INTO finance_categories(id,name,kind,active,created_at,updated_at) VALUES('category','Servicios','expense',1,'now','now')", []).expect("category fixture");
        connection.execute("INSERT INTO finance_services(id,name,normalized_name,category_id,currency,expected_amount,modality,active,created_at,updated_at) VALUES('service','Internet','internet','category','ARS','100.00','fixed',1,'now','now')", []).expect("service fixture");
        connection.execute("INSERT INTO finance_service_occurrences(id,service_id,period,expected_amount,paid_amount,effective_date,status,source,created_at,updated_at) VALUES('occurrence','service','2026-08','100.00','150.00','2026-08-15','current','app','now','now')", []).expect("occurrence fixture");
        let transaction = connection.transaction().expect("transaction");
        apply_audit_proposal_change(
            &transaction,
            "amount-variation",
            Some("service"),
            "2026-08",
            "{\"expected\":\"100.00\",\"paid\":\"150.00\"}",
            "{\"operation\":\"set_occurrence_expected_amount\",\"parameters\":{\"serviceId\":\"service\",\"period\":\"2026-08\",\"expectedAmount\":\"150.00\"}}",
            Some("user-owner"),
            "app",
            None,
        ).expect("structured change");
        transaction.commit().expect("commit");

        let expected: String = connection
            .query_row(
                "SELECT expected_amount FROM finance_service_occurrences WHERE id='occurrence'",
                [],
                |row| row.get(0),
            )
            .expect("updated expected amount");
        let versions: i64 = connection.query_row("SELECT COUNT(*) FROM finance_service_occurrence_versions WHERE occurrence_id='occurrence'", [], |row| row.get(0)).expect("history count");
        assert_eq!(expected, "150.00");
        assert_eq!(versions, 1);
    }

    #[test]
    fn rejects_unstructured_audit_changes_before_persisting_anything() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        let transaction = connection.unchecked_transaction().expect("transaction");
        let error = apply_audit_proposal_change(
            &transaction,
            "contextual",
            None,
            "2026-08",
            "{}",
            "Cambiar algo",
            Some("user-owner"),
            "app",
            None,
        )
        .expect_err("free-form change must be rejected");
        assert!(error.contains("acción estructurada"));
    }

    #[test]
    fn audit_returns_a_result_when_card_evidence_covers_an_unpaid_occurrence() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        crate::database::migrate(&connection).expect("finance migrations");
        seed_finance_demo_data(&mut connection).expect("demo fixture");
        connection
            .execute_batch(
                // Its own card: the demo seed already has an August statement.
                "INSERT INTO finance_accounts(id,name,account_type,currency,opening_balance,active,created_at,updated_at)
                 VALUES('audit-card-account','Tarjeta auditoría','credit_card','ARS','0.00',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
                 INSERT INTO finance_source_artifacts(id,source_type,reference,raw_text,created_at)
                 VALUES('audit-card-artifact','credit_card_statement','audit-card.pdf','Resumen de auditoría',CURRENT_TIMESTAMP);
                 INSERT INTO finance_services(id,name,normalized_name,category_id,currency,expected_amount,modality,active,created_at,updated_at)
                 VALUES('audit-service','Movistar','movistar','dev-category-food','ARS','82997.00','fixed',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
                 INSERT INTO finance_service_occurrences(id,service_id,period,expected_amount,paid_amount,effective_date,status,source,created_at,updated_at)
                 VALUES('audit-occurrence','audit-service','2026-08','82997.00',NULL,NULL,'current','test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
                 INSERT INTO finance_transactions(id,transaction_type,amount,currency,effective_date,account_id,description,source,status,created_at,updated_at)
                 VALUES('audit-card-transaction','expense','82997.00','ARS','2026-08-19','audit-card-account','MOVISTAR ARGENTINA 82997','credit_card_statement','confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
                 INSERT INTO finance_credit_card_statements(id,account_id,issuer,card_last_four,period,closing_date,due_date,currency,previous_balance,payments_amount,credits_amount,purchases_amount,fees_amount,interest_amount,taxes_amount,total_due,minimum_payment,source_artifact_id,validation_status,created_at,updated_at)
                 VALUES('audit-card-statement','audit-card-account','Banco Test','9999','2026-08','2026-08-25','2026-09-05','ARS','0.00','0.00','0.00','82997.00','0.00','0.00','0.00','82997.00','8299.70','audit-card-artifact','confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
                 INSERT INTO finance_credit_card_statement_items(id,statement_id,transaction_id,purchase_date,description,amount,currency,item_type,created_at)
                 VALUES('audit-card-item','audit-card-statement','audit-card-transaction','2026-08-19','MOVISTAR ARGENTINA 82997','82997.00','ARS','purchase',CURRENT_TIMESTAMP);",
            )
            .expect("card audit fixture");

        let result = execute_deterministic_audit(
            &mut connection,
            &RunFinanceAuditPayload {
                context: FinanceContext {
                    library_path: String::new(),
                    android_directory_uri: None,
                    actor_library_user_id: "test-user".into(),
                    source: "test".into(),
                },
                period: "2026-08".into(),
                trigger_fingerprint: "audit-card-regression".into(),
                reason: None,
            },
        )
        .expect("card evidence should not panic the audit");

        // The card statement covers the Movistar occurrence; the demo seed
        // keeps its own unpaid service, which may be reported.
        assert!(result.proposals.iter().all(|proposal| {
            proposal.proposal_type != "service-unpaid" || proposal.service_id.as_deref() != Some("audit-service")
        }));
    }
}
