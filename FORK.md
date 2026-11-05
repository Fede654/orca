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

| Ref | Qué es | Quién la mueve |
|---|---|---|
| `main` | Espejo de `stablyai/orca` `main`. **Nunca** se commitea en ella. | `fork/actions-guard.sh --sync-main` (nunca el botón *Sync fork*) |
| `feat/<tema>`, `fix/<tema>` | Ramas de tema, basadas en upstream `main`. Una por tema. Origen de los PRs a upstream. | Su dueño |
| `backport/<tema>` | Commit de upstream adaptado a un tag base, cuando no aplica tal cual. Sale cuando el tag lo contiene. | Quien integra |
| `adapt/<tema>` | Rama de tema rearmada sobre el tag base, cuando la versión sobre `main` no aplica a ese tag. Vale solo para ese tag. | Quien integra |
| `fork/tooling` | Tema `fork-only`: esta doctrina, `fork/` y `.github/workflows/hub-release.yml`. Siempre primero en la serie. | Quien mantiene el fork |
| `feat/integration` | **Rama destino y rama por defecto del fork**: tag de upstream + la serie, lineal. Muestra el estado que instalan los hubs. Se regenera (force push) en cada integración. **No es rama de trabajo**: lo que se commitea ahí a mano se pierde en la próxima integración. | `fork/integrate.sh` |
| `vX.Y.Z-hub.N` | Tag anotado e **inmutable** sobre `feat/integration`. Dispara la build y la release. **Es lo que instalan los hubs.** | `fork/integrate.sh` |

- `X.Y.Z` es la release de upstream usada como base (su tag `vX.Y.Z`). `N` arranca en 1
  por cada base y sube en cada reintegración sobre la misma base (otro tema, otro fix).
- Los temas se desarrollan sobre `main` para poder proponerlos upstream. La rama destino
  se arma sobre un **tag**, no sobre `main`: los tags de upstream salen de ramas de release
  con entre 7 y 22 commits de preparación que no están en `main`, y es lo que upstream
  probó. Instalar una punta de `main` en un hub es instalar algo que nadie publicó.
- **Nunca el botón *Sync fork*** de GitHub, en ninguna rama. Sobre `feat/integration` (la
  que muestra la página del fork) ofrece mergear upstream `main` o descartar la serie, y
  cualquiera de las dos rompe la rama destino. Sobre `main` dispara workflows de upstream
  (§7).
- La versión de la app (`package.json`) **no se cambia**: el runtime reporta `X.Y.Z`. La
  build se identifica por el tag `vX.Y.Z-hub.N`, que `orca-ctl` usa como nombre de la
  release instalada. Cambiarla podría alterar comparaciones de versión con clientes
  emparejados.

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

| Entrada | Tipo | Upstream | Parametrización | Retira |
|---|---|---|---|---|
| `fork/tooling` | topic | fork-only | – | – |
| `fork/partial-orcad-template` | topic | fork-only (se puede proponer como perilla de build) | `ORCA_ORCAD_TEMPLATE_TARGETS` en el workflow (sin la variable verifica los 8 targets; uno desconocido corta el build) | – |
| `feat/persistent-browser-profile` | topic | proponer | `ORCA_BROWSER_PROFILE_DIR` (absoluta, 0700, propia, ≤ 80 bytes) | lanzador `orca-electron-persistent`, lista de validadas y chequeo de contrato de `orca-ctl browser` |
| `feat/stt-remote-endpoint` (sobre el tag: `@adapt/stt-remote-endpoint`) | topic adaptado | fork-only por ahora | Settings > Voice (`~/.orca/remote-stt-endpoint.json`) | – |
| `fix/markdown-footnotes` | topic | proponer | – | – |

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
