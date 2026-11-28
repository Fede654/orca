import { Node } from '@tiptap/core'
import type { RichMarkdownEditorCodec } from '../document/rich-markdown-source-transport'
import { registerMarkdownTokenizerStart } from '../../markdown/source-scanning/markdown-tokenizer-start'
import {
  footnoteContext,
  installRichMarkdownFootnoteParser
} from './rich-markdown-footnote-context'
import { matchRichMarkdownFootnoteDefinition } from './rich-markdown-footnote-source'

const REFERENCE = 'richMarkdownFootnoteReference'
const DEFINITION = 'richMarkdownFootnoteDefinition'
const LABEL_PATTERN = /^[^\]\s[]+$/

function readLabel(element: HTMLElement) {
  const label = element.getAttribute('data-footnote-label')
  return label && LABEL_PATTERN.test(label) ? { label } : false
}

export function createRichMarkdownFootnoteExtensions(codec: RichMarkdownEditorCodec) {
  // Lists use nested lexers; definitions belong to the whole parse, not one lexer.
  const context = footnoteContext(codec)
  codec.marked.use({
    extensions: [
      {
        name: REFERENCE,
        level: 'inline',
        start: () => -1,
        tokenizer(source) {
          const match = /^\[\^([^\]\s[]+)\]/.exec(source)
          if (!match || !context.labels.has(match[1].toLowerCase())) {
            return undefined
          }
          return { type: REFERENCE, raw: match[0], label: match[1] }
        }
      },
      {
        name: DEFINITION,
        level: 'block',
        start: registerMarkdownTokenizerStart('[^', (source) =>
          source.search(/^ {0,3}\[\^[^\]\s[]+\]:/m)
        ),
        tokenizer(source) {
          const matched = matchRichMarkdownFootnoteDefinition(source)
          if (!matched) {
            return undefined
          }
          context.labels.add(matched.label.toLowerCase())
          return {
            type: DEFINITION,
            raw: matched.raw,
            label: matched.label,
            tokens: this.lexer.blockTokens(matched.body)
          }
        }
      }
    ]
  })
  return [
    Node.create({
      name: REFERENCE,
      priority: 50,
      onBeforeCreate() {
        installRichMarkdownFootnoteParser(this.editor.markdown!, codec)
      },
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      addAttributes: () => ({ label: { default: '', rendered: false } }),
      markdownTokenName: REFERENCE,
      parseMarkdown: (token, helpers) =>
        helpers.createNode(REFERENCE, { label: String(token.label ?? '') }),
      renderMarkdown: (node) => `[^${String(node.attrs?.label ?? '')}]`,
      renderText: ({ node }) => `[${String(node.attrs.label ?? '')}]`,
      parseHTML: () => [{ tag: 'sup[data-rich-markdown-footnote]', getAttrs: readLabel }],
      renderHTML: ({ node }) => [
        'sup',
        {
          'data-rich-markdown-footnote': '',
          'data-footnote-label': String(node.attrs.label ?? ''),
          contenteditable: 'false'
        },
        `[${String(node.attrs.label ?? '')}]`
      ]
    }),
    Node.create({
      name: DEFINITION,
      group: 'block',
      content: 'block+',
      defining: true,
      isolating: true,
      addAttributes: () => ({ label: { default: '', rendered: false } }),
      markdownTokenName: DEFINITION,
      parseMarkdown: (token, helpers) => {
        const content = helpers.parseChildren(token.tokens ?? [])
        return helpers.createNode(
          DEFINITION,
          { label: String(token.label ?? '') },
          content.length ? content : [helpers.createNode('paragraph')]
        )
      },
      renderMarkdown: (node, helpers) => {
        const body = helpers.renderChildren(node.content ?? [], '\n\n')
        return `[^${String(node.attrs?.label ?? '')}]: ${body.replace(/\n/g, '\n    ')}`
      },
      parseHTML: () => [
        {
          tag: 'div[data-rich-markdown-footnote-definition]',
          getAttrs: readLabel,
          contentElement: '[data-footnote-body]'
        }
      ],
      renderHTML: ({ node }) => [
        'div',
        {
          'data-rich-markdown-footnote-definition': '',
          'data-footnote-label': String(node.attrs.label ?? '')
        },
        ['span', { contenteditable: 'false' }, `[^${String(node.attrs.label ?? '')}]: `],
        ['div', { 'data-footnote-body': '' }, 0]
      ]
    })
  ]
}
