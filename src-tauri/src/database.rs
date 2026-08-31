use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, State, Wry,
};

const NOTIA_DIRECTORY: &str = ".notia";
const DATABASE_FILE_NAME: &str = "notia.db";
pub const CURRENT_SCHEMA_VERSION: i64 = 10;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeLibraryDatabasePayload {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
}

pub struct LibraryDatabaseState {
    #[cfg(target_os = "android")]
    handle: std::sync::Mutex<Option<PluginHandle<Wry>>>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileDatabaseResult {
    ok: bool,
    database_path: Option<String>,
    error: Option<String>,
}

#[cfg(target_os = "android")]
pub fn open_mobile_library_connection(
    app: &tauri::AppHandle,
    directory_uri: &str,
) -> Result<Connection, String> {
    let state = app.state::<LibraryDatabaseState>();
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al adaptador SQLite Android.".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "El adaptador SQLite Android no está disponible.".to_string())?;
    let result = handle
        .run_mobile_plugin::<MobileDatabaseResult>(
            "prepareDatabase",
            serde_json::json!({ "libraryUri": directory_uri }),
        )
        .map_err(|error| format!("No se pudo preparar SQLite en Android: {error}"))?;
    if !result.ok {
        return Err(result.error.unwrap_or_else(|| {
            "No se pudo acceder a SQLite. Revisá el permiso de la carpeta de la biblioteca.".into()
        }));
    }
    let path = result
        .database_path
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "El adaptador Android no devolvió la copia SQLite temporal.".to_string())?;
    let connection = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la copia SQLite Android: {error}"))?;
    migrate(&connection).map_err(|error| format!("No se pudo migrar SQLite Android: {error}"))?;
    Ok(connection)
}

#[cfg(target_os = "android")]
pub fn sync_mobile_library_connection(
    app: &tauri::AppHandle,
    directory_uri: &str,
) -> Result<(), String> {
    let state = app.state::<LibraryDatabaseState>();
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al adaptador SQLite Android.".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "El adaptador SQLite Android no está disponible.".to_string())?;
    let result = handle
        .run_mobile_plugin::<MobileDatabaseResult>(
            "syncDatabase",
            serde_json::json!({ "libraryUri": directory_uri }),
        )
        .map_err(|error| format!("No se pudo sincronizar SQLite por SAF: {error}"))?;
    if result.ok {
        Ok(())
    } else {
        Err(result.error.unwrap_or_else(|| {
            "No se pudo sincronizar SQLite. Volvé a autorizar la carpeta de la biblioteca.".into()
        }))
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeLibraryDatabaseResult {
    pub ok: bool,
    pub database_path: Option<String>,
    pub schema_version: Option<i64>,
    pub error: Option<String>,
}

fn database_path(library_path: &str) -> Result<PathBuf, String> {
    let trimmed_library_path = library_path.trim();
    if trimmed_library_path.is_empty() {
        return Err("La ruta de la librería es obligatoria.".to_string());
    }
    let library_root = Path::new(trimmed_library_path);
    if !library_root.is_dir() {
        return Err("La ruta de la librería no es un directorio válido.".to_string());
    }
    Ok(library_root.join(NOTIA_DIRECTORY).join(DATABASE_FILE_NAME))
}

pub fn migrate(connection: &Connection) -> Result<i64, rusqlite::Error> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = DELETE;
         CREATE TABLE IF NOT EXISTS notia_schema_migrations (
             version INTEGER PRIMARY KEY,
             applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );",
    )?;
    let current_version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM notia_schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if current_version < 2 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS finance_accounts (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, account_type TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                opening_balance TEXT NOT NULL DEFAULT '0', active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_categories (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
                parent_id TEXT REFERENCES finance_categories(id), active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_transactions (
                id TEXT PRIMARY KEY, transaction_type TEXT NOT NULL,
                amount TEXT NOT NULL, currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                effective_date TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES finance_accounts(id),
                destination_account_id TEXT REFERENCES finance_accounts(id), category_id TEXT REFERENCES finance_categories(id),
                description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, status TEXT NOT NULL,
                source_artifact_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE IF NOT EXISTS finance_merchants (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_source_artifacts (
                id TEXT PRIMARY KEY, source_type TEXT NOT NULL, reference TEXT,
                raw_text TEXT, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions(effective_date);
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_account ON finance_transactions(account_id);
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_category ON finance_transactions(category_id);
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_status ON finance_transactions(status);
            INSERT OR IGNORE INTO finance_categories (id, name, kind, created_at, updated_at) VALUES
                ('category-other', 'Otros', 'expense', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO notia_schema_migrations (version) VALUES (2);",
        )?;
        transaction.commit()?;
    }
    if current_version < 3 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS finance_extraction_results (
                id TEXT PRIMARY KEY, source_artifact_id TEXT NOT NULL REFERENCES finance_source_artifacts(id),
                extractor TEXT NOT NULL, raw_result TEXT NOT NULL, confidence REAL,
                status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_receipts (
                id TEXT PRIMARY KEY, source_artifact_id TEXT NOT NULL UNIQUE REFERENCES finance_source_artifacts(id),
                receipt_type TEXT NOT NULL CHECK (receipt_type IN ('ticket', 'salary')),
                validation_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_purchases (
                id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE REFERENCES finance_transactions(id),
                merchant_id TEXT REFERENCES finance_merchants(id), observed_at TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')), total_amount TEXT NOT NULL,
                source_artifact_id TEXT REFERENCES finance_source_artifacts(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_products (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_purchase_items (
                id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES finance_purchases(id),
                product_id TEXT REFERENCES finance_products(id), original_description TEXT NOT NULL,
                normalized_description TEXT, quantity TEXT, unit_price TEXT, discount_amount TEXT,
                line_total TEXT NOT NULL, currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                category_id TEXT REFERENCES finance_categories(id), created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_salary_receipts (
                id TEXT PRIMARY KEY, period TEXT NOT NULL, payment_date TEXT, employer TEXT,
                gross_amount TEXT NOT NULL, deductions_total TEXT NOT NULL, net_amount TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')), account_id TEXT REFERENCES finance_accounts(id),
                transaction_id TEXT UNIQUE REFERENCES finance_transactions(id), source_artifact_id TEXT REFERENCES finance_source_artifacts(id),
                validation_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(period, employer)
            );
            CREATE TABLE IF NOT EXISTS finance_salary_concepts (
                id TEXT PRIMARY KEY, salary_receipt_id TEXT NOT NULL REFERENCES finance_salary_receipts(id),
                name TEXT NOT NULL, concept_type TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_savings_reserves (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                opening_balance TEXT NOT NULL DEFAULT '0', objective TEXT, active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_savings_movements (
                id TEXT PRIMARY KEY, reserve_id TEXT NOT NULL REFERENCES finance_savings_reserves(id),
                account_id TEXT REFERENCES finance_accounts(id), movement_type TEXT NOT NULL,
                amount TEXT NOT NULL, currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                effective_date TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', reason TEXT,
                source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_investments (
                id TEXT PRIMARY KEY, account_id TEXT REFERENCES finance_accounts(id), name TEXT NOT NULL,
                asset_type TEXT NOT NULL, currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_valuations (
                id TEXT PRIMARY KEY, investment_id TEXT NOT NULL REFERENCES finance_investments(id),
                valuation_date TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL,
                source TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(investment_id, valuation_date)
            );
            CREATE INDEX IF NOT EXISTS idx_finance_purchase_items_product ON finance_purchase_items(product_id);
            CREATE INDEX IF NOT EXISTS idx_finance_salary_period ON finance_salary_receipts(period);
            CREATE INDEX IF NOT EXISTS idx_finance_savings_date ON finance_savings_movements(effective_date);
            CREATE INDEX IF NOT EXISTS idx_finance_valuations_date ON finance_valuations(valuation_date);
            INSERT INTO notia_schema_migrations (version) VALUES (3);",
        )?;
        transaction.commit()?;
    }
    if current_version < 4 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS finance_savings_accounts (
                reserve_id TEXT NOT NULL REFERENCES finance_savings_reserves(id),
                account_id TEXT NOT NULL REFERENCES finance_accounts(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY (reserve_id, account_id)
            );
            CREATE INDEX IF NOT EXISTS idx_finance_savings_accounts_account ON finance_savings_accounts(account_id);
            INSERT INTO notia_schema_migrations (version) VALUES (4);",
        )?;
        transaction.commit()?;
    }
    if current_version < 5 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_savings_reserves ADD COLUMN ledger_account_id TEXT REFERENCES finance_accounts(id);
            INSERT OR IGNORE INTO finance_accounts (id,name,account_type,currency,opening_balance,active,created_at,updated_at)
                SELECT 'savings:' || id, name, 'savings_reserve', currency, '0', active, created_at, updated_at
                FROM finance_savings_reserves;
            UPDATE finance_savings_reserves SET ledger_account_id = 'savings:' || id WHERE ledger_account_id IS NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_savings_ledger_account ON finance_savings_reserves(ledger_account_id);
            INSERT INTO notia_schema_migrations (version) VALUES (5);",
        )?;
        transaction.commit()?;
    }
    if current_version < 6 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN actor_user_id INTEGER;
            ALTER TABLE finance_savings_movements ADD COLUMN actor_user_id INTEGER;
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_actor ON finance_transactions(actor_user_id);
            CREATE INDEX IF NOT EXISTS idx_finance_savings_actor ON finance_savings_movements(actor_user_id);
            INSERT INTO notia_schema_migrations (version) VALUES (6);",
        )?;
        transaction.commit()?;
    }
    if current_version < 7 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_source_artifact ON finance_transactions(source_artifact_id) WHERE source_artifact_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_finance_accounts_active_currency ON finance_accounts(active, currency);
            CREATE INDEX IF NOT EXISTS idx_finance_categories_active_kind ON finance_categories(active, kind);
            INSERT INTO notia_schema_migrations (version) VALUES (7);",
        )?;
        transaction.commit()?;
    }
    if current_version < 8 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN merchant_id TEXT REFERENCES finance_merchants(id);
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_merchant ON finance_transactions(merchant_id);
            INSERT INTO notia_schema_migrations (version) VALUES (8);",
        )?;
        transaction.commit()?;
    }
    if current_version < 9 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN operation_fingerprint TEXT;
            ALTER TABLE finance_transactions ADD COLUMN installment_id TEXT;
            ALTER TABLE finance_categories ADD COLUMN description TEXT;
            ALTER TABLE finance_source_artifacts ADD COLUMN content_hash TEXT;
            ALTER TABLE finance_source_artifacts ADD COLUMN deleted_at TEXT;
            ALTER TABLE finance_purchases ADD COLUMN subtotal_amount TEXT NOT NULL DEFAULT '0';
            ALTER TABLE finance_purchases ADD COLUMN discount_amount TEXT NOT NULL DEFAULT '0';
            ALTER TABLE finance_purchases ADD COLUMN tax_amount TEXT NOT NULL DEFAULT '0';
            ALTER TABLE finance_purchases ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'pending';
            ALTER TABLE finance_savings_movements ADD COLUMN linked_transaction_id TEXT REFERENCES finance_transactions(id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_fingerprint
                ON finance_transactions(operation_fingerprint)
                WHERE operation_fingerprint IS NOT NULL AND deleted_at IS NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_artifacts_content_hash
                ON finance_source_artifacts(content_hash)
                WHERE content_hash IS NOT NULL;
            CREATE TABLE IF NOT EXISTS finance_price_observations (
                id TEXT PRIMARY KEY,
                purchase_item_id TEXT NOT NULL REFERENCES finance_purchase_items(id),
                product_id TEXT NOT NULL REFERENCES finance_products(id),
                merchant_id TEXT REFERENCES finance_merchants(id),
                observed_at TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                quantity TEXT NOT NULL,
                unit_price TEXT NOT NULL,
                discount_amount TEXT NOT NULL DEFAULT '0',
                final_amount TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'corrected', 'discarded')),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_finance_prices_product_date
                ON finance_price_observations(product_id, observed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_finance_prices_merchant_date
                ON finance_price_observations(merchant_id, observed_at DESC);
            CREATE TABLE IF NOT EXISTS finance_installment_plans (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES finance_accounts(id),
                merchant_id TEXT REFERENCES finance_merchants(id),
                description TEXT NOT NULL,
                purchase_date TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                total_amount TEXT NOT NULL,
                installment_count INTEGER NOT NULL CHECK (installment_count > 0 AND installment_count <= 120),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS finance_installments (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL REFERENCES finance_installment_plans(id),
                installment_number INTEGER NOT NULL,
                due_date TEXT NOT NULL,
                amount TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'corrected', 'discarded')),
                transaction_id TEXT UNIQUE REFERENCES finance_transactions(id),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(plan_id, installment_number)
            );
            CREATE INDEX IF NOT EXISTS idx_finance_installments_due ON finance_installments(due_date, status);
            INSERT INTO notia_schema_migrations (version) VALUES (9);",
        )?;
        transaction.commit()?;
    }
    if current_version < 10 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS finance_credit_card_statements (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES finance_accounts(id),
                issuer TEXT NOT NULL,
                card_last_four TEXT,
                period TEXT NOT NULL,
                closing_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                previous_balance TEXT NOT NULL DEFAULT '0',
                payments_amount TEXT NOT NULL DEFAULT '0',
                credits_amount TEXT NOT NULL DEFAULT '0',
                purchases_amount TEXT NOT NULL DEFAULT '0',
                fees_amount TEXT NOT NULL DEFAULT '0',
                interest_amount TEXT NOT NULL DEFAULT '0',
                taxes_amount TEXT NOT NULL DEFAULT '0',
                total_due TEXT NOT NULL,
                minimum_payment TEXT,
                source_artifact_id TEXT NOT NULL UNIQUE REFERENCES finance_source_artifacts(id),
                validation_status TEXT NOT NULL CHECK (validation_status IN ('pending','confirmed','corrected')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(account_id, period, currency)
            );
            CREATE TABLE IF NOT EXISTS finance_credit_card_statement_items (
                id TEXT PRIMARY KEY,
                statement_id TEXT NOT NULL REFERENCES finance_credit_card_statements(id),
                transaction_id TEXT UNIQUE REFERENCES finance_transactions(id),
                purchase_date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                item_type TEXT NOT NULL CHECK (item_type IN ('purchase','fee','interest','tax','payment','credit')),
                installment_number INTEGER,
                installment_count INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_finance_card_statements_period
                ON finance_credit_card_statements(period, account_id);
            CREATE INDEX IF NOT EXISTS idx_finance_card_statement_items_date
                ON finance_credit_card_statement_items(purchase_date, statement_id);
            INSERT INTO notia_schema_migrations (version) VALUES (10);",
        )?;
        transaction.commit()?;
    }
    Ok(current_version.max(CURRENT_SCHEMA_VERSION))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn open_library_connection(library_path: &str) -> Result<Connection, String> {
    let path = database_path(library_path)?;
    let connection =
        Connection::open(path).map_err(|error| format!("No se pudo abrir SQLite: {error}"))?;
    migrate(&connection).map_err(|error| format!("No se pudo migrar SQLite: {error}"))?;
    Ok(connection)
}

#[tauri::command]
pub fn initialize_library_database(
    payload: InitializeLibraryDatabasePayload,
    state: State<'_, LibraryDatabaseState>,
) -> InitializeLibraryDatabaseResult {
    #[cfg(target_os = "android")]
    {
        let Some(directory_uri) = payload
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        else {
            return failure("La librería Android no tiene una URI SAF válida.".to_string());
        };
        let guard = match state.handle.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return failure("No se pudo acceder al adaptador SQLite Android.".to_string())
            }
        };
        let Some(handle) = guard.as_ref() else {
            return failure("El adaptador SQLite Android no está disponible.".to_string());
        };
        return match handle.run_mobile_plugin::<InitializeLibraryDatabaseResult>(
            "initializeDatabase",
            serde_json::json!({ "libraryUri": directory_uri }),
        ) {
            Ok(result) => result,
            Err(error) => failure(format!("No se pudo inicializar SQLite en Android: {error}")),
        };
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let path = match database_path(&payload.library_path) {
            Ok(path) => path,
            Err(error) => return failure(error),
        };
        let Some(parent) = path.parent() else {
            return failure("No se pudo resolver el directorio .notia.".to_string());
        };
        if let Err(error) = fs::create_dir_all(parent) {
            return failure(format!("No se pudo crear .notia: {error}"));
        }
        let connection = match Connection::open(&path) {
            Ok(connection) => connection,
            Err(error) => return failure(format!("No se pudo abrir la base SQLite: {error}")),
        };
        let schema_version = match migrate(&connection) {
            Ok(version) => version,
            Err(error) => return failure(format!("No se pudo migrar la base SQLite: {error}")),
        };
        return InitializeLibraryDatabaseResult {
            ok: true,
            database_path: Some(path.to_string_lossy().into_owned()),
            schema_version: Some(schema_version),
            error: None,
        };
    }
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-library-database")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api
                    .register_android_plugin("com.gabriel.notia", "LibraryDatabasePlugin")
                    .map_err(|error| {
                        format!("No se pudo registrar el plugin SQLite Android: {error}")
                    })?;
                app.manage(LibraryDatabaseState {
                    handle: std::sync::Mutex::new(Some(handle)),
                });
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
                app.manage(LibraryDatabaseState {});
            }
            Ok(())
        })
        .build()
}

fn failure(error: String) -> InitializeLibraryDatabaseResult {
    InitializeLibraryDatabaseResult {
        ok: false,
        database_path: None,
        schema_version: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate, CURRENT_SCHEMA_VERSION};
    use rusqlite::Connection;

    #[test]
    fn migration_is_idempotent() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        assert_eq!(
            migrate(&connection).expect("first migration"),
            CURRENT_SCHEMA_VERSION
        );
        assert_eq!(
            migrate(&connection).expect("second migration"),
            CURRENT_SCHEMA_VERSION
        );
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM notia_schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");
        assert_eq!(count, CURRENT_SCHEMA_VERSION - 1);
        let purchase_items: i64 = connection
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'finance_purchase_items'", [], |row| row.get(0))
            .expect("purchase items table");
        assert_eq!(purchase_items, 1);
        let receipts: i64 = connection
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'finance_receipts'", [], |row| row.get(0))
            .expect("receipts table");
        assert_eq!(receipts, 1);
        let ledger_column: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_table_info('finance_savings_reserves') WHERE name = 'ledger_account_id'", [], |row| row.get(0))
            .expect("ledger account column");
        assert_eq!(ledger_column, 1);
    }

    #[test]
    fn migrates_an_existing_v1_database() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("CREATE TABLE notia_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO notia_schema_migrations(version) VALUES(1);").expect("v1 schema");
        assert_eq!(
            migrate(&connection).expect("migration"),
            CURRENT_SCHEMA_VERSION
        );
        let version: i64 = connection
            .query_row(
                "SELECT MAX(version) FROM notia_schema_migrations",
                [],
                |row| row.get(0),
            )
            .expect("version");
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let accounts: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='finance_accounts'",
                [],
                |row| row.get(0),
            )
            .expect("accounts table");
        assert_eq!(accounts, 1);
    }

    #[test]
    fn does_not_mark_a_failed_migration_as_applied() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("CREATE TABLE notia_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO notia_schema_migrations(version) VALUES(1); CREATE TABLE finance_accounts(id TEXT PRIMARY KEY);").expect("broken v1 schema");
        assert!(migrate(&connection).is_err());
        let version: i64 = connection
            .query_row(
                "SELECT MAX(version) FROM notia_schema_migrations",
                [],
                |row| row.get(0),
            )
            .expect("version");
        assert_eq!(version, 4);
        let failed_version: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM notia_schema_migrations WHERE version=5",
                [],
                |row| row.get(0),
            )
            .expect("failed version count");
        assert_eq!(failed_version, 0);
    }
}
