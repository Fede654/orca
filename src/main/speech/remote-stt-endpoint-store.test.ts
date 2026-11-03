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
    ['10.10.9.1:8091', 'http://10.10.9.1:8091'],
    ['http://10.10.9.1:8091/', 'http://10.10.9.1:8091'],
    ['http://10.10.9.1:8091/v1', 'http://10.10.9.1:8091'],
    ['https://stt.example.org/api/v1/', 'https://stt.example.org/api']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRemoteSttBaseUrl(input)).toBe(expected)
  })

  it.each(['', 'ftp://host/x', 'http://u:p@host'])('rejects %j', (input) => {
    expect(() => normalizeRemoteSttBaseUrl(input)).toThrow()
  })
})

describe('remote transcription', () => {
  it('posts to the remote server with the remote model name and no credentials', async () => {
    const fetchMock = vi.fn(async () => Response.json({ text: ' hola ' }))
    vi.stubGlobal('fetch', fetchMock)
    const readKey = vi.fn(() => 'sk-secret')
    const session = new OpenAiTranscriptionSession(
      'remote-parakeet-tdt-0.6b-v3',
      readKey,
      'http://10.10.9.1:8091'
    )
    session.feedAudio(new Float32Array(1600), 16000)

    await expect(session.finish()).resolves.toBe('hola')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(getRemoteTranscriptionUrl('http://10.10.9.1:8091'))
    expect(init.headers).toEqual({})
    expect((init.body as FormData).get('model')).toBe('parakeet-tdt-0.6b-v3')
    expect(readKey).not.toHaveBeenCalled()
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
