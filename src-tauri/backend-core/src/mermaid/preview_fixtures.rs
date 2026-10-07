//! The diagrams of the design canvas, with their models, for the visual
//! preview of the editor (`NOTIA_MERMAID_FIXTURES` = output file).

use super::read_model;

pub const SAMPLES: [(&str, &str); 5] = [
    (
        "flowchart",
        "flowchart TD\n  a@{ shape: rect, label: \"Pedido\" }\n  b@{ shape: diam, label: \"¿Hay stock?\" }\n  c@{ shape: rect, label: \"Preparar\" }\n  d@{ shape: rounded, label: \"Avisar\" }\n  e@{ shape: stadium, label: \"Fin\" }\n  a --> b\n  b -.->|sí| c\n  b -->|no| d\n  d ==> e\n  style b stroke:#4FD1C5\n",
    ),
    (
        "sequence",
        "sequenceDiagram\n  autonumber\n  actor U as Usuario\n  participant M as Munin\n  participant B as Backend\n  participant C as ColdPass\n  U->>+M: Abrir bóveda\n  M->>B: Solicitar desafío\n  B-->>M: nonce\n  loop Hasta conectar\n    M-)C: Escanear BLE\n  end\n  C-->>M: Firma(nonce)\n  M->>B: Verificar firma\n  alt firma válida\n    B-->>M: Token de sesión\n  else firma inválida\n    M--x-U: Rechazado\n  end\n",
    ),
    (
        "state",
        "stateDiagram-v2\n  state \"Próximo Q\" as ProximoQ\n  state \"A refinar\" as ARefinar\n  state \"Sprint actual\" as SprintActual\n  state \"En revisión\" as EnRevision\n  [*] --> Anotador\n  Anotador --> ProximoQ : priorizar\n  ProximoQ --> ARefinar : planificar\n  ARefinar --> SprintActual : estimar\n  SprintActual --> EnRevision : abrir PR\n  EnRevision --> SprintActual : cambios pedidos\n  SprintActual --> Bloqueado : bloquear\n  Bloqueado --> SprintActual : desbloquear\n  EnRevision --> Hecho : aprobar\n  Hecho --> [*]\n  classDef c_sprintactual stroke:#4FD1C5\n  class SprintActual c_sprintactual\n  classDef c_bloqueado stroke:#FF6B6B\n  class Bloqueado c_bloqueado\n",
    ),
    (
        "class",
        "classDiagram\n  direction TB\n  class Sincronizable {\n    <<interface>>\n    +sincronizar() Resultado\n  }\n  class Carpeta {\n    +String nombre\n    +listar() List~Nota~\n  }\n  class Nota {\n    +String id\n    +String titulo\n    -DateTime creada\n    +guardar() void\n  }\n  class Prioridad {\n    <<enumeration>>\n    URGENTE\n    ALTA\n  }\n  Carpeta \"1\" *-- \"0..*\" Nota : contiene\n  Sincronizable <|.. Nota\n  Nota --> Prioridad : prioridad\n",
    ),
    (
        "er",
        "erDiagram\n  USUARIO ||--o{ CUENTA : tiene\n  CUENTA ||--o{ MOVIMIENTO : registra\n  CATEGORIA |o..o{ MOVIMIENTO : clasifica\n  USUARIO {\n    uuid id PK\n    string nombre\n    string email UK\n  }\n  CUENTA {\n    uuid id PK\n    uuid usuario_id FK\n    string moneda\n  }\n  CATEGORIA {\n    uuid id PK\n    string nombre\n  }\n  MOVIMIENTO {\n    uuid id PK\n    uuid cuenta_id FK\n    decimal monto\n  }\n",
    ),
];

#[test]
#[ignore]
fn dump_preview_fixtures() {
    let path = std::env::var("NOTIA_MERMAID_FIXTURES").expect("NOTIA_MERMAID_FIXTURES");
    let fixtures = SAMPLES
        .iter()
        .map(|(name, source)| serde_json::json!({ "name": name, "source": source, "model": read_model(source).expect("model") }))
        .collect::<Vec<_>>();
    std::fs::write(path, serde_json::to_string_pretty(&fixtures).expect("json")).expect("write");
}
