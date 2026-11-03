import { Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'

type RemoteSttEndpointDialogProps = {
  open: boolean
  configured: boolean
  urlDraft: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onUrlDraftChange: (value: string) => void
  onSave: () => void
  onClear: () => void
}

export function RemoteSttEndpointDialog({
  open,
  configured,
  urlDraft,
  pending,
  onOpenChange,
  onUrlDraftChange,
  onSave,
  onClear
}: RemoteSttEndpointDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate('settings.voice.remoteEndpoint.title', 'Remote speech server')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'settings.voice.remoteEndpoint.dialogDescription',
              'Dictation audio is sent to this server when the remote model is selected. It must expose POST /v1/audio/transcriptions and GET /health.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="remote-stt-endpoint-url">
            {translate('settings.voice.remoteEndpoint.urlLabel', 'Server URL')}
          </Label>
          <Input
            id="remote-stt-endpoint-url"
            value={urlDraft}
            placeholder="http://10.10.9.1:8091"
            disabled={pending}
            onChange={(event) => onUrlDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && urlDraft.trim()) {
                onSave()
              }
            }}
          />
        </div>
        <DialogFooter>
          {configured && (
            <Button variant="outline" disabled={pending} onClick={onClear}>
              {translate('settings.voice.remoteEndpoint.remove', 'Remove')}
            </Button>
          )}
          <Button disabled={pending || !urlDraft.trim()} onClick={onSave}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {translate('settings.voice.remoteEndpoint.save', 'Save and test')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
