import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/*
 * Syntax colors of the code blocks, as in the design canvas: keywords
 * violet, strings sage, functions periwinkle, numbers amber, types and keys
 * teal, comments slate. They are theme tokens, so both themes get them.
 */
export const codeHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier], color: 'var(--color-violet)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: 'var(--color-sage)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: 'var(--color-periwinkle)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--color-amber)' },
  { tag: [tags.typeName, tags.className, tags.propertyName, tags.attributeName, tags.tagName, tags.labelName], color: 'var(--color-accent-text)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--color-slate)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator], color: 'var(--color-muted-text)' },
  { tag: tags.invalid, color: 'var(--color-coral)' },
]))
