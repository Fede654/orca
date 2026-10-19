// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { encodeRawMarkdownHtmlForRichEditor } from '../raw-source/raw-markdown-html'
import { createRichMarkdownExtensions } from '../schema/rich-markdown-extensions'
import { createRichMarkdownEditorCodec } from '../document/rich-markdown-source-transport'
import { getMarkdownRichModeUnsupportedReason } from '../../markdown/render-mode/markdown-rich-mode'
import { getRichMarkdownSerializationDocument } from '../schema/rich-markdown-trailing-paragraph'
import { commitRichMarkdownSerialization } from '../document/rich-markdown-serialization-commit'

function createEditor(source: string) {
  const codec = createRichMarkdownEditorCodec()
  return new Editor({
    element: document.createElement('div'),
    extensions: createRichMarkdownExtensions({ codec }),
    content: encodeRawMarkdownHtmlForRichEditor(source, codec),
    contentType: 'markdown'
  })
}

function roundTrip(source: string) {
  const editor = createEditor(source)
  try {
    return editor.getMarkdown()
  } finally {
    editor.destroy()
  }
}

function labels(editor: Editor, kind: string) {
  const result: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === kind) {
      result.push(String(node.attrs.label))
    }
  })
  return result
}

describe('editable Markdown footnotes', () => {
  it.each([
    'A note.',
    'Word',
    'https://example.com',
    '',
    '**Bold** and [source](https://example.com).'
  ])('preserves a definition containing %j instead of treating it as a link definition', (body) => {
    const source = `Price[^fx-1]. Again[^fx-1].\n\n[^fx-1]: ${body}\n`
    const editor = createEditor(source)
    try {
      editor.state.doc.check()
      expect(labels(editor, 'richMarkdownFootnoteReference')).toEqual(['fx-1', 'fx-1'])
      expect(labels(editor, 'richMarkdownFootnoteDefinition')).toEqual(['fx-1'])
      expect(editor.getMarkdown()).toContain('[^fx-1]:')
      expect(editor.view.dom.querySelectorAll('sup[data-rich-markdown-footnote]')).toHaveLength(2)
      expect(editor.view.dom.querySelector('[data-footnote-body]')?.textContent).toBe(
        body.replace(/\*\*/g, '').replace('[source](https://example.com)', 'source')
      )
      expect(getMarkdownRichModeUnsupportedReason(source)).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('preserves adjacent definitions, unused notes, formatting and multiline blocks on reopen', () => {
    const source =
      'Text[^a].\n\n[^a]: First **paragraph**.\n\n    Second paragraph with `code`.\n\n    - One\n    - Two\n\n[^unused]: Never referenced.\n'
    const first = createEditor(source)
    try {
      const saved = first.getMarkdown()
      const reopened = createEditor(saved)
      try {
        expect(getRichMarkdownSerializationDocument(reopened).toJSON()).toEqual(
          getRichMarkdownSerializationDocument(first).toJSON()
        )
        expect(labels(reopened, 'richMarkdownFootnoteDefinition')).toEqual(['a', 'unused'])
        expect(reopened.state.doc.textContent).toContain('Second paragraph')
        expect(reopened.state.doc.textContent).toContain('OneTwo')
      } finally {
        reopened.destroy()
      }
    } finally {
      first.destroy()
    }
  })

  it.each(['\n', '\r\n'])('edits note text, saves and reopens with %j endings', (eol) => {
    const source = ['# Prices', '', 'Price[^fx-1].', '', '[^fx-1]: Original amount.', ''].join(eol)
    const editor = createEditor(source)
    const refs = {
      originalSourceRef: { current: source },
      baseCanonicalRef: { current: editor.getMarkdown() },
      lastCommittedMarkdownRef: { current: source }
    }
    try {
      let notePosition = -1
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Original amount.') {
          notePosition = pos
        }
      })
      expect(notePosition).toBeGreaterThan(0)
      editor.view.dispatch(editor.state.tr.insertText('Verified ', notePosition))
      const { markdown } = commitRichMarkdownSerialization(editor, refs, roundTrip)
      expect(markdown).toBe(source.replace('Original amount.', 'Verified Original amount.'))
      const reopened = createEditor(markdown)
      try {
        expect(getRichMarkdownSerializationDocument(reopened).toJSON()).toEqual(
          getRichMarkdownSerializationDocument(editor).toJSON()
        )
        expect(labels(reopened, 'richMarkdownFootnoteReference')).toEqual(['fx-1'])
      } finally {
        reopened.destroy()
      }
      expect(editor.commands.undo()).toBe(true)
      expect(commitRichMarkdownSerialization(editor, refs, roundTrip).markdown).toBe(source)
    } finally {
      editor.destroy()
    }
  })

  it('keeps escaped references and code examples literal', () => {
    const source = 'Escaped \\[^a] and `[^a]`.\n\n```md\n[^a]: Example\n```\n'
    const editor = createEditor(source)
    try {
      expect(labels(editor, 'richMarkdownFootnoteReference')).toEqual([])
      expect(labels(editor, 'richMarkdownFootnoteDefinition')).toEqual([])
      expect(roundTrip(editor.getMarkdown())).toBe(editor.getMarkdown())
    } finally {
      editor.destroy()
    }
  })

  it('preserves references in tables, links in notes, and indented definitions', () => {
    const source =
      '| Price |\n| --- |\n| USD 10[^fx-1] |\n\n   [^fx-1]: [Source](https://example.com) and **rate**.\n'
    const editor = createEditor(source)
    try {
      expect(labels(editor, 'richMarkdownFootnoteReference')).toEqual(['fx-1'])
      expect(labels(editor, 'richMarkdownFootnoteDefinition')).toEqual(['fx-1'])
      expect(getMarkdownRichModeUnsupportedReason(source)).toBeNull()
      const reopened = createEditor(editor.getMarkdown())
      try {
        expect(getRichMarkdownSerializationDocument(reopened).toJSON()).toEqual(
          getRichMarkdownSerializationDocument(editor).toJSON()
        )
      } finally {
        reopened.destroy()
      }
    } finally {
      editor.destroy()
    }
  })

  it('preserves footnote identities when copying HTML between editors', () => {
    const source = 'Price[^fx].\n\n[^fx]: Original **amount**.\n'
    const first = createEditor(source)
    const second = createEditor('')
    try {
      second.commands.setContent(first.getHTML(), { contentType: 'html' })
      expect(getRichMarkdownSerializationDocument(second).toJSON()).toEqual(
        getRichMarkdownSerializationDocument(first).toJSON()
      )
      expect(second.getMarkdown()).toBe(first.getMarkdown())
    } finally {
      first.destroy()
      second.destroy()
    }
  })

  it('keeps unsupported labels protected rather than discarding definitions', () => {
    expect(getMarkdownRichModeUnsupportedReason('Text[^a b].\n\n[^a b]: Note.')).toBe('footnotes')
  })

  it('shares definitions with list and quote lexers without leaking them into later parses', () => {
    const source = '1. Price[^a].\n2. Again[^a].\n\n> Quoted[^a].\n\n[^a]: The source.\n'
    const editor = createEditor(source)
    try {
      expect(labels(editor, 'richMarkdownFootnoteReference')).toEqual(['a', 'a', 'a'])
      expect(getMarkdownRichModeUnsupportedReason(source)).toBeNull()
      editor.commands.setContent('Unresolved[^a].', { contentType: 'markdown' })
      expect(labels(editor, 'richMarkdownFootnoteReference')).toEqual([])
      expect(editor.state.doc.textContent).toBe('Unresolved[^a].')
    } finally {
      editor.destroy()
    }
  })

  it('keeps consecutive tables separate without adding empty paragraphs on reopen', () => {
    const source = '| A |\n| --- |\n| Price[^a] |\n\n| B |\n| --- |\n| Rate |\n\n[^a]: Source.\n'
    const editor = createEditor(source)
    try {
      const reopened = createEditor(editor.getMarkdown())
      try {
        expect(getRichMarkdownSerializationDocument(reopened).toJSON()).toEqual(
          getRichMarkdownSerializationDocument(editor).toJSON()
        )
      } finally {
        reopened.destroy()
      }
    } finally {
      editor.destroy()
    }
  })

  it('preserves untouched source in reports above the reconciliation size threshold', () => {
    const paragraphs = Array.from(
      { length: 80 },
      (_, i) => `Price [R1] with user_name_field[^fx-${i}].`
    ).join('\n\n')
    const notes = Array.from(
      { length: 80 },
      (_, i) => `[^fx-${i}]: Original row: ${'\\| USD 10 \\| exchange_rate \\| '.repeat(30)}`
    ).join('\n\n')
    const source = `# PRICES_REPORT\n\n${paragraphs}\n\n${notes}\n`
    expect(source.length).toBeGreaterThan(50_000)
    expect(getMarkdownRichModeUnsupportedReason(source)).toBeNull()
    const editor = createEditor(source)
    const refs = {
      originalSourceRef: { current: source },
      baseCanonicalRef: { current: editor.getMarkdown() },
      lastCommittedMarkdownRef: { current: source }
    }
    try {
      editor.view.dispatch(editor.state.tr.insertText('Updated ', 1))
      const saved = commitRichMarkdownSerialization(editor, refs, roundTrip).markdown
      expect(saved).toBe(source.replace('# PRICES_REPORT', '# Updated PRICES_REPORT'))
      const reopened = createEditor(saved)
      try {
        expect(getRichMarkdownSerializationDocument(reopened).toJSON()).toEqual(
          getRichMarkdownSerializationDocument(editor).toJSON()
        )
      } finally {
        reopened.destroy()
      }
    } finally {
      editor.destroy()
    }
  })
})
