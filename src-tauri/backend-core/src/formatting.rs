use super::protocol::ChannelResponse;

const ALLOWED_TAGS: &[&str] = &["b", "i", "u", "s", "code", "pre", "a"];

/// Builds both channel representations from the canonical Markdown response.
/// Telegram output is generated from scratch so model-provided HTML is never
/// copied into the transport payload.
pub fn channel_response(markdown: impl Into<String>) -> ChannelResponse {
    let markdown = markdown.into();
    ChannelResponse {
        telegram_html: markdown_to_telegram_html(&markdown),
        markdown,
        data: serde_json::Value::Null,
    }
}

pub fn escape_telegram_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

/// Converts the supported Markdown subset to Telegram HTML. Unsupported
/// Markdown and all input HTML are emitted as escaped text.
pub fn markdown_to_telegram_html(markdown: &str) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut in_fence = false;

    for (index, line) in markdown.lines().enumerate() {
        if index > 0 {
            output.push('\n');
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if in_fence {
                output.push_str("</pre>");
            } else {
                output.push_str("<pre>");
            }
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            output.push_str(&escape_telegram_html(line));
            continue;
        }

        let (line, prefix) = list_prefix(line);
        if let Some(prefix) = prefix {
            output.push_str(prefix);
        }
        if let Some(heading) = line.strip_prefix("### ") {
            output.push_str("<b>");
            output.push_str(&render_inline(heading));
            output.push_str("</b>");
        } else if let Some(heading) = line.strip_prefix("## ") {
            output.push_str("<b>");
            output.push_str(&render_inline(heading));
            output.push_str("</b>");
        } else if let Some(heading) = line.strip_prefix("# ") {
            output.push_str("<b>");
            output.push_str(&render_inline(heading));
            output.push_str("</b>");
        } else {
            output.push_str(&render_inline(line));
        }
    }

    if in_fence {
        output.push_str("</pre>");
    }
    output
}

fn list_prefix(value: &str) -> (&str, Option<&'static str>) {
    if let Some(rest) = value
        .strip_prefix("- ")
        .or_else(|| value.strip_prefix("* "))
    {
        return (rest, Some("• "));
    }
    let digits = value.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && value.as_bytes().get(digits) == Some(&b'.') {
        let start = digits + 1;
        if value.as_bytes().get(start) == Some(&b' ') {
            return (&value[start + 1..], Some("• "));
        }
    }
    (value, None)
}

fn render_inline(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        let rest = &value[index..];
        if let Some(end) = rest.strip_prefix('`').and_then(|rest| rest.find('`')) {
            let content = &rest[1..end + 1];
            output.push_str("<code>");
            output.push_str(&escape_telegram_html(content));
            output.push_str("</code>");
            index += end + 2;
            continue;
        }

        if let Some((text, url, consumed)) = markdown_link(rest) {
            output.push_str("<a href=\"");
            output.push_str(&escape_attribute(url));
            output.push_str("\">");
            output.push_str(&render_inline(text));
            output.push_str("</a>");
            index += consumed;
            continue;
        }

        let marker = if rest.starts_with("**") {
            Some(("**", "<b>", "</b>"))
        } else if rest.starts_with("__") {
            Some(("__", "<b>", "</b>"))
        } else if rest.starts_with('*') {
            Some(("*", "<i>", "</i>"))
        } else if rest.starts_with('_') {
            Some(("_", "<i>", "</i>"))
        } else if rest.starts_with("~~") {
            Some(("~~", "<s>", "</s>"))
        } else {
            None
        };
        if let Some((marker, open, close)) = marker {
            if let Some(end) = rest[marker.len()..].find(marker) {
                output.push_str(open);
                output.push_str(&render_inline(&rest[marker.len()..marker.len() + end]));
                output.push_str(close);
                index += marker.len() * 2 + end;
                continue;
            }
        }

        let character = rest.chars().next().expect("index is on a character");
        output.push_str(&escape_telegram_html(&character.to_string()));
        index += character.len_utf8();
    }
    output
}

fn markdown_link(value: &str) -> Option<(&str, &str, usize)> {
    let text_end = value.strip_prefix('[')?.find(']')?;
    let text = &value[1..text_end + 1];
    let after_text = &value[text_end + 2..];
    let url_end = after_text.strip_prefix('(')?.find(')')?;
    let url = &after_text[1..url_end + 1];
    if !allowed_url(url) {
        return None;
    }
    Some((text, url, text_end + url_end + 4))
}

fn allowed_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && !value
            .chars()
            .any(|character| character.is_control() || matches!(character, '"' | '<' | '>'))
}

fn escape_attribute(value: &str) -> String {
    escape_telegram_html(value).replace('"', "&quot;")
}

#[allow(dead_code)]
pub fn allowed_telegram_tags() -> &'static [&'static str] {
    ALLOWED_TAGS
}

#[cfg(test)]
mod tests {
    use super::{channel_response, escape_telegram_html, markdown_to_telegram_html};

    #[test]
    fn escapes_input_html_and_special_characters() {
        assert_eq!(
            markdown_to_telegram_html("<script>alert('&')</script>"),
            "&lt;script&gt;alert('&amp;')&lt;/script&gt;"
        );
        assert_eq!(escape_telegram_html("<&>"), "&lt;&amp;&gt;");
    }

    #[test]
    fn renders_only_the_supported_markdown_subset() {
        assert_eq!(
            markdown_to_telegram_html("# **Título**\n- `código`\n[fuente](https://example.com)"),
            "<b><b>Título</b></b>\n• <code>código</code>\n<a href=\"https://example.com\">fuente</a>"
        );
        assert_eq!(
            markdown_to_telegram_html("[unsafe](javascript:alert(1))"),
            "[unsafe](javascript:alert(1))"
        );
    }

    #[test]
    fn returns_markdown_and_safe_telegram_variants() {
        let response = channel_response("**respuesta**".to_string());
        assert_eq!(response.markdown, "**respuesta**");
        assert_eq!(response.telegram_html, "<b>respuesta</b>");
    }
}
