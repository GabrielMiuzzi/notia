import { TableNodeView } from '@milkdown/kit/component/table-block'
import { tableSchema } from '@milkdown/preset-gfm'
import { $view } from '@milkdown/utils'

class MarkdownTableNodeView extends TableNodeView {
  override stopEvent(event: Event): boolean {
    // The stock table view stops every drag/drop event. That protects table
    // operations, but also prevents Milkdown's block handle from dropping a
    // selected block into another cell.
    if ((event.type === 'drop' || event.type.startsWith('drag')) && this.view.dragging?.move) {
      return false
    }

    return super.stopEvent(event)
  }
}

export const markdownTableBlockView = $view(
  tableSchema.node,
  (ctx) => (node, view, getPos) => new MarkdownTableNodeView(ctx, node, view, getPos),
)
