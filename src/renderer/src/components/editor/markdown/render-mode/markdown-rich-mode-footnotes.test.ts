import { afterEach, describe, expect, it, vi } from 'vitest'
import * as roundTrip from './markdown-round-trip'
import {
  getMarkdownRichModeEligibilityDecision,
  getMarkdownRichModeUnsupportedMessage
} from './markdown-rich-mode'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rich Markdown footnote eligibility', () => {
  it('keeps footnotes protected if serialization loses a definition or reference', () => {
    vi.spyOn(roundTrip, 'getRichMarkdownRoundTripOutput').mockReturnValue('Text.')
    expect(getMarkdownRichModeUnsupportedMessage('Text[^lost].\n\n[^lost]: Keep this note.')).toBe(
      'Editable only in code mode because this file contains footnotes.'
    )
  })

  it.each(['\n', '\r\n'])('allows supported footnotes with %j endings', (newline) => {
    const content = [
      'Price in USD.[^fx-1]',
      '',
      '[^fx-1]: Original amount and exchange rate.'
    ].join(newline)

    expect(
      getMarkdownRichModeEligibilityDecision({ content, sizeOverridden: false }).unsupportedReason
    ).toBeNull()
    expect(getMarkdownRichModeUnsupportedMessage(content)).toBeNull()
  })

  it.each([
    '[source]: https://example.com\n\n[^fx-1]: Exchange rate.',
    '[^fx-1]: Exchange rate.\n\n[source]: https://example.com',
    '[exchange^rate]: https://example.com'
  ])('still identifies reference links in %j', (content) => {
    expect(
      getMarkdownRichModeEligibilityDecision({ content, sizeOverridden: false }).unsupportedReason
    ).toBe('reference-links')
  })

  it.each(['`[^fx-1]: Example note.`', '```md\n[^fx-1]: Example note.\n```'])(
    'ignores footnote examples inside code in %j',
    (content) => {
      expect(getMarkdownRichModeUnsupportedMessage(content)).toBeNull()
    }
  )
})
