# Corrección contextual del dictado remoto (diseño)

Este diseño complementa `pve-infra/gpu-audio/ultra/TIMESTAMPS-Y-DICTADO.md`. Depende de verificar allí qué marcas temporales y grados de confianza puede entregar Parakeet Ultra v3. La implementación actual de Orca sigue enviando fragmentos independientes y agregando texto final; este documento no cambia ese contrato.

## 1. Solapar audio con contexto

Al cerrar un fragmento por pausa, conservar un tramo corto de audio anterior (por ejemplo, 1–2 s) y anteponerlo al siguiente envío. El servicio debe devolver texto y marcas de tiempo por palabra, con tiempos referidos al audio enviado. Orca conserva el desplazamiento absoluto de cada fragmento para ubicar las palabras en la grabación. El solapamiento solo aporta contexto al modelo; no duplica palabras visibles.

## 2. Reconciliar palabras

Separar cada respuesta en zona solapada y zona nueva mediante marcas de tiempo. Comparar las palabras de la zona solapada con la cola ya reconocida, normalizando espacios, puntuación y mayúsculas. Reemplazar solo la cola que tenga una correspondencia temporal y textual suficientemente clara. Si los resultados son ambiguos, conservar el texto confirmado y añadir únicamente las palabras nuevas. Probar especialmente pausas dentro de una oración, nombres propios, repeticiones reales, muletillas y respuestas tardías o fuera de orden.

## 3. Mantener una cola provisional en la pastilla

La pastilla muestra texto confirmado y una cola provisional corregible. Cada respuesta puede revisar esa cola y confirmar las palabras anteriores cuando el contexto siguiente estabilice la transcripción. Al terminar, se confirma la cola restante; al cancelar, se descarta. La interfaz de la pastilla es la misma para chat, editores y terminales. El texto enviado al destino externo permanece estable: Orca no intenta borrar ni reescribir caracteres ya insertados en una terminal o en otra aplicación.

## 4. Publicar texto y degradar con seguridad

El envío automático espera la confirmación de la cola y respeta el orden de fragmentos. Un tiempo límite o un error del servicio confirma la mejor versión disponible, sin perder palabras ni bloquear `Finish`. La respuesta enriquecida se negocia como capacidad opcional del servicio y se valida antes de usarla; el servicio actual `{ text }` conserva el comportamiento vigente. Las pruebas deben cubrir solapamiento, puntuación, orden de respuestas, cortes forzados al máximo del segmento (hoy 30 s), cancelación y clientes/hosts de versiones distintas.
