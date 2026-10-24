import type { Nodes } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { stripMarkdownCode } from './markdown-rich-mode-code-strip'

const GFM_DEFINITION_CANDIDATE = /^\uFEFF?[ \t>*+\-\d.)]*\[\^/m
const SIMPLE_FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]+\]:/
const gfmDefinitionParser = unified().use(remarkParse).use(remarkGfm)

export function getGfmDefinitionReason(
  body: string
): 'reference-links' | 'footnotes' | 'footnotes-unsupported' | null {
  if (!GFM_DEFINITION_CANDIDATE.test(body)) {
    return null
  }
  if (body.length > 50_000) {
    const candidateLines = stripMarkdownCode(body)
      .split(/\r?\n/)
      .filter((line) => GFM_DEFINITION_CANDIDATE.test(line) && /\]:/.test(line))
    if (candidateLines.length === 0) {
      return null
    }
    return candidateLines.some((line) => !SIMPLE_FOOTNOTE_DEFINITION.test(line))
      ? 'footnotes-unsupported'
      : 'footnotes'
  }
  try {
    const tree = gfmDefinitionParser.parse(body)
    const contains = (node: Nodes, type: 'definition' | 'footnoteDefinition'): boolean =>
      node.type === type ||
      ('children' in node && node.children.some((child) => contains(child, type)))
    if (contains(tree, 'definition')) {
      return 'reference-links'
    }
    if (!contains(tree, 'footnoteDefinition')) {
      return null
    }
    const lines = body.split(/\r?\n/)
    const hasUnsupportedContext = (node: Nodes): boolean =>
      (node.type === 'footnoteDefinition' &&
        (node.position?.start.line === undefined ||
          !SIMPLE_FOOTNOTE_DEFINITION.test(lines[node.position.start.line - 1] ?? ''))) ||
      ('children' in node && node.children.some(hasUnsupportedContext))
    return hasUnsupportedContext(tree) ? 'footnotes-unsupported' : 'footnotes'
  } catch {
    return 'footnotes-unsupported'
  }
}
