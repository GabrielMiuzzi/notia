/** Contracts of the Mermaid editor commands (`backend_core::mermaid`). */

export type DiagramKind = 'flowchart' | 'sequence' | 'state' | 'class' | 'er'

export type LineStyle = 'solid' | 'dotted' | 'thick' | 'invisible'
export type EdgeCap = 'arrow' | 'none' | 'circle' | 'cross' | 'both'
export type FillMode = 'surface' | 'tint' | 'none'
export type TextSize = 'S' | 'M' | 'L'

export interface FlowNode {
  id: string
  label: string
  shape: string
  icon?: string
  border?: string
  fill: FillMode
  textSize: TextSize
  lines: number[]
}

export interface FlowEdge {
  index: number
  from: string
  to: string
  label: string
  lineStyle: LineStyle
  cap: EdgeCap
  op: string
  line: number
}

export interface FlowchartModel {
  kind: 'flowchart'
  keyword: string
  direction: string
  headerLine: number
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export type ParticipantKind = 'participant' | 'actor'
export type MessageLine = 'solid' | 'dotted'
export type MessageTip = 'arrow' | 'none' | 'async' | 'cross' | 'both'
export type Activation = 'none' | 'activateTarget' | 'deactivateSource'

export interface Participant {
  alias: string
  label: string
  kind: ParticipantKind
  line?: number
  sends: number
  receives: number
}

export interface Message {
  index: number
  from: string
  to: string
  text: string
  lineStyle: MessageLine
  tip: MessageTip
  activation: Activation
  op: string
  line: number
  block?: { keyword: string; label: string }
}

export interface SequenceModel {
  kind: 'sequence'
  headerLine: number
  autonumber: boolean
  participants: Participant[]
  messages: Message[]
  blocks: Array<{ keyword: string; label: string; startLine: number; endLine: number }>
  notes: Array<{ position: string; over: string[]; text: string; line: number }>
}

export type StateKind = 'normal' | 'choice' | 'fork' | 'join'

export interface StateNode {
  id: string
  label: string
  kind: StateKind
  color?: string
  parent?: string
  lines: number[]
}

export interface Transition {
  index: number
  from: string
  to: string
  event: string
  line: number
}

export interface StateModel {
  kind: 'state'
  headerLine: number
  direction: string
  states: StateNode[]
  transitions: Transition[]
}

export type Stereotype = 'none' | 'interface' | 'abstract' | 'enumeration'
export type RelationKind = 'inheritance' | 'realization' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'link' | 'dashedLink'

export interface ClassMember {
  visibility: string
  typeName: string
  name: string
  args?: string
  line: number
}

export interface ClassNode {
  name: string
  stereotype: Stereotype
  attributes: ClassMember[]
  methods: ClassMember[]
  lines: number[]
}

export interface ClassRelation {
  index: number
  a: string
  b: string
  kind: RelationKind
  multA: string
  multB: string
  label: string
  op: string
  line: number
}

export interface ClassModel {
  kind: 'class'
  headerLine: number
  direction: string
  classes: ClassNode[]
  relations: ClassRelation[]
}

export type Cardinality = 'one' | 'zeroOne' | 'many1' | 'many0'
export type ErKey = 'PK' | 'FK' | 'UK'

export interface ErAttribute {
  typeName: string
  name: string
  key?: ErKey
  comment: string
  line: number
}

export interface ErEntity {
  name: string
  attributes: ErAttribute[]
  lines: number[]
}

export interface ErRelation {
  index: number
  a: string
  b: string
  cardA: Cardinality
  cardB: Cardinality
  identifying: boolean
  verb: string
  op: string
  line: number
}

export interface ErModel {
  kind: 'er'
  headerLine: number
  entities: ErEntity[]
  relations: ErRelation[]
}

export type MermaidModel =
  | { kind: 'empty' }
  | { kind: 'other'; keyword: string }
  | FlowchartModel
  | SequenceModel
  | StateModel
  | ClassModel
  | ErModel

/** What is selected on the canvas, by the key the backend uses. */
export interface DiagramSelection {
  kind: 'node' | 'edge' | 'participant' | 'message' | 'state' | 'transition' | 'class' | 'relation' | 'entity'
  key: string
}

/** An edit the backend applies: `{ diagram, op, ...fields }`. */
export type MermaidEdit =
  | { diagram: 'start'; kind: DiagramKind }
  | ({ diagram: 'flowchart'; op: string } & Record<string, unknown>)
  | ({ diagram: 'sequence'; op: string } & Record<string, unknown>)
  | ({ diagram: 'state'; op: string } & Record<string, unknown>)
  | ({ diagram: 'class'; op: string } & Record<string, unknown>)
  | ({ diagram: 'er'; op: string } & Record<string, unknown>)

export interface MermaidEditResult {
  source: string
  model: MermaidModel
  selection?: DiagramSelection
}
