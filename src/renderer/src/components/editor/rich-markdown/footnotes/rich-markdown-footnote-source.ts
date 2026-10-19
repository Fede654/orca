import {
  createMarkdownFenceRangeCursor,
  getMarkdownFenceRanges
} from '../../markdown/source-scanning/markdown-fence-scanner'

export function matchRichMarkdownFootnoteDefinition(source: string) {
  const first = /^ {0,3}\[\^([^\]\s[]+)\]:[ \t]*([^\n]*)(?:\n|$)/.exec(source)
  if (!first) {
    return null
  }

  const lines = [first[2]]
  let end = first[0].length
  while (end < source.length) {
    const rest = source.slice(end)
    const continuation = /^(?: {4}|\t)([^\n]*)(?:\n|$)/.exec(rest)
    if (continuation) {
      lines.push(continuation[1])
      end += continuation[0].length
      continue
    }
    const blank = /^(?:[ \t]*\n)+(?= {4}|\t)/.exec(rest)
    if (!blank) {
      break
    }
    lines.push(...Array.from(blank[0].matchAll(/\n/g), () => ''))
    end += blank[0].length
  }
  return { raw: source.slice(0, end), label: first[1], body: lines.join('\n') }
}

/** Definitions must remain definitions, including repeated references and unused notes. */
export function preservesRichMarkdownFootnoteMarkers(before: string, after: string): boolean {
  const signature = (source: string) => {
    const definitions = new Map(
      Array.from(source.matchAll(/^ {0,3}\[\^([^\]\r\n]+)\]:/gm), (match) => [
        match.index + match[0].indexOf('['),
        match[1]
      ])
    )
    const labels = new Set(Array.from(definitions.values(), (label) => label.toLowerCase()))
    return Array.from(source.matchAll(/(\\*)\[\^([^\]\r\n]+)\]/g))
      .filter((match) => match[1].length % 2 === 0 && labels.has(match[2].toLowerCase()))
      .map((match) => [match[2], definitions.has(match.index + match[1].length)])
  }
  return JSON.stringify(signature(before)) === JSON.stringify(signature(after))
}

export function collectRichMarkdownFootnoteLabels(source: string): Set<string> {
  if (!source.includes('[^')) {
    return new Set()
  }
  const definitions = Array.from(source.matchAll(/^ {0,3}\[\^([^\]\s[]+)\]:/gm))
  if (definitions.length === 0) {
    return new Set()
  }
  const insideFence = createMarkdownFenceRangeCursor(getMarkdownFenceRanges(source))
  return new Set(
    definitions.filter((match) => !insideFence(match.index)).map((match) => match[1].toLowerCase())
  )
}
