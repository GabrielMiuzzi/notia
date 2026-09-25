use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use crate::host::plugin::PluginHandle;
use crate::host::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, State, Wry,
};

const NOTIA_DIRECTORY: &str = ".notia";
const DATABASE_FILE_NAME: &str = "notia.db";
pub const CURRENT_SCHEMA_VERSION: i64 = 26;

const DEFAULT_EXPENSE_CATEGORIES: [(&str, &str, &str); 10] = [
    (
        "default-expense-food",
        "Alimentación",
        "Supermercado, comida y bebidas.",
    ),
    (
        "default-expense-housing",
        "Vivienda",
        "Alquiler, expensas y mantenimiento del hogar.",
    ),
    (
        "default-expense-services",
        "Servicios",
        "Luz, gas, agua, internet y telefonía.",
    ),
    (
        "default-expense-transport",
        "Transporte",
        "Transporte público, combustible y mantenimiento vehicular.",
    ),
    (
        "default-expense-health",
        "Salud",
        "Consultas, medicamentos y cobertura médica.",
    ),
    (
        "default-expense-education",
        "Educación",
        "Cursos, cuotas y materiales educativos.",
    ),
    (
        "default-expense-entertainment",
        "Entretenimiento",
        "Salidas, suscripciones y actividades recreativas.",
    ),
    (
        "default-expense-clothing",
        "Indumentaria",
        "Ropa, calzado y accesorios.",
    ),
    (
        "default-expense-taxes",
        "Impuestos y comisiones",
        "Impuestos, tasas y comisiones bancarias.",
    ),
    (
        "default-expense-other",
        "Otros",
        "Gastos que no corresponden a otra categoría.",
    ),
];

pub(crate) fn ensure_default_finance_categories(
    connection: &Connection,
) -> Result<(), rusqlite::Error> {
    for (id, name, description) in DEFAULT_EXPENSE_CATEGORIES {
        connection.execute(
            "INSERT OR IGNORE INTO finance_categories (id,name,kind,parent_id,active,description,created_at,updated_at)
             SELECT ?1,?2,'expense',NULL,1,?3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
             WHERE NOT EXISTS (
                 SELECT 1 FROM finance_categories
                 WHERE kind='expense' AND lower(trim(name))=lower(trim(?2))
             )",
            params![id, name, description],
        )?;
    }
    Ok(())
}

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
    app: &crate::host::AppHandle,
    directory_uri: &str,
) -> Result<Connection, String> {
    let state = app
        .try_state::<LibraryDatabaseState>()
        .ok_or_else(|| "El adaptador SQLite Android no está disponible.".to_string())?;
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
    app: &crate::host::AppHandle,
    directory_uri: &str,
) -> Result<(), String> {
    let state = app
        .try_state::<LibraryDatabaseState>()
        .ok_or_else(|| "El adaptador SQLite Android no está disponible.".to_string())?;
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

fn table_has_column(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, rusqlite::Error> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2",
            params![table, column],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
}

fn ensure_finance_service_link_columns(connection: &Connection) -> Result<(), rusqlite::Error> {
    let transaction = connection.unchecked_transaction()?;

    if !table_has_column(&transaction, "finance_transactions", "service_id")? {
        transaction.execute(
            "ALTER TABLE finance_transactions ADD COLUMN service_id TEXT REFERENCES finance_services(id)",
            [],
        )?;
    }
    if !table_has_column(&transaction, "finance_purchases", "service_id")? {
        transaction.execute(
            "ALTER TABLE finance_purchases ADD COLUMN service_id TEXT REFERENCES finance_services(id)",
            [],
        )?;
    }
    transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_finance_transactions_service ON finance_transactions(service_id)",
        [],
    )?;
    transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_finance_purchases_service ON finance_purchases(service_id)",
        [],
    )?;
    transaction.commit()
}

/// Keeps a copy of a library with Finanzas movements before schema 26
/// rewrites them, next to the database file. In-memory databases and
/// libraries without movements are not copied.
fn copy_before_finance_rework(connection: &Connection) -> Result<(), rusqlite::Error> {
    let has_transactions = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='finance_transactions')",
            [],
            |row| row.get::<_, bool>(0),
        )?
        && connection.query_row("SELECT EXISTS(SELECT 1 FROM finance_transactions)", [], |row| {
            row.get::<_, bool>(0)
        })?;
    let Some(path) = connection.path().filter(|path| !path.is_empty() && *path != ":memory:") else {
        return Ok(());
    };
    let copy = format!("{path}.pre-v26.sqlite");
    if has_transactions && !Path::new(&copy).exists() {
        connection.execute("VACUUM INTO ?1", [copy])?;
    }
    Ok(())
}

pub fn migrate(connection: &Connection) -> Result<i64, rusqlite::Error> {
    migrate_to(connection, CURRENT_SCHEMA_VERSION)
}

/// Applies the migrations up to `target`. Only tests stop before the current
/// version, to build databases as older releases left them.
fn migrate_to(connection: &Connection, target: i64) -> Result<i64, rusqlite::Error> {
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
    if current_version < 2 && target >= 2 {
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
    if current_version < 3 && target >= 3 {
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
    if current_version < 4 && target >= 4 {
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
    if current_version < 5 && target >= 5 {
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
    if current_version < 6 && target >= 6 {
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
    if current_version < 7 && target >= 7 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_source_artifact ON finance_transactions(source_artifact_id) WHERE source_artifact_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_finance_accounts_active_currency ON finance_accounts(active, currency);
            CREATE INDEX IF NOT EXISTS idx_finance_categories_active_kind ON finance_categories(active, kind);
            INSERT INTO notia_schema_migrations (version) VALUES (7);",
        )?;
        transaction.commit()?;
    }
    if current_version < 8 && target >= 8 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN merchant_id TEXT REFERENCES finance_merchants(id);
            CREATE INDEX IF NOT EXISTS idx_finance_transactions_merchant ON finance_transactions(merchant_id);
            INSERT INTO notia_schema_migrations (version) VALUES (8);",
        )?;
        transaction.commit()?;
    }
    if current_version < 9 && target >= 9 {
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
    if current_version < 10 && target >= 10 {
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
    if current_version < 11 && target >= 11 {
        let transaction = connection.unchecked_transaction()?;
        ensure_default_finance_categories(&transaction)?;
        transaction.execute(
            "INSERT INTO notia_schema_migrations (version) VALUES (11)",
            [],
        )?;
        transaction.commit()?;
    }
    if current_version < 12 && target >= 12 {
        let transaction = connection.unchecked_transaction()?;
        ensure_default_finance_categories(&transaction)?;
        transaction.execute(
            "INSERT INTO notia_schema_migrations (version) VALUES (12)",
            [],
        )?;
        transaction.commit()?;
    }
    if current_version < 13 && target >= 13 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_salary_receipts ADD COLUMN signed_document INTEGER NOT NULL DEFAULT 0;
             INSERT INTO notia_schema_migrations (version) VALUES (13);",
        )?;
        transaction.commit()?;
    }
    if current_version < 14 && target >= 14 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "DROP INDEX IF EXISTS idx_finance_transactions_source_artifact;
             CREATE INDEX IF NOT EXISTS idx_finance_transactions_source_artifact
                ON finance_transactions(source_artifact_id) WHERE source_artifact_id IS NOT NULL;
             INSERT INTO notia_schema_migrations (version) VALUES (14);",
        )?;
        transaction.commit()?;
    }
    if current_version < 15 && target >= 15 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS library_roles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                normalized_name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 1000,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_library_roles_order
                ON library_roles(sort_order, created_at, id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_library_roles_normalized_name_ci
                ON library_roles(lower(normalized_name));
            INSERT OR IGNORE INTO library_roles
                (id, name, normalized_name, sort_order, created_at, updated_at)
            VALUES
                ('role-owner', 'Owner', 'owner', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('role-family', 'Family', 'family', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('role-guest', 'Guest', 'guest', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS library_users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                normalized_name TEXT NOT NULL UNIQUE,
                role_id TEXT NOT NULL REFERENCES library_roles(id),
                password_hash TEXT,
                telegram_user_id INTEGER UNIQUE,
                telegram_chat_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_library_users_telegram_chat
                ON library_users(telegram_chat_id)
                WHERE telegram_chat_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_library_users_normalized_name_ci
                ON library_users(lower(normalized_name));
            INSERT OR IGNORE INTO library_users
                (id, name, normalized_name, role_id, password_hash, created_at, updated_at)
            VALUES
                ('user-owner', 'Owner', 'owner', 'role-owner', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO notia_schema_migrations (version) VALUES (15);",
        )?;
        transaction.commit()?;
    }
    if current_version < 16 && target >= 16 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS library_user_contexts (
                user_id TEXT NOT NULL REFERENCES library_users(id) ON DELETE CASCADE,
                context_tag TEXT NOT NULL CHECK (length(trim(context_tag)) > 0),
                PRIMARY KEY (user_id, context_tag)
            );
            CREATE INDEX IF NOT EXISTS idx_library_user_contexts_tag
                ON library_user_contexts(context_tag);
            INSERT INTO notia_schema_migrations (version) VALUES (16);",
        )?;
        transaction.commit()?;
    }
    if current_version < 17 && target >= 17 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN actor_library_user_id TEXT;
             ALTER TABLE finance_savings_movements ADD COLUMN actor_library_user_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_finance_transactions_actor_library ON finance_transactions(actor_library_user_id);
             CREATE INDEX IF NOT EXISTS idx_finance_savings_actor_library ON finance_savings_movements(actor_library_user_id);
             INSERT INTO notia_schema_migrations (version) VALUES (17);",
        )?;
        transaction.commit()?;
    }
    if current_version < 18 && target >= 18 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS finance_services (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                 normalized_name TEXT NOT NULL,
                 category_id TEXT NOT NULL REFERENCES finance_categories(id),
                 currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                 expected_amount TEXT NOT NULL,
                 due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
                 default_account_id TEXT REFERENCES finance_accounts(id),
                 provider TEXT,
                 normalized_provider TEXT,
                 modality TEXT NOT NULL CHECK (modality IN ('fixed', 'variable')),
                 active INTEGER NOT NULL DEFAULT 1,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_services_name_provider
                 ON finance_services(normalized_name, COALESCE(normalized_provider, ''));
             CREATE INDEX IF NOT EXISTS idx_finance_services_category ON finance_services(category_id);
             CREATE INDEX IF NOT EXISTS idx_finance_services_active ON finance_services(active);
             CREATE TABLE IF NOT EXISTS finance_service_occurrences (
                 id TEXT PRIMARY KEY,
                 service_id TEXT NOT NULL REFERENCES finance_services(id) ON DELETE CASCADE,
                 period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
                 expected_amount TEXT NOT NULL,
                 paid_amount TEXT,
                 effective_date TEXT,
                 status TEXT NOT NULL CHECK (status IN ('pending', 'current', 'accepted', 'rejected', 'discarded', 'failed', 'outdated')),
                 transaction_id TEXT REFERENCES finance_transactions(id),
                 artifact_id TEXT REFERENCES finance_source_artifacts(id),
                 source_reference TEXT,
                 raw_source TEXT,
                 actor_library_user_id TEXT,
                 source TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 UNIQUE(service_id, period)
             );
             CREATE INDEX IF NOT EXISTS idx_finance_service_occurrences_period ON finance_service_occurrences(period);
             CREATE INDEX IF NOT EXISTS idx_finance_service_occurrences_status ON finance_service_occurrences(status);
             CREATE TABLE IF NOT EXISTS finance_service_occurrence_versions (
                 id TEXT PRIMARY KEY,
                 occurrence_id TEXT NOT NULL REFERENCES finance_service_occurrences(id) ON DELETE CASCADE,
                 version_number INTEGER NOT NULL,
                 expected_amount TEXT NOT NULL,
                 paid_amount TEXT,
                 effective_date TEXT,
                 status TEXT NOT NULL,
                 transaction_id TEXT,
                 artifact_id TEXT,
                 source_reference TEXT,
                 raw_source TEXT,
                 actor_library_user_id TEXT,
                 source TEXT NOT NULL,
                 reason TEXT,
                 created_at TEXT NOT NULL,
                 UNIQUE(occurrence_id, version_number)
             );
             CREATE TABLE IF NOT EXISTS finance_service_invoices (
                 id TEXT PRIMARY KEY,
                 service_id TEXT REFERENCES finance_services(id) ON DELETE SET NULL,
                 period TEXT NOT NULL,
                 due_date TEXT,
                 provider TEXT,
                 amount TEXT NOT NULL,
                 currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
                 transaction_id TEXT REFERENCES finance_transactions(id),
                 artifact_id TEXT REFERENCES finance_source_artifacts(id),
                 validation_status TEXT NOT NULL CHECK (validation_status IN ('pending', 'valid', 'invalid', 'duplicate')),
                 source_reference TEXT,
                 raw_extraction TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
              CREATE INDEX IF NOT EXISTS idx_finance_service_invoices_period ON finance_service_invoices(period);
              CREATE INDEX IF NOT EXISTS idx_finance_service_invoices_service ON finance_service_invoices(service_id);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_service_invoices_artifact ON finance_service_invoices(artifact_id) WHERE artifact_id IS NOT NULL;
             CREATE TABLE IF NOT EXISTS finance_audit_runs (
                 id TEXT PRIMARY KEY,
                 period TEXT NOT NULL,
                 trigger_fingerprint TEXT NOT NULL UNIQUE,
                 status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'outdated')),
                 actor_library_user_id TEXT,
                 source TEXT NOT NULL,
                 reason TEXT,
                 error_message TEXT,
                 created_at TEXT NOT NULL,
                 completed_at TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_finance_audit_runs_period_status ON finance_audit_runs(period, status);
             CREATE TABLE IF NOT EXISTS finance_audit_proposals (
                 id TEXT PRIMARY KEY,
                 audit_run_id TEXT NOT NULL REFERENCES finance_audit_runs(id) ON DELETE CASCADE,
                 proposal_type TEXT NOT NULL,
                 status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'outdated', 'failed')),
                 rule_key TEXT NOT NULL,
                 data_fingerprint TEXT NOT NULL,
                 service_id TEXT REFERENCES finance_services(id) ON DELETE SET NULL,
                 period TEXT NOT NULL,
                 reason TEXT NOT NULL,
                 current_data TEXT NOT NULL,
                 suggested_change TEXT NOT NULL,
                 evidence TEXT,
                 actor_library_user_id TEXT,
                 source TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 decided_at TEXT,
                 UNIQUE(rule_key, data_fingerprint)
             );
             CREATE INDEX IF NOT EXISTS idx_finance_audit_proposals_status ON finance_audit_proposals(status);
             CREATE INDEX IF NOT EXISTS idx_finance_audit_proposals_period ON finance_audit_proposals(period);
             CREATE TABLE IF NOT EXISTS finance_audit_decisions (
                 id TEXT PRIMARY KEY,
                 proposal_id TEXT NOT NULL REFERENCES finance_audit_proposals(id) ON DELETE CASCADE,
                 decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected', 'cancelled', 'outdated')),
                 actor_library_user_id TEXT,
                 source TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );
             ALTER TABLE finance_transactions ADD COLUMN service_id TEXT REFERENCES finance_services(id);
             ALTER TABLE finance_purchases ADD COLUMN service_id TEXT REFERENCES finance_services(id);
             CREATE INDEX IF NOT EXISTS idx_finance_transactions_service ON finance_transactions(service_id);
             CREATE INDEX IF NOT EXISTS idx_finance_purchases_service ON finance_purchases(service_id);
             INSERT INTO notia_schema_migrations (version) VALUES (18);",
        )?;
        transaction.commit()?;
    }
    if current_version < 19 && target >= 19 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN source_reference TEXT;
             ALTER TABLE finance_transactions ADD COLUMN raw_source TEXT;
             UPDATE finance_service_occurrences
                SET transaction_id=NULL
              WHERE transaction_id IS NOT NULL
                AND id NOT IN (SELECT MAX(id) FROM finance_service_occurrences WHERE transaction_id IS NOT NULL GROUP BY transaction_id);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_service_occurrences_transaction
                 ON finance_service_occurrences(transaction_id) WHERE transaction_id IS NOT NULL;
             CREATE INDEX IF NOT EXISTS idx_finance_audit_proposals_rule_period
                 ON finance_audit_proposals(rule_key, period);
             INSERT INTO notia_schema_migrations (version) VALUES (19);",
        )?;
        transaction.commit()?;
    }
    if current_version < 20 && target >= 20 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS finance_relation_repairs (
                 id TEXT PRIMARY KEY,
                 operation_id TEXT NOT NULL UNIQUE,
                 relation_type TEXT NOT NULL CHECK (relation_type IN ('purchase-transaction','statement-item-transaction','savings-movement-transaction')),
                 relation_id TEXT NOT NULL,
                 previous_transaction_id TEXT,
                 new_transaction_id TEXT,
                 actor_library_user_id TEXT,
                 source TEXT NOT NULL,
                 reason TEXT,
                 created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_finance_relation_repairs_target
                 ON finance_relation_repairs(relation_type, relation_id, created_at);
             INSERT INTO notia_schema_migrations (version) VALUES (20);",
        )?;
        transaction.commit()?;
    }
    if current_version < 21 && target >= 21 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS library_inventory (
                 path TEXT PRIMARY KEY,
                 entry_type TEXT NOT NULL CHECK (entry_type IN ('folder', 'file')),
                 name TEXT NOT NULL,
                 parent_path TEXT,
                 size_bytes INTEGER,
                 modified_at INTEGER,
                 revision INTEGER NOT NULL DEFAULT 0,
                 generation INTEGER NOT NULL DEFAULT 0,
                 indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE INDEX IF NOT EXISTS idx_library_inventory_parent ON library_inventory(parent_path);
             CREATE INDEX IF NOT EXISTS idx_library_inventory_type ON library_inventory(entry_type);
             CREATE INDEX IF NOT EXISTS idx_library_inventory_generation ON library_inventory(generation);
             INSERT INTO notia_schema_migrations (version) VALUES (21);",
        )?;
        transaction.commit()?;
    }
    if current_version < 22 && target >= 22 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS library_inventory_staging (
                 path TEXT PRIMARY KEY,
                 entry_type TEXT NOT NULL CHECK (entry_type IN ('folder', 'file')),
                 name TEXT NOT NULL,
                 parent_path TEXT,
                 size_bytes INTEGER,
                 modified_at INTEGER,
                 revision INTEGER NOT NULL DEFAULT 0,
                 generation INTEGER NOT NULL,
                 indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE INDEX IF NOT EXISTS idx_library_inventory_staging_generation
                 ON library_inventory_staging(generation);
             CREATE TABLE IF NOT EXISTS library_inventory_state (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 active_generation INTEGER NOT NULL DEFAULT 0,
                 staging_generation INTEGER
             );
             INSERT OR IGNORE INTO library_inventory_state(id, active_generation)
                 VALUES (1, 0);
             INSERT INTO notia_schema_migrations (version) VALUES (22);",
        )?;
        transaction.commit()?;
    }
    if current_version < 23 && target >= 23 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS backend_operation_journal (
                 library_user_id TEXT NOT NULL,
                 idempotency_key TEXT NOT NULL,
                 record_json TEXT NOT NULL,
                 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 PRIMARY KEY (library_user_id, idempotency_key)
             );
             CREATE INDEX IF NOT EXISTS idx_backend_operation_journal_updated
                 ON backend_operation_journal(updated_at);
             INSERT INTO notia_schema_migrations (version) VALUES (23);",
        )?;
        transaction.commit()?;
    }
    if current_version < 24 && target >= 24 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS routine_routines (
                 id TEXT PRIMARY KEY,
                 owner_user_id TEXT NOT NULL REFERENCES library_users(id) ON DELETE CASCADE,
                 name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                 position INTEGER NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_routine_routines_owner
                 ON routine_routines(owner_user_id, position);
             CREATE TABLE IF NOT EXISTS routine_tasks (
                 id TEXT PRIMARY KEY,
                 owner_user_id TEXT NOT NULL REFERENCES library_users(id) ON DELETE CASCADE,
                 routine_id TEXT NOT NULL REFERENCES routine_routines(id) ON DELETE CASCADE,
                 name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                 category TEXT NOT NULL,
                 days TEXT NOT NULL,
                 notes TEXT NOT NULL DEFAULT '',
                 status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
                 position INTEGER NOT NULL,
                 deleted_at TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_routine_tasks_owner
                 ON routine_tasks(owner_user_id, routine_id, position);
             CREATE TABLE IF NOT EXISTS routine_completions (
                 task_id TEXT NOT NULL REFERENCES routine_tasks(id) ON DELETE CASCADE,
                 date TEXT NOT NULL,
                 completed_at TEXT NOT NULL,
                 PRIMARY KEY (task_id, date)
             );
             CREATE INDEX IF NOT EXISTS idx_routine_completions_date
                 ON routine_completions(date);
             CREATE TABLE IF NOT EXISTS routine_goals (
                 owner_user_id TEXT NOT NULL REFERENCES library_users(id) ON DELETE CASCADE,
                 category TEXT NOT NULL,
                 goal INTEGER NOT NULL CHECK (goal BETWEEN 1 AND 10),
                 updated_at TEXT NOT NULL,
                 PRIMARY KEY (owner_user_id, category)
             );
             INSERT INTO notia_schema_migrations (version) VALUES (24);",
        )?;
        transaction.commit()?;
    }
    if current_version < 25 && target >= 25 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS agenda_events (
                 id TEXT PRIMARY KEY,
                 owner_user_id TEXT NOT NULL REFERENCES library_users(id) ON DELETE CASCADE,
                 date TEXT NOT NULL,
                 start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1425),
                 end_minute INTEGER NOT NULL CHECK (end_minute > start_minute AND end_minute <= 1440),
                 title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                 priority TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_agenda_events_owner_date
                 ON agenda_events(owner_user_id, date, start_minute);
             CREATE TABLE IF NOT EXISTS agenda_notes (
                 id TEXT PRIMARY KEY,
                 owner_user_id TEXT NOT NULL REFERENCES library_users(id) ON DELETE CASCADE,
                 text TEXT NOT NULL CHECK (length(trim(text)) > 0),
                 done_on TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_agenda_notes_owner
                 ON agenda_notes(owner_user_id, done_on);
             INSERT INTO notia_schema_migrations (version) VALUES (25);",
        )?;
        transaction.commit()?;
    }
    if current_version < 26 && target >= 26 {
        copy_before_finance_rework(connection)?;
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "ALTER TABLE finance_transactions ADD COLUMN purchase_date TEXT;
             CREATE TABLE IF NOT EXISTS finance_review_items (
                 id TEXT PRIMARY KEY,
                 kind TEXT NOT NULL,
                 subject_key TEXT NOT NULL,
                 status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'dismissed')),
                 question TEXT NOT NULL,
                 options_json TEXT NOT NULL,
                 subject_json TEXT NOT NULL,
                 resolution TEXT,
                 created_at TEXT NOT NULL,
                 resolved_at TEXT,
                 UNIQUE(kind, subject_key)
             );
             CREATE INDEX IF NOT EXISTS idx_finance_review_items_status
                 ON finance_review_items(status, created_at);
             CREATE TABLE IF NOT EXISTS finance_merchant_aliases (
                 normalized_alias TEXT PRIMARY KEY,
                 merchant_id TEXT NOT NULL REFERENCES finance_merchants(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS finance_product_aliases (
                 normalized_alias TEXT PRIMARY KEY,
                 product_id TEXT NOT NULL REFERENCES finance_products(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS finance_link_log (
                 id TEXT PRIMARY KEY,
                 kind TEXT NOT NULL,
                 subject_id TEXT NOT NULL,
                 target_id TEXT NOT NULL,
                 summary TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 undone_at TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_finance_link_log_target
                 ON finance_link_log(target_id, undone_at);
             DROP TABLE IF EXISTS finance_audit_decisions;
             DROP TABLE IF EXISTS finance_audit_proposals;
             DROP TABLE IF EXISTS finance_audit_runs;
             DROP TABLE IF EXISTS finance_relation_repairs;
             DROP TABLE IF EXISTS finance_valuations;
             DROP TABLE IF EXISTS finance_investments;",
        )?;
        crate::finance_migration::migrate_existing_finance_data(&transaction).map_err(|message| {
            rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ABORT),
                Some(format!("Finanzas v26: {message}")),
            )
        })?;
        transaction.execute("INSERT INTO notia_schema_migrations (version) VALUES (26)", [])?;
        transaction.commit()?;
    }
    // Some development builds recorded schema version 18/19 before the
    // association columns were present. Repair the invariant independently
    // of the version marker so existing libraries can load their dashboard.
    if target < CURRENT_SCHEMA_VERSION {
        return Ok(current_version.max(target));
    }
    ensure_finance_service_link_columns(connection)?;
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn open_existing_library_connection(library_root: &Path) -> Result<Connection, String> {
    let path = library_root.join(NOTIA_DIRECTORY).join(DATABASE_FILE_NAME);
    if !path.is_file() {
        return Err("La base de datos de la biblioteca no existe.".to_string());
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("No se pudo abrir SQLite: {error}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn open_existing_library_connection_rw(
    library_root: &Path,
) -> Result<Connection, String> {
    let path = library_root.join(NOTIA_DIRECTORY).join(DATABASE_FILE_NAME);
    if !path.is_file() {
        return Err("La base de datos de la biblioteca no existe.".to_string());
    }
    Connection::open(path).map_err(|error| format!("No se pudo abrir SQLite: {error}"))
}

pub(crate) fn load_backend_operation_record(
    connection: &Connection,
    library_user_id: &str,
    idempotency_key: &str,
) -> Result<Option<String>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT record_json FROM backend_operation_journal WHERE library_user_id=?1 AND idempotency_key=?2",
            params![library_user_id, idempotency_key],
            |row| row.get(0),
        )
        .optional()
}

pub(crate) fn save_backend_operation_record(
    connection: &Connection,
    library_user_id: &str,
    idempotency_key: &str,
    record_json: &str,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO backend_operation_journal (library_user_id,idempotency_key,record_json,updated_at)
         VALUES (?1,?2,?3,CURRENT_TIMESTAMP)
         ON CONFLICT(library_user_id,idempotency_key) DO UPDATE SET record_json=excluded.record_json,updated_at=CURRENT_TIMESTAMP",
        params![library_user_id, idempotency_key, record_json],
    )?;
    Ok(())
}

pub fn initialize_library_database(
    app: crate::host::AppHandle,
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
        // Opening the mobile connection copies the SAF database into the app
        // cache and runs the schema migration on that copy, so the very first
        // initialization leaves the cache prepared and the schema current.
        let connection = match open_mobile_library_connection(&app, directory_uri) {
            Ok(connection) => connection,
            Err(error) => return failure(error),
        };
        let schema_version = match migrate(&connection) {
            Ok(version) => version,
            Err(error) => return failure(format!("No se pudo migrar la base SQLite: {error}")),
        };
        let database_path = connection.path().map(str::to_owned);
        drop(connection);
        return InitializeLibraryDatabaseResult {
            ok: true,
            database_path,
            schema_version: Some(schema_version),
            error: None,
        };
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state);
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

/// Opens the library database for a feature that stores per-user data: the
/// SAF copy on Android, the library file elsewhere.
#[cfg(target_os = "android")]
pub(crate) fn open_user_data_connection(
    app: &crate::host::AppHandle,
    _library_path: &str,
    android_directory_uri: Option<&str>,
) -> Result<Connection, String> {
    let directory_uri = android_directory_uri
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "La biblioteca perdió su URI SAF. Volvé a seleccionarla.".to_string())?;
    open_mobile_library_connection(app, directory_uri)
}

#[cfg(target_os = "ios")]
pub(crate) fn open_user_data_connection(
    _app: &crate::host::AppHandle,
    _library_path: &str,
    _android_directory_uri: Option<&str>,
) -> Result<Connection, String> {
    Err("Esta función todavía no está disponible en iOS.".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn open_user_data_connection(
    _app: &crate::host::AppHandle,
    library_path: &str,
    _android_directory_uri: Option<&str>,
) -> Result<Connection, String> {
    if library_path.trim().is_empty() {
        return Err("La librería es obligatoria.".to_string());
    }
    open_library_connection(library_path)
}

/// Android works on a cached copy of the database: writes are copied back
/// through SAF before they are reported as saved. Elsewhere it does nothing.
pub(crate) fn sync_user_data_connection(
    app: &crate::host::AppHandle,
    android_directory_uri: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let directory_uri = android_directory_uri
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La biblioteca perdió su URI SAF. Volvé a seleccionarla.".to_string())?;
        sync_mobile_library_connection(app, directory_uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, android_directory_uri);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate, migrate_to, CURRENT_SCHEMA_VERSION};
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
        for table in [
            "finance_services",
            "finance_service_occurrences",
            "finance_service_occurrence_versions",
            "finance_service_invoices",
            "finance_review_items",
            "finance_merchant_aliases",
            "finance_product_aliases",
            "finance_link_log",
            "library_inventory",
            "library_inventory_staging",
            "library_inventory_state",
        ] {
            let exists: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("new finance table");
            assert_eq!(exists, 1, "missing {table}");
        }
        for table in [
            "finance_audit_runs",
            "finance_audit_proposals",
            "finance_audit_decisions",
            "finance_relation_repairs",
            "finance_investments",
            "finance_valuations",
        ] {
            let exists: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("removed finance table");
            assert_eq!(exists, 0, "{table} should be removed");
        }
        let transaction_service_column: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_table_info('finance_transactions') WHERE name='service_id'", [], |row| row.get(0))
            .expect("transaction service column");
        assert_eq!(transaction_service_column, 1);
        let purchase_service_column: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_table_info('finance_purchases') WHERE name='service_id'", [], |row| row.get(0))
            .expect("purchase service column");
        assert_eq!(purchase_service_column, 1);
        let ledger_column: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_table_info('finance_savings_reserves') WHERE name = 'ledger_account_id'", [], |row| row.get(0))
            .expect("ledger account column");
        assert_eq!(ledger_column, 1);
        let signed_salary_column: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_table_info('finance_salary_receipts') WHERE name = 'signed_document'", [], |row| row.get(0))
            .expect("signed salary column");
        assert_eq!(signed_salary_column, 1);
        let expense_categories = connection
            .prepare("SELECT name FROM finance_categories WHERE kind='expense' ORDER BY name")
            .expect("expense category query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("expense categories")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect expense categories");
        assert_eq!(
            expense_categories,
            vec![
                "Alimentación",
                "Educación",
                "Entretenimiento",
                "Impuestos y comisiones",
                "Indumentaria",
                "Otros",
                "Salud",
                "Servicios",
                "Transporte",
                "Vivienda",
            ]
        );
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
    fn default_expense_categories_preserve_an_existing_category_with_the_same_name() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        assert_eq!(migrate_to(&connection, 10).expect("version 10"), 10);
        connection.execute_batch(
            "DELETE FROM finance_categories;
             INSERT INTO finance_categories(id,name,kind,active,description,created_at,updated_at)
                VALUES('custom-food','Alimentación','expense',0,'Categoría personalizada','now','now');",
        ).expect("version 10 fixture");

        assert_eq!(
            migrate(&connection).expect("migration"),
            CURRENT_SCHEMA_VERSION
        );

        let category_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM finance_categories WHERE kind='expense'",
                [],
                |row| row.get(0),
            )
            .expect("expense category count");
        let existing: (String, i64, String) = connection
            .query_row(
                "SELECT id,active,description FROM finance_categories WHERE name='Alimentación'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("existing category");

        assert_eq!(category_count, 10);
        assert_eq!(
            existing,
            ("custom-food".into(), 0, "Categoría personalizada".into())
        );
    }

    #[test]
    fn version_12_restores_categories_in_an_already_cleared_database() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        assert_eq!(migrate_to(&connection, 11).expect("version 11"), 11);
        connection
            .execute_batch("DELETE FROM finance_categories;")
            .expect("cleared version 11 fixture");

        assert_eq!(
            migrate(&connection).expect("migration"),
            CURRENT_SCHEMA_VERSION
        );

        let category_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM finance_categories WHERE kind='expense' AND active=1",
                [],
                |row| row.get(0),
            )
            .expect("restored category count");
        assert_eq!(category_count, 10);
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

    #[test]
    fn repairs_service_columns_when_current_version_was_recorded_early() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection
            .execute_batch(
                "CREATE TABLE notia_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                 INSERT INTO notia_schema_migrations(version) VALUES(19);
                 CREATE TABLE finance_services(id TEXT PRIMARY KEY);
                 CREATE TABLE finance_transactions(id TEXT PRIMARY KEY);
                 CREATE TABLE finance_purchases(id TEXT PRIMARY KEY);",
            )
            .expect("incomplete current schema");

        assert_eq!(
            migrate(&connection).expect("repair migration"),
            CURRENT_SCHEMA_VERSION
        );

        for table in ["finance_transactions", "finance_purchases"] {
            let column_count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name='service_id'",
                    [table],
                    |row| row.get(0),
                )
                .expect("service link column");
            assert_eq!(column_count, 1, "missing service_id in {table}");
        }
    }

    #[test]
    fn version_26_moves_existing_finance_data_to_the_card_payment_model() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        assert_eq!(migrate_to(&connection, 25).expect("version 25"), 25);
        connection
            .execute_batch(
                "INSERT INTO finance_accounts(id,name,account_type,currency,opening_balance,active,created_at,updated_at) VALUES
                    ('card','Visa','credit_card','ARS','0',1,'now','now'),
                    ('bank','Banco','bank','ARS','0',1,'now','now'),
                    ('savings:usd','Ahorros','savings_reserve','USD','0',1,'now','now');
                 INSERT INTO finance_categories(id,name,kind,active,created_at,updated_at)
                    VALUES('category-credit-card','Tarjeta de crédito','expense',1,'now','now');
                 INSERT INTO finance_savings_reserves(id,name,currency,opening_balance,active,ledger_account_id,created_at,updated_at)
                    VALUES('usd','Ahorros','USD','19626.00',1,'savings:usd','now','now');
                 INSERT INTO finance_transactions(id,transaction_type,amount,currency,effective_date,account_id,category_id,description,source,status,created_at,updated_at) VALUES
                    ('exchange','expense','1450000.00','ARS','2026-09-02','bank',NULL,'Compra de USD para ahorro','savings_exchange','confirmed','now','now'),
                    ('line-tx','expense','1500.00','ARS','2026-08-12','card','category-credit-card','COTO CICSA 123','credit_card_statement','confirmed','now','now'),
                    ('duplicate','expense','1500.00','ARS','2026-08-12','card',NULL,'Compra en Coto','telegram','confirmed','now','now'),
                    ('after-closing','expense','800.00','ARS','2026-09-02','card',NULL,'Farmacia','telegram','confirmed','now','now'),
                    ('old-card','expense','300.00','ARS','2026-06-01','card',NULL,'Kiosco','telegram','confirmed','now','now'),
                    ('future-installment','expense','500.00','ARS','2099-01-10','card',NULL,'Heladera · cuota 3/3','installment','confirmed','now','now');
                 INSERT INTO finance_savings_movements(id,reserve_id,movement_type,amount,currency,effective_date,description,source,status,linked_transaction_id,created_at,updated_at)
                    VALUES('savings-exchange:exchange','usd','contribution','1000.00','USD','2026-09-02','Compra de USD para ahorro','savings_exchange','confirmed','exchange','now','now');
                 INSERT INTO finance_source_artifacts(id,source_type,reference,created_at)
                    VALUES('statement-artifact','credit_card_statement','resumen.pdf','now');
                 INSERT INTO finance_credit_card_statements(id,account_id,issuer,period,closing_date,due_date,currency,total_due,source_artifact_id,validation_status,created_at,updated_at)
                    VALUES('statement','card','Banco','2026-08','2026-08-28','2026-09-05','ARS','1500.00','statement-artifact','confirmed','now','now');
                 INSERT INTO finance_credit_card_statement_items(id,statement_id,transaction_id,purchase_date,description,amount,currency,item_type,created_at)
                    VALUES('line','statement','line-tx','2026-08-12','COTO CICSA 123','1500.00','ARS','purchase','now');
                 INSERT INTO finance_installment_plans(id,account_id,description,purchase_date,currency,total_amount,installment_count,created_at,updated_at)
                    VALUES('plan','card','Heladera','2098-11-10','ARS','1500.00',3,'now','now');
                 INSERT INTO finance_installments(id,plan_id,installment_number,due_date,amount,status,transaction_id,created_at,updated_at)
                    VALUES('plan:3','plan',3,'2099-01-10','500.00','confirmed','future-installment','now','now');
                 INSERT INTO finance_audit_runs(id,period,trigger_fingerprint,status,source,created_at)
                    VALUES('run','2026-08','fingerprint','completed','app','now');",
            )
            .expect("version 25 finance data");

        assert_eq!(migrate(&connection).expect("migration"), CURRENT_SCHEMA_VERSION);

        let transaction = |id: &str| -> (String, String, String, Option<String>, Option<String>, Option<String>) {
            connection
                .query_row(
                    "SELECT transaction_type,status,effective_date,purchase_date,destination_account_id,deleted_at
                     FROM finance_transactions WHERE id=?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
                )
                .expect("migrated transaction")
        };
        let exchange = transaction("exchange");
        assert_eq!((exchange.0.as_str(), exchange.4.as_deref()), ("exchange", Some("savings:usd")));
        let line = transaction("line-tx");
        assert_eq!((line.2.as_str(), line.3.as_deref(), line.5.as_deref()), ("2026-09-05", Some("2026-08-12"), None));
        let line_description: String = connection
            .query_row("SELECT description FROM finance_transactions WHERE id='line-tx'", [], |row| row.get(0))
            .expect("line description");
        assert_eq!(line_description, "Compra en Coto");
        assert!(transaction("duplicate").5.is_some(), "the duplicate joins its line");
        let after_closing = transaction("after-closing");
        assert_eq!((after_closing.1.as_str(), after_closing.3.as_deref()), ("card_unpaid", Some("2026-09-02")));
        let old = transaction("old-card");
        assert_eq!((old.1.as_str(), old.3.as_deref()), ("confirmed", None));
        assert!(transaction("future-installment").5.is_some());
        let installment: (String, Option<String>) = connection
            .query_row("SELECT status,transaction_id FROM finance_installments WHERE id='plan:3'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("installment");
        assert_eq!(installment, ("pending".into(), None));
        let savings: (String, i64) = connection
            .query_row(
                "SELECT r.opening_balance,(SELECT COUNT(*) FROM finance_savings_movements WHERE reserve_id=r.id)
                 FROM finance_savings_reserves r WHERE r.id='usd'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("reserve");
        assert_eq!(savings, ("19626.00".into(), 1));
        let charges: String = connection
            .query_row("SELECT name FROM finance_categories WHERE id='category-credit-card'", [], |row| row.get(0))
            .expect("card category");
        assert_eq!(charges, "Cargos de tarjeta");
        let audit_tables: i64 = connection
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'finance_audit%'", [], |row| row.get(0))
            .expect("audit tables");
        assert_eq!(audit_tables, 0);
    }

    #[test]
    fn version_26_keeps_a_copy_of_a_library_with_movements() {
        let path = std::env::temp_dir().join(format!("notia-v26-{}.db", uuid::Uuid::new_v4()));
        let copy = std::path::PathBuf::from(format!("{}.pre-v26.sqlite", path.display()));
        {
            let connection = Connection::open(&path).expect("file SQLite");
            migrate_to(&connection, 25).expect("version 25");
            connection
                .execute_batch(
                    "INSERT INTO finance_accounts(id,name,account_type,currency,opening_balance,active,created_at,updated_at)
                        VALUES('bank','Banco','bank','ARS','0',1,'now','now');
                     INSERT INTO finance_transactions(id,transaction_type,amount,currency,effective_date,account_id,description,source,status,created_at,updated_at)
                        VALUES('expense','expense','10.00','ARS','2026-09-01','bank','Café','app','confirmed','now','now');",
                )
                .expect("movement");
            migrate(&connection).expect("migration");
            let copied: i64 = Connection::open(&copy)
                .expect("copy")
                .query_row("SELECT COUNT(*) FROM finance_transactions", [], |row| row.get(0))
                .expect("copied movements");
            assert_eq!(copied, 1);
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&copy);
    }

    #[test]
    fn creates_library_roles_and_owner_idempotently() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        migrate(&connection).expect("migration");
        migrate(&connection).expect("second migration");
        let roles = connection
            .prepare("SELECT name FROM library_roles ORDER BY sort_order")
            .expect("roles query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("roles")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect roles");
        assert_eq!(roles, vec!["Owner", "Family", "Guest"]);
        let owner: (String, String, Option<String>) = connection
            .query_row(
                "SELECT u.id, r.name, u.password_hash FROM library_users u JOIN library_roles r ON r.id=u.role_id WHERE u.id='user-owner'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("owner");
        assert_eq!(owner, ("user-owner".into(), "Owner".into(), None));
        let owner_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM library_users WHERE id='user-owner'",
                [],
                |row| row.get(0),
            )
            .expect("owner count");
        assert_eq!(owner_count, 1);
        assert!(connection.execute("INSERT INTO library_users (id,name,normalized_name,role_id,created_at,updated_at) VALUES ('bad','Bad','bad','missing',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", []).is_err());
    }
}
