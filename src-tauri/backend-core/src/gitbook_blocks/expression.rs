//! The expressions GitBook writes in `<code class="expression">` and in
//! `{% if %}`: a small, side-effect free subset of JavaScript over the page
//! and space variables. `visitor.*` data only exists for a published reader,
//! so an expression that reads it depends on who reads the page.

use super::Variables;

pub const MAX_EXPRESSION_CHARS: usize = 500;
/// Nesting beyond this is rejected so hostile input cannot exhaust the stack.
const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
}

impl Value {
    pub fn truthy(&self) -> bool {
        match self {
            Self::Undefined | Self::Null => false,
            Self::Bool(value) => *value,
            Self::Number(value) => *value != 0.0 && !value.is_nan(),
            Self::Text(value) => !value.is_empty(),
        }
    }

    /// The text JavaScript's `String()` gives.
    pub fn display(&self) -> String {
        match self {
            Self::Undefined => "undefined".to_string(),
            Self::Null => "null".to_string(),
            Self::Bool(value) => value.to_string(),
            Self::Number(value) => display_number(*value),
            Self::Text(value) => value.clone(),
        }
    }

    fn number(&self) -> f64 {
        match self {
            Self::Undefined => f64::NAN,
            Self::Null => 0.0,
            Self::Bool(value) => f64::from(u8::from(*value)),
            Self::Number(value) => *value,
            Self::Text(value) => {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    0.0
                } else {
                    trimmed.parse().unwrap_or(f64::NAN)
                }
            }
        }
    }
}

fn display_number(value: f64) -> String {
    if value.is_nan() {
        "NaN".to_string()
    } else if value.is_infinite() {
        if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
    } else if value.fract() == 0.0 && value.abs() < 1e21 {
        format!("{}", value as i128)
    } else {
        format!("{value}")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    pub value: Value,
    /// The expression reads `visitor.*`, which only a published reader has.
    pub depends_on_reader: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpressionError {
    Empty,
    TooLong,
    Invalid,
}

impl ExpressionError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "La expresión está vacía.",
            Self::TooLong => "La expresión es demasiado larga.",
            Self::Invalid => "La expresión no es válida.",
        }
    }
}

pub fn evaluate(expression: &str, variables: &Variables) -> Result<Evaluation, ExpressionError> {
    let expression = expression.trim();
    if expression.is_empty() {
        return Err(ExpressionError::Empty);
    }
    if expression.chars().count() > MAX_EXPRESSION_CHARS {
        return Err(ExpressionError::TooLong);
    }
    let tokens = tokenize(expression)?;
    let mut parser = Parser { tokens, index: 0, variables, depends_on_reader: false, depth: 0 };
    let value = parser.ternary()?;
    if parser.index != parser.tokens.len() {
        return Err(ExpressionError::Invalid);
    }
    let value = parser.resolve(value);
    Ok(Evaluation { value, depends_on_reader: parser.depends_on_reader })
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Text(String),
    Name(String),
    Punct(&'static str),
}

const PUNCTUATION: [&str; 25] = [
    "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "??", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(",
    ")", ".", "[", "]", ",",
];

fn tokenize(source: &str) -> Result<Vec<Token>, ExpressionError> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if ch.is_whitespace() {
            index += 1;
        } else if ch == '"' || ch == '\'' {
            let (text, next) = read_string(&chars, index)?;
            tokens.push(Token::Text(text));
            index = next;
        } else if ch.is_ascii_digit() {
            let start = index;
            while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
                index += 1;
            }
            let text: String = chars[start..index].iter().collect();
            tokens.push(Token::Number(text.parse().map_err(|_| ExpressionError::Invalid)?));
        } else if ch.is_alphabetic() || ch == '_' || ch == '$' {
            let start = index;
            while index < chars.len() && (chars[index].is_alphanumeric() || chars[index] == '_' || chars[index] == '$') {
                index += 1;
            }
            tokens.push(Token::Name(chars[start..index].iter().collect()));
        } else {
            let rest: String = chars[index..chars.len().min(index + 3)].iter().collect();
            let punct = PUNCTUATION.iter().find(|punct| rest.starts_with(**punct)).ok_or(ExpressionError::Invalid)?;
            tokens.push(Token::Punct(punct));
            index += punct.chars().count();
        }
    }
    Ok(tokens)
}

fn read_string(chars: &[char], start: usize) -> Result<(String, usize), ExpressionError> {
    let quote = chars[start];
    let mut text = String::new();
    let mut index = start + 1;
    while index < chars.len() {
        match chars[index] {
            '\\' => {
                let escaped = *chars.get(index + 1).ok_or(ExpressionError::Invalid)?;
                text.push(match escaped {
                    'n' => '\n',
                    't' => '\t',
                    other => other,
                });
                index += 2;
            }
            ch if ch == quote => return Ok((text, index + 1)),
            ch => {
                text.push(ch);
                index += 1;
            }
        }
    }
    Err(ExpressionError::Invalid)
}

/// A value, or a path such as `page.vars` still being read.
#[derive(Debug, Clone, PartialEq)]
enum Operand {
    Value(Value),
    Path(Vec<String>),
}

struct Parser<'a> {
    tokens: Vec<Token>,
    index: usize,
    variables: &'a Variables,
    depends_on_reader: bool,
    depth: usize,
}

impl Parser<'_> {
    fn peek_punct(&self) -> Option<&'static str> {
        match self.tokens.get(self.index) {
            Some(Token::Punct(punct)) => Some(punct),
            _ => None,
        }
    }

    fn eat(&mut self, punct: &str) -> bool {
        if self.peek_punct() == Some(punct) {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, punct: &str) -> Result<(), ExpressionError> {
        if self.eat(punct) {
            Ok(())
        } else {
            Err(ExpressionError::Invalid)
        }
    }

    fn resolve(&mut self, operand: Operand) -> Value {
        let path = match operand {
            Operand::Value(value) => return value,
            Operand::Path(path) => path,
        };
        let names: Vec<&str> = path.iter().map(String::as_str).collect();
        match names.as_slice() {
            ["visitor", ..] => {
                self.depends_on_reader = true;
                Value::Undefined
            }
            ["page", "vars", name] => self.variables.page.get(*name).cloned().map_or(Value::Undefined, Value::Text),
            ["space", "vars", name] => self.variables.space.get(*name).cloned().map_or(Value::Undefined, Value::Text),
            _ => Value::Undefined,
        }
    }

    fn value(&mut self, parse: fn(&mut Self) -> Result<Operand, ExpressionError>) -> Result<Value, ExpressionError> {
        let operand = parse(self)?;
        Ok(self.resolve(operand))
    }

    fn ternary(&mut self) -> Result<Operand, ExpressionError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(ExpressionError::Invalid);
        }
        let condition = self.logical_or()?;
        let result = if self.eat("?") {
            let condition = self.resolve(condition);
            let when_true = self.value(Self::ternary)?;
            self.expect(":")?;
            let when_false = self.value(Self::ternary)?;
            Operand::Value(if condition.truthy() { when_true } else { when_false })
        } else {
            condition
        };
        self.depth -= 1;
        Ok(result)
    }

    fn logical_or(&mut self) -> Result<Operand, ExpressionError> {
        let mut left = self.logical_and()?;
        loop {
            let punct = match self.peek_punct() {
                Some(punct @ ("||" | "??")) => punct,
                _ => return Ok(left),
            };
            self.index += 1;
            let left_value = self.resolve(left);
            let right = self.value(Self::logical_and)?;
            let keep_left = if punct == "||" {
                left_value.truthy()
            } else {
                !matches!(left_value, Value::Undefined | Value::Null)
            };
            left = Operand::Value(if keep_left { left_value } else { right });
        }
    }

    fn logical_and(&mut self) -> Result<Operand, ExpressionError> {
        let mut left = self.equality()?;
        while self.eat("&&") {
            let left_value = self.resolve(left);
            let right = self.value(Self::equality)?;
            left = Operand::Value(if left_value.truthy() { right } else { left_value });
        }
        Ok(left)
    }

    fn equality(&mut self) -> Result<Operand, ExpressionError> {
        let mut left = self.relational()?;
        loop {
            let punct = match self.peek_punct() {
                Some(punct @ ("===" | "!==" | "==" | "!=")) => punct,
                _ => return Ok(left),
            };
            self.index += 1;
            let left_value = self.resolve(left);
            let right = self.value(Self::relational)?;
            let equal = if punct.len() == 3 { strict_equal(&left_value, &right) } else { loose_equal(&left_value, &right) };
            left = Operand::Value(Value::Bool(if punct.starts_with('!') { !equal } else { equal }));
        }
    }

    fn relational(&mut self) -> Result<Operand, ExpressionError> {
        let mut left = self.additive()?;
        loop {
            let punct = match self.peek_punct() {
                Some(punct @ ("<" | ">" | "<=" | ">=")) => punct,
                _ => return Ok(left),
            };
            self.index += 1;
            let left_value = self.resolve(left);
            let right = self.value(Self::additive)?;
            let ordering = match (&left_value, &right) {
                (Value::Text(a), Value::Text(b)) => Some(a.cmp(b)),
                _ => left_value.number().partial_cmp(&right.number()),
            };
            let result = ordering.is_some_and(|ordering| match punct {
                "<" => ordering.is_lt(),
                ">" => ordering.is_gt(),
                "<=" => ordering.is_le(),
                _ => ordering.is_ge(),
            });
            left = Operand::Value(Value::Bool(result));
        }
    }

    fn additive(&mut self) -> Result<Operand, ExpressionError> {
        let mut left = self.multiplicative()?;
        loop {
            let punct = match self.peek_punct() {
                Some(punct @ ("+" | "-")) => punct,
                _ => return Ok(left),
            };
            self.index += 1;
            let left_value = self.resolve(left);
            let right = self.value(Self::multiplicative)?;
            left = Operand::Value(match (punct, &left_value, &right) {
                ("+", Value::Text(_), _) | ("+", _, Value::Text(_)) => {
                    Value::Text(format!("{}{}", left_value.display(), right.display()))
                }
                ("+", _, _) => Value::Number(left_value.number() + right.number()),
                _ => Value::Number(left_value.number() - right.number()),
            });
        }
    }

    fn multiplicative(&mut self) -> Result<Operand, ExpressionError> {
        let mut left = self.unary()?;
        loop {
            let punct = match self.peek_punct() {
                Some(punct @ ("*" | "/" | "%")) => punct,
                _ => return Ok(left),
            };
            self.index += 1;
            let a = self.resolve(left).number();
            let b = self.value(Self::unary)?.number();
            left = Operand::Value(Value::Number(match punct {
                "*" => a * b,
                "/" => a / b,
                _ => a % b,
            }));
        }
    }

    fn unary(&mut self) -> Result<Operand, ExpressionError> {
        let punct = match self.peek_punct() {
            Some(punct @ ("!" | "-" | "+")) => punct,
            _ => return self.postfix(),
        };
        self.index += 1;
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(ExpressionError::Invalid);
        }
        let value = self.value(Self::unary)?;
        self.depth -= 1;
        Ok(Operand::Value(match punct {
            "!" => Value::Bool(!value.truthy()),
            "-" => Value::Number(-value.number()),
            _ => Value::Number(value.number()),
        }))
    }

    fn postfix(&mut self) -> Result<Operand, ExpressionError> {
        let mut operand = self.primary()?;
        loop {
            let key = if self.eat(".") {
                match self.tokens.get(self.index) {
                    Some(Token::Name(name)) => {
                        let name = name.clone();
                        self.index += 1;
                        name
                    }
                    _ => return Err(ExpressionError::Invalid),
                }
            } else if self.eat("[") {
                let key = self.value(Self::ternary)?.display();
                self.expect("]")?;
                key
            } else {
                return Ok(operand);
            };
            operand = match operand {
                Operand::Path(mut path) => {
                    path.push(key);
                    let is_variable = path.len() == 3 && matches!(path[0].as_str(), "page" | "space") && path[1] == "vars";
                    if is_variable {
                        Operand::Value(self.resolve(Operand::Path(path)))
                    } else {
                        Operand::Path(path)
                    }
                }
                Operand::Value(Value::Text(text)) if key == "length" => {
                    Operand::Value(Value::Number(text.chars().count() as f64))
                }
                Operand::Value(_) => Operand::Value(Value::Undefined),
            };
        }
    }

    fn primary(&mut self) -> Result<Operand, ExpressionError> {
        let token = self.tokens.get(self.index).cloned().ok_or(ExpressionError::Invalid)?;
        self.index += 1;
        Ok(match token {
            Token::Number(value) => Operand::Value(Value::Number(value)),
            Token::Text(value) => Operand::Value(Value::Text(value)),
            Token::Name(name) => match name.as_str() {
                "true" => Operand::Value(Value::Bool(true)),
                "false" => Operand::Value(Value::Bool(false)),
                "null" => Operand::Value(Value::Null),
                "undefined" => Operand::Value(Value::Undefined),
                _ => Operand::Path(vec![name]),
            },
            Token::Punct("(") => {
                let inner = self.value(Self::ternary)?;
                self.expect(")")?;
                Operand::Value(inner)
            }
            Token::Punct(_) => return Err(ExpressionError::Invalid),
        })
    }
}

fn strict_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a == b,
        _ => left == right,
    }
}

fn loose_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Undefined | Value::Null, Value::Undefined | Value::Null) => true,
        (Value::Undefined | Value::Null, _) | (_, Value::Undefined | Value::Null) => false,
        (Value::Text(a), Value::Text(b)) => a == b,
        _ => left.number() == right.number(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn variables() -> Variables {
        let mut variables = Variables::default();
        variables.page.insert("food".to_string(), "orange".to_string());
        variables.space.insert("latest_version".to_string(), "v3.0.4".to_string());
        variables
    }

    fn show(expression: &str) -> String {
        evaluate(expression, &variables()).expect("valid").value.display()
    }

    #[test]
    fn reads_variables_and_the_javascript_gitbook_documents() {
        assert_eq!(show("space.vars.latest_version"), "v3.0.4");
        assert_eq!(show("\"My favorite food is \" + page.vars.food"), "My favorite food is orange");
        assert_eq!(show("space.vars.latest_version === \"v3.0.4\" ? \"Latest\" : \"Outdated\""), "Latest");
        assert_eq!(show("1 + 1"), "2");
        assert_eq!(show("7 / 2"), "3.5");
        assert_eq!(show("page.vars['food'].length"), "6");
        assert_eq!(show("page.vars.missing ?? 'nada'"), "nada");
        assert_eq!(show("!page.vars.missing && (2 > 1)"), "true");
    }

    #[test]
    fn marks_what_depends_on_the_reader() {
        let evaluation = evaluate("!visitor.claims.unsigned.example_attribute_A", &variables()).expect("valid");
        assert!(evaluation.depends_on_reader);
        assert!(!evaluate("page.vars.food", &variables()).expect("valid").depends_on_reader);
    }

    #[test]
    fn rejects_invalid_and_hostile_input() {
        assert_eq!(evaluate("", &variables()), Err(ExpressionError::Empty));
        assert_eq!(evaluate("1 +", &variables()), Err(ExpressionError::Invalid));
        assert_eq!(evaluate("'abierta", &variables()), Err(ExpressionError::Invalid));
        assert_eq!(evaluate("a = 1", &variables()), Err(ExpressionError::Invalid));
        assert_eq!(evaluate(&"x".repeat(MAX_EXPRESSION_CHARS + 1), &variables()), Err(ExpressionError::TooLong));
        assert_eq!(evaluate(&format!("{}1{}", "(".repeat(200), ")".repeat(200)), &variables()), Err(ExpressionError::Invalid));
        assert_eq!(evaluate(&"!".repeat(400), &variables()), Err(ExpressionError::Invalid));
    }
}
