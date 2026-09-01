use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, types::ValueRef, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceContext {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAccount {
    pub id: String,
    pub name: String,
    pub account_type: String,
    pub currency: String,
    pub opening_balance: String,
    pub active: bool,
    pub current_balance: String,
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
    pub source_artifact_id: Option<String>,
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
    pub income_total: String,
    pub expense_total: String,
    pub net_total: String,
    pub income_by_currency: BTreeMap<String, String>,
    pub expense_by_currency: BTreeMap<String, String>,
    pub net_by_currency: BTreeMap<String, String>,
    pub savings: Vec<FinanceSavingsReserve>,
    pub savings_movements: Vec<FinanceSavingsMovement>,
    pub merchants: Vec<FinanceMerchant>,
    pub balance_history: Vec<FinanceMonthlyBalance>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceMonthlyBalance {
    pub month: String,
    pub by_currency: BTreeMap<String, String>,
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
    pub linked_transaction_id: Option<String>,
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

#[tauri::command]
pub fn finance_dev_list_tables() -> Vec<FinanceDevTable> {
    FINANCE_DEV_TABLES
        .iter()
        .map(|name| FinanceDevTable { name })
        .collect()
}

#[tauri::command]
pub fn finance_dev_query_table(
    app: tauri::AppHandle,
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

#[tauri::command]
pub fn finance_dev_query_sql(
    app: tauri::AppHandle,
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
                ('dev-statement-item-aug-interest','dev-statement-aug',NULL,'2026-08-25','Interés demo','250.00','ARS','interest',NULL,NULL,CURRENT_TIMESTAMP);",
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn finance_dev_seed_demo_data(
    app: tauri::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<()> {
    let mut connection = validate_context(&context, &app)?;
    seed_finance_demo_data(&mut connection)?;
    sync_context(&context, &app)?;
    Ok(())
}
pub(crate) fn validate_context(
    context: &FinanceContext,
    app: &tauri::AppHandle,
) -> Result<Connection, String> {
    #[cfg(target_os = "android")]
    {
        let directory_uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La biblioteca perdió su URI SAF. Volvé a seleccionarla.".to_string())?;
        crate::database::open_mobile_library_connection(app, directory_uri)
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
        open_library_connection(&context.library_path)
    }
}

pub(crate) fn sync_context(context: &FinanceContext, app: &tauri::AppHandle) -> Result<(), String> {
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
    let (negative, unsigned) = trimmed
        .strip_prefix('-')
        .map_or((false, trimmed), |rest| (true, rest));
    let mut parts = unsigned.split('.');
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
    Ok(if negative { -result } else { result })
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
    if status != "confirmed" {
        return;
    }
    let amount = parse_cents(amount).unwrap_or_default();
    if matches!(movement_type, "contribution" | "return" | "adjustment") {
        *balance += amount;
    } else if matches!(movement_type, "withdrawal" | "loss") {
        *balance -= amount;
    }
}

#[tauri::command]
pub fn finance_get_dashboard(
    app: tauri::AppHandle,
    context: FinanceContext,
    month: String,
) -> FinanceCommandResult<FinanceDashboard> {
    let connection = validate_context(&context, &app)?;
    let accounts = finance_list_accounts_inner(&connection)?;
    let categories = finance_list_categories_inner(&connection)?;
    let mut statement = connection.prepare("SELECT t.id, t.transaction_type, t.amount, t.currency, t.effective_date, t.account_id, t.destination_account_id, t.category_id, t.description, t.source, t.status, t.actor_user_id, t.source_artifact_id, t.merchant_id, t.operation_fingerprint, t.installment_id, a.reference, a.raw_text, t.created_at, t.updated_at FROM finance_transactions t LEFT JOIN finance_source_artifacts a ON a.id=t.source_artifact_id WHERE t.deleted_at IS NULL AND t.effective_date LIKE ?1 || '%' ORDER BY t.effective_date DESC, t.created_at DESC LIMIT 500") .map_err(|e| e.to_string())?;
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
                source_artifact_id: row.get(12)?,
                merchant_id: row.get(13)?,
                operation_fingerprint: row.get(14)?,
                installment_id: row.get(15)?,
                source_reference: row.get(16)?,
                raw_source: row.get(17)?,
                created_at: row.get(18)?,
                updated_at: row.get(19)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut income_by_currency = BTreeMap::new();
    let mut expense_by_currency = BTreeMap::new();
    for transaction in transactions
        .iter()
        .filter(|item| item.status == "confirmed")
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
    Ok(FinanceDashboard {
        accounts,
        categories,
        transactions,
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
        savings: finance_list_savings_inner(&connection)?,
        savings_movements: finance_list_savings_movements_inner(&connection, &month)?,
        merchants: finance_list_merchants_inner(&connection)?,
        balance_history: finance_balance_history(&connection)?,
    })
}

fn finance_balance_history(connection: &Connection) -> Result<Vec<FinanceMonthlyBalance>, String> {
    let mut balances: BTreeMap<String, i128> = BTreeMap::new();
    let mut accounts = connection
        .prepare("SELECT currency,opening_balance FROM finance_accounts WHERE active=1")
        .map_err(|error| error.to_string())?;
    for row in accounts
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
    {
        let (currency, amount) = row.map_err(|error| error.to_string())?;
        *balances.entry(currency).or_default() += parse_cents(&amount).unwrap_or_default();
    }
    let mut statement=connection.prepare("SELECT substr(effective_date,1,7),transaction_type,currency,amount FROM finance_transactions WHERE deleted_at IS NULL AND status='confirmed' ORDER BY effective_date,created_at").map_err(|error|error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut snapshots: BTreeMap<String, BTreeMap<String, i128>> = BTreeMap::new();
    for row in rows {
        let (month, kind, currency, amount) = row.map_err(|error| error.to_string())?;
        let cents = parse_cents(&amount).unwrap_or_default();
        let delta = match kind.as_str() {
            "income" => cents,
            "expense" => -cents,
            "adjustment" => cents,
            _ => 0,
        };
        *balances.entry(currency).or_default() += delta;
        snapshots.insert(month, balances.clone());
    }
    Ok(snapshots
        .into_iter()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|(month, values)| FinanceMonthlyBalance {
            month,
            by_currency: values
                .into_iter()
                .map(|(currency, value)| (currency, format_cents(value)))
                .collect(),
        })
        .collect())
}

#[tauri::command]
pub fn finance_save_savings_reserve(
    app: tauri::AppHandle,
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

#[tauri::command]
pub fn finance_save_savings_movement(
    app: tauri::AppHandle,
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
    }
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(movement.clone())
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

#[tauri::command]
pub fn finance_link_savings_account(
    app: tauri::AppHandle,
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

#[tauri::command]
pub fn finance_save_account(
    app: tauri::AppHandle,
    payload: SaveAccountPayload,
) -> FinanceCommandResult<FinanceAccount> {
    if payload.account.name.trim().is_empty()
        || !valid_amount(&payload.account.opening_balance)
        || !matches!(payload.account.currency.as_str(), "ARS" | "USD")
    {
        return Err("La cuenta requiere nombre y saldo válido.".into());
    }
    let connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    connection.execute("INSERT INTO finance_accounts (id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name, account_type=excluded.account_type, currency=excluded.currency, opening_balance=excluded.opening_balance, active=excluded.active, updated_at=excluded.updated_at", params![payload.account.id, payload.account.name.trim(), payload.account.account_type, payload.account.currency, payload.account.opening_balance, payload.account.active as i32, timestamp]).map_err(|e| e.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(payload.account)
}

#[tauri::command]
pub fn finance_save_category(
    app: tauri::AppHandle,
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

#[tauri::command]
pub fn finance_delete_transaction(
    app: tauri::AppHandle,
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

#[tauri::command]
pub fn finance_delete_account(
    app: tauri::AppHandle,
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

#[tauri::command]
pub fn finance_delete_category(
    app: tauri::AppHandle,
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
            "DELETE FROM finance_price_observations;
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
             DELETE FROM finance_savings_reserves;
             DELETE FROM finance_categories;
             DELETE FROM finance_accounts;",
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn finance_clear_all_data(
    app: tauri::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<()> {
    let mut connection = validate_context(&context, &app)?;
    clear_finance_data(&mut connection)?;
    drop(connection);
    sync_context(&context, &app)?;
    Ok(())
}

#[tauri::command]
pub fn finance_save_transaction(
    app: tauri::AppHandle,
    payload: SaveTransactionPayload,
) -> FinanceCommandResult<FinanceTransaction> {
    let transaction = &payload.transaction;
    if !valid_amount(&transaction.amount)
        || transaction.effective_date.len() < 10
        || transaction.account_id.trim().is_empty()
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
        database_transaction.execute("INSERT INTO finance_source_artifacts(id,source_type,reference,raw_text,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,raw_text=excluded.raw_text", params![artifact_id.as_str(), transaction.source, reference, transaction.raw_source, timestamp]).map_err(|error| error.to_string())?;
    }
    database_transaction.execute("INSERT INTO finance_transactions (id,transaction_type,amount,currency,effective_date,account_id,destination_account_id,category_id,description,source,status,actor_user_id,source_artifact_id,merchant_id,operation_fingerprint,installment_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17) ON CONFLICT(id) DO UPDATE SET transaction_type=excluded.transaction_type,amount=excluded.amount,currency=excluded.currency,effective_date=excluded.effective_date,account_id=excluded.account_id,destination_account_id=excluded.destination_account_id,category_id=excluded.category_id,description=excluded.description,source=excluded.source,status=excluded.status,actor_user_id=excluded.actor_user_id,source_artifact_id=excluded.source_artifact_id,merchant_id=excluded.merchant_id,operation_fingerprint=COALESCE(excluded.operation_fingerprint,finance_transactions.operation_fingerprint),installment_id=COALESCE(excluded.installment_id,finance_transactions.installment_id),updated_at=excluded.updated_at", params![transaction.id, transaction.transaction_type, transaction.amount, transaction.currency, transaction.effective_date, transaction.account_id, transaction.destination_account_id, transaction.category_id, transaction.description, transaction.source, transaction.status, transaction.actor_user_id, source_artifact_id, transaction.merchant_id, transaction.operation_fingerprint, transaction.installment_id, timestamp]).map_err(|e| e.to_string())?;
    database_transaction
        .commit()
        .map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(transaction.clone())
}

fn finance_list_accounts_inner(connection: &Connection) -> Result<Vec<FinanceAccount>, String> {
    let current_month: String = connection
        .query_row("SELECT strftime('%Y-%m', 'now', 'localtime')", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    finance_list_accounts_for_month_inner(connection, &current_month)
}

fn finance_list_accounts_for_month_inner(
    connection: &Connection,
    current_month: &str,
) -> Result<Vec<FinanceAccount>, String> {
    let mut statement = connection.prepare("SELECT id,name,account_type,currency,opening_balance,active FROM finance_accounts ORDER BY name").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let opening_balance: String = row.get(4)?;
            Ok(FinanceAccount {
                id,
                name: row.get(1)?,
                account_type: row.get(2)?,
                currency: row.get(3)?,
                opening_balance: opening_balance.clone(),
                active: row.get::<_, i32>(5)? != 0,
                current_balance: opening_balance,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut accounts = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for account in &mut accounts {
        let mut balance = parse_cents(&account.opening_balance).unwrap_or_default();
        let mut movements = connection.prepare("SELECT transaction_type, amount, destination_account_id, account_id FROM finance_transactions WHERE deleted_at IS NULL AND status = 'confirmed' AND substr(effective_date, 1, 7) = ?2 AND (account_id = ?1 OR destination_account_id = ?1)").map_err(|e| e.to_string())?;
        let movement_rows = movements
            .query_map(params![&account.id, current_month], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for movement in movement_rows {
            let (kind, amount, destination, source) = movement.map_err(|e| e.to_string())?;
            let amount = parse_cents(&amount).unwrap_or_default();
            if kind == "income"
                || (kind == "adjustment" && source == account.id)
                || (kind == "transfer"
                    && destination.as_deref() == Some(account.id.as_str())
                    && source != account.id)
            {
                balance += amount;
            }
            if kind == "expense"
                || (kind == "transfer"
                    && source == account.id
                    && destination.as_deref() != Some(account.id.as_str()))
            {
                balance -= amount;
            }
        }
        account.current_balance = format_cents(balance);
    }
    Ok(accounts)
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
    let mut statement=connection.prepare("SELECT id,reserve_id,account_id,movement_type,amount,currency,effective_date,description,reason,source,status,actor_user_id,linked_transaction_id FROM finance_savings_movements WHERE effective_date LIKE ?1 || '%' ORDER BY effective_date DESC,created_at DESC LIMIT 500").map_err(|error|error.to_string())?;
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
                linked_transaction_id: row.get(12)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(movements)
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
        apply_savings_movement, clear_finance_data, finance_dev_query,
        finance_list_accounts_for_month_inner, format_cents, parse_cents, seed_finance_demo_data,
        valid_amount, validate_finance_dev_sql, validate_savings_movement, FinanceCommandError,
        FinanceSavingsMovement, FINANCE_DEV_TABLES,
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
        assert_eq!(parse_cents("-0.50"), Ok(-50));
        assert_eq!(parse_cents("12.345"), Err(()));
        assert_eq!(format_cents(-50), "-0.50");
    }

    #[test]
    fn account_current_balance_ignores_confirmed_historical_movements() {
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

        let accounts = finance_list_accounts_for_month_inner(&connection, "2026-08")
            .expect("account balances");

        assert_eq!(accounts[0].current_balance, "250.00");
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
    fn clears_every_finance_table_without_removing_migrations() {
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
            "finance_categories",
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
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM notia_schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");
        assert!(migration_count > 0);
    }

    #[test]
    fn calculates_savings_only_from_confirmed_movements() {
        let mut balance = parse_cents("100.00").expect("opening balance");
        apply_savings_movement(&mut balance, "contribution", "50.25", "confirmed");
        apply_savings_movement(&mut balance, "withdrawal", "10.00", "confirmed");
        apply_savings_movement(&mut balance, "loss", "5.25", "pending");
        assert_eq!(format_cents(balance), "140.25");
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
}
