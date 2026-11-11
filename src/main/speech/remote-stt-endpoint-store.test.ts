import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  checkRemoteSttHealth,
  getRemoteTranscriptionUrl,
  normalizeRemoteSttBaseUrl
} from './remote-stt-endpoint-store'
import { OpenAiTranscriptionSession } from './openai-transcription-client'

afterEach(() => vi.unstubAllGlobals())

describe('normalizeRemoteSttBaseUrl', () => {
  it.each([
    ['192.0.2.10:8000', 'http://192.0.2.10:8000'],
    ['http://192.0.2.10:8000/', 'http://192.0.2.10:8000'],
    ['http://192.0.2.10:8000/v1', 'http://192.0.2.10:8000'],
    ['https://stt.example.org/api/v1/', 'https://stt.example.org/api']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRemoteSttBaseUrl(input)).toBe(expected)
  })

  it.each(['', 'ftp://host/x', 'http://u:p@host'])('rejects %j', (input) => {
    expect(() => normalizeRemoteSttBaseUrl(input)).toThrow()
  })
})

describe('remote transcription', () => {
  it('posts to the remote server with the remote model name, the language and no credentials', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ text: ' hola ' })
    )
    vi.stubGlobal('fetch', fetchMock)
    const session = new OpenAiTranscriptionSession(
      () => ({
        url: getRemoteTranscriptionUrl('http://192.0.2.10:8000'),
        model: 'parakeet-tdt-0.6b-v3',
        apiKey: '',
        label: 'Remote'
      }),
      'es'
    )
    session.feedAudio(new Float32Array(1600), 16000)

    await expect(session.finish()).resolves.toBe('hola')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(getRemoteTranscriptionUrl('http://192.0.2.10:8000'))
    expect(init.headers).toEqual({})
    expect(init.body).toBeInstanceOf(FormData)
    if (!(init.body instanceof FormData)) {
      throw new Error('Expected multipart body')
    }
    expect(init.body.get('model')).toBe('parakeet-tdt-0.6b-v3')
    expect(init.body.get('language')).toBe('es')
  })

  it('reports an unreachable health endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 503 }))
    )
    await expect(checkRemoteSttHealth('http://h:1')).resolves.toEqual({
      ok: false,
      error: 'HTTP 503'
    })
  })
})
