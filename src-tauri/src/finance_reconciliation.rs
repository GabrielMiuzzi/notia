use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone)]
pub(crate) struct ReconciliationService {
    pub id: String,
    pub name: String,
    pub provider: Option<String>,
    pub currency: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ReconciliationLine {
    pub id: String,
    pub transaction_id: Option<String>,
    pub purchase_date: String,
    pub description: String,
    pub amount: String,
    pub currency: String,
    pub item_type: String,
    pub confirmed: bool,
    pub transaction_snapshot: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ReconciliationOccurrence {
    pub id: String,
    pub service_id: String,
    pub period: String,
    pub paid_amount: Option<String>,
    pub transaction_id: Option<String>,
    pub snapshot: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ReconciliationInput {
    pub statement_id: String,
    pub statement_period: String,
    pub statement_snapshot: String,
    pub lines: Vec<ReconciliationLine>,
    pub services: Vec<ReconciliationService>,
    pub occurrences: Vec<ReconciliationOccurrence>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardServiceAssignment {
    pub statement_id: String,
    pub line_id: String,
    pub service_id: String,
    pub transaction_id: String,
    pub purchase_date: String,
    pub period: String,
    pub amount: String,
    pub currency: String,
    pub assignment_status: String,
    pub evidence: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardServiceReason {
    pub code: String,
    pub message: String,
    pub line_ids: Vec<String>,
    pub candidate_service_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardServiceAmbiguousGroup {
    pub statement_id: String,
    pub service_id: Option<String>,
    pub line_ids: Vec<String>,
    pub candidate_service_ids: Vec<String>,
    pub statement_period: String,
    pub reason: CardServiceReason,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardServiceReconciliation {
    pub status: String,
    pub assignments: Vec<CardServiceAssignment>,
    pub ambiguous_groups: Vec<CardServiceAmbiguousGroup>,
    pub reasons: Vec<CardServiceReason>,
}

pub(crate) fn normalize_service_text(value: &str) -> String {
    value
        .nfd()
        .filter(|character| !matches!(*character, '\u{0300}'..='\u{036f}'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn valid_amount(value: &str) -> bool {
    let mut parts = value.trim().split('.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next().unwrap_or_default();
    !whole.is_empty()
        && whole.chars().all(|character| character.is_ascii_digit())
        && fraction.len() <= 2
        && fraction.chars().all(|character| character.is_ascii_digit())
        && parts.next().is_none()
}

fn amount_cents(value: &str) -> Option<i128> {
    if !valid_amount(value) {
        return None;
    }
    let mut parts = value.trim().split('.');
    let whole = parts.next()?.parse::<i128>().ok()?;
    let fraction = format!("{:0<2}", parts.next().unwrap_or_default())
        .parse::<i128>()
        .ok()?;
    whole.checked_mul(100)?.checked_add(fraction)
}

fn valid_date(value: &str) -> bool {
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
    let year = value[0..4].parse::<u32>().unwrap_or_default();
    let month = value[5..7].parse::<u32>().unwrap_or_default();
    let day = value[8..].parse::<u32>().unwrap_or_default();
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    };
    max_day > 0 && (1..=max_day).contains(&day)
}

fn previous_period(period: &str) -> Option<String> {
    if period.len() != 7 {
        return None;
    }
    let year = period[0..4].parse::<i32>().ok()?;
    let month = period[5..].parse::<u8>().ok()?;
    if !(1..=12).contains(&month) || period.as_bytes()[4] != b'-' {
        return None;
    }
    Some(if month == 1 {
        format!("{:04}-12", year - 1)
    } else {
        format!("{year:04}-{:02}", month - 1)
    })
}

fn same_amount(left: &str, right: &str) -> bool {
    amount_cents(left)
        .zip(amount_cents(right))
        .is_some_and(|(a, b)| a == b)
}

fn matches_service_descriptor(description: &str, candidate: &str) -> bool {
    description == candidate
        || (candidate.chars().count() >= 3
            && !candidate.contains(' ')
            && format!(" {description} ").contains(&format!(" {candidate} ")))
}

fn reason(
    code: &str,
    message: impl Into<String>,
    line_ids: Vec<String>,
    candidate_service_ids: Vec<String>,
) -> CardServiceReason {
    CardServiceReason {
        code: code.to_string(),
        message: message.into(),
        line_ids,
        candidate_service_ids,
    }
}

fn assignment(
    input: &ReconciliationInput,
    line: &ReconciliationLine,
    service: &ReconciliationService,
    transaction_id: &str,
    period: String,
    assignment_status: &str,
) -> CardServiceAssignment {
    CardServiceAssignment {
        statement_id: input.statement_id.clone(),
        line_id: line.id.clone(),
        service_id: service.id.clone(),
        transaction_id: transaction_id.to_string(),
        purchase_date: line.purchase_date.clone(),
        period,
        amount: line.amount.clone(),
        currency: line.currency.clone(),
        assignment_status: assignment_status.to_string(),
        evidence: serde_json::json!({
            "matching": "normalized-boundary",
            "description": line.description,
            "normalizedDescription": normalize_service_text(&line.description),
            "serviceName": service.name,
            "provider": service.provider,
            "normalizedServiceName": normalize_service_text(&service.name),
            "purchaseDate": line.purchase_date,
            "statementPeriod": input.statement_period,
        }),
    }
}

fn occurrence<'a>(
    occurrences: &'a [ReconciliationOccurrence],
    service_id: &str,
    period: &str,
) -> Option<&'a ReconciliationOccurrence> {
    occurrences
        .iter()
        .find(|value| value.service_id == service_id && value.period == period)
}

fn transaction_linked_elsewhere(
    occurrences: &[ReconciliationOccurrence],
    transaction_id: &str,
    service_id: &str,
    period: &str,
) -> bool {
    occurrences.iter().any(|value| {
        value.transaction_id.as_deref() == Some(transaction_id)
            && (value.service_id != service_id || value.period != period)
    })
}

fn existing_assignment_status(
    target: Option<&ReconciliationOccurrence>,
    line: &ReconciliationLine,
) -> Result<&'static str, &'static str> {
    let Some(target) = target else {
        return Ok("new");
    };
    if target.paid_amount.as_deref().is_some_and(|amount| {
        line.transaction_id.is_some()
            && target.transaction_id == line.transaction_id
            && same_amount(amount, &line.amount)
    }) {
        return Ok("already-reconciled");
    }
    if target.paid_amount.is_some() || target.transaction_id.is_some() {
        return Err("destination-conflict");
    }
    Ok("new")
}

pub(crate) fn reconcile_card_service_consumption(
    input: &ReconciliationInput,
) -> CardServiceReconciliation {
    let mut assignments = Vec::new();
    let mut ambiguous_groups = Vec::new();
    let mut reasons = Vec::new();
    let services_by_id = input
        .services
        .iter()
        .map(|service| (service.id.as_str(), service))
        .collect::<BTreeMap<_, _>>();
    let mut grouped: BTreeMap<String, Vec<&ReconciliationLine>> = BTreeMap::new();

    for line in &input.lines {
        if line.item_type != "purchase" || !line.confirmed {
            continue;
        }
        let valid_line = line
            .transaction_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !line.description.trim().is_empty()
            && valid_amount(&line.amount)
            && amount_cents(&line.amount).is_some_and(|amount| amount > 0)
            && !line.currency.trim().is_empty()
            && valid_date(&line.purchase_date);
        if !valid_line {
            reasons.push(reason(
                "invalid-purchase-line",
                "La línea purchase no tiene transacción, descripción, importe, moneda o fecha válidos.",
                vec![line.id.clone()],
                Vec::new(),
            ));
            continue;
        }

        let normalized_description = normalize_service_text(&line.description);
        let candidates = input
            .services
            .iter()
            .filter(|service| {
                matches_service_descriptor(
                    &normalized_description,
                    &normalize_service_text(&service.name),
                ) || service.provider.as_deref().is_some_and(|provider| {
                    !provider.trim().is_empty()
                        && matches_service_descriptor(
                            &normalized_description,
                            &normalize_service_text(provider),
                        )
                })
            })
            .collect::<Vec<_>>();
        let candidate_ids = candidates
            .iter()
            .map(|service| service.id.clone())
            .collect::<Vec<_>>();
        if candidates.len() != 1 {
            let code = if candidates.is_empty() {
                "no-service-match"
            } else {
                "multiple-service-match"
            };
            let group_reason = reason(
                code,
                if candidates.is_empty() {
                    "La descripción no coincide exactamente con el nombre o proveedor de un servicio."
                } else {
                    "La descripción coincide con varios servicios; la asignación es ambigua."
                },
                vec![line.id.clone()],
                candidate_ids.clone(),
            );
            reasons.push(group_reason.clone());
            ambiguous_groups.push(CardServiceAmbiguousGroup {
                statement_id: input.statement_id.clone(),
                service_id: None,
                line_ids: vec![line.id.clone()],
                candidate_service_ids: candidate_ids,
                statement_period: input.statement_period.clone(),
                reason: group_reason,
            });
            continue;
        }
        let service = candidates[0];
        if service.currency != line.currency {
            let group_reason = reason(
                "currency-mismatch",
                "La moneda del consumo no coincide con la moneda del servicio.",
                vec![line.id.clone()],
                vec![service.id.clone()],
            );
            reasons.push(group_reason.clone());
            ambiguous_groups.push(CardServiceAmbiguousGroup {
                statement_id: input.statement_id.clone(),
                service_id: Some(service.id.clone()),
                line_ids: vec![line.id.clone()],
                candidate_service_ids: vec![service.id.clone()],
                statement_period: input.statement_period.clone(),
                reason: group_reason,
            });
            continue;
        }
        grouped.entry(service.id.clone()).or_default().push(line);
    }

    for (service_id, mut lines) in grouped {
        let service = services_by_id[service_id.as_str()];
        lines.sort_by(|left, right| {
            left.purchase_date
                .cmp(&right.purchase_date)
                .then_with(|| left.id.cmp(&right.id))
        });
        if lines.len() > 2 {
            let line_ids = lines.iter().map(|line| line.id.clone()).collect::<Vec<_>>();
            let group_reason = reason(
                "more-than-two-consumptions",
                "Hay más de dos consumos del mismo servicio en el resumen; no se asigna automáticamente.",
                line_ids.clone(),
                vec![service_id.clone()],
            );
            reasons.push(group_reason.clone());
            ambiguous_groups.push(CardServiceAmbiguousGroup {
                statement_id: input.statement_id.clone(),
                service_id: Some(service_id),
                line_ids,
                candidate_service_ids: vec![service.id.clone()],
                statement_period: input.statement_period.clone(),
                reason: group_reason,
            });
            continue;
        }

        let periods = if lines.len() == 1 {
            vec![input.statement_period.clone()]
        } else {
            let Some(previous) = previous_period(&input.statement_period) else {
                continue;
            };
            let previous_occurrence = occurrence(&input.occurrences, &service_id, &previous);
            let current_occurrence =
                occurrence(&input.occurrences, &service_id, &input.statement_period);
            let already_reconciled = [
                (previous_occurrence, &lines[0]),
                (current_occurrence, &lines[1]),
            ]
            .iter()
            .all(|(target, line)| {
                existing_assignment_status(*target, line)
                    .is_ok_and(|status| status == "already-reconciled")
            });
            if already_reconciled {
                vec![previous, input.statement_period.clone()]
            } else if previous_occurrence.is_some_and(|value| value.paid_amount.is_some()) {
                let group_reason = reason(
                    "previous-period-paid",
                    "El período anterior ya tiene un pago; la distribución de dos consumos requiere decisión.",
                    lines.iter().map(|line| line.id.clone()).collect(),
                    vec![service_id.clone()],
                );
                reasons.push(group_reason.clone());
                ambiguous_groups.push(CardServiceAmbiguousGroup {
                    statement_id: input.statement_id.clone(),
                    service_id: Some(service_id),
                    line_ids: lines.iter().map(|line| line.id.clone()).collect(),
                    candidate_service_ids: vec![service.id.clone()],
                    statement_period: input.statement_period.clone(),
                    reason: group_reason,
                });
                continue;
            } else {
                vec![previous, input.statement_period.clone()]
            }
        };

        let mut group_assignments = Vec::new();
        let mut conflict = None;
        let mut group_transactions = BTreeSet::new();
        for (line, period) in lines.iter().zip(periods) {
            let Some(transaction_id) = line.transaction_id.as_deref() else {
                conflict = Some("invalid-purchase-line");
                continue;
            };
            if !group_transactions.insert(transaction_id.to_string()) {
                conflict = Some("transaction-conflict");
                continue;
            }
            let target = occurrence(&input.occurrences, &service_id, &period);
            match existing_assignment_status(target, line) {
                Ok(status)
                    if !transaction_linked_elsewhere(
                        &input.occurrences,
                        transaction_id,
                        &service_id,
                        &period,
                    ) =>
                {
                    group_assignments.push(assignment(
                        input,
                        line,
                        service,
                        transaction_id,
                        period,
                        status,
                    ))
                }
                Ok(_) => conflict = Some("transaction-conflict"),
                Err(code) => conflict = Some(code),
            }
        }
        if let Some(code) = conflict {
            let group_reason = reason(
                code,
                "El destino o la transacción ya están vinculados de forma incompatible; no se modifica nada.",
                lines.iter().map(|line| line.id.clone()).collect(),
                vec![service_id.clone()],
            );
            reasons.push(group_reason.clone());
            ambiguous_groups.push(CardServiceAmbiguousGroup {
                statement_id: input.statement_id.clone(),
                service_id: Some(service_id),
                line_ids: lines.iter().map(|line| line.id.clone()).collect(),
                candidate_service_ids: vec![service.id.clone()],
                statement_period: input.statement_period.clone(),
                reason: group_reason,
            });
        } else {
            assignments.extend(group_assignments);
        }
    }

    let status = if ambiguous_groups.is_empty() {
        if assignments.is_empty() {
            "no-matches"
        } else {
            "ready"
        }
    } else if assignments.is_empty() {
        "ambiguous"
    } else {
        "partial"
    };
    CardServiceReconciliation {
        status: status.to_string(),
        assignments,
        ambiguous_groups,
        reasons,
    }
}

/// Validates an explicit user selection for an ambiguous group without allowing
/// the caller to change any fact from the persisted preview.
pub(crate) fn resolve_card_service_assignments(
    input: &ReconciliationInput,
    automatic: &CardServiceReconciliation,
    requested: &[CardServiceAssignment],
) -> Result<CardServiceReconciliation, String> {
    if requested.is_empty() {
        return Err("La resolución manual requiere al menos una asignación.".into());
    }
    let services = input
        .services
        .iter()
        .map(|service| (service.id.as_str(), service))
        .collect::<BTreeMap<_, _>>();
    let mut seen_lines = BTreeSet::new();
    let mut seen_destinations = BTreeSet::new();
    let mut seen_transactions = BTreeSet::new();
    let mut manual = Vec::with_capacity(requested.len());

    for requested_assignment in requested {
        if requested_assignment.statement_id != input.statement_id
            || !seen_lines.insert(requested_assignment.line_id.clone())
        {
            return Err("La resolución manual contiene líneas repetidas o de otro resumen.".into());
        }
        let line = input
            .lines
            .iter()
            .find(|line| line.id == requested_assignment.line_id)
            .ok_or_else(|| "La línea de la resolución manual no existe.".to_string())?;
        if line.item_type != "purchase"
            || !line.confirmed
            || line.transaction_id.as_deref() != Some(requested_assignment.transaction_id.as_str())
            || line.purchase_date != requested_assignment.purchase_date
            || line.amount != requested_assignment.amount
            || line.currency != requested_assignment.currency
        {
            return Err("La resolución manual cambió los datos de una línea del preview.".into());
        }
        let group = automatic
            .ambiguous_groups
            .iter()
            .find(|group| group.line_ids.iter().any(|line_id| line_id == &line.id))
            .ok_or_else(|| {
                "La resolución manual incluye una línea que no era ambigua.".to_string()
            })?;
        if !group
            .candidate_service_ids
            .iter()
            .any(|id| id == &requested_assignment.service_id)
            || group
                .service_id
                .as_deref()
                .is_some_and(|id| id != requested_assignment.service_id)
        {
            return Err("El servicio elegido no es candidato en el preview.".into());
        }
        let service = services
            .get(requested_assignment.service_id.as_str())
            .ok_or_else(|| "El servicio elegido no existe.".to_string())?;
        if service.currency != requested_assignment.currency {
            return Err("La moneda del servicio elegido no coincide con la línea.".into());
        }
        let previous = previous_period(&input.statement_period);
        let period_allowed = requested_assignment.period == input.statement_period
            || (group.line_ids.len() > 1
                && previous.as_deref() == Some(requested_assignment.period.as_str()));
        if !period_allowed {
            return Err(
                "El período elegido no corresponde al resumen ni a su período anterior.".into(),
            );
        }
        if !seen_destinations.insert((
            requested_assignment.service_id.clone(),
            requested_assignment.period.clone(),
        )) {
            return Err("La resolución manual asigna dos líneas a la misma ocurrencia.".into());
        }
        if !seen_transactions.insert(requested_assignment.transaction_id.clone()) {
            return Err(
                "La resolución manual reutiliza una transacción en más de una ocurrencia.".into(),
            );
        }
        let target = occurrence(
            &input.occurrences,
            &requested_assignment.service_id,
            &requested_assignment.period,
        );
        if existing_assignment_status(target, line).is_err()
            || transaction_linked_elsewhere(
                &input.occurrences,
                &requested_assignment.transaction_id,
                &requested_assignment.service_id,
                &requested_assignment.period,
            )
        {
            return Err(
                "La ocurrencia o transacción elegida ya está vinculada de forma incompatible."
                    .into(),
            );
        }
        manual.push(assignment(
            input,
            line,
            service,
            &requested_assignment.transaction_id,
            requested_assignment.period.clone(),
            "new",
        ));
    }

    let mut assignments = automatic.assignments.clone();
    assignments.extend(manual);
    Ok(CardServiceReconciliation {
        status: "ready".into(),
        assignments,
        ambiguous_groups: Vec::new(),
        reasons: automatic.reasons.clone(),
    })
}

pub(crate) fn reconciliation_fingerprint(
    input: &ReconciliationInput,
    result: &CardServiceReconciliation,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.statement_id.as_bytes());
    hasher.update(input.statement_period.as_bytes());
    hasher.update(input.statement_snapshot.as_bytes());
    for line in &input.lines {
        hasher.update(
            format!(
                "line:{}:{}:{}:{}:{}:{}:{}:{}:{}|",
                line.id,
                line.transaction_id.as_deref().unwrap_or_default(),
                line.purchase_date,
                normalize_service_text(&line.description),
                line.amount,
                line.currency,
                line.item_type,
                line.confirmed,
                line.transaction_snapshot
            )
            .as_bytes(),
        );
    }
    for service in &input.services {
        hasher.update(
            format!(
                "service:{}:{}:{}:{}|",
                service.id,
                normalize_service_text(&service.name),
                normalize_service_text(service.provider.as_deref().unwrap_or_default()),
                service.currency
            )
            .as_bytes(),
        );
    }
    for occurrence in &input.occurrences {
        hasher.update(
            format!(
                "occurrence:{}:{}:{}:{}:{}:{}|",
                occurrence.id,
                occurrence.service_id,
                occurrence.period,
                occurrence.paid_amount.as_deref().unwrap_or_default(),
                occurrence.transaction_id.as_deref().unwrap_or_default(),
                occurrence.snapshot
            )
            .as_bytes(),
        );
    }
    hasher.update(
        serde_json::to_string(result)
            .unwrap_or_else(|_| "reconciliation-serialization-error".into()),
    );
    format!("service-card-reconciliation:{:x}", hasher.finalize())
}

pub(crate) fn assignment_keys(
    assignments: &[CardServiceAssignment],
) -> BTreeSet<(
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
)> {
    assignments
        .iter()
        .map(|assignment| {
            (
                assignment.statement_id.clone(),
                assignment.line_id.clone(),
                assignment.service_id.clone(),
                assignment.period.clone(),
                assignment.transaction_id.clone(),
                assignment.purchase_date.clone(),
                assignment.amount.clone(),
                assignment.currency.clone(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(
        id: &str,
        name: &str,
        provider: Option<&str>,
        currency: &str,
    ) -> ReconciliationService {
        ReconciliationService {
            id: id.into(),
            name: name.into(),
            provider: provider.map(str::to_owned),
            currency: currency.into(),
        }
    }

    fn line(
        id: &str,
        transaction_id: Option<&str>,
        date: &str,
        description: &str,
        kind: &str,
    ) -> ReconciliationLine {
        ReconciliationLine {
            id: id.into(),
            transaction_id: transaction_id.map(str::to_owned),
            purchase_date: date.into(),
            description: description.into(),
            amount: "100.00".into(),
            currency: "ARS".into(),
            item_type: kind.into(),
            confirmed: true,
            transaction_snapshot: String::new(),
        }
    }

    fn input(
        lines: Vec<ReconciliationLine>,
        occurrences: Vec<ReconciliationOccurrence>,
    ) -> ReconciliationInput {
        ReconciliationInput {
            statement_id: "statement".into(),
            statement_period: "2026-09".into(),
            statement_snapshot: String::new(),
            lines,
            services: vec![service("internet", "Internet", Some("Fibra"), "ARS")],
            occurrences,
        }
    }

    #[test]
    fn matches_accented_name_or_provider_only_exactly() {
        let result = reconcile_card_service_consumption(&input(
            vec![line(
                "line",
                Some("tx"),
                "2026-08-02",
                "  INTERNET ",
                "purchase",
            )],
            vec![],
        ));
        assert_eq!(result.assignments[0].service_id, "internet");
        assert_eq!(result.assignments[0].period, "2026-09");

        let result = reconcile_card_service_consumption(&input(
            vec![line(
                "line",
                Some("tx"),
                "2026-08-02",
                "Interés de Internet",
                "purchase",
            )],
            vec![],
        ));
        assert!(result.assignments.is_empty());
        assert_eq!(result.ambiguous_groups[0].reason.code, "no-service-match");
    }

    #[test]
    fn matches_service_name_inside_a_card_descriptor_on_word_boundaries() {
        let mut descriptor = line(
            "descriptor",
            Some("tx-descriptor"),
            "2026-08-02",
            "MOVISTAR ARGENTINA 82997",
            "purchase",
        );
        let mut partial = line(
            "partial",
            Some("tx-partial"),
            "2026-08-03",
            "Supermovistar",
            "purchase",
        );
        descriptor.amount = "100.00".into();
        partial.amount = "100.00".into();
        let mut input = input(vec![descriptor, partial], vec![]);
        input.services = vec![service("movistar", "Movistar", None, "ARS")];

        let result = reconcile_card_service_consumption(&input);

        assert_eq!(result.assignments.len(), 1);
        assert_eq!(result.assignments[0].line_id, "descriptor");
        assert_eq!(result.ambiguous_groups[0].reason.code, "no-service-match");
    }

    #[test]
    fn excludes_non_purchase_unconfirmed_and_invalid_lines() {
        let mut pending = line(
            "pending",
            Some("tx-pending"),
            "2026-08-02",
            "Internet",
            "purchase",
        );
        pending.confirmed = false;
        let invalid = line("invalid", None, "2026-08-02", "Internet", "purchase");
        let result = reconcile_card_service_consumption(&input(
            vec![
                line(
                    "payment",
                    Some("tx-payment"),
                    "2026-08-02",
                    "Internet",
                    "payment",
                ),
                line("fee", Some("tx-fee"), "2026-08-02", "Internet", "fee"),
                line(
                    "credit",
                    Some("tx-credit"),
                    "2026-08-02",
                    "Internet",
                    "credit",
                ),
                pending,
                invalid,
            ],
            vec![],
        ));
        assert!(result.assignments.is_empty());
        assert_eq!(result.reasons.len(), 1);
        assert_eq!(result.reasons[0].code, "invalid-purchase-line");
    }

    #[test]
    fn distributes_two_consumptions_by_date_to_previous_and_statement_period() {
        let result = reconcile_card_service_consumption(&input(
            vec![
                line(
                    "newer",
                    Some("tx-newer"),
                    "2026-09-10",
                    "Internet",
                    "purchase",
                ),
                line(
                    "older",
                    Some("tx-older"),
                    "2026-08-10",
                    "Internet",
                    "purchase",
                ),
            ],
            vec![],
        ));
        assert_eq!(result.assignments[0].line_id, "older");
        assert_eq!(result.assignments[0].period, "2026-08");
        assert_eq!(result.assignments[1].line_id, "newer");
        assert_eq!(result.assignments[1].period, "2026-09");
    }

    #[test]
    fn does_not_distribute_when_previous_is_paid_or_there_are_more_than_two() {
        let previous_paid = ReconciliationOccurrence {
            id: "occurrence".into(),
            service_id: "internet".into(),
            period: "2026-08".into(),
            paid_amount: Some("50.00".into()),
            transaction_id: Some("old-tx".into()),
            snapshot: String::new(),
        };
        let result = reconcile_card_service_consumption(&input(
            vec![
                line("one", Some("tx-one"), "2026-08-10", "Internet", "purchase"),
                line("two", Some("tx-two"), "2026-09-10", "Internet", "purchase"),
            ],
            vec![previous_paid],
        ));
        assert!(result.assignments.is_empty());
        assert_eq!(
            result.ambiguous_groups[0].reason.code,
            "previous-period-paid"
        );

        let result = reconcile_card_service_consumption(&input(
            vec![
                line("one", Some("tx-one"), "2026-08-10", "Internet", "purchase"),
                line("two", Some("tx-two"), "2026-08-11", "Internet", "purchase"),
                line(
                    "three",
                    Some("tx-three"),
                    "2026-08-12",
                    "Internet",
                    "purchase",
                ),
            ],
            vec![],
        ));
        assert!(result.assignments.is_empty());
        assert_eq!(
            result.ambiguous_groups[0].reason.code,
            "more-than-two-consumptions"
        );
    }

    #[test]
    fn accepts_a_manual_selection_for_an_ambiguous_group_without_changing_line_data() {
        let previous_paid = ReconciliationOccurrence {
            id: "occurrence".into(),
            service_id: "internet".into(),
            period: "2026-08".into(),
            paid_amount: Some("50.00".into()),
            transaction_id: Some("old-tx".into()),
            snapshot: String::new(),
        };
        let input = input(
            vec![
                line("one", Some("tx-one"), "2026-08-10", "Internet", "purchase"),
                line("two", Some("tx-two"), "2026-09-10", "Internet", "purchase"),
            ],
            vec![previous_paid],
        );
        let preview = reconcile_card_service_consumption(&input);
        let resolved = resolve_card_service_assignments(
            &input,
            &preview,
            &[CardServiceAssignment {
                statement_id: "statement".into(),
                line_id: "two".into(),
                service_id: "internet".into(),
                transaction_id: "tx-two".into(),
                purchase_date: "2026-09-10".into(),
                period: "2026-09".into(),
                amount: "100.00".into(),
                currency: "ARS".into(),
                assignment_status: "new".into(),
                evidence: serde_json::json!({}),
            }],
        )
        .expect("manual resolution");
        assert_eq!(resolved.status, "ready");
        assert_eq!(resolved.assignments.len(), 1);
        assert_eq!(resolved.assignments[0].line_id, "two");
        assert_eq!(resolved.assignments[0].period, "2026-09");
        assert!(resolved.ambiguous_groups.is_empty());
    }
}
