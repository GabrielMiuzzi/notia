//! Referencias orientativas de IMC y composición corporal para adultos: el
//! tramo visible de cada barra, sus cortes y el estado de un valor.

use serde::Serialize;

use super::Sex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Tone {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "warn")]
    Warn,
    #[serde(rename = "alto")]
    High,
    #[serde(rename = "bajo")]
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Segment {
    /// El tramo llega hasta este valor (sin incluirlo).
    pub until: f64,
    pub label: &'static str,
    pub tone: Tone,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Range {
    pub min: f64,
    pub max: f64,
    pub segments: Vec<Segment>,
}

const fn seg(until: f64, label: &'static str, tone: Tone) -> Segment {
    Segment { until, label, tone }
}

const INF: f64 = f64::INFINITY;

pub fn bmi_range() -> Range {
    Range {
        min: 15.0,
        max: 42.0,
        segments: vec![
            seg(18.5, "Bajo peso", Tone::Low),
            seg(25.0, "Normal", Tone::Ok),
            seg(30.0, "Sobrepeso", Tone::Warn),
            seg(35.0, "Obesidad grado I", Tone::High),
            seg(40.0, "Obesidad grado II", Tone::High),
            seg(INF, "Obesidad grado III", Tone::High),
        ],
    }
}

/// El rango de una métrica de la balanza, si tiene referencia.
pub fn range_for(key: &str, sex: Sex) -> Option<Range> {
    let female = sex == Sex::Female;
    let range = |min: f64, max: f64, segments: Vec<Segment>| Some(Range { min, max, segments });
    match key {
        "imc" => Some(bmi_range()),
        "grasaPct" if female => range(10.0, 50.0, vec![seg(21.0, "Bajo", Tone::Low), seg(33.0, "Normal", Tone::Ok), seg(39.0, "Alto", Tone::Warn), seg(INF, "Muy alto", Tone::High)]),
        "grasaPct" => range(3.0, 40.0, vec![seg(8.0, "Bajo", Tone::Low), seg(20.0, "Normal", Tone::Ok), seg(25.0, "Alto", Tone::Warn), seg(INF, "Muy alto", Tone::High)]),
        "grasaVisceral" => range(1.0, 20.0, vec![seg(10.0, "Normal", Tone::Ok), seg(15.0, "Alto", Tone::Warn), seg(INF, "Muy alto", Tone::High)]),
        "aguaPct" if female => range(35.0, 70.0, vec![seg(45.0, "Bajo", Tone::Low), seg(60.01, "Normal", Tone::Ok), seg(INF, "Alto", Tone::Warn)]),
        "aguaPct" => range(40.0, 75.0, vec![seg(50.0, "Bajo", Tone::Low), seg(65.01, "Normal", Tone::Ok), seg(INF, "Alto", Tone::Warn)]),
        "proteinaPct" => range(10.0, 25.0, vec![seg(16.0, "Bajo", Tone::Low), seg(20.01, "Normal", Tone::Ok), seg(INF, "Alto", Tone::Ok)]),
        "obesidadPct" => range(-30.0, 50.0, vec![seg(-10.0, "Bajo peso", Tone::Low), seg(10.01, "Normal", Tone::Ok), seg(20.01, "Sobrepeso", Tone::Warn), seg(INF, "Obesidad", Tone::High)]),
        _ => None,
    }
}

/// El estado de un valor: su etiqueta y su tono. La edad metabólica se
/// compara con la edad de la persona.
pub fn state(key: &str, value: f64, sex: Sex, age: Option<i64>) -> Option<(&'static str, Tone)> {
    if key == "edadMetabolica" {
        let age = age?;
        return Some(if value <= age as f64 { ("Igual o menor a tu edad", Tone::Ok) } else { ("Mayor a tu edad", Tone::Warn) });
    }
    let range = range_for(key, sex)?;
    let segment = range.segments.iter().find(|segment| value < segment.until).or(range.segments.last())?;
    Some((segment.label, segment.tone))
}

pub fn bmi_state(value: f64) -> (&'static str, Tone) {
    let range = bmi_range();
    let segment = range.segments.iter().find(|segment| value < segment.until).unwrap_or(&range.segments[range.segments.len() - 1]);
    (segment.label, segment.tone)
}
