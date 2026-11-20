import type { JSONContent } from '@tiptap/core'
import type { RichMarkdownEditorCodec } from '../document/rich-markdown-source-transport'
import { collectRichMarkdownFootnoteLabels } from './rich-markdown-footnote-source'

const contexts = new WeakMap<RichMarkdownEditorCodec, { labels: Set<string> }>()
const installedParsers = new WeakSet<object>()

export function footnoteContext(codec: RichMarkdownEditorCodec) {
  let context = contexts.get(codec)
  if (!context) {
    context = { labels: new Set() }
    contexts.set(codec, context)
  }
  return context
}

export function installRichMarkdownFootnoteParser(
  parser: { parse: (source: string) => JSONContent },
  codec: RichMarkdownEditorCodec
) {
  if (installedParsers.has(parser)) {
    return
  }
  installedParsers.add(parser)
  const parse = parser.parse.bind(parser)
  const context = footnoteContext(codec)
  parser.parse = (source) => {
    const previous = context.labels
    context.labels = collectRichMarkdownFootnoteLabels(source)
    try {
      return parse(source)
    } finally {
      context.labels = previous
    }
  }
}

export function prepareRichMarkdownFootnoteDefinitions(
  codec: RichMarkdownEditorCodec,
  source: string
): void {
  footnoteContext(codec).labels = collectRichMarkdownFootnoteLabels(source)
}
