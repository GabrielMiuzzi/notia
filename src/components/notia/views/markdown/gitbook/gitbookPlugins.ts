import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { createAnnotationsPlugin } from './gitbookAnnotations'
import {
  ButtonView,
  CardsView,
  ContentRefView,
  DrawingView,
  EmbedView,
  ExpressionView,
  FileView,
  IconView,
  IncludeView,
  InlineImageView,
} from './gitbookAtomViews'
import {
  CodeFrameView,
  ConditionView,
  DetailsView,
  GitbookPartView,
  HintView,
  PartsView,
  PromptView,
  TabsView,
  type GetPos,
} from './gitbookBlockViews'
import { GITBOOK_NODE_SPECS, GITBOOK_SCHEMA_NAMES as N, gitbookNodeSchemas, gitbookSchemaPlugins } from './gitbookSchema'
import type { GitbookViewEnvironment } from './gitbookViewEnvironment'

type ViewFactory = (node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) => NodeView

const VIEWS: Record<string, ViewFactory> = {
  [N.hint]: (...args) => new HintView(...args),
  [N.tabs]: (...args) => new TabsView(...args),
  [N.tab]: (node, view, getPos) => new GitbookPartView(node, view, getPos),
  [N.stepper]: (node, view, getPos, env) => new PartsView(node, view, getPos, env, 'stepper'),
  [N.step]: (node, view, getPos) => new GitbookPartView(node, view, getPos),
  [N.columns]: (node, view, getPos, env) => new PartsView(node, view, getPos, env, 'columns'),
  [N.column]: (node, view, getPos) => new GitbookPartView(node, view, getPos),
  [N.updates]: (node, view, getPos, env) => new PartsView(node, view, getPos, env, 'updates'),
  [N.update]: (node, view, getPos) => new GitbookPartView(node, view, getPos),
  [N.code]: (...args) => new CodeFrameView(...args),
  [N.prompt]: (...args) => new PromptView(...args),
  [N.condition]: (...args) => new ConditionView(...args),
  [N.details]: (...args) => new DetailsView(...args),
  [N.embed]: (...args) => new EmbedView(...args),
  [N.file]: (...args) => new FileView(...args),
  [N.contentRef]: (...args) => new ContentRefView(...args),
  [N.include]: (...args) => new IncludeView(...args),
  [N.cards]: (...args) => new CardsView(...args),
  [N.drawing]: (...args) => new DrawingView(...args),
  [N.button]: (...args) => new ButtonView(...args),
  [N.icon]: (...args) => new IconView(...args),
  [N.expression]: (...args) => new ExpressionView(...args),
  [N.inlineImage]: (...args) => new InlineImageView(...args),
}

/** Parts that only move with their block: no block handle of their own. */
export const GITBOOK_PART_NODE_NAMES = new Set<string>([N.tab, N.step, N.column, N.update])

/** Everything the editor needs for the GitBook blocks, drawn with `env`. */
export function createGitbookPlugins(env: GitbookViewEnvironment): MilkdownPlugin[] {
  const views = GITBOOK_NODE_SPECS.map((spec, index) => {
    const schema = gitbookNodeSchemas[index]
    const factory = VIEWS[spec.name]
    if (!schema || !factory) throw new Error(`GitBook block without a view: ${spec.name}`)
    return $view(schema.node, () => (node, view, getPos) => factory(node, view, getPos as GetPos, env))
  })
  return [...gitbookSchemaPlugins, ...views, $prose(() => createAnnotationsPlugin())].flat()
}
