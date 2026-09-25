//! Links made automatically when something new is saved in Finanzas: a
//! card-unpaid expense (a ticket or a loose expense) with the statement line
//! that pays it, a card line with its installment plan, and the identity of
//! merchants and products. A single clear candidate is linked and logged so
//! it can be undone; several candidates or a similar name become a review
//! item the assistant asks about.

use std::collections::BTreeSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::finance::{format_cents, now, parse_cents};

/// Expenses paid with a credit card that no loaded statement includes yet.
pub(crate) const CARD_UNPAID: &str = "card_unpaid";
/// Category of card fees, interest and taxes.
pub(crate) const CARD_CHARGES_CATEGORY: &str = "category-credit-card";

const DAYS_BETWEEN_PURCHASE_AND_LINE: f64 = 2.0;
const SIMILAR_NAME_THRESHOLD: f64 = 0.8;
const STOPWORDS: &[&str] = &[
    "de", "del", "la", "el", "los", "las", "y", "en", "con", "para", "por", "al", "compra", "x",
];
const LEGAL_SUFFIXES: &[&str] = &[
    "sa", "srl", "sas", "saic", "saci", "sacif", "sacifia", "cicsa", "sh", "ltda", "inc", "llc",
    "suc", "sucursal",
];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

fn canonical_unit(token: &str) -> Option<&'static str> {
    Some(match token {
        "l" | "lt" | "lts" | "litro" | "litros" => "l",
        "ml" | "cc" => "ml",
        "g" | "gr" | "grs" | "gramo" | "gramos" => "g",
        "kg" | "kgs" | "kilo" | "kilos" => "kg",
        "u" | "un" | "unid" | "unidad" | "unidades" => "u",
        _ => return None,
    })
}

fn is_number(token: &str) -> bool {
    token.chars().next().is_some_and(|first| first.is_ascii_digit())
        && token.chars().all(|character| character.is_ascii_digit() || character == '.')
}

/// Lowercase text without accents or punctuation, with quantities written
/// the same way: "1 Lt", "1lts" and "1 litro" all become "1l".
pub(crate) fn normalize_text(value: &str) -> String {
    let plain = value
        .nfd()
        .filter(|character| !matches!(*character, '\u{0300}'..='\u{036f}'))
        .flat_map(char::to_lowercase)
        .collect::<Vec<_>>();
    let mut cleaned = String::with_capacity(plain.len());
    for (index, character) in plain.iter().enumerate() {
        let between_digits = index > 0
            && plain[index - 1].is_ascii_digit()
            && plain.get(index + 1).is_some_and(char::is_ascii_digit);
        if character.is_alphanumeric() {
            cleaned.push(*character);
        } else if matches!(character, '.' | ',') && between_digits {
            cleaned.push('.');
        } else {
            cleaned.push(' ');
        }
    }
    let tokens = cleaned.split_whitespace().collect::<Vec<_>>();
    let mut output = Vec::with_capacity(tokens.len());
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        if is_number(token) {
            if let Some(unit) = tokens.get(index + 1).and_then(|next| canonical_unit(next)) {
                output.push(format!("{token}{unit}"));
                index += 2;
                continue;
            }
        }
        let digits = token
            .find(|character: char| !(character.is_ascii_digit() || character == '.'))
            .unwrap_or(token.len());
        if digits > 0 && digits < token.len() && is_number(&token[..digits]) {
            if let Some(unit) = canonical_unit(&token[digits..]) {
                output.push(format!("{}{unit}", &token[..digits]));
                index += 1;
                continue;
            }
        }
        output.push(token.to_string());
        index += 1;
    }
    output.join(" ")
}

/// A merchant as the card prints it, without the payment processor
/// ("MERPAGO*"), branch numbers or the company type: "MERPAGO*COTO CICSA
/// 123" becomes "coto".
pub(crate) fn normalize_card_descriptor(value: &str) -> String {
    let segment = value
        .rsplit('*')
        .map(str::trim)
        .find(|part| !part.is_empty())
        .unwrap_or(value);
    normalize_text(segment)
        .split_whitespace()
        .filter(|token| token.len() > 1 && !is_number(token) && !LEGAL_SUFFIXES.contains(token))
        .collect::<Vec<_>>()
        .join(" ")
}

fn significant_tokens(normalized: &str) -> Vec<&str> {
    normalized
        .split_whitespace()
        .filter(|token| {
            token.len() >= 3
                && !STOPWORDS.contains(token)
                && !LEGAL_SUFFIXES.contains(token)
                && !is_number(token)
        })
        .collect()
}

/// Equal words, or one abbreviating the other ("seren" and "serenisima").
fn tokens_match(left: &str, right: &str) -> bool {
    left == right
        || (left.len().min(right.len()) >= 4 && (left.starts_with(right) || right.starts_with(left)))
}

/// Whether a card descriptor ("MERPAGO*COTO 123") and a merchant name or
/// an expense description ("Compra en Coto") name the same business.
pub(crate) fn merchants_compatible(descriptor: &str, name: &str) -> bool {
    let left = normalize_card_descriptor(descriptor);
    let right = normalize_card_descriptor(name);
    if left.is_empty() || right.is_empty() {
        return false;
    }
    if left == right {
        return true;
    }
    let right_tokens = significant_tokens(&right);
    significant_tokens(&left)
        .iter()
        .any(|left_token| right_tokens.iter().any(|right_token| tokens_match(left_token, right_token)))
}

/// Share of equivalent words between two normalized names, from 0 to 1.
/// Names with different quantities ("1l" and "500ml") are never similar.
pub(crate) fn name_similarity(left: &str, right: &str) -> f64 {
    let words = |value: &str| {
        value
            .split_whitespace()
            .filter(|token| !STOPWORDS.contains(token))
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    let (left, right) = (words(left), words(right));
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let quantities = |words: &[String]| {
        words
            .iter()
            .filter(|word| word.chars().next().is_some_and(|first| first.is_ascii_digit()))
            .cloned()
            .collect::<BTreeSet<_>>()
    };
    if quantities(&left) != quantities(&right) {
        return 0.0;
    }
    let matched_left = left
        .iter()
        .filter(|word| right.iter().any(|other| tokens_match(word, other)))
        .count();
    let matched_right = right
        .iter()
        .filter(|word| left.iter().any(|other| tokens_match(word, other)))
        .count();
    (matched_left + matched_right) as f64 / (left.len() + right.len()) as f64
}

fn legacy_normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

// ---------------------------------------------------------------------------
// Outcome of a save: automatic links and review items
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOption {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub question: String,
    pub options: Vec<ReviewOption>,
    pub subject: serde_json::Value,
    pub resolution: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

/// A link made without asking; `id` undoes it.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutoLink {
    pub id: String,
    pub kind: String,
    pub summary: String,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkOutcome {
    pub links: Vec<AutoLink>,
    pub review_items: Vec<ReviewItem>,
}

fn storage(error: rusqlite::Error) -> String {
    error.to_string()
}

fn option(id: impl Into<String>, label: impl Into<String>) -> ReviewOption {
    ReviewOption {
        id: id.into(),
        label: label.into(),
    }
}

fn review_item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewItem> {
    let options: String = row.get(4)?;
    let subject: String = row.get(5)?;
    Ok(ReviewItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        status: row.get(2)?,
        question: row.get(3)?,
        options: serde_json::from_str::<Vec<serde_json::Value>>(&options)
            .unwrap_or_default()
            .into_iter()
            .map(|value| {
                option(
                    value["id"].as_str().unwrap_or_default(),
                    value["label"].as_str().unwrap_or_default(),
                )
            })
            .collect(),
        subject: serde_json::from_str(&subject).unwrap_or(serde_json::Value::Null),
        resolution: row.get(6)?,
        created_at: row.get(7)?,
        resolved_at: row.get(8)?,
    })
}

const REVIEW_COLUMNS: &str =
    "id,kind,status,question,options_json,subject_json,resolution,created_at,resolved_at";

/// Creates a review item once per subject. Returns it while it is pending,
/// also when it already existed, so the assistant asks again.
pub(crate) fn create_review_item(
    connection: &Connection,
    kind: &str,
    subject_key: &str,
    subject: serde_json::Value,
    question: String,
    options: Vec<ReviewOption>,
) -> Result<Option<ReviewItem>, String> {
    let options_json = serde_json::to_string(
        &options
            .iter()
            .map(|value| serde_json::json!({ "id": value.id, "label": value.label }))
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO finance_review_items
             (id,kind,subject_key,status,question,options_json,subject_json,created_at)
             VALUES(?1,?2,?3,'pending',?4,?5,?6,?7)",
            params![
                Uuid::new_v4().to_string(),
                kind,
                subject_key,
                question,
                options_json,
                subject.to_string(),
                now()
            ],
        )
        .map_err(storage)?;
    connection
        .query_row(
            &format!("SELECT {REVIEW_COLUMNS} FROM finance_review_items WHERE kind=?1 AND subject_key=?2 AND status='pending'"),
            params![kind, subject_key],
            review_item_from_row,
        )
        .optional()
        .map_err(storage)
}

pub(crate) fn list_review_items(
    connection: &Connection,
    status: Option<&str>,
    limit: u32,
) -> Result<Vec<ReviewItem>, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {REVIEW_COLUMNS} FROM finance_review_items
             WHERE (?1 IS NULL OR status=?1) ORDER BY created_at DESC,id LIMIT ?2"
        ))
        .map_err(storage)?;
    let rows = statement
        .query_map(params![status, limit.clamp(1, 200)], review_item_from_row)
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    Ok(rows)
}

fn log_link(
    connection: &Connection,
    kind: &str,
    subject_id: &str,
    target_id: &str,
    summary: String,
) -> Result<AutoLink, String> {
    let id = Uuid::new_v4().to_string();
    connection
        .execute(
            "INSERT INTO finance_link_log(id,kind,subject_id,target_id,summary,created_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, kind, subject_id, target_id, summary, now()],
        )
        .map_err(storage)?;
    Ok(AutoLink {
        id,
        kind: kind.to_string(),
        summary,
    })
}

// ---------------------------------------------------------------------------
// Merchants and products
// ---------------------------------------------------------------------------

struct NamedRecord {
    table: &'static str,
    alias_table: &'static str,
    id_prefix: &'static str,
    review_kind: &'static str,
    noun: &'static str,
}

const MERCHANTS: NamedRecord = NamedRecord {
    table: "finance_merchants",
    alias_table: "finance_merchant_aliases",
    id_prefix: "merchant",
    review_kind: "similar-merchant",
    noun: "comercio",
};
const PRODUCTS: NamedRecord = NamedRecord {
    table: "finance_products",
    alias_table: "finance_product_aliases",
    id_prefix: "product",
    review_kind: "similar-product",
    noun: "producto",
};

fn comparable_name(record: &NamedRecord, value: &str) -> String {
    if record.table == MERCHANTS.table {
        normalize_card_descriptor(value)
    } else {
        normalize_text(value)
    }
}

/// Finds the merchant or product by alias or name, or creates it. A new
/// record with a name similar to an existing one adds a review item.
fn resolve_named(
    connection: &Connection,
    record: &NamedRecord,
    display_name: &str,
    outcome: &mut LinkOutcome,
) -> Result<String, String> {
    let key = normalize_text(display_name);
    if key.is_empty() {
        return Err(format!("El nombre del {} es obligatorio.", record.noun));
    }
    let alias_query = format!(
        "SELECT a.{0}_id FROM {1} a JOIN {2} r ON r.id=a.{0}_id WHERE a.normalized_alias=?1",
        record.id_prefix, record.alias_table, record.table
    );
    if let Some(id) = connection
        .query_row(&alias_query, [&key], |row| row.get::<_, String>(0))
        .optional()
        .map_err(storage)?
    {
        return Ok(id);
    }
    let by_name = format!(
        "SELECT id FROM {} WHERE normalized_name=?1 OR normalized_name=?2 ORDER BY id LIMIT 1",
        record.table
    );
    let existing = connection
        .query_row(&by_name, params![key, legacy_normalize(display_name)], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(storage)?;
    let id = match existing {
        Some(id) => id,
        None => {
            let timestamp = now();
            let candidate = format!("{}:{key}", record.id_prefix);
            let insert = format!(
                "INSERT OR IGNORE INTO {} (id,name,normalized_name,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)",
                record.table
            );
            let inserted = connection
                .execute(&insert, params![candidate, display_name.trim(), key, timestamp])
                .map_err(storage)?;
            let id = if inserted == 1 {
                candidate
            } else {
                let fallback = format!("{}:{}", record.id_prefix, Uuid::new_v4());
                connection
                    .execute(&insert, params![fallback, display_name.trim(), key, timestamp])
                    .map_err(storage)?;
                fallback
            };
            flag_similar(connection, record, &id, display_name, outcome)?;
            id
        }
    };
    let alias_insert = format!(
        "INSERT OR IGNORE INTO {} (normalized_alias,{}_id) VALUES(?1,?2)",
        record.alias_table, record.id_prefix
    );
    connection
        .execute(&alias_insert, params![key, id])
        .map_err(storage)?;
    Ok(id)
}

fn flag_similar(
    connection: &Connection,
    record: &NamedRecord,
    new_id: &str,
    display_name: &str,
    outcome: &mut LinkOutcome,
) -> Result<(), String> {
    let comparable = comparable_name(record, display_name);
    let mut statement = connection
        .prepare(&format!("SELECT id,name FROM {} WHERE id<>?1", record.table))
        .map_err(storage)?;
    let others = statement
        .query_map([new_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    let best = others
        .into_iter()
        .map(|(id, name)| {
            let score = name_similarity(&comparable, &comparable_name(record, &name));
            (score, id, name)
        })
        .filter(|(score, _, _)| *score >= SIMILAR_NAME_THRESHOLD)
        .max_by(|left, right| left.0.total_cmp(&right.0));
    if let Some((_, existing_id, existing_name)) = best {
        let item = create_review_item(
            connection,
            record.review_kind,
            &format!("{new_id}|{existing_id}"),
            serde_json::json!({ "newId": new_id, "existingId": existing_id }),
            format!(
                "¿«{}» es el mismo {} que «{}»?",
                display_name.trim(),
                record.noun,
                existing_name
            ),
            vec![
                option("merge", format!("Sí, es «{existing_name}»")),
                option("keep", "No, son distintos"),
            ],
        )?;
        outcome.review_items.extend(item);
    }
    Ok(())
}

pub(crate) fn resolve_merchant(
    connection: &Connection,
    name: &str,
    outcome: &mut LinkOutcome,
) -> Result<String, String> {
    resolve_named(connection, &MERCHANTS, name, outcome)
}

pub(crate) fn resolve_product(
    connection: &Connection,
    name: &str,
    outcome: &mut LinkOutcome,
) -> Result<String, String> {
    resolve_named(connection, &PRODUCTS, name, outcome)
}

/// Existing merchant that a card descriptor names, when exactly one fits.
pub(crate) fn find_merchant_for_descriptor(
    connection: &Connection,
    descriptor: &str,
) -> Result<Option<String>, String> {
    let key = normalize_text(descriptor);
    if let Some(id) = connection
        .query_row(
            "SELECT merchant_id FROM finance_merchant_aliases WHERE normalized_alias=?1",
            [&key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage)?
    {
        return Ok(Some(id));
    }
    let mut statement = connection
        .prepare("SELECT id,name FROM finance_merchants")
        .map_err(storage)?;
    let matches = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?
        .into_iter()
        .filter(|(_, name)| merchants_compatible(descriptor, name))
        .map(|(id, _)| id)
        .collect::<Vec<_>>();
    Ok((matches.len() == 1).then(|| matches[0].clone()))
}

/// The category last used with a merchant, to categorize card lines that
/// arrive without a ticket.
pub(crate) fn last_merchant_category(
    connection: &Connection,
    merchant_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT category_id FROM finance_transactions
             WHERE merchant_id=?1 AND category_id IS NOT NULL AND category_id<>?2
               AND deleted_at IS NULL
             ORDER BY effective_date DESC,updated_at DESC LIMIT 1",
            params![merchant_id, CARD_CHARGES_CATEGORY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage)
}

/// Moves every reference of a merchant or product into another one and
/// keeps the old name as an alias.
fn merge_named(
    connection: &Connection,
    record: &NamedRecord,
    from: &str,
    into: &str,
) -> Result<(), String> {
    if from == into {
        return Err(format!("Elegí dos {}s distintos.", record.noun));
    }
    let exists = |id: &str| -> Result<bool, String> {
        connection
            .query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {} WHERE id=?1)", record.table),
                [id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(storage)
    };
    if !exists(from)? || !exists(into)? {
        return Err(format!("El {} no existe.", record.noun));
    }
    let references: &[(&str, &str)] = if record.table == MERCHANTS.table {
        &[
            ("finance_purchases", "merchant_id"),
            ("finance_transactions", "merchant_id"),
            ("finance_price_observations", "merchant_id"),
            ("finance_installment_plans", "merchant_id"),
            ("finance_merchant_aliases", "merchant_id"),
        ]
    } else {
        &[
            ("finance_purchase_items", "product_id"),
            ("finance_price_observations", "product_id"),
            ("finance_product_aliases", "product_id"),
        ]
    };
    for (table, column) in references {
        connection
            .execute(
                &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2"),
                params![into, from],
            )
            .map_err(storage)?;
    }
    let old_name: String = connection
        .query_row(
            &format!("SELECT normalized_name FROM {} WHERE id=?1", record.table),
            [from],
            |row| row.get(0),
        )
        .map_err(storage)?;
    connection
        .execute(
            &format!("DELETE FROM {} WHERE id=?1", record.table),
            [from],
        )
        .map_err(storage)?;
    connection
        .execute(
            &format!(
                "INSERT OR REPLACE INTO {} (normalized_alias,{}_id) VALUES(?1,?2)",
                record.alias_table, record.id_prefix
            ),
            params![old_name, into],
        )
        .map_err(storage)?;
    dismiss_review_items_about(connection, from)
}

fn rename_named(
    connection: &Connection,
    record: &NamedRecord,
    id: &str,
    name: &str,
) -> Result<(), String> {
    let key = normalize_text(name);
    if key.is_empty() || name.trim().chars().count() > 200 {
        return Err(format!("El nombre del {} no es válido.", record.noun));
    }
    let taken = connection
        .query_row(
            &format!("SELECT id FROM {} WHERE normalized_name=?1 AND id<>?2", record.table),
            params![key, id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage)?;
    if taken.is_some() {
        return Err(format!(
            "Ya existe un {} con ese nombre; unificalos en lugar de renombrar.",
            record.noun
        ));
    }
    let changed = connection
        .execute(
            &format!("UPDATE {} SET name=?1,normalized_name=?2,updated_at=?3 WHERE id=?4", record.table),
            params![name.trim(), key, now(), id],
        )
        .map_err(storage)?;
    if changed == 0 {
        return Err(format!("El {} no existe.", record.noun));
    }
    connection
        .execute(
            &format!(
                "INSERT OR REPLACE INTO {} (normalized_alias,{}_id) VALUES(?1,?2)",
                record.alias_table, record.id_prefix
            ),
            params![key, id],
        )
        .map_err(storage)?;
    Ok(())
}

pub(crate) fn merge_merchants(connection: &Connection, from: &str, into: &str) -> Result<(), String> {
    merge_named(connection, &MERCHANTS, from, into)
}

pub(crate) fn merge_products(connection: &Connection, from: &str, into: &str) -> Result<(), String> {
    merge_named(connection, &PRODUCTS, from, into)
}

pub(crate) fn rename_merchant(connection: &Connection, id: &str, name: &str) -> Result<(), String> {
    rename_named(connection, &MERCHANTS, id, name)
}

pub(crate) fn rename_product(connection: &Connection, id: &str, name: &str) -> Result<(), String> {
    rename_named(connection, &PRODUCTS, id, name)
}

fn dismiss_review_items_about(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_review_items SET status='dismissed',resolved_at=?1
             WHERE status='pending' AND instr(subject_json, ?2)>0",
            params![now(), format!("\"{id}\"")],
        )
        .map_err(storage)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Card-unpaid expenses and statement lines
// ---------------------------------------------------------------------------

/// A purchase line of a statement, as the matcher needs it.
#[derive(Debug, Clone)]
pub(crate) struct CardLine {
    pub item_id: String,
    pub account_id: String,
    pub currency: String,
    pub purchase_date: String,
    pub description: String,
    pub amount: i128,
    pub installment_number: Option<i64>,
    pub installment_count: Option<i64>,
    pub transaction_id: Option<String>,
    pub due_date: String,
}

impl CardLine {
    fn is_installment(&self) -> bool {
        self.installment_count.is_some_and(|count| count > 1)
    }

    /// Whether an unpaid expense of `total` is what this line pays: the
    /// same amount, or the whole purchase when the line is one installment.
    fn pays(&self, total: i128) -> bool {
        match self.installment_count.filter(|count| *count > 1) {
            Some(count) => (self.amount * i128::from(count) - total).abs() <= i128::from(count),
            None => self.amount == total,
        }
    }
}

#[derive(Debug, Clone)]
struct UnpaidExpense {
    id: String,
    account_id: String,
    currency: String,
    purchase_date: String,
    amount: i128,
    label: String,
}

const CARD_LINE_SELECT: &str = "SELECT i.id,s.account_id,i.currency,i.purchase_date,i.description,i.amount,
        i.installment_number,i.installment_count,i.transaction_id,s.due_date
     FROM finance_credit_card_statement_items i
     JOIN finance_credit_card_statements s ON s.id=i.statement_id";

fn card_line_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardLine> {
    let amount: String = row.get(5)?;
    Ok(CardLine {
        item_id: row.get(0)?,
        account_id: row.get(1)?,
        currency: row.get(2)?,
        purchase_date: row.get(3)?,
        description: row.get(4)?,
        amount: parse_cents(&amount).unwrap_or_default(),
        installment_number: row.get(6)?,
        installment_count: row.get(7)?,
        transaction_id: row.get(8)?,
        due_date: row.get(9)?,
    })
}

pub(crate) fn load_card_line(connection: &Connection, item_id: &str) -> Result<CardLine, String> {
    connection
        .query_row(&format!("{CARD_LINE_SELECT} WHERE i.id=?1"), [item_id], card_line_from_row)
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "La línea del resumen no existe.".to_string())
}

const UNPAID_SELECT: &str = "SELECT t.id,t.account_id,t.currency,COALESCE(t.purchase_date,t.effective_date),
        t.amount,COALESCE(m.name,''),t.description
     FROM finance_transactions t LEFT JOIN finance_merchants m ON m.id=t.merchant_id";

fn unpaid_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UnpaidExpense> {
    let amount: String = row.get(4)?;
    let merchant: String = row.get(5)?;
    let description: String = row.get(6)?;
    Ok(UnpaidExpense {
        id: row.get(0)?,
        account_id: row.get(1)?,
        currency: row.get(2)?,
        purchase_date: row.get(3)?,
        amount: parse_cents(&amount).unwrap_or_default(),
        label: if merchant.is_empty() { description } else { merchant },
    })
}

fn load_unpaid(connection: &Connection, transaction_id: &str) -> Result<Option<UnpaidExpense>, String> {
    connection
        .query_row(
            &format!(
                "{UNPAID_SELECT} WHERE t.id=?1 AND t.status=?2 AND t.deleted_at IS NULL AND t.transaction_type='expense'"
            ),
            params![transaction_id, CARD_UNPAID],
            unpaid_from_row,
        )
        .optional()
        .map_err(storage)
}

/// Card-unpaid expenses that a statement line pays: same card and
/// currency, bought within two days, same amount (or the whole purchase
/// for an installment) and a compatible merchant.
fn unpaid_candidates(connection: &Connection, line: &CardLine) -> Result<Vec<UnpaidExpense>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{UNPAID_SELECT} WHERE t.account_id=?1 AND t.currency=?2 AND t.status=?3
               AND t.deleted_at IS NULL AND t.transaction_type='expense'
               AND abs(julianday(COALESCE(t.purchase_date,t.effective_date))-julianday(?4))<=?5"
        ))
        .map_err(storage)?;
    let rows = statement
        .query_map(
            params![
                line.account_id,
                line.currency,
                CARD_UNPAID,
                line.purchase_date,
                DAYS_BETWEEN_PURCHASE_AND_LINE
            ],
            unpaid_from_row,
        )
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    Ok(rows
        .into_iter()
        .filter(|unpaid| line.pays(unpaid.amount) && merchants_compatible(&line.description, &unpaid.label))
        .collect())
}

/// Statement lines that could pay an unpaid expense and do not pay another
/// one yet. Several installments of one purchase count as its first line.
fn line_candidates(connection: &Connection, unpaid: &UnpaidExpense) -> Result<Vec<CardLine>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{CARD_LINE_SELECT}
             WHERE s.account_id=?1 AND i.currency=?2 AND i.item_type='purchase'
               AND i.transaction_id IS NOT NULL
               AND abs(julianday(i.purchase_date)-julianday(?3))<=?4
               AND NOT EXISTS (SELECT 1 FROM finance_purchases p WHERE p.transaction_id=i.transaction_id)
               AND NOT EXISTS (SELECT 1 FROM finance_link_log l WHERE l.target_id=i.id
                               AND l.undone_at IS NULL AND l.kind IN ('card-line-reused','card-line-merged'))
             ORDER BY i.installment_number,i.id"
        ))
        .map_err(storage)?;
    let rows = statement
        .query_map(
            params![
                unpaid.account_id,
                unpaid.currency,
                unpaid.purchase_date,
                DAYS_BETWEEN_PURCHASE_AND_LINE
            ],
            card_line_from_row,
        )
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    let mut seen_purchases = BTreeSet::new();
    Ok(rows
        .into_iter()
        .filter(|line| line.pays(unpaid.amount) && merchants_compatible(&line.description, &unpaid.label))
        .filter(|line| {
            !line.is_installment()
                || seen_purchases.insert((
                    line.installment_count,
                    normalize_card_descriptor(&line.description),
                    line.purchase_date.clone(),
                ))
        })
        .collect())
}

fn money(amount: i128, currency: &str) -> String {
    format!("{currency} {}", format_cents(amount))
}

fn describe_unpaid(unpaid: &UnpaidExpense) -> String {
    format!(
        "{} del {} por {}",
        unpaid.label,
        unpaid.purchase_date,
        money(unpaid.amount, &unpaid.currency)
    )
}

fn describe_line(line: &CardLine) -> String {
    let installment = match (line.installment_number, line.installment_count) {
        (Some(number), Some(count)) if count > 1 => format!(" (cuota {number}/{count})"),
        _ => String::new(),
    };
    format!(
        "«{}» del {} por {}{installment}",
        line.description,
        line.purchase_date,
        money(line.amount, &line.currency)
    )
}

/// The unpaid expense itself becomes the line's expense: it keeps its
/// merchant, category and ticket, and now counts in the payment month.
fn reuse_unpaid(connection: &Connection, unpaid_id: &str, line: &CardLine) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_transactions SET status='confirmed',effective_date=?1,
                    purchase_date=COALESCE(purchase_date,effective_date),updated_at=?2
             WHERE id=?3",
            params![line.due_date, now(), unpaid_id],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_credit_card_statement_items SET transaction_id=?1 WHERE id=?2",
            params![unpaid_id, line.item_id],
        )
        .map_err(storage)?;
    Ok(())
}

/// Moves an unpaid expense into the line's own expense: the line takes its
/// merchant, category and description, and whatever pointed to the unpaid
/// expense now points to the line.
fn merge_unpaid(connection: &Connection, unpaid_id: &str, line_transaction_id: &str) -> Result<(), String> {
    let timestamp = now();
    connection
        .execute(
            "UPDATE finance_transactions SET
                merchant_id=COALESCE((SELECT merchant_id FROM finance_transactions WHERE id=?1),merchant_id),
                category_id=CASE WHEN category_id IS NULL OR category_id=?3
                                 THEN COALESCE((SELECT category_id FROM finance_transactions WHERE id=?1),category_id)
                                 ELSE category_id END,
                service_id=COALESCE(service_id,(SELECT service_id FROM finance_transactions WHERE id=?1)),
                description=(SELECT description FROM finance_transactions WHERE id=?1),
                updated_at=?4
             WHERE id=?2",
            params![unpaid_id, line_transaction_id, CARD_CHARGES_CATEGORY, timestamp],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_purchases SET transaction_id=?1,updated_at=?2 WHERE transaction_id=?3",
            params![line_transaction_id, timestamp, unpaid_id],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_service_occurrences SET transaction_id=?1,updated_at=?2
             WHERE transaction_id=?3
               AND NOT EXISTS (SELECT 1 FROM finance_service_occurrences o WHERE o.transaction_id=?1)",
            params![line_transaction_id, timestamp, unpaid_id],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_service_invoices SET transaction_id=?1,updated_at=?2 WHERE transaction_id=?3",
            params![line_transaction_id, timestamp, unpaid_id],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_transactions SET deleted_at=?1,updated_at=?1 WHERE id=?2",
            params![timestamp, unpaid_id],
        )
        .map_err(storage)?;
    Ok(())
}

/// What a statement line should do with the card-unpaid expenses it may pay.
pub(crate) enum LineMatch {
    /// No unpaid expense fits; the line gets its own expense.
    None,
    /// One fits and a plain line reuses it as its expense.
    Reuse(String),
    /// The line gets its own expense; one or more unpaid ones are handled
    /// after the line is stored.
    Later,
}

/// Decides, before a plain purchase line gets an expense, whether it reuses
/// a card-unpaid one. Installments and ambiguous lines always get their own
/// expense and are resolved by [`link_line_after_save`].
pub(crate) fn match_line_before_save(connection: &Connection, line: &CardLine) -> Result<LineMatch, String> {
    let candidates = unpaid_candidates(connection, line)?;
    Ok(match candidates.as_slice() {
        [] => LineMatch::None,
        [only] if !line.is_installment() => LineMatch::Reuse(only.id.clone()),
        _ => LineMatch::Later,
    })
}

/// Records the reuse chosen by [`match_line_before_save`] once the line is stored.
pub(crate) fn apply_reuse(
    connection: &Connection,
    unpaid_id: &str,
    line: &CardLine,
    outcome: &mut LinkOutcome,
) -> Result<(), String> {
    let unpaid = load_unpaid(connection, unpaid_id)?
        .ok_or_else(|| "El gasto a pagar con tarjeta ya no está disponible.".to_string())?;
    reuse_unpaid(connection, unpaid_id, line)?;
    outcome.links.push(log_link(
        connection,
        "card-line-reused",
        unpaid_id,
        &line.item_id,
        format!("{} quedó pagado en el resumen con la línea {}.", describe_unpaid(&unpaid), describe_line(line)),
    )?);
    Ok(())
}

/// After a line with its own expense is stored: merges the one unpaid
/// expense it pays, or asks which one when several fit.
pub(crate) fn link_line_after_save(
    connection: &Connection,
    item_id: &str,
    outcome: &mut LinkOutcome,
) -> Result<(), String> {
    let line = load_card_line(connection, item_id)?;
    let Some(line_transaction_id) = line.transaction_id.clone() else {
        return Ok(());
    };
    let candidates = unpaid_candidates(connection, &line)?;
    match candidates.as_slice() {
        [] => {}
        [only] => {
            merge_unpaid(connection, &only.id, &line_transaction_id)?;
            outcome.links.push(log_link(
                connection,
                "card-line-merged",
                &only.id,
                &line.item_id,
                format!("{} quedó pagado en el resumen con la línea {}.", describe_unpaid(only), describe_line(&line)),
            )?);
        }
        several => {
            let mut options = several
                .iter()
                .map(|unpaid| option(format!("merge:{}", unpaid.id), describe_unpaid(unpaid)))
                .collect::<Vec<_>>();
            options.push(option("none", "Ninguno: es otra compra"));
            outcome.review_items.extend(create_review_item(
                connection,
                "card-line-candidates",
                &line.item_id,
                serde_json::json!({ "lineId": line.item_id }),
                format!("¿Qué gasto paga la línea {} del resumen?", describe_line(&line)),
                options,
            )?);
        }
    }
    Ok(())
}

/// After a card-unpaid expense is stored (a ticket or a loose expense):
/// merges it into the statement line that already paid it, or asks which
/// line when several fit.
pub(crate) fn link_unpaid_expense(
    connection: &Connection,
    transaction_id: &str,
    outcome: &mut LinkOutcome,
) -> Result<(), String> {
    let Some(unpaid) = load_unpaid(connection, transaction_id)? else {
        return Ok(());
    };
    let candidates = line_candidates(connection, &unpaid)?;
    match candidates.as_slice() {
        [] => {}
        [only] => {
            let line_transaction_id = only
                .transaction_id
                .clone()
                .ok_or_else(|| "La línea del resumen no tiene gasto.".to_string())?;
            merge_unpaid(connection, &unpaid.id, &line_transaction_id)?;
            outcome.links.push(log_link(
                connection,
                "card-line-merged",
                &unpaid.id,
                &only.item_id,
                format!("{} ya estaba pagado en el resumen: línea {}.", describe_unpaid(&unpaid), describe_line(only)),
            )?);
        }
        several => {
            let mut options = several
                .iter()
                .map(|line| option(format!("line:{}", line.item_id), describe_line(line)))
                .collect::<Vec<_>>();
            options.push(option("none", "Ninguna: todavía no se pagó"));
            outcome.review_items.extend(create_review_item(
                connection,
                "unpaid-line-candidates",
                &unpaid.id,
                serde_json::json!({ "transactionId": unpaid.id }),
                format!("¿En qué línea del resumen se pagó {}?", describe_unpaid(&unpaid)),
                options,
            )?);
        }
    }
    Ok(())
}

/// Links a card-unpaid expense (or a ticket's) with a statement line on
/// request, checking card, currency and amount.
pub(crate) fn link_expense_to_line(
    connection: &Connection,
    transaction_id: &str,
    item_id: &str,
) -> Result<AutoLink, String> {
    let unpaid = load_unpaid(connection, transaction_id)?.ok_or_else(|| {
        "El gasto no está pendiente de pago con tarjeta; solo esos se vinculan a un resumen.".to_string()
    })?;
    let line = load_card_line(connection, item_id)?;
    if line.account_id != unpaid.account_id || line.currency != unpaid.currency || !line.pays(unpaid.amount) {
        return Err("La línea es de otra tarjeta, otra moneda u otro importe.".into());
    }
    let line_transaction_id = line
        .transaction_id
        .clone()
        .ok_or_else(|| "La línea del resumen no tiene gasto.".to_string())?;
    let taken: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM finance_purchases WHERE transaction_id=?1)",
            [&line_transaction_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if taken {
        return Err("La línea ya está vinculada a otro ticket.".into());
    }
    merge_unpaid(connection, &unpaid.id, &line_transaction_id)?;
    log_link(
        connection,
        "card-line-merged",
        &unpaid.id,
        &line.item_id,
        format!("{} quedó pagado con la línea {}.", describe_unpaid(&unpaid), describe_line(&line)),
    )
}

/// The line's own expense for a line that reused an unpaid one when it is
/// unlinked.
fn line_transaction_id_for(line: &CardLine) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "{}:{}:{}:{}:{}",
        line.account_id,
        line.purchase_date,
        normalize_text(&line.description),
        format_cents(line.amount),
        line.currency
    ));
    format!("card-statement-item:{}:{:x}", line.item_id, hasher.finalize())
}

/// Creates the expense of a statement line, dated on the payment month.
pub(crate) fn insert_line_transaction(
    connection: &Connection,
    line: &CardLine,
    item_type: &str,
    category_id: Option<&str>,
    merchant_id: Option<&str>,
    artifact_id: &str,
) -> Result<String, String> {
    let id = line_transaction_id_for(line);
    let timestamp = now();
    connection
        .execute(
            "INSERT INTO finance_transactions(id,transaction_type,amount,currency,effective_date,purchase_date,
                 account_id,category_id,merchant_id,description,source,status,source_artifact_id,
                 operation_fingerprint,created_at,updated_at)
             VALUES(?1,'expense',?2,?3,?4,?5,?6,?7,?8,?9,'credit_card_statement','confirmed',?10,?11,?12,?12)
             ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,
                 effective_date=excluded.effective_date,purchase_date=excluded.purchase_date,
                 status='confirmed',deleted_at=NULL,updated_at=excluded.updated_at",
            params![
                id,
                format_cents(line.amount),
                line.currency,
                line.due_date,
                line.purchase_date,
                line.account_id,
                category_id,
                merchant_id,
                line.description,
                artifact_id,
                format!("card-line:{}:{item_type}", line.item_id),
                timestamp
            ],
        )
        .map_err(storage)?;
    Ok(id)
}

/// Undoes a link between an expense and a statement line: the line keeps
/// (or gets back) its own expense and the other expense is again pending
/// payment with the card.
pub(crate) fn unlink_line(connection: &Connection, link_id: &str) -> Result<(), String> {
    let (kind, subject_id, item_id): (String, String, String) = connection
        .query_row(
            "SELECT kind,subject_id,target_id FROM finance_link_log WHERE id=?1 AND undone_at IS NULL",
            [link_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "El vínculo no existe o ya se deshizo.".to_string())?;
    let timestamp = now();
    match kind.as_str() {
        "card-line-reused" => {
            let line = load_card_line(connection, &item_id)?;
            let artifact_id: String = connection
                .query_row(
                    "SELECT s.source_artifact_id FROM finance_credit_card_statement_items i
                     JOIN finance_credit_card_statements s ON s.id=i.statement_id WHERE i.id=?1",
                    [&item_id],
                    |row| row.get(0),
                )
                .map_err(storage)?;
            let merchant_id = find_merchant_for_descriptor(connection, &line.description)?;
            let own = insert_line_transaction(connection, &line, "purchase", None, merchant_id.as_deref(), &artifact_id)?;
            connection
                .execute(
                    "UPDATE finance_credit_card_statement_items SET transaction_id=?1 WHERE id=?2",
                    params![own, item_id],
                )
                .map_err(storage)?;
            connection
                .execute(
                    "UPDATE finance_service_occurrences SET transaction_id=?1,updated_at=?2 WHERE transaction_id=?3",
                    params![own, timestamp, subject_id],
                )
                .map_err(storage)?;
            connection
                .execute(
                    "UPDATE finance_transactions SET status=?1,effective_date=COALESCE(purchase_date,effective_date),
                            service_id=NULL,updated_at=?2
                     WHERE id=?3",
                    params![CARD_UNPAID, timestamp, subject_id],
                )
                .map_err(storage)?;
        }
        "card-line-merged" => {
            let line = load_card_line(connection, &item_id)?;
            connection
                .execute(
                    "UPDATE finance_transactions SET deleted_at=NULL,status=?1,
                            effective_date=COALESCE(purchase_date,effective_date),updated_at=?2
                     WHERE id=?3",
                    params![CARD_UNPAID, timestamp, subject_id],
                )
                .map_err(storage)?;
            if let Some(line_transaction_id) = line.transaction_id.as_deref() {
                if let Some(purchase_id) = subject_id.strip_prefix("purchase:") {
                    connection
                        .execute(
                            "UPDATE finance_purchases SET transaction_id=?1,updated_at=?2
                             WHERE id=?3 AND transaction_id=?4",
                            params![subject_id, timestamp, purchase_id, line_transaction_id],
                        )
                        .map_err(storage)?;
                }
            }
        }
        "installment-card-line" => {
            connection
                .execute(
                    "UPDATE finance_installments SET transaction_id=NULL,status='pending',updated_at=?1 WHERE id=?2",
                    params![timestamp, subject_id],
                )
                .map_err(storage)?;
        }
        _ => return Err("Ese vínculo no se puede deshacer.".into()),
    }
    connection
        .execute(
            "UPDATE finance_link_log SET undone_at=?1 WHERE id=?2",
            params![timestamp, link_id],
        )
        .map_err(storage)?;
    Ok(())
}

/// The link that joined a statement line with another expense or an
/// installment, so it can be undone by naming the line.
pub(crate) fn active_link_for_line(connection: &Connection, item_id: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT id FROM finance_link_log WHERE target_id=?1 AND undone_at IS NULL
             ORDER BY created_at DESC LIMIT 1",
            [item_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage)
}

/// Marks as undone the links of a line whose expense is being replaced.
pub(crate) fn forget_links_for_line(connection: &Connection, item_id: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_link_log SET undone_at=?1 WHERE target_id=?2 AND undone_at IS NULL",
            params![now(), item_id],
        )
        .map_err(storage)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Installments
// ---------------------------------------------------------------------------

/// Adds `months` to a date, keeping the day inside the target month
/// (31 January plus one month is 28 or 29 February).
pub(crate) fn add_months(date: &str, months: i32) -> Result<String, String> {
    let invalid = || "La fecha es inválida.".to_string();
    let year: i32 = date.get(0..4).ok_or_else(invalid)?.parse().map_err(|_| invalid())?;
    let month: i32 = date.get(5..7).ok_or_else(invalid)?.parse().map_err(|_| invalid())?;
    let day: u32 = date.get(8..10).ok_or_else(invalid)?.parse().map_err(|_| invalid())?;
    let index = year * 12 + month - 1 + months;
    let (year, month) = (index.div_euclid(12), index.rem_euclid(12) + 1);
    let last_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        _ => 28,
    };
    Ok(format!("{year:04}-{month:02}-{:02}", day.min(last_day)))
}

/// Links an installment line with its plan's installment, or creates the
/// plan from the line when the purchase has none, so the pending
/// installments are known.
pub(crate) fn link_installment_line(
    connection: &Connection,
    item_id: &str,
    outcome: &mut LinkOutcome,
) -> Result<(), String> {
    let line = load_card_line(connection, item_id)?;
    let (Some(number), Some(count), Some(line_transaction_id)) =
        (line.installment_number, line.installment_count, line.transaction_id.clone())
    else {
        return Ok(());
    };
    if count <= 1 {
        return Ok(());
    }
    let mut statement = connection
        .prepare(
            "SELECT i.id,i.amount,i.transaction_id,p.description,COALESCE(m.name,''),p.purchase_date
             FROM finance_installments i
             JOIN finance_installment_plans p ON p.id=i.plan_id
             LEFT JOIN finance_merchants m ON m.id=p.merchant_id
             WHERE p.account_id=?1 AND p.currency=?2 AND p.installment_count=?3
               AND i.installment_number=?4",
        )
        .map_err(storage)?;
    let rows = statement
        .query_map(params![line.account_id, line.currency, count, number], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    if rows.iter().any(|row| row.2.as_deref() == Some(line_transaction_id.as_str())) {
        return Ok(());
    }
    let tolerance = i128::from(count).max(line.amount / 100);
    let mut candidates = rows
        .into_iter()
        .filter(|(_, amount, transaction_id, description, merchant, _)| {
            transaction_id.is_none()
                && parse_cents(amount).is_ok_and(|value| (value - line.amount).abs() <= tolerance)
                && (merchants_compatible(&line.description, merchant)
                    || merchants_compatible(&line.description, description))
        })
        .collect::<Vec<_>>();
    if candidates.len() > 1 {
        candidates.retain(|candidate| candidate.5 == line.purchase_date);
    }
    match candidates.as_slice() {
        [only] => {
            connection
                .execute(
                    "UPDATE finance_installments SET transaction_id=?1,status='confirmed',updated_at=?2 WHERE id=?3",
                    params![line_transaction_id, now(), only.0],
                )
                .map_err(storage)?;
            outcome.links.push(log_link(
                connection,
                "installment-card-line",
                &only.0,
                &line.item_id,
                format!("La línea {} pagó la cuota {number}/{count} de «{}».", describe_line(&line), only.3),
            )?);
        }
        [] => create_plan_from_line(connection, &line, number, count, &line_transaction_id)?,
        _ => {}
    }
    Ok(())
}

fn create_plan_from_line(
    connection: &Connection,
    line: &CardLine,
    number: i64,
    count: i64,
    line_transaction_id: &str,
) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "{}|{}|{}|{}|{}",
        line.account_id,
        line.currency,
        normalize_card_descriptor(&line.description),
        line.purchase_date,
        count
    ));
    let plan_id = format!("card-plan:{:x}", hasher.finalize());
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM finance_installment_plans WHERE id=?1)",
            [&plan_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    let timestamp = now();
    if !exists {
        let merchant_id = find_merchant_for_descriptor(connection, &line.description)?;
        connection
            .execute(
                "INSERT INTO finance_installment_plans(id,account_id,merchant_id,description,purchase_date,
                     currency,total_amount,installment_count,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                params![
                    plan_id,
                    line.account_id,
                    merchant_id,
                    line.description,
                    line.purchase_date,
                    line.currency,
                    format_cents(line.amount * i128::from(count)),
                    count,
                    timestamp
                ],
            )
            .map_err(storage)?;
        for installment in 1..=count {
            let due_date = add_months(&line.due_date, i32::try_from(installment - number).unwrap_or_default())?;
            // Earlier installments were paid in statements loaded before
            // this plan existed; they count as paid without an expense.
            let status = if installment <= number { "confirmed" } else { "pending" };
            connection
                .execute(
                    "INSERT OR IGNORE INTO finance_installments(id,plan_id,installment_number,due_date,amount,
                         status,transaction_id,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,NULL,?7,?7)",
                    params![
                        format!("{plan_id}:{installment}"),
                        plan_id,
                        installment,
                        due_date,
                        format_cents(line.amount),
                        status,
                        timestamp
                    ],
                )
                .map_err(storage)?;
        }
    }
    connection
        .execute(
            "UPDATE finance_installments SET transaction_id=?1,status='confirmed',updated_at=?2
             WHERE plan_id=?3 AND installment_number=?4 AND transaction_id IS NULL",
            params![line_transaction_id, timestamp, plan_id, number],
        )
        .map_err(storage)?;
    Ok(())
}

/// Links an installment with a statement line on request.
pub(crate) fn link_installment_to_line(
    connection: &Connection,
    installment_id: &str,
    item_id: &str,
) -> Result<AutoLink, String> {
    let line = load_card_line(connection, item_id)?;
    let line_transaction_id = line
        .transaction_id
        .clone()
        .ok_or_else(|| "La línea del resumen no tiene gasto.".to_string())?;
    let (account_id, currency, number, count): (String, String, i64, i64) = connection
        .query_row(
            "SELECT p.account_id,p.currency,i.installment_number,p.installment_count
             FROM finance_installments i JOIN finance_installment_plans p ON p.id=i.plan_id WHERE i.id=?1",
            [installment_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "La cuota no existe.".to_string())?;
    if account_id != line.account_id || currency != line.currency {
        return Err("La cuota es de otra tarjeta u otra moneda.".into());
    }
    connection
        .execute(
            "UPDATE finance_installments SET transaction_id=?1,status='confirmed',updated_at=?2 WHERE id=?3",
            params![line_transaction_id, now(), installment_id],
        )
        .map_err(storage)?;
    log_link(
        connection,
        "installment-card-line",
        installment_id,
        item_id,
        format!("La línea {} pagó la cuota {number}/{count}.", describe_line(&line)),
    )
}

// ---------------------------------------------------------------------------
// Review resolution
// ---------------------------------------------------------------------------

/// Applies the chosen option of a pending review item.
pub(crate) fn resolve_review_item(
    connection: &Connection,
    id: &str,
    option_id: &str,
    actor_library_user_id: &str,
    source: &str,
) -> Result<ReviewItem, String> {
    let item = connection
        .query_row(
            &format!("SELECT {REVIEW_COLUMNS} FROM finance_review_items WHERE id=?1"),
            [id],
            review_item_from_row,
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "El caso para revisar no existe.".to_string())?;
    if item.status != "pending" {
        return Err("El caso ya fue resuelto.".into());
    }
    if !item.options.iter().any(|value| value.id == option_id) {
        return Err("La opción elegida no corresponde a este caso.".into());
    }
    let subject = |key: &str| item.subject[key].as_str().unwrap_or_default().to_string();
    let mut dismissed = matches!(option_id, "none" | "keep");
    match (item.kind.as_str(), option_id) {
        (_, "none" | "keep") => {}
        ("card-line-candidates", choice) => {
            let unpaid_id = choice.strip_prefix("merge:").unwrap_or_default();
            link_expense_to_line(connection, unpaid_id, &subject("lineId"))?;
        }
        ("unpaid-line-candidates", choice) => {
            let item_id = choice.strip_prefix("line:").unwrap_or_default();
            link_expense_to_line(connection, &subject("transactionId"), item_id)?;
        }
        ("similar-merchant", "merge") => merge_merchants(connection, &subject("newId"), &subject("existingId"))?,
        ("similar-product", "merge") => merge_products(connection, &subject("newId"), &subject("existingId"))?,
        ("missing-installment", "delete") => {
            let timestamp = now();
            connection
                .execute(
                    "UPDATE finance_transactions SET deleted_at=?1,updated_at=?1 WHERE id=?2",
                    params![timestamp, subject("transactionId")],
                )
                .map_err(storage)?;
            connection
                .execute(
                    "UPDATE finance_installments SET transaction_id=NULL,status='discarded',updated_at=?1 WHERE id=?2",
                    params![timestamp, subject("installmentId")],
                )
                .map_err(storage)?;
        }
        ("service-card-line", choice) => {
            let service_id = choice.strip_prefix("service:").unwrap_or_default();
            crate::finance_records::assign_card_line_to_service(
                connection,
                &subject("lineId"),
                service_id,
                actor_library_user_id,
                source,
            )?;
        }
        _ => {
            dismissed = true;
        }
    }
    let status = if dismissed { "dismissed" } else { "resolved" };
    connection
        .execute(
            "UPDATE finance_review_items SET status=?1,resolution=?2,resolved_at=?3 WHERE id=?4",
            params![status, option_id, now(), id],
        )
        .map_err(storage)?;
    connection
        .query_row(
            &format!("SELECT {REVIEW_COLUMNS} FROM finance_review_items WHERE id=?1"),
            [id],
            review_item_from_row,
        )
        .map_err(storage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_accents_punctuation_and_quantities() {
        assert_eq!(normalize_text("Leche La Serenísima 1 Lt."), "leche la serenisima 1l");
        assert_eq!(normalize_text("YERBA 500GR"), "yerba 500g");
        assert_eq!(normalize_text("Aceite 1,5 litros"), "aceite 1.5l");
        assert_eq!(normalize_text("Café  molido"), "cafe molido");
    }

    #[test]
    fn card_descriptors_drop_processor_branch_and_company_type() {
        assert_eq!(normalize_card_descriptor("MERPAGO*COTO CICSA 123"), "coto");
        assert_eq!(normalize_card_descriptor("PAYU*AR*UBER"), "uber");
        assert_eq!(normalize_card_descriptor("Farmacity S.A. Suc 45"), "farmacity");
    }

    #[test]
    fn matches_card_descriptors_with_merchants_on_words() {
        assert!(merchants_compatible("MERPAGO*COTO 4521", "Coto"));
        assert!(merchants_compatible("COTO CICSA", "Compra en Coto"));
        assert!(merchants_compatible("SHAMISHAWARMA", "Compra en Shamishawarma"));
        assert!(!merchants_compatible("YPF", "Compra en supermercado"));
        assert!(!merchants_compatible("DLO*SPOTIFY", "Netflix"));
    }

    #[test]
    fn similar_names_ignore_abbreviations_but_not_quantities() {
        let leche = normalize_text("Leche La Serenísima 1L");
        assert!(name_similarity(&normalize_text("LECHE SEREN 1LT"), &leche) >= SIMILAR_NAME_THRESHOLD);
        assert!(name_similarity(&normalize_text("Leche Serenísima 500 ml"), &leche) < SIMILAR_NAME_THRESHOLD);
        assert!(
            name_similarity(&normalize_text("Leche descremada 1l"), &normalize_text("Leche entera 1l"))
                < SIMILAR_NAME_THRESHOLD
        );
    }

    #[test]
    fn adding_months_keeps_the_day_inside_the_month() {
        assert_eq!(add_months("2026-01-31", 1).as_deref(), Ok("2026-02-28"));
        assert_eq!(add_months("2028-01-31", 1).as_deref(), Ok("2028-02-29"));
        assert_eq!(add_months("2026-11-15", 3).as_deref(), Ok("2027-02-15"));
        assert_eq!(add_months("2026-03-10", -3).as_deref(), Ok("2025-12-10"));
    }

    #[test]
    fn an_installment_line_pays_the_whole_purchase() {
        let line = CardLine {
            item_id: "line".into(),
            account_id: "card".into(),
            currency: "ARS".into(),
            purchase_date: "2026-08-10".into(),
            description: "FRAVEGA C.01/03".into(),
            amount: 33_333,
            installment_number: Some(1),
            installment_count: Some(3),
            transaction_id: None,
            due_date: "2026-09-05".into(),
        };
        assert!(line.pays(100_000));
        assert!(!line.pays(33_333));
    }
}
