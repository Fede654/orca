import { ipcMain } from 'electron'
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

export function registerSpeechProviderHandlers(): void {
  ipcMain.handle('speech:getOpenAiApiKeyStatus', async () => {
    return {
      configured: await hasOpenAiSpeechApiKey(),
      protection: await getOpenAiSpeechApiKeyProtection()
    }
  })

  ipcMain.handle('speech:saveOpenAiApiKey', async (_event, apiKey: string) => {
    await saveVerifiedOpenAiSpeechApiKey(apiKey)
    return { configured: true, protection: await getOpenAiSpeechApiKeyProtection() }
  })

  ipcMain.handle('speech:clearOpenAiApiKey', async () => {
    await clearOpenAiSpeechApiKey()
    return { configured: false, protection: null }
  })

  ipcMain.handle('speech:getOpenAiCompatibleProvider', async () => {
    try {
      return await summarizeOpenAiCompatibleSpeechProvider()
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'speech:saveOpenAiCompatibleProvider',
    async (_event, input: OpenAiCompatibleSpeechProvider) => {
      await saveVerifiedOpenAiCompatibleSpeechProvider(input)
    }
  )

  ipcMain.handle('speech:clearOpenAiCompatibleProvider', async () => {
    await clearOpenAiCompatibleSpeechProvider()
  })

  ipcMain.handle('speech:getRemoteEndpoint', async () => ({ url: await readRemoteSttBaseUrl() }))
  ipcMain.handle('speech:saveRemoteEndpoint', async (_event, url: string) => ({
    url: await saveRemoteSttEndpoint(url)
  }))
  ipcMain.handle('speech:clearRemoteEndpoint', async () => {
    await clearRemoteSttEndpoint()
    return { url: null }
  })
  ipcMain.handle('speech:checkRemoteEndpoint', async () => {
    const url = await readRemoteSttBaseUrl()
    return url ? checkRemoteSttHealth(url) : { ok: false as const, error: 'not configured' }
  })
}
