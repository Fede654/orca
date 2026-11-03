import { CheckCircle2, Server, Unlink } from 'lucide-react'
import { Button } from '../../ui/button'
import { Label } from '../../ui/label'
import { translate } from '@/i18n/i18n'

type RemoteSttEndpointSettingsRowProps = {
  url: string | null
  disabled: boolean
  onConfigure: () => void
  onClear: () => void
}

export function RemoteSttEndpointSettingsRow({
  url,
  disabled,
  onConfigure,
  onClear
}: RemoteSttEndpointSettingsRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <Label>{translate('settings.voice.remoteEndpoint.title', 'Remote speech server')}</Label>
          {url && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" />
              {translate('settings.voice.remoteEndpoint.configured', 'Configured')}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {url ??
            translate(
              'settings.voice.remoteEndpoint.emptyHint',
              'Set the URL of an OpenAI-compatible transcription server before selecting the remote model.'
            )}
        </p>
      </div>
      {url ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={disabled} onClick={onConfigure}>
            {translate('settings.voice.remoteEndpoint.edit', 'Edit')}
          </Button>
          <button
            onClick={onClear}
            aria-label={translate(
              'settings.voice.remoteEndpoint.disconnect',
              'Remove remote speech server'
            )}
            disabled={disabled}
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Unlink className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button variant="outline" size="sm" disabled={disabled} onClick={onConfigure}>
          {translate('settings.voice.remoteEndpoint.add', 'Set server URL')}
        </Button>
      )}
    </div>
  )
}
