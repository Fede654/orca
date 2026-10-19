import { Table } from '@tiptap/extension-table'

const tokenizer = Table.config.markdownTokenizer
const renderTableMarkdown = Table.config.renderMarkdown

export const RichMarkdownTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    // The document serializer supplies separators; table margins create phantom paragraphs.
    return renderTableMarkdown?.call(this, node, helpers, context).trim() ?? ''
  },
  markdownTokenizer:
    tokenizer && typeof tokenizer !== 'function'
      ? {
          ...tokenizer,
          start(source) {
            const firstEnd = source.indexOf('\n')
            if (firstEnd === -1) {
              return -1
            }
            const secondEnd = source.indexOf('\n', firstEnd + 1)
            // Upstream tests only two lines, but splits the entire remaining document.
            const prefix = secondEnd === -1 ? source : source.slice(0, secondEnd)
            return typeof tokenizer.start === 'function' ? tokenizer.start(prefix) : -1
          }
        }
      : tokenizer
})
