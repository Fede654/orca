# Fork Fede654/orca: doctrina

Este archivo existe solo en el fork. Es la referencia para cualquier persona o agente que
toque el fork, la integración o las builds que instalan nuestros hubs. Si algo de lo que
hacés contradice este documento, se cambia el documento primero.

## 1. Para qué existe el fork

Corremos Orca como servidor headless (`orca serve`) en hubs propios: un CT de Proxmox por
hub, operado con `orca-ctl` desde el host (repo `orca-migration`) y con la doctrina de
`hub-ops`. Hasta ahora adaptábamos Orca **desde afuera**: un lanzador en C que intercepta
el perfil del navegador, chequeos de contrato sobre el JS minificado, workarounds en
hub-ops. Cada release de upstream podía romperlos y había que revalidarlos a mano.

El fork existe para que esas adaptaciones vivan **en el fuente, con tests**, y para que
nuestros hubs instalen una build de Orca que ya las trae:

1. **Fixes que necesitamos antes de que upstream los publique**: un PR nuestro abierto o
   un fix mergeado en `main` que todavía no salió en un tag.
2. **Features que upstream no tiene o no va a tener**: perfil persistente del navegador
   en headless, STT por servidor remoto, etc.
3. **Reemplazar parches operativos por código**: cada feature que entra al fork debería
   permitir retirar un parche de `orca-ctl` o de hub-ops (sección 9).

El fork **no** es un producto propio ni una divergencia: upstream sigue siendo la fuente
de verdad. El fork es una **capa delgada**, una serie corta de parches sobre una release
de upstream.

### Por qué lo mantenemos vivo, y cuándo se duerme

Mantener un fork cuesta: upstream avanza unas 200 commits por día y publica releases casi
a diario. Cada parche de la serie es una deuda que se paga en cada integración. Por eso:

- **Vive** mientras la serie tenga al menos un parche que los hubs necesitan y que no está
  en el tag de upstream que instalamos.
- **Se duerme** cuando la serie queda vacía. Los hubs vuelven a instalar releases de
  upstream (`ORCA_REPO=stablyai/orca` en `orca-ctl`) y el fork queda sin integrar hasta
  que haga falta otra vez. No se borra.
- Cada parche tiene que justificar su lugar. Si nadie lo usa en los hubs, sale.

## 2. Principios

1. **Upstream primero.** Todo parche de interés general se propone upstream como PR
   desde su rama del fork. La serie lo lleva solo hasta que entra en un tag de upstream;
   ahí sale de la serie. Un parche es `fork-only` solo cuando upstream no lo quiere o no
   le sirve, y la serie lo dice explícitamente.
2. **Opt-in y parametrizado** (sección 4). Sin configuración, una build del fork se
   comporta exactamente como upstream.
3. **Nada de nuestros hubs en el fuente.** Ni rutas, ni IPs, ni usuarios, ni nombres de
   CT. Eso vive en la configuración del hub: drop-ins de systemd, `orca-ctl`, hub-ops.
4. **Un tema, una rama.** Cada parche vive en su rama, chica y enfocada, con tests. Nada
   de refactors, renombres o cambios cosméticos que no hagan falta: cada línea extra es un
   conflicto futuro.
5. **No tocar** `package.json` (versión, scripts), lockfiles ni los workflows de upstream
   desde una rama de tema.
6. **La integración no inventa código.** Si un tema no aplica, se arregla en su rama; en
   la integración solo se resuelven diferencias entre `main` y el tag (sección 6).

## 3. Ramas y tags

| Ref                         | Qué es                                                                                                                                                                                                                                                                 | Quién la mueve                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `main`                      | Espejo de `stablyai/orca` `main`. **Nunca** se commitea en ella.                                                                                                                                                                                                       | `fork/actions-guard.sh --sync-main` (nunca el botón _Sync fork_) |
| `feat/<tema>`, `fix/<tema>` | Ramas de tema, basadas en upstream `main`. Una por tema. Origen de los PRs a upstream.                                                                                                                                                                                 | Su dueño                                                         |
| `backport/<tema>`           | Commit de upstream adaptado a un tag base, cuando no aplica tal cual. Sale cuando el tag lo contiene.                                                                                                                                                                  | Quien integra                                                    |
| `adapt/<tema>`              | Rama de tema rearmada sobre el tag base, cuando la versión sobre `main` no aplica a ese tag. Vale solo para ese tag.                                                                                                                                                   | Quien integra                                                    |
| `fork/tooling`              | Tema `fork-only`: esta doctrina, `fork/` y `.github/workflows/hub-release.yml`. Siempre primero en la serie.                                                                                                                                                           | Quien mantiene el fork                                           |
| `feat/integration`          | **Rama destino y rama por defecto del fork**: tag de upstream + la serie, lineal. Muestra el estado que instalan los hubs. Se regenera (force push) en cada integración. **No es rama de trabajo**: lo que se commitea ahí a mano se pierde en la próxima integración. | `fork/integrate.sh`                                              |
| `vX.Y.Z-hub.N`              | Tag anotado e **inmutable** sobre `feat/integration`. Dispara la build y la release. **Es lo que instalan los hubs.**                                                                                                                                                  | `fork/integrate.sh`                                              |

- `X.Y.Z` es la release de upstream usada como base (su tag `vX.Y.Z`). `N` arranca en 1
  por cada base y sube en cada reintegración sobre la misma base (otro tema, otro fix).
- Los temas se desarrollan sobre `main` para poder proponerlos upstream. La rama destino
  se arma sobre un **tag**, no sobre `main`: los tags de upstream salen de ramas de release
  con entre 7 y 22 commits de preparación que no están en `main`, y es lo que upstream
  probó. Instalar una punta de `main` en un hub es instalar algo que nadie publicó.
- **Nunca el botón _Sync fork_** de GitHub, en ninguna rama. Sobre `feat/integration` (la
  que muestra la página del fork) ofrece mergear upstream `main` o descartar la serie, y
  cualquiera de las dos rompe la rama destino. Sobre `main` dispara workflows de upstream
  (§7).
- La versión de la app (`package.json`) **no se cambia**: el runtime reporta `X.Y.Z`. La
  build se identifica por el tag `vX.Y.Z-hub.N`, que `orca-ctl` usa como nombre de la
  release instalada. Cambiarla podría alterar comparaciones de versión con clientes
  emparejados.
- La identidad del fork va aparte: `hub-release.yml` sella `src/shared/fork-build-stamp.ts`
  con `X.Y.Z-hub.N` y el repo (tema `fork/release-identity`). Con el sello, About y
  Settings > Updates muestran `X.Y.Z-hub.N` y el updater del escritorio sigue las releases
  del fork: ofrece `hub.N+1` y nunca una release de upstream. El resto del código sigue
  viendo `X.Y.Z`. Sin sello (builds locales, upstream), todo como upstream.

## 4. Parametrización

Toda diferencia de comportamiento respecto de upstream se activa con configuración. Sin
ella, el código del fork hace lo mismo que el de upstream. En orden de preferencia:

1. **Variables de entorno `ORCA_*`** para lo que pertenece al servidor headless o a
   orcad. Se configuran en el hub con un drop-in de systemd de `orca-serve`, versionado
   en `orca-migration` u `orca-ctl`. Siguen el estilo de las de upstream
   (`ORCA_BROWSER_EXECUTABLE`, …). Ejemplo: `ORCA_BROWSER_PROFILE_DIR`.
2. **Settings persistidos y UI** para lo que configura una persona en el desktop. Ejemplo:
   el endpoint de STT remoto, en `~/.orca/remote-stt-endpoint.json`, desde Settings > Voice.
3. **Flags de CLI** solo si upstream ya tiene un flag hermano para lo mismo.

Toda variable o setting nuevo:

- valida su valor y **falla cerrado** con un mensaje que nombra la variable (ruta
  relativa, permisos inseguros, valor fuera de rango): el feature no se activa a medias;
- tiene tests con y sin la configuración;
- figura en la tabla de la serie (sección 8) y en la configuración del hub que lo usa.

## 5. La serie

`fork/series` es la lista ordenada de lo que entra en `feat/integration`. Formato: una
línea por entrada, campos separados por tabs, `#` para comentarios.

```
<tipo>	<ref>	<upstream>	<nota>
```

- `topic <rama>`: aplica los commits de la rama que no están en upstream `main`
  (`git merge-base <rama> <upstream>/main..<rama>`). Se busca primero la rama local y si
  no está, `<fork>/<rama>`.
- `backport <sha>`: aplica un commit de upstream que está en `main` pero todavía no en el
  tag base. Se usa para traer un fix de upstream sin esperar la próxima release.
- `backport <sha>@<rama>`: igual, pero aplica la rama `backport/<tema>`, creada sobre el
  tag con `cherry-pick -x <sha>` y el ajuste necesario en el mismo commit (autoría de
  upstream intacta). Hace falta cuando upstream movió archivos después del tag.
  **Ojo:** un cherry-pick puede aplicar mal sin dar conflicto. La detección de renombres
  lleva los cambios a las rutas viejas, pero un archivo nuevo queda en una carpeta que en
  el tag no existe y con imports que no resuelven: pasó con #38706. Todo backport se
  verifica con sus tests sobre el tag antes de entrar a la serie.
- `topic <rama>@<adaptada>`: para un tema que, rebasado sobre `main`, ya no encaja con el
  tag base. Pasa cuando `main` reescribió o borró lo que el tema toca y el tag es
  anterior a eso. La rama `adapt/<tema>` se crea sobre el tag con el tema rearmado para
  él; suele bastar el commit del tema previo al rebase. `integrate.sh` la usa solo si
  está basada exactamente en el tag que integra. Con la próxima base vuelve a usar la
  rama de tema y avisa que hay que sacar la adaptación de la serie y retirar la rama: la
  adaptación caduca sola. Se prueba con sus tests sobre el tag antes de entrar a la
  serie, igual que un backport.
  **No se resuelve a mano en la integración** algo que no sea un conflicto textual:
  `rerere` repite solo hunks en conflicto. Un ajuste fuera de ellos, como editar un test
  que en `main` ya no existe, se perdería en la próxima corrida sin aviso.
- La columna `upstream` dice el estado frente a upstream: `fork-only`, `proponer`,
  `PR #n`, `merged #n`.

Reglas de salida, que `integrate.sh` aplica y avisa:

- un `backport` cuyo commit ya está en el tag base se saltea: hay que sacarlo de la serie
  (y retirar su rama adaptada, si tiene);
- un `topic` cuyos commits ya están todos en el tag (mismo patch-id) se saltea: hay que
  sacarlo de la serie y retirar la rama.

## 6. Integración

`fork/integrate.sh` arma la rama destino. Hace solo cherry-picks, no compila ni corre
suites, así que es liviano para la laptop.

```sh
fork/integrate.sh v1.4.250            # arma feat/integration y el tag v1.4.250-hub.N, sin push
fork/integrate.sh v1.4.250 --push     # arma y publica en un paso
fork/integrate.sh --publish v1.4.250-hub.1  # publica lo ya armado y revisado (dispara la build)
fork/integrate.sh v1.4.250 --dry-run  # integra y descarta: para probar la serie sin tag
fork/integrate.sh --canary            # prueba la serie contra upstream main; no deja nada
```

1. Parte de un worktree desacoplado en el tag base.
2. Aplica la serie en orden con `cherry-pick -x` (el mensaje registra el commit de
   origen).
3. Ante un conflicto: si `rerere` ya conoce la resolución, sigue solo; si no, se detiene
   y lo deja para resolver a mano. Una resolución hecha en la integración se acepta solo
   si es una diferencia entre `main` y el tag; `rerere` la recuerda para la próxima. Si
   el tema está mal, se arregla en su rama y se vuelve a integrar.
4. Saca los workflows de upstream del árbol (commit `fork: strip upstream workflows`),
   salvo `hub-release.yml`. Así ni el tag ni la release disparan nada de upstream.
5. Mueve `feat/integration` y crea el tag anotado. La anotación lista la base y cada
   entrada de la serie con sus commits.
6. Con `--push` o `--publish`, pushea las ramas de la serie que estén locales y la rama
   destino con `--force-with-lease`, la deja como rama por defecto
   del fork si no lo era, pushea el tag (eso dispara la build) y corre
   `fork/actions-guard.sh`.

**Ciclo por release de upstream.** Upstream publica casi todos los días, y cada tag sale
de una rama de release que queda entre 150 y 450 commits detrás de `main`. Por eso un
tema puede aplicar sobre `main` y no sobre el tag, o al revés.

1. `fork/integrate.sh <tag> --dry-run` y `fork/integrate.sh --canary`. La mayoría de las
   veces los dos dan OK, y lo que hay que hacer sale solo:
   - los `backport` que el tag ya trae se saltean;
   - las adaptaciones `@adapt/...` que no son para este tag se ignoran;
   - los temas que upstream absorbió se saltean.

   En todos esos casos `integrate.sh` avisa qué sacar de la serie.

2. **Si un tema choca igual sobre el tag y sobre `main`**, el problema es del tema:
   upstream reescribió lo que toca. Se rebasa la rama sobre `main` y se reimplementa
   sobre la arquitectura nueva, sin forzar los hunks viejos.
3. **Si después aplica sobre `main` pero no sobre el tag**, porque el tag todavía no
   tiene la reescritura, se crea o se pisa `adapt/<tema>` sobre ese tag y la entrada pasa
   a `topic <rama>@adapt/<tema>`. Cuando un tag posterior trae la reescritura, la
   adaptación caduca sola.
4. Se integra, se revisa y se publica (`--publish`).

Un tema que toca un área que upstream está reescribiendo, como el dictado en 2026-11, va
a necesitar el paso 2 o el 3 en varias releases seguidas. Cuesta menos rebasarlo seguido
(con el canario) que acumular distancia.

**Cuándo integrar:** cuando sale una release de upstream que queremos (fixes que nos
importan, o como mínimo una vez por semana para no acumular distancia), y cada vez que
cambia la serie. El canario (`--canary`) se corre seguido: avisa de conflictos con
`main` antes de que lleguen a un tag.

`rerere` tiene que estar activado en el repo (`git config rerere.enabled true`); su
caché vive en `.git/rr-cache` del clon local y no viaja con el push.

## 7. Build, releases y Actions

- `.github/workflows/hub-release.yml` es **el único workflow del fork**. Corre en push de
  tags `v*-hub.*` y a mano (`workflow_dispatch` con un ref, sin publicar). Construye el
  template de orcad para `linux-x64-glibc` y el AppImage x64, hace un chequeo de humo y
  publica la release en `Fede654/orca` con el asset `orca-linux.AppImage`, el mismo
  nombre que upstream. GitHub publica el sha256 del asset y `orca-ctl` lo verifica.
- El mismo workflow suma a la release `orca-macos-arm64.dmg`: el escritorio para una Mac que
  se conecta a los hubs (no corre `orca serve`). Lleva el template de orcad del AppImage y
  va **firmado ad-hoc, sin certificado de Apple**: la primera vez se abre con clic derecho >
  Abrir (o `xattr -dr com.apple.quarantine /Applications/Orca.app`), macOS puede volver a
  pedir permisos en cada versión y el updater no instala (Squirrel.Mac exige firma), así
  que se actualiza bajando el dmg. Si falla, la release del AppImage ya está publicada.
- **Workflows de upstream: desactivados.** En la rama destino no existen, porque
  `integrate.sh` los saca. En `main` y en las ramas de tema sí existen, y se desactivan
  por la API con `fork/actions-guard.sh`, que deja activo solo `hub-release.yml`. Hay que
  correrlo al habilitar Actions y después de cada `--push` (`--check` solo informa).
  Ninguno de los de upstream se dispara con pushes a `feat/*`, `fix/*`, `backport/*`,
  `fork/*` o a tags `v*-hub.*`.
- **`main` del fork se sincroniza solo con `fork/actions-guard.sh --sync-main`.** El sync
  es un push a `main`, y en upstream hay workflows que corren con push a `main`
  (`ci-cache-warmup*`, `ci-xterm-cache`, `cloud-verify`, `mobile`). GitHub los dispara en
  el mismo push que los registra, así que desactivarlos después llega tarde. `--sync-main`
  apaga Actions, sincroniza y lo vuelve a prender con la política de abajo. Nada del fork
  depende de `main`: `integrate.sh` lee upstream directo, así que puede quedar atrasada sin
  costo. Tampoco se publican releases fuera de `hub-release.yml`: el evento `release`
  dispara `docs.yml`, `release-policy.yml` y `readme-downloads-badge.yml` donde existan.
- **Política de acciones del fork: `selected`.** Se permiten las acciones de GitHub
  (`actions/*`) y `pnpm/setup@*`, que son las que usan `hub-release.yml` y sus acciones
  compuestas. Nada más: ni `verified`, ni `all`. `actions-guard.sh` la reaplica y `--check`
  la verifica. Si un tag nuevo de upstream suma una acción de terceros a
  `install-node-dependencies` o a otra acción compuesta que usamos, el build falla con
  "not allowed". Se agrega el patrón en `PATTERNS` del guard, no se abre a `all`.
- **La rama por defecto del fork es `feat/integration`**, y `integrate.sh --push` lo
  asegura. Tres cosas dependen de eso:
  - **Corrida manual.** GitHub ofrece `workflow_dispatch` solo para workflows de la rama por
    defecto, así que `hub-release.yml` se puede correr a mano sobre cualquier ref sin
    publicar nada.
  - **Cache.** La cache de Actions queda atada a la rama o tag de cada corrida. Un tag
    puede leer la de la rama por defecto, pero no la de otro tag. Por eso, después de un
    `--push`, conviene correr una vez `hub-release.yml` a mano sobre `feat/integration`:
    deja caliente la cache de dependencias, Electron y nativos, y la build del tag la usa.
  - **Eventos ajenos al push.** Las tareas programadas, `issues`, `workflow_run` y
    `pull_request_target` toman los workflows de la rama por defecto. Como en
    `feat/integration` solo está `hub-release.yml`, los de upstream con esos eventos no
    existen en el fork por diseño, sin depender de `actions-guard.sh`.
  - Lo que no resuelve: un push usa los workflows del commit pusheado, no los de la rama
    por defecto. Por eso `main` se sigue sincronizando solo con `--sync-main`.
- **No se compila ni se corren suites completas en la laptop** (13 GB). El lint completo
  de Orca (`pnpm run lint`, con oxlint type-aware) la dejó sin memoria el 2026-11-05. En
  la laptop: tests puntuales por archivo, oxlint y oxfmt sobre los archivos tocados,
  siempre con tope de memoria
  (`systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0 …`). Lo completo va
  al CI.

## 8. Serie actual

| Entrada                                                                              | Tipo  | Upstream                                            | Parametrización                                                                                                                                                                                                                            | Retira                                                                                              |
| ------------------------------------------------------------------------------------ | ----- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `fork/tooling`                                                                       | topic | fork-only                                           | –                                                                                                                                                                                                                                          | –                                                                                                   |
| `fork/partial-orcad-template`                                                        | topic | fork-only (se puede proponer como perilla de build) | `ORCA_ORCAD_TEMPLATE_TARGETS` en el workflow (sin la variable verifica los 8 targets; uno desconocido corta el build)                                                                                                                      | –                                                                                                   |
| `feat/persistent-browser-profile`                                                    | topic | proponer                                            | `ORCA_BROWSER_PROFILE_DIR` (absoluta, 0700, propia, ≤ 80 bytes)                                                                                                                                                                            | lanzador `orca-electron-persistent`, lista de validadas y chequeo de contrato de `orca-ctl browser` |
| `feat/stt-remote-endpoint` (comportamiento: [addendum](fork/addenda/stt-dictado.md)) | topic | fork-only por ahora                                 | Settings > Voice o `orca-ctl speech remote` (`~/.orca/remote-stt-endpoint.json`); `ORCA_SPEECH_MODEL` fija el modelo de dictado del host (`orca-ctl speech pin`; sin la variable, como upstream; un id inválido corta el dictado)          | –                                                                                                   |
| `fix/markdown-footnotes`                                                             | topic | proponer                                            | –                                                                                                                                                                                                                                          | –                                                                                                   |
| `fix/agent-picker-launchable-first`                                                  | topic | PR #45594 (issue #45593)                            | –                                                                                                                                                                                                                                          | –                                                                                                   |
| `fork/release-identity`                                                              | topic | fork-only                                           | el sello que escribe `hub-release.yml` (`src/shared/fork-build-stamp.ts`: versión `X.Y.Z-hub.N`, que tiene que ser de la `X.Y.Z` de `package.json`, y repo); sin sello, como upstream. La release lleva `latest-linux.yml` con esa versión | –                                                                                                   |

Los temas cuyo comportamiento no se entiende solo con el código tienen un addendum en
`fork/addenda/`. Explica qué hacen, cómo interactúan con upstream, cómo se operan en los
hubs y qué límites tienen. Se actualiza con el tema, en el mismo push.

- [`stt-dictado.md`](fork/addenda/stt-dictado.md): quién transcribe qué (escritorio,
  hubs, teléfonos, web), un modelo por host y `ORCA_SPEECH_MODEL`.

Retirados (y por qué), para no volver a cargarlos:

- `Fede654/fix-headless-mailbox-pointer`: lo resolvió upstream con su propio #33258.
- `fix/mirrored-agent-status-order-by-state-start` (#34129): retirado por regresión frente
  a #29538.
- `fix/mirrored-done-idle-title-restamp` (#36793, el spinner done/idle en clientes
  emparejados): upstream lo incorporó en #38706 sobre nuestro commit. Fue `backport` vía
  `backport/title-only-status-stamp` solo para v1.4.250-hub.1. Salió de la serie con
  v1.4.251, que trae los tres archivos de #38706 idénticos a upstream; nuestro backport
  difería solo en los imports, por la reorganización de carpetas.

## 9. Relación con orca-ctl y hub-ops

El fork y `orca-ctl` se complementan: `orca-ctl` instala, actualiza, hace backups y
verifica; el fork trae el comportamiento.

- `orca-ctl update` instala desde el fork con `ORCA_REPO=Fede654/orca`. Las releases de
  upstream siguen sirviendo como rollback.
- Cuando un feature del fork reemplaza un parche externo, el retiro va en `orca-ctl` y en
  hub-ops en el mismo ciclo (columna "Retira"). Por ejemplo, con
  `ORCA_BROWSER_PROFILE_DIR` el navegador ya no necesita el lanzador en C: alcanza con
  `/opt/Orca/orca-ide` apuntando a `/opt/orca/current/orca-ide` y la variable en el
  drop-in de `orca-serve`, con el mismo directorio de perfil de siempre.
- Lo que siga siendo operativo (censo, backups, journal, reglas de reinicio) queda en
  `orca-ctl` y hub-ops; no se mete en el fuente de Orca.

## Reproducción de v1.4.266-hub.3

La preparación `Fede654/reconcile-fork-266` referencia ocho ramas
`adapt/*-v1.4.266`, cada una basada directamente en `v1.4.266` y limitada a
los archivos de su tema. Conservan el árbol publicado `8da9b6e323`, incluidos
el picker #45594, las resoluciones de integración y los dos fixes del build
nativo. La serie agrega `fork/native-build` para esos fixes. Las ramas de
origen se conservan; las adaptaciones solo corresponden a esta base.

Desde la rama de preparación, sin publicar ni mover `feat/integration`:

```sh
FORK_SERIES="$PWD/fork/series" FORK_WORKTREE=/tmp/orca-reproduce-266 \
  FORK_VERIFY_TREE=8da9b6e323 bash fork/integrate.sh v1.4.266 --dry-run
```

La ejecución comprobada produjo nueve commits (ocho temas y eliminación de
77 workflows) y el árbol exacto
`c9dff7cc3acf908a5dd6665837f89bcd6f07c6b1`. No hubo diferencias de archivos.
`FORK_VERIFY_TREE` compara antes de limpiar el destino temporal y aborta ante
cualquier diferencia. La preparación cambia únicamente esta documentación,
los selectores de `fork/series` y esa comprobación opcional; esos metadatos no
se incorporan al árbol histórico que se reproduce. Para otra base deben
revisarse de nuevo las adaptaciones; no eliminarlas sin portar sus ajustes.

### Investigación de workflows deshabilitados

GitHub informó `disabled_manually` en consultas previas del workflow
`409894392`. El estado actual es `active`; el campo `updated_at` reportado es
`2026-11-18T18:48:25Z`. La API del workflow no identifica al actor que hizo el
cambio. No se ha establecido la causa y no se modifica la configuración.
El código de `actions-guard.sh` excluye explícitamente `hub-release.yml` de
las desactivaciones individuales, pero `--sync-main` apaga Actions para todo
el repositorio y luego restaura la política mediante un trap. Esto es una
ruta que requiere investigación operativa, no prueba de causalidad. Antes
de activar automatización, el propietario debe revisar registros de auditoría
y otras sesiones que administran Actions. No habilitar workflows a ciegas.

### Referencias remotas y próxima base

`fork/native-build` apunta al commit upstream `b9d8a3f26f` (#45118), que ya
contiene los exports de ambas huellas y el manejo de `--desktop-linux`.
La adaptación histórica retiene exactamente nuestros dos arreglos publicados;
el fallback canónico usa la implementación completa de upstream. Cuando la
próxima release la incluya, el integrador la omitirá por estar incorporada.
No se usa una rama local inexistente como fallback.

La comprobación remota debe incluir las dos referencias de cada fila, aunque
la adaptación histórica sea la seleccionada. No basta comprobar que existen
localmente. La reproducción aislada usa un repositorio vacío y fetch explícito
de las ramas publicadas, el tag y upstream main; no toma ramas de este workspace.

Aún necesitan portar ajustes a la próxima base antes de integrar:

- `persistent-browser-profile`: recuperación persistente de upstream más ruta
  explícita, validación de longitud/permisos y pruebas finales de hub.3.
- `stt-remote-endpoint`: imports reorganizados, registro de Opus en el archivo
  de dependencias nuevo e integración del indicador con componentes upstream.
- `markdown-footnotes`: el scanner compartido y los cambios del round-trip.
- `agent-picker-launchable-first`: filas sin `setup` y anotaciones de tipos.
- `release-identity`: imports y coordinación del instalador con upstream.
- `partial-orcad-template`: conserva la opción de target sin revivir el test
  que upstream eliminó.
- `tooling`: la metadata nueva de este PR aún no está en el snapshot histórico.

Para una nueva base, crear ramas `adapt/*-v<base>` desde ese tag, aplicar los
cambios publicados de cada snapshot, resolver contra upstream y seleccionar
esas ramas en una nueva preparación. El tooling de esa preparación debe
incluir los selectores nuevos y `FORK_VERIFY_TREE`, sin modificar la adaptación
histórica `adapt/tooling-v1.4.266`. La comparación de la próxima integración
se hará contra su propia referencia revisada, no contra hub.3. Este PR deja
reproducible el histórico y referencias válidas; no habilita integración
autónoma de releases futuras.

## Próximas bases: plan revisado y metadata

`fork/integration-plan.json` fija base/commit, selectores ordenados y commits
remotos canónicos/adaptados. SHA-256 de los archivos finales que difieren de
upstream protege los ajustes de comportamiento. El integrador rechaza base no
revisada, refs cambiadas/ausentes, ramas locales divergentes y adaptaciones
caducadas. Tras los picks verifica archivos retenidos antes de publicar nada.
Un hash no demuestra semántica: fuerza a revisar explícitamente el contenido.

Para otra base, portar todos los temas a nuevas adaptaciones y revisar cambios
de selectores, commits y hashes en un PR. No regenerar hashes para silenciar
pérdidas. Ejecutar dry-run y tests de los dueños de los comportamientos cambiados.
Canarios también requieren plan revisado. El integrador copia `fork/` y FORK.md
del commit de preparación en un commit separado: así viajan los selectores,
verificador y plan actualizados sin reescribir la adaptación histórica.

La reproducción histórica usa `FORK_HISTORICAL=1 FORK_VERIFY_TREE=8da9b6e323`
junto con `--dry-run`. Exige el árbol histórico exacto y no permite publicación.
La ruta normal incorpora metadata nueva y por ello difiere deliberadamente del
histórico solo en tooling/documentación. Este PR no habilita integración autónoma.

### Deduplicación y exclusión: diseño, sin detector activo

El futuro coordinador necesita un registro durable con clave única
`(upstreamRepo, releaseId)`, tag y upstreamCommit inmutables. Tag cambiado de
commit exige revisión. Lease exclusivo por repo, expiración y token de fencing
creciente; transiciones por compare-and-set de versión evitan dobles despertares.
Estados: discovered, preparing, review-required, tagged, building,
linux-published/macos-pending, complete, failed. Guardar integrationCommit,
planDigest, forkTag, runId y attempt. Registrar intención antes del push y
reconciliar refs/releases/runs remotos tras pérdida de respuesta: tag y almacén
no forman una transacción distribuida. Commit remoto distinto bloquea la tarea;
nunca sobrescribir tags. Un tag por commit revisado: falta de runners solo
reintenta el job del mismo run con backoff/límite; no crea hub.N ni repite Linux.
La concurrency por ref del workflow actual no deduplica tags distintos.

Orca ofrece workflow exacto y webhook.call, no release publicada. Falta elegir y
autorizar el origen/receptor de eventos y un almacén con exclusión durable.
El conector GitHub por sí solo no aporta esas garantías. No se configura aquí
ningún detector programado, receptor o automatización.

### Riesgo Actions: evidencia y límite

La API expone state/updated_at, sin actor o historial de disabled_manually.
El guard excluye hub-release del disable individual; --sync-main sí desactiva
Actions globalmente y restaura política por trap. No hay evidencia que atribuya
el problema a esa ruta. No se cambia permisos ni se agrega enable incondicional.
Hace falta auditoría del propietario/otras sesiones para identificar al actor.
Si se demuestra que la restauración global es la causa, la corrección mínima
sería capturar/restaurar explícitamente política y estados con rechazo de cambios
concurrentes, en revisión separada con evidencia del proveedor. Mientras tanto
no se usa --sync-main durante una publicación.

### Barreras revisadas del PR #2

El plan y verificador son obligatorios, también para `--publish`. Se valida el
SHA-256 de los bytes del archivo SERIES realmente consumido (`FORK_SERIES`
incluido); esquema distinto y entradas no soportadas, incluidos backports en
este esquema exclusivamente de temas, se rechazan explícitamente. No se ignoran.
Las refs se vuelven a comprobar tras fetch y los picks usan el SHA fijado, no
el nombre mutable. Metadata dirty/untracked se rechaza; HEAD y metadata se
recomprueban antes de archivarlos. Publicar requiere candidato con archivos
retenidos, metadata revisada y reproducción dry-run exacta antes de push o
cambios de GitHub. Modo histórico no puede publicar.

`python3 fork/integration-guard.test.py` ejercita rechazos reales por plan
ausente, SERIES alterna con backport, backport con hash coincidente, metadata
sin commit, ref movida entre consulta/fetch y candidato publicable con pérdida
de contenido. Cada rechazo comprueba que integración y tags siguen intactos.

## Coordinación durable de releases (sin efectos externos)

`python3 fork/release-ledger.py --db /ruta/fuera/del/checkout/releases.sqlite`
usa exclusivamente SQLite/Python estándar; no ejecuta git, GitHub, pushes,
tags, builds ni reintentos. La ruta es obligatoria y no puede estar dentro de
un checkout. Usar disco local del host coordinador, nunca NFS/una copia
sincronizada del archivo. Mantener directorio privado y backups SQLite
consistentes; la herramienta no guarda credenciales. No pasar secretos como
owner, IDs o nombres: esos campos son metadatos de coordinación.

Comandos (todos devuelven JSON; un rechazo devuelve exit 1):

```sh
python3 fork/release-ledger.py --db /var/lib/orky/releases.sqlite register \
  --repo stablyai/orca --release-id 123 --tag v1.4.266 --commit COMMIT_UPSTREAM
python3 fork/release-ledger.py --db /var/lib/orky/releases.sqlite claim \
  --repo stablyai/orca --release-id 123 --owner orky --ttl 300
python3 fork/release-ledger.py --db /var/lib/orky/releases.sqlite get \
  --repo stablyai/orca --release-id 123
python3 fork/release-ledger.py --db /var/lib/orky/releases.sqlite list
```

`register` es idempotente por identidad exacta. ReleaseId/tag/commit no pueden
cambiar; reutilizar tag con otro releaseId también se rechaza. `claim` hace
BEGIN IMMEDIATE, reclama todo el repo (no solo esa release), incrementa fence
y version, y devuelve lease con token único. Incluso el mismo owner no puede
reclamar dos veces un lease vigente. Guardar el recibo; una respuesta perdida
se inspecciona con `get`, no se interpreta como permiso para actuar de nuevo.

`transition` requiere repo/release-id/owner/token/fence/version/state. Leer
version del recibo o `get`; una versión vieja falla por CAS. `renew` y `release`
requieren las mismas credenciales de lease (sin version); renew acepta ttl.
Lease expirado/token/fence antiguo no puede transicionar, renovar ni liberar,
aunque el nuevo titular tenga el mismo nombre. TTL máximo: una hora.

La transición normal es discovered -> preparing -> review-required -> tagged
-> building -> linux-published -> macos-pending -> complete. Desde building o
linux-published se puede completar directamente si la evidencia externa prueba
que todos los assets están publicados. `failed` guarda la etapa previa y solo
puede regresar a esa etapa; no reinicia el pipeline. `complete` es terminal.
Campos opcionales: --integration-commit, --fork-tag, --run-id, --attempt.
Los tres primeros no pueden reemplazarse dentro del candidato; attempt solo
crece. Para tagged hacen falta integración/tag; para building y posteriores,
runId y attempt positivo. Linux publicado nunca vuelve a construir Linux.
macOS conserva runId/tag/commit y solo actualiza attempt: capacidad insuficiente
no genera una versión nueva. La herramienta registra evidencia del operador,
no verifica por sí sola los assets de GitHub.

Antes de un efecto externo autorizado, usar una transición (incluso a la misma
etapa) con --intent-id ID_UNICO --intent-kind tag-push|build-start|macos-retry.
Solo hay una intención pendiente; persiste al cerrar/reabrir, al fallar o al
liberar el lease. Tras reinicio: consultar, adquirir/recuperar lease válido,
comparar la intención con refs/releases/runs externos usando las herramientas
autorizadas y resolver con --resolve-intent ID en la misma transacción que
registra tag/run/attempt/estado comprobados. No completar con intención pendiente.
No existe transacción distribuida con GitHub: lease/fencing impiden escrituras
obsoletas en SQLite, pero cualquier futuro ejecutor de efectos externos deberá
respetar los tokens, comprobar estado remoto y no repetir un push a ciegas.

Validación: `PYTHONDONTWRITEBYTECODE=1 python3 fork/release-ledger.test.py`.
Incluye dos procesos reclamando releases distintas del mismo repo, expiración
y fence viejo, owner repetido y CAS obsoleto, identidad cambiada, rollback,
reinicio con intención pendiente y conservación del run/tag para macOS.
No hay detector, scheduler ni webhook; su autorización sigue separada.

### Correcciones de código: generaciones de candidatos

La identidad upstream sigue siendo una sola e inmutable. Cada release tiene
una generación activa, numerada desde 1. `history --repo ... --release-id ...`
devuelve las generaciones archivadas y la activa, en orden. Al cambiar de
candidato se archiva una instantánea completa del anterior en una tabla
append-only: estado fallido, commit, tag, run, attempt, version e intención.
No se borran ni se reescriben las generaciones anteriores.

`candidate` requiere las mismas credenciales de lease y CAS que transition,
más --integration-commit COMMIT_CORREGIDO --fork-tag TAG_NUEVO --reviewed.
Solo se acepta sobre un candidato failed con commit/tag registrados, sin
intención pendiente y con un commit distinto no usado antes en esa release.
--reviewed es una declaración del coordinador tras revisión, no una consulta
automática a GitHub. El tag debe ser nuevo en todo el repo, tanto en registros
activos como archivados. El nuevo candidato comienza en preparing, incrementa
generation y version, conserva identidad upstream y reinicia run/attempt/estado
Linux para su código nuevo. El run nuevo tampoco puede pertenecer a otro
candidato. La renovación no mueve el lease ni cambia el fence del titular.

Ejemplo: hub.1 falla por código, se revisa un commit corregido y se crea hub.2
con `candidate`; las transiciones siguientes registran su run nuevo hasta
complete. hub.1 permanece en history como failed. Una cancelación por capacidad
con el mismo commit no permite candidate, aunque se proponga otro tag:
reanudar la etapa previa del mismo candidato y aumentar attempt sobre el mismo
run. Tampoco se puede reciclar un commit o tag de generaciones anteriores.

Antes de cambiar de candidato, cualquier efecto incierto debe reconciliarse
con --resolve-intent; cerrar/reabrir SQLite o perder el lease no elimina esa
intención. La migración transaccional de esquema 1 a 2 conserva la generación
original como 1 y crea el historial sin borrar datos. La unicidad entre tabla
activa e historial se comprueba dentro del mismo BEGIN IMMEDIATE.

## Preparación revisada v1.4.268 (2026-11-21)

Base estable fijada: `v1.4.268` (consultar `integration-plan.json` para el SHA
completo). Esta preparación conserva los tres PR de tooling/ledger mergeados.
Se revisaron los once archivos de comportamiento que cambian respecto al fork
anterior: async de credenciales/upload de voz; cambios upstream del updater,
catálogo y UI; lockfile/versiones upstream; implementación nativa absorbida.
El resto de archivos retenidos no cambió respecto a la integración revisada.

Picker #45594 (`c664321280ab21890371eddec200dc8356204e63`) NO es ancestro
del tag v1.4.268. Se mantiene la adaptación; upstream volvió a ofrecer filas
chat con setup y la condición ready excluye setup de nuevo. Las pruebas cubren
esa distinción. Los fixes nativos completos de #45118 (`b9d8a3f26f`) SÍ están
en el tag y el diff del build nativo es cero; se retira esa fila de la serie
actual sin borrar ramas o snapshots históricos.

Siete adaptaciones nuevas, basadas directamente en v1.4.268, contienen los
ajustes revisados; el plan fija sus commits y hashes. No se actualizaron hashes
para ocultar pérdidas: las diferencias se revisaron por archivo y se probaron
los comportamientos de voz, perfil, picker, footnotes y updater. El nuevo
resolver de credenciales puede devolver Promise; cada upload, incluidos tramos
remotos, espera el destino antes de crear el formulario.

La reproducción normal compara el candidato completo, incluida metadata, con
HEAD revisado. La modalidad histórica del plan actual compara el árbol fuente
revisado de v1.4.268 anterior al refresco de metadata (historicalTarget).
Para reproducir el histórico publicado de v1.4.266 usar un checkout temporal
del tooling/plan conservado en `30965cc3f8` con sus refs adapt-v1.4.266; el plan
actual rechaza deliberadamente otra base. No se sobrescribieron esos refs.

Esta rama no publica ni activa builds. La revisión precede cualquier tag
`v1.4.268-hub.N`; la publicación se coordina después de aprobar el candidato.
