//! Fenced blocks of a note as its public page shows them, like the editor's
//! code blocks: Mermaid and XGraph become diagrams the page draws, LaTeX a
//! formula, and code a frame with its language, line numbers, wrapping and
//! copy. The page only colours the code and makes the buttons work.

use super::{escape_attribute, escape_text};

/// The editor refuses to draw a larger XGraph; the page does the same.
pub(crate) const XGRAPH_MAX_SOURCE_LENGTH: usize = 100_000;
/// Fences the editor shows as a formula.
const MATH_LANGUAGES: &[&str] = &["latex", "math", "tex"];
/// Fences the editor draws as an XGraph board.
const XGRAPH_LANGUAGES: &[&str] = &["xgraph", "jsxgraph"];

const NUMBERS_ICON: &str = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M6.5 4h7M6.5 8h7M6.5 12h7\"/><path d=\"M2.5 3.5h1v1.5M2.5 7.5h1.5l-1.5 1.5h1.5M2.5 11.5h1.5v2h-1.5\"/></svg>";
const WRAP_ICON: &str = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M2.5 4h11M2.5 8h9a2 2 0 010 4H8M9.5 10.5L8 12l1.5 1.5M2.5 12h3\"/></svg>";
const COPY_ICON: &str = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><rect x=\"5.5\" y=\"5.5\" width=\"8\" height=\"8\" rx=\"1.5\"/><path d=\"M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2\"/></svg>";
const TASK_DONE_ICON: &str = "<svg viewBox=\"0 0 18 18\" aria-hidden=\"true\"><rect class=\"ps-task-box\" x=\"0\" y=\"0\" width=\"18\" height=\"18\" rx=\"5\"/><path class=\"ps-task-mark\" d=\"M4.9 9.6l2.9 2.7 5.3-6.1\"/></svg>";
const TASK_OPEN_ICON: &str = "<svg viewBox=\"0 0 18 18\" aria-hidden=\"true\"><rect class=\"ps-task-box\" x=\"0.75\" y=\"0.75\" width=\"16.5\" height=\"16.5\" rx=\"4.25\"/></svg>";

/// How a code block starts out: the editor shows line numbers and does not
/// wrap; a GitBook `{% code %}` frame may say otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodeView {
    pub(crate) numbers: bool,
    pub(crate) wrap: bool,
}

impl Default for CodeView {
    fn default() -> Self {
        Self { numbers: true, wrap: false }
    }
}

/// The first word of a fence's info string.
pub(crate) fn fence_language(info: &str) -> &str {
    info.split_whitespace().next().unwrap_or_default()
}

fn is_one_of(language: &str, names: &[&str]) -> bool {
    names.iter().any(|name| language.eq_ignore_ascii_case(name))
}

/// The lines of the code, without the newline that ends the fence.
fn lines(text: &str) -> Vec<&str> {
    let text = text.strip_suffix('\n').unwrap_or(text);
    text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).collect()
}

fn toggle(action: &str, label: &str, title: &str, icon: &str, pressed: bool) -> String {
    format!(
        "<button type=\"button\" class=\"ps-code-button\" data-action=\"{action}\" aria-pressed=\"{pressed}\" title=\"{title}\">{icon}<span>{label}</span></button>"
    )
}

/// The HTML of a fenced block with `language` (its first word) and `text`.
pub(crate) fn code_block(language: &str, text: &str, view: CodeView) -> String {
    if language.eq_ignore_ascii_case("mermaid") {
        return format!("<pre class=\"ps-mermaid\">{}</pre>\n", escape_text(text));
    }
    if is_one_of(language, MATH_LANGUAGES) {
        return format!("<div class=\"ps-math ps-math-display\">{}</div>\n", escape_text(text.trim_end()));
    }
    if is_one_of(language, XGRAPH_LANGUAGES) {
        if text.len() > XGRAPH_MAX_SOURCE_LENGTH {
            return "<p class=\"ps-xgraph-error\" role=\"alert\">XGraph: el código supera el límite de 100.000 caracteres.</p>\n".to_string();
        }
        return format!(
            "<div class=\"ps-xgraph\"><pre class=\"ps-xgraph-source\" aria-label=\"Código del gráfico XGraph\">{}</pre></div>\n",
            escape_text(text)
        );
    }
    let mut html = format!("<div class=\"ps-code-block\" data-numbers=\"{}\" data-wrap=\"{}\"><div class=\"ps-code-head\">", view.numbers, view.wrap);
    if !language.is_empty() {
        html.push_str(&format!("<span class=\"ps-code-lang\">{}</span>", escape_text(&language.to_lowercase())));
    }
    html.push_str("<div class=\"ps-code-tools\">");
    html.push_str(&toggle("numbers", "Números", "Números de línea", NUMBERS_ICON, view.numbers));
    html.push_str(&toggle("wrap", "Ajustar", "Ajustar líneas", WRAP_ICON, view.wrap));
    html.push_str(&format!(
        "<button type=\"button\" class=\"ps-code-button\" data-action=\"copy\" title=\"Copiar el código\">{COPY_ICON}<span>Copiar</span></button>"
    ));
    html.push_str("</div></div>");
    let (label, class) = if language.is_empty() {
        (String::new(), String::new())
    } else {
        (format!(" data-lang=\"{}\"", escape_attribute(language)), format!(" class=\"language-{}\"", escape_attribute(language)))
    };
    html.push_str(&format!("<pre class=\"ps-code\"{label}><code{class}>"));
    for line in lines(text) {
        html.push_str(&format!("<span class=\"ps-line\">{}</span>", escape_text(line)));
    }
    html.push_str("</code></pre></div>\n");
    html
}

/// The box of a task list item, drawn like the editor's.
pub(crate) fn task_marker(checked: bool) -> String {
    let (icon, label) = if checked { (TASK_DONE_ICON, "Tarea hecha") } else { (TASK_OPEN_ICON, "Tarea pendiente") };
    format!("<span class=\"ps-task\" data-checked=\"{checked}\" role=\"img\" aria-label=\"{label}\">{icon}</span>")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_gets_the_editor_frame_with_one_span_per_line() {
        let html = code_block("C", "int main()\n{\n\n  return 0;\n}\n", CodeView::default());
        assert!(html.starts_with("<div class=\"ps-code-block\" data-numbers=\"true\" data-wrap=\"false\">"));
        assert!(html.contains("<span class=\"ps-code-lang\">c</span>"));
        assert!(html.contains("data-action=\"numbers\" aria-pressed=\"true\""));
        assert!(html.contains("data-action=\"wrap\" aria-pressed=\"false\""));
        assert!(html.contains("data-action=\"copy\""));
        assert!(html.contains("<pre class=\"ps-code\" data-lang=\"C\"><code class=\"language-C\">"));
        assert_eq!(html.matches("<span class=\"ps-line\">").count(), 5);
        assert!(html.contains("<span class=\"ps-line\"></span><span class=\"ps-line\">  return 0;</span>"));
    }

    #[test]
    fn code_without_language_has_no_chip_and_escapes_its_text() {
        let html = code_block("", "<b>&</b>\r\nfin", CodeView { numbers: false, wrap: true });
        assert!(html.contains("data-numbers=\"false\" data-wrap=\"true\""));
        assert!(!html.contains("ps-code-lang"));
        assert!(html.contains("<pre class=\"ps-code\"><code>"));
        assert!(html.contains("<span class=\"ps-line\">&lt;b&gt;&amp;&lt;/b&gt;</span><span class=\"ps-line\">fin</span>"));
    }

    #[test]
    fn diagrams_and_formulas_are_left_to_the_page() {
        assert_eq!(code_block("mermaid", "graph TD\n", CodeView::default()), "<pre class=\"ps-mermaid\">graph TD\n</pre>\n");
        assert_eq!(code_block("LaTeX", "x^2\n", CodeView::default()), "<div class=\"ps-math ps-math-display\">x^2</div>\n");
        assert_eq!(code_block("tex", "a<b", CodeView::default()), "<div class=\"ps-math ps-math-display\">a&lt;b</div>\n");
        let xgraph = code_block("jsxgraph", "board.create('point', [1, 2]);", CodeView::default());
        assert!(xgraph.contains("<div class=\"ps-xgraph\"><pre class=\"ps-xgraph-source\""));
        assert!(xgraph.contains("board.create(&#39;point&#39;, [1, 2]);") || xgraph.contains("board.create('point', [1, 2]);"));
        let too_big = code_block("xgraph", &"x".repeat(XGRAPH_MAX_SOURCE_LENGTH + 1), CodeView::default());
        assert!(too_big.contains("role=\"alert\"") && !too_big.contains("ps-xgraph-source"));
    }

    #[test]
    fn tasks_are_drawn_boxes_with_a_label() {
        assert!(task_marker(true).contains("data-checked=\"true\" role=\"img\" aria-label=\"Tarea hecha\""));
        assert!(task_marker(false).contains("aria-label=\"Tarea pendiente\""));
    }

    #[test]
    fn the_fence_language_is_its_first_word() {
        assert_eq!(fence_language("c title=\"main.c\""), "c");
        assert_eq!(fence_language(""), "");
    }
}
