const TABLE_STRUCTURE_NODE_NAMES = new Set([
  'table_header_row',
  'table_row',
  'table_header',
  'table_cell',
])

export function shouldShowMarkdownBlockHandle(
  nodeTypeName: string,
  hasExcludedAncestor: boolean,
  isInsideTable = false,
): boolean {
  return (isInsideTable || !hasExcludedAncestor) && !TABLE_STRUCTURE_NODE_NAMES.has(nodeTypeName)
}
