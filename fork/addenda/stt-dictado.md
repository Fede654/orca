# Addendum: dictado y STT remoto en el fork

Complementa el tema `feat/stt-remote-endpoint` (FORK.md §8). Explica **quién transcribe
qué** en una instalación con escritorio, hubs y teléfonos, qué agrega el fork al
comportamiento de upstream y cómo se opera en un hub. Las rutas de archivo son de upstream
`main` con la serie aplicada (2026-11-07). Si se mueven, se busca por nombre de función.

## 1. Qué agrega el tema

- **Modelo `remote-parakeet-tdt-0.6b-v3`** (proveedor `remote`): transcribe en un servidor
  propio compatible con la API de OpenAI (`POST <url>/v1/audio/transcriptions`, health en
  `GET <url>/health`). No usa clave. La URL vive en `~/.orca/remote-stt-endpoint.json` de
  **cada máquina**.
  - Se carga desde Settings > Voice en el escritorio, o con `orca-ctl speech remote <url>`
    en un hub, que no tiene interfaz.
- **El remoto usa el cliente de nube de upstream** (`openai-transcription-client.ts`).
  Hereda el tope de 10 minutos, el timeout de subida, el manejo de errores y el idioma
  de dictado. Solo cambian la URL, que no manda `Authorization` y que los errores dicen
  "Remote".
  - **Idioma:** si se elige un idioma de dictado, el servidor recibe el campo `language`.
    Si no acepta un código, el dictado falla con "Remote transcription failed".
- **`/health` antes de cada dictado.** Sin URL o con el servidor caído, el dictado no
  arranca y el error lo dice.
- **Los teléfonos ven el remoto en su lista solo si la URL está configurada.** Aparece como
  fila `remote` en estado `ready`, sin tamaño, y no se puede descargar ni borrar (el host
  responde `voice_model_not_downloadable` y `voice_model_not_deletable`). Sin URL no se
  manda nunca: una app vieja lo trataría como modelo local y ofrecería una descarga
  imposible.
  - **No hace falta rebuildear la app mobile.** Las apps instaladas degradan un proveedor
    desconocido a vacío y dibujan la fila por su estado (`dictation-reply-schema.ts`).
- **`ORCA_SPEECH_MODEL`** (segundo commit del tema): fija el modelo de dictado del host
  (§4).

## 2. Quién transcribe: la regla

**Transcribe la máquina que tiene el micrófono, salvo el teléfono y el cliente web, que
mandan el audio al host al que están conectados.** El modelo no depende del proyecto ni
del hub donde vive la terminal.

| Dónde se dicta | Quién transcribe | Con qué modelo | Adónde va el audio |
|---|---|---|---|
| App de escritorio, en un proyecto local | El escritorio | El de Settings > Voice del escritorio | Nada sale de la máquina (local), a OpenAI o al servidor remoto del escritorio |
| App de escritorio, en una terminal o agente de **cualquier hub** | El escritorio, igual que arriba | El mismo | Igual que arriba. **Al hub llega texto**, como si se hubiera tipeado |
| Teléfono emparejado con un hub | Ese hub | El modelo del hub (o el fijado) | Teléfono → hub → según el modelo del hub |
| Teléfono emparejado con el escritorio | El escritorio | El del escritorio | Teléfono → escritorio → según su modelo |
| Cliente web abierto contra un hub | Ese hub | El del hub (`followHostVoiceSettings`) | Navegador → hub → según su modelo |

- **Escritorio** (`DictationController.tsx`): lee `voice.sttModel` de su propia
  configuración y transcribe por IPC en su propio proceso (`window.api.speech`). No hay
  modelo por proyecto ni por hub; upstream no lo tiene y el fork no lo agrega.
- **Teléfono:** la app maneja una lista de hosts (`MobileHomeHostList`) y dicta contra el
  que tiene conectado (`mobile-dictation-desktop-start.ts`). Con dos hubs, cada uno
  transcribe con el suyo: el hub A puede mandar a Parakeet y el hub B transcribir en su
  CPU.
- **Pedido de dictado:** ni el teléfono ni el web mandan modelo; solo un id de dictado. El
  host usa el suyo (`runtime-mobile-dictation-controller.ts`:
  `params.modelId || voice.sttModel`).

## 3. Un modelo por host, y quién puede cambiarlo

En upstream, cada host tiene **un solo modelo de dictado** (`voice.sttModel`) para todos
sus clientes. #39305 separó las sesiones por dispositivo, pero el modelo siguió siendo
global. Cuando un teléfono elige un modelo en su pantalla, llama a `speech.dictation.setup`
y **cambia el modelo del host para todos** (`runtime-mobile-speech-catalog.ts`
`configure()`).

En un hub eso significa que cualquier teléfono emparejado puede:

- pasar el hub a un modelo **local**: transcribe en la CPU del CT, es lento, le compite
  recursos al resto y puede obligar a bajar cientos de MB;
- pasarlo a **OpenAI**, si hay clave guardada: el audio de todos va a un tercero. Es la
  única frontera de privacidad real; el remoto es un servidor propio;
- y nada queda registrado de quién lo cambió.

El cambio afecta **solo a ese host**: no se propaga a otros hubs ni al escritorio.

## 4. `ORCA_SPEECH_MODEL`: el modelo lo fija el hub

Lo decidió Fede el 2026-11-07, entre tres opciones: libre como upstream, fijado por el hub
o un modelo por teléfono. Se descartó el modelo por teléfono: contradice #39305 y suma
código propio en un área que upstream reescribe cada semana.

- **Sin la variable** (o vacía): exactamente como upstream.
- **Con un id válido:** el host dicta siempre con ese modelo.
  - La lista de los teléfonos lo muestra como elegido.
  - Elegir otro devuelve `voice_model_pinned`.
  - Prender o apagar el dictado y cambiar el modo siguen funcionando.
  - Nunca se escribe en la configuración.
  - En `main` también se precarga ese modelo y no el de la configuración.
- **Con un id desconocido o retirado:** falla cerrado con `voice_model_pin_invalid`, sin
  volver en silencio a la configuración. La lista muestra igual el id, para que el error
  se vea.
- **Alcance por máquina:** se pone en el drop-in de systemd del hub. En una máquina con la
  variable, el dictado desde la app de escritorio también queda limitado al modelo fijado.
  La pantalla de Settings > Voice sigue mostrando el modelo de la configuración; en un hub
  headless no hay escritorio, así que no molesta. Un escritorio sin la variable no se
  entera.
- Lógica en `src/main/speech/speech-model-pin.ts`; la variable se lee en cada uso.

Operación (orca-ctl ≥ 1.6.0, `tools/pve/README-orca-ctl.md` en `orca-migration`):

```sh
orca-ctl speech                                   # release, modelo fijado, servidor y /health
orca-ctl speech remote 10.0.0.5:8000              # URL del servidor (sin reinicio)
orca-ctl speech pin remote-parakeet-tdt-0.6b-v3   # drop-in 71-speech-model.conf
orca-ctl restart                                  # el pin rige desde el reinicio
orca-ctl speech unpin                             # vuelve a upstream (con reinicio)
```

`update` y `rollback` avisan, y lo registran en el journal, si la release nueva no sabe
leer el modelo fijado. Por ejemplo, al volver a una release de upstream.

## 5. Seguridad del servidor remoto

- **El audio viaja sin credenciales** y, con `http://`, en claro. El servidor tiene que
  estar en una red de confianza (LAN, VPN o Tailscale) o detrás de HTTPS. La URL no admite
  usuario ni contraseña embebidos; el store los rechaza.
- Cualquiera que llegue al puerto del servidor puede transcribir con él. Restringirlo es
  cosa del servidor, no de Orca.

## 6. Diferencias entre `main` y el tag base

El dictado es un área que upstream reescribió en 2026-11, con #39297, #39305, #39327,
#39346 y #39347. Mientras el tag base no traiga esa reescritura, el tema entra a la
integración como `adapt/stt-remote-endpoint` (FORK.md §5). La adaptación se arma sobre el
tag y caduca sola cuando el tag nuevo trae la reescritura.

- **En el tag (v1.4.253):** una sola sesión de dictado a la vez. Un teléfono no puede
  dictar mientras dicta otro cliente; recibe `dictation_already_active`. No existe la
  precarga del modelo.
- **En `main`:** sesiones por dispositivo. Los remotos no compiten con nadie, hasta 4
  sesiones (`MAX_STT_SESSIONS`).

## 7. Límites conocidos

- No hay modelo por cliente ni por proyecto: es por host (§2 y §3).
- Una app mobile nueva ocultaría el botón de borrar en la fila remota. Las instaladas lo
  muestran, y el host rechaza el borrado.
- Ningún test cubre cómo dibuja la app mobile una fila `remote`. La acción depende solo
  del estado, que sí está probado.
- `stt-session-start.ts` y las llamadas al modelo fijado se validan con tests, sin type
  check completo: no entra en el tope de memoria de la laptop. Lo completo queda para el
  CI.
