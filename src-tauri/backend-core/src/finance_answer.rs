//! Verification of a finance final answer against what the turn really did:
//! the agent must not claim or promise a financial write that no tool
//! executed, must not leave a document received by Telegram unpersisted and
//! must ask for missing data through a clarification, not as final text.

/// What the turn executed, derived from its tool calls and results.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FinanceTurnFacts {
    /// Some mutating tool reported a change.
    pub mutation_executed: bool,
    /// The agent asked the user through `request_user_clarification`.
    pub clarification_requested: bool,
    /// A Telegram message carried a document (ticket, receipt, statement).
    pub document_received: bool,
    /// Names of the tools that reported a change.
    pub changed_tools: Vec<String>,
}

impl FinanceTurnFacts {
    fn persisted(&self, tool: &str) -> bool {
        self.changed_tools.iter().any(|name| name == tool)
    }
}

fn fold(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' => 'a',
            'é' => 'e',
            'í' => 'i',
            'ó' => 'o',
            'ú' | 'ü' => 'u',
            other => other,
        })
        .collect()
}

fn words(text: &str) -> Vec<&str> {
    text.split(|character: char| !character.is_alphanumeric()).filter(|word| !word.is_empty()).collect()
}

/// Whether `sequence` appears as consecutive words, each from its options.
fn has_phrase(words: &[&str], sequence: &[&[&str]]) -> bool {
    words.windows(sequence.len()).any(|window| {
        window.iter().zip(sequence).all(|(word, options)| options.contains(word))
    })
}

const DETECTED: &[&str] = &["detectado", "detectada", "identificado", "identificada"];

fn reports_detected(words: &[&str], subjects: &[&[&[&str]]]) -> bool {
    subjects.iter().any(|subject| {
        let mut sequence = subject.to_vec();
        sequence.push(DETECTED);
        has_phrase(words, &sequence)
    })
}

/// Correction for the model. `blocking` corrections describe an answer that
/// misreports a write and must never reach the user; the others (a question
/// asked as final text) may be delivered once the retries run out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FinanceCorrection {
    pub message: &'static str,
    pub blocking: bool,
}

const fn blocking(message: &'static str) -> Option<FinanceCorrection> {
    Some(FinanceCorrection { message, blocking: true })
}

/// Correction for the model, or `None` when the answer is consistent.
pub fn finance_answer_correction(answer: &str, facts: &FinanceTurnFacts) -> Option<FinanceCorrection> {
    let folded = fold(answer);
    let words = words(&folded);
    if facts.document_received {
        let ticket = reports_detected(&words, &[&[&["ticket"]], &[&["ticket"], &["de"], &["compra"]]]);
        let salary = reports_detected(
            &words,
            &[&[&["recibo"], &["de"], &["sueldo"]], &[&["liquidacion"], &["de"], &["haberes"]]],
        );
        let statement = reports_detected(
            &words,
            &[&[&["resumen"], &["de"], &["tarjeta"]], &[&["resumen"], &["de"], &["tarjeta"], &["de"], &["credito"]]],
        );
        let invoice = reports_detected(
            &words,
            &[&[&["factura", "boleta"], &["servicio"]], &[&["factura", "boleta"], &["de"], &["servicio"]]],
        );
        if ticket && !facts.persisted("create_finance_purchase") {
            return blocking("Detectaste un ticket recibido por Telegram, pero aún no fue persistido. No finalices con un resumen: usa create_finance_purchase con la cuenta, categoría, comercio, fecha, total, líneas y sourceReference disponibles. Espera ok:true antes de responder que el ticket quedó registrado.");
        }
        if salary && !facts.persisted("create_finance_salary") {
            return blocking("Detectaste un recibo de sueldo recibido por Telegram, pero aún no fue persistido. Usa create_finance_salary con cuenta, período, fecha de cobro, empleador, bruto, descuentos, neto, moneda, conceptos y sourceReference. Espera ok:true antes de responder que quedó registrado.");
        }
        if statement && !facts.persisted("create_finance_credit_card_statement") {
            return blocking("Detectaste un resumen de tarjeta recibido por Telegram, pero aún no fue persistido. Usa create_finance_credit_card_statement con la cuenta credit_card, período, fechas, moneda, saldos, totales, líneas y sourceReference. Espera ok:true antes de responder que quedó registrado.");
        }
        if invoice && !facts.persisted("create_finance_service_invoice") {
            return blocking("Detectaste una factura o boleta de servicio recibida por Telegram, pero aún no fue persistida. Usa create_finance_service_invoice con período, importe, moneda y la referencia opaca disponible; no generes un gasto genérico adicional.");
        }
    }
    if facts.mutation_executed {
        return None;
    }
    // First person ("registré") or a perfect/passive result ("quedó
    // registrado"); a bare participle describes existing data ("el gasto
    // registrado ayer") and is not a claim.
    const FIRST_PERSON: &[&str] = &["registre", "guarde", "cargue", "anote"];
    const AUXILIARIES: &[&str] = &["he", "ha", "hemos", "quedo", "quedaron"];
    const PARTICIPLES: &[&str] = &[
        "registrado", "registrada", "registrados", "registradas", "guardado", "guardada", "guardados",
        "guardadas", "cargado", "cargada", "cargados", "cargadas", "anotado", "anotada", "anotados", "anotadas",
    ];
    let claims_persisted = words.iter().any(|word| FIRST_PERSON.contains(word))
        || has_phrase(&words, &[AUXILIARIES, PARTICIPLES])
        || has_phrase(&words, &[AUXILIARIES, &["sido"], PARTICIPLES])
        || folded.lines().any(|line| {
            let line_words = self::words(line);
            line_words.contains(&"listo")
                && line_words.iter().any(|word| ["gasto", "ingreso", "movimiento"].contains(word))
        });
    let promises_mutation = has_phrase(
        &words,
        &[&["voy", "vamos", "procedere"], &["a"], &["registrar", "guardar", "cargar", "anotar", "crear"]],
    );
    if claims_persisted || promises_mutation {
        return blocking("No afirmes ni prometas que el movimiento fue registrado o que lo registrarás: ninguna mutación financiera se ejecutó. Si falta la cuenta o categoría, usa request_user_clarification. Si todos los datos están completos, llama create_finance_transaction y espera su resultado antes de responder.");
    }
    const FIELDS: &[&str] = &["cuenta", "categoria", "fecha", "moneda"];
    let asks_field = has_phrase(&words, &[&["que", "cual"], FIELDS])
        || (answer.contains('?') && words.iter().any(|word| FIELDS.contains(word)));
    (asks_field && !facts.clarification_requested).then_some(FinanceCorrection {
        message: "No hagas la pregunta financiera como texto final. Llama request_user_clarification con la cuenta, categoría, fecha o moneda que falta y espera su respuesta dentro de esta misma operación; así se conserva la referencia del ticket y no se inicia otra conversación.",
        blocking: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_without_a_write_are_corrected() {
        let facts = FinanceTurnFacts::default();
        assert!(finance_answer_correction("Listo, registré el gasto de 500.", &facts).is_some());
        assert!(finance_answer_correction("Voy a registrar el movimiento.", &facts).is_some());
        assert!(finance_answer_correction("Tenés 5 gastos registrados este mes.", &facts).is_none());
        assert!(finance_answer_correction("El gasto registrado ayer fue de 500.", &facts).is_none());
        assert!(finance_answer_correction("El gasto quedó registrado.", &facts).is_some());
        let written = FinanceTurnFacts { mutation_executed: true, ..FinanceTurnFacts::default() };
        assert!(finance_answer_correction("Registré el gasto.", &written).is_none());
    }

    #[test]
    fn missing_fields_go_through_a_clarification() {
        let facts = FinanceTurnFacts::default();
        assert!(finance_answer_correction("¿En qué cuenta lo registro?", &facts).is_some());
        let asked = FinanceTurnFacts { clarification_requested: true, ..FinanceTurnFacts::default() };
        assert!(finance_answer_correction("¿Qué cuenta usaste?", &asked).is_none());
    }

    #[test]
    fn detected_documents_must_be_persisted() {
        let facts = FinanceTurnFacts { document_received: true, ..FinanceTurnFacts::default() };
        assert!(finance_answer_correction("Ticket de compra detectado en Coto.", &facts)
            .is_some_and(|correction| correction.blocking && correction.message.contains("create_finance_purchase")));
        let saved = FinanceTurnFacts {
            document_received: true,
            mutation_executed: true,
            changed_tools: vec!["create_finance_purchase".into()],
            ..FinanceTurnFacts::default()
        };
        assert!(finance_answer_correction("Ticket detectado y guardado.", &saved).is_none());
    }
}
