export function forEachEmbeddedHtmlFragment(
  content: string,
  visit: (fragment: string) => boolean
): boolean {
  const lastCommentClose = content.lastIndexOf('-->')
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 60) {
      continue
    }

    let fragmentEnd: number | null = null
    if (content.startsWith('<!--', index)) {
      const commentEnd = index + 4 <= lastCommentClose ? content.indexOf('-->', index + 4) : -1
      fragmentEnd = commentEnd === -1 ? null : commentEnd + 3
    } else {
      fragmentEnd = getHtmlTagEnd(content, index)
    }

    if (fragmentEnd === null) {
      continue
    }

    if (!visit(content.slice(index, fragmentEnd))) {
      return false
    }
    index = fragmentEnd - 1
  }

  return true
}

function getHtmlTagEnd(content: string, startIndex: number): number | null {
  let index = startIndex + 1

  if (content.charCodeAt(index) === 47) {
    index++
  }

  if (!isHtmlTagNameStart(content.charCodeAt(index))) {
    return null
  }
  index++

  while (isHtmlTagNamePart(content.charCodeAt(index))) {
    index++
  }

  const nextCode = content.charCodeAt(index)
  if (nextCode === 62) {
    return index + 1
  }
  if (nextCode === 47 && content.charCodeAt(index + 1) === 62) {
    return index + 2
  }
  if (!isHtmlWhitespace(nextCode)) {
    return null
  }

  index++
  while (index < content.length) {
    const code = content.charCodeAt(index)
    if (code === 60) {
      return null
    }
    if (code === 62) {
      return index + 1
    }
    index++
  }

  return null
}

function isHtmlTagNameStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isHtmlTagNamePart(code: number): boolean {
  return (
    isHtmlTagNameStart(code) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 46 ||
    code === 58 ||
    code === 45
  )
}

function isHtmlWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32
}
