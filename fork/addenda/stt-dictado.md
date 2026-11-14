# Addendum: dictado y STT remoto en el fork

Complementa el tema `feat/stt-remote-endpoint` (FORK.md §8). Explica **quién transcribe
qué** en una instalación con escritorio, hubs y teléfonos, qué agrega el fork al
comportamiento de upstream y cómo se opera en un hub. Las rutas corresponden a
`v1.4.256` con la serie aplicada.

## 1. Qué agrega el tema

- **Modelo `remote-parakeet-tdt-0.6b-v3`** (proveedor OpenAI-compatible de upstream): transcribe en un servidor
  propio compatible con la API de OpenAI (`POST <url>/v1/audio/transcriptions`, health en
  `GET <url>/health`). No usa clave. La URL vive en `~/.orca/remote-stt-endpoint.json` de
  **cada máquina**.
  - Es el **primero del catálogo**, así que encabeza la lista en Settings > Voice y en el
    teléfono. Los dos recorren el catálogo en orden.
  - **URL precargada:** sin servidor configurado, el diálogo abre con la URL de nuestro
    servidor (`remote-stt-default-url.ts`). Alcanza con "Save and test", que valida
    `/health`. Una URL guardada manda sobre la precargada. Es la única dirección de la
    infra en este repo público: es interna, ya estaba publicada en el tema, y Fede decidió
    el 2026-11-08 dejarla por conveniencia. Ninguna otra dirección ni nombre de host va
    acá; van en los repos privados de la infra. Los ejemplos usan `192.0.2.0/24`
    (RFC 5737) o nombres genéricos.
  - Se carga desde Settings > Voice en el escritorio, o con `orca-ctl speech remote <url>`
    en un hub, que no tiene interfaz.
- **El remoto usa el cliente de nube de upstream** (`openai-transcription-client.ts`).
  Hereda el tope de 10 minutos, el timeout de subida, el manejo de errores y el idioma
  de dictado. Solo cambian la URL, que no manda `Authorization` y que los errores dicen
  "Remote".
  - **Idioma:** si se elige un idioma de dictado, el servidor recibe el campo `language`.
    Si no acepta un código, el dictado falla con "Remote transcription failed".
- **Envío por tramos, mientras se habla** (`remote-stt-segmenter.ts`, decidido el
  2026-11-08). OpenAI sigue con un solo envío al parar, como upstream. El remoto corta el
  audio en las pausas y transcribe cada tramo apenas cierra:
  - Un tramo cierra con **1600 ms de silencio**, si ya lleva al menos **4 s**. Es una pausa
    larga a propósito, para quien habla lento. Sin pausas, se corta antes de los **30 s**,
    en el punto más silencioso de los últimos 5 s.
  - El silencio se mide por energía, contra un piso de ruido que sigue al micrófono. Un
    tramo sin voz no se manda.
  - Se envía un tramo a la vez, en orden. Cada respuesta llega al cliente como `final`;
    el escritorio y el teléfono ya los van sumando. Al parar solo falta el último tramo.
  - Un tramo que falla se reintenta una vez. Si falla de nuevo, el error se informa una
    vez y se descarta el resto del dictado. Lo ya insertado queda.
  - Medido el 2026-11-08 con un dictado lento de 56 s desde la laptop:
    - la espera al parar bajó de 9,6 s a 1,9 s;
    - cada tramo aparece unos 2 s después de su pausa. Casi todo es red: el servidor
      tarda unos 50 ms, la ida y vuelta por ZeroTier 280 ms y la subida del WAV el resto.
- **Los tramos viajan en Ogg Opus a 24 kbps**, una décima parte de los bytes del WAV.
  - **Medición, mismo dictado:** cada request bajó de 1,8–3,6 s a 1,1–1,5 s y la espera
    al parar a 1,1 s. Las transcripciones salieron idénticas, y el servidor decodifica
    cualquier formato con ffmpeg.
  - **Librería:** se eligió `libopus-wasm` 0.4.1 frente a `@audio/encode-opus`:
    - codifica 2 a 4 veces más rápido y acepta 16 kHz sin remuestrear;
    - deja codificar cada cuadro de 20 ms del segmentador a medida que llega, así que al
      cerrar un tramo solo falta envolverlo;
    - tiene alrededor de un millón de descargas por mes.

    Es MIT, con libopus 1.6.1 (BSD), un solo módulo con el WASM embebido y sin scripts de
    instalación. El contenedor Ogg lo escribe el fork (`remote-stt-ogg-opus.ts`,
    RFC 7845).
  - **Un stream por tramo:** la librería no tiene un reset síncrono, así que se tiene
    siempre un codificador de repuesto creado de antemano. Si el repuesto no llegó a
    estar listo, el tramo siguiente continúa el stream anterior.
  - **Carga diferida:** la librería se carga con el primer dictado remoto. Si no carga,
    los tramos van en WAV, como antes.
  - **Empaquetado:** Orca solo lleva a la app una lista blanca de `node_modules`, así que
    la librería va en el bundle del proceso principal (`BUNDLED_MAIN_DEPENDENCIES` en
    `electron.vite.config.ts`), como un chunk aparte. orcad la incluye con el ajuste de
    `import.meta.url` que ya trae su build. Los chunks de main van desempaquetados
    (`asarUnpack` lleva `out/main/chunks/**`), así que el chunk queda en
    `app.asar.unpacked/out/main/chunks/`. El smoke check del release lo busca ahí y en
    `app.asar`, y también en `orcad-server.js` (hub.3 falló por mirar solo `app.asar`).
  - **Mantenimiento:** el tema toca `package.json`, `pnpm-lock.yaml` y
    `electron.vite.config.ts`. Si el lockfile choca en un rebase, se toma el de upstream y
    se corre `pnpm install --lockfile-only`. Después se verifica que el hash de
    integridad de `libopus-wasm@0.4.1` siga siendo
    `sha512-dt2u6KyBe1IONzZA2Q9TXQbmLsZ6l1vLqgt4n9XC/sE70BegLgwC/hcbZp41aJgURAqalYdnPg0wGSI2IwHyvA==`.
- **`/health` antes de cada dictado.** Sin URL o con el servidor caído, el dictado no
  arranca y el error lo dice.
- **Los teléfonos ven el remoto en su lista solo si la URL está configurada.** Aparece como
  fila de nube en estado `ready`, sin tamaño, y no se puede descargar ni borrar (el host
  responde `voice_model_not_downloadable` y `voice_model_not_deletable`). Sin URL no se
  manda nunca: una app vieja lo trataría como modelo local y ofrecería una descarga
  imposible.
  - **No hace falta rebuildear la app mobile.** El host presenta el proveedor como
    `openai`, que las apps instaladas ya entienden.
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
orca-ctl speech remote 192.0.2.10:8000             # URL del servidor (sin reinicio)
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

## 6. Adaptación a v1.4.256

Upstream incorporó un proveedor OpenAI-compatible (#40160), sesiones por dispositivo y
un motor local nuevo. La adaptación `adapt/stt-remote-endpoint-v256` conserva el modelo
`remote-parakeet-tdt-0.6b-v3` y el archivo que escribe `orca-ctl`, pero usa el cliente
de transcripción y las sesiones de upstream. Sigue cortando y enviando el audio remoto
en tramos Ogg Opus. El proveedor genérico de upstream sigue disponible por separado.
La adaptación está basada exactamente en `v1.4.256`; para el próximo tag hay que volver
a portar el tema o actualizar su rama sobre `main`.

## 7. Límites conocidos

- No hay modelo por cliente ni por proyecto: es por host (§2 y §3).
- Una app mobile nueva ocultaría el botón de borrar en la fila remota. Las instaladas lo
  muestran, y el host rechaza el borrado.
- Ningún test cubre cómo dibuja la app mobile una fila `remote`. La acción depende solo
  del estado, que sí está probado.
- La adaptación pasó `pnpm tc`, pruebas puntuales de STT, Opus, modelo fijado y catálogo
  móvil, además del gate de calidad de los archivos cambiados.
