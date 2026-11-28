import type { IpcHandleRegistrar } from './lazy-ipc-handle-group'
import type { OpenAiCompatibleSpeechProvider } from '../../shared/speech/speech-types'
import {
  clearOpenAiSpeechApiKey,
  getOpenAiSpeechApiKeyProtection,
  hasOpenAiSpeechApiKey
} from '../speech/openai-api-key-store'
import {
  saveVerifiedOpenAiCompatibleSpeechProvider,
  saveVerifiedOpenAiSpeechApiKey
} from '../speech/openai-api-key-verification'
import {
  clearOpenAiCompatibleSpeechProvider,
  summarizeOpenAiCompatibleSpeechProvider
} from '../speech/openai-compatible-speech-provider-store'
import {
  checkRemoteSttHealth,
  clearRemoteSttEndpoint,
  readRemoteSttBaseUrl,
  saveRemoteSttEndpoint
} from '../speech/remote-stt-endpoint-store'

export function registerSpeechProviderHandlers(ipc: IpcHandleRegistrar): void {
  ipc.handle('speech:getOpenAiApiKeyStatus', async () => {
    return {
      configured: await hasOpenAiSpeechApiKey(),
      protection: await getOpenAiSpeechApiKeyProtection()
    }
  })

  ipc.handle('speech:saveOpenAiApiKey', async (_event, apiKey: string) => {
    await saveVerifiedOpenAiSpeechApiKey(apiKey)
    return { configured: true, protection: await getOpenAiSpeechApiKeyProtection() }
  })

  ipc.handle('speech:clearOpenAiApiKey', async () => {
    await clearOpenAiSpeechApiKey()
    return { configured: false, protection: null }
  })

  ipc.handle('speech:getOpenAiCompatibleProvider', async () => {
    try {
      return await summarizeOpenAiCompatibleSpeechProvider()
    } catch {
      return null
    }
  })

  ipc.handle(
    'speech:saveOpenAiCompatibleProvider',
    async (_event, input: OpenAiCompatibleSpeechProvider) => {
      await saveVerifiedOpenAiCompatibleSpeechProvider(input)
    }
  )

  ipc.handle('speech:clearOpenAiCompatibleProvider', async () => {
    await clearOpenAiCompatibleSpeechProvider()
  })

  ipc.handle('speech:getRemoteEndpoint', async () => ({ url: await readRemoteSttBaseUrl() }))
  ipc.handle('speech:saveRemoteEndpoint', async (_event, url: string) => ({
    url: await saveRemoteSttEndpoint(url)
  }))
  ipc.handle('speech:clearRemoteEndpoint', async () => {
    await clearRemoteSttEndpoint()
    return { url: null }
  })
  ipc.handle('speech:checkRemoteEndpoint', async () => {
    const url = await readRemoteSttBaseUrl()
    return url ? checkRemoteSttHealth(url) : { ok: false as const, error: 'not configured' }
  })
}
