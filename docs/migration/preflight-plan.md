# Drogon rewrite — preflight y plan de ejecución

Fecha: 2026-09-05. Estado actualizado: **ambiente creado y smoke de tres harnesses aprobado; P0 completo y rewrite pendientes**.
Este documento no es una recipe ejecutada. Se renombró el repositorio anterior, se creó el nuevo y se ejecutaron tres workers; no se inició implementación del producto. El [reporte de resultados](preflight-results.md) reemplaza los estados históricos del discovery que siguen abajo.

## Objetivo y orden

Construir Drogon en un repositorio público nuevo, con aplicación Electron y CLI propia `drogon-cli`, reutilizando explícitamente las buenas piezas y contratos de Orca. Renombrar el repositorio anterior a `drogon-orca` y dejarlo privado mediante una operación compatible con las restricciones de GitHub y sin perder historial. Después de validar la migración, retomar los pendientes de `../reports/HANDOFF-20260905.md`.

No es un reemplazo de cadenas Orca→Drogon ni una traducción indiscriminada de TypeScript a Rust. Debe haber núcleo propio, lifecycle verificable y una app utilizable. No declarar paridad completa de Orca: inventariar capacidades y aprobar explícitamente cuáles son objetivo, cuáles se reutilizan y cuáles quedan fuera de la edición Dev-Day. El usuario confirmó deadline **14 de septiembre de 2026** (hora no indicada) y objetivo de **24 horas para la reescritura funcional desde el arranque**. Es una meta, no una garantía de paridad total ni autorización para omitir pruebas.

## Distribución temporal objetivo: primeras 24 horas

| Ventana desde el arranque | Resultado exigido |
| --- | --- |
| 0–2 h | Smoke de los tres harnesses, inventario de capacidades, procedencia y ruta de repositorios. Bloqueos de GitHub se reportan pronto; la construcción local puede avanzar sin borrar/renombrar a ciegas. |
| 2–5 h | Contrato de protocolo y corte vertical Rust + drogon-cli + Electron con terminal/harness real. Si no funciona, resolverlo antes de ampliar olas. |
| 5–15 h | Tres lanes paralelos con integraciones pequeñas: núcleo, CLI/adapters y desktop reutilizado. Cada capacidad acordada lleva test y estado visible. |
| 15–20 h | Integración completa, revisión cruzada, fallos/recovery, SSH y matriz de plataformas; corregir regresiones antes de generar el candidato. |
| 20–24 h | Build/instalación aislada y dogfooding: la app nueva + drogon-cli coordinan una tarea real sin invocar el runtime de Orca por detrás. Informe de aceptación y gaps. |

Si un requisito acordado no pasa a las 24 h, queda explícitamente pendiente: no reducir alcance ni declarar «terminado» por cumplir el reloj. Entre ese corte y el 14/09 se prevén estabilización, pendientes del handoff y ensayo de demo. No prometer coste/tokens/throughput de los tres proveedores antes del smoke; aprovechar concurrencia útil, no procesos sin ownership. Durante ejecución comunicar progreso por puertas y bloqueos con evidencia.

## Evidencia del preflight

| Comprobación | Resultado |
| --- | --- |
| Fuente de referencia | `/Users/carlos/Documents/Drogon-mentu-session`, rama `codex/mentu-session-approved`, HEAD `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, limpio antes de escribir este plan. |
| Main conocido | `origin/main` en `34ae1a1c926fd1ce1f174f7c6ef2f65e0a0c4168`, squash de PR1; mantener linaje del checkout antiguo para su evidencia. |
| Repo GitHub | ID 1357520197, `clioo/drogon`, público, fork de `stablyai/orca`, permisos admin verificados. |
| Orca | `/usr/local/bin/orca`, runtime 1.4.197 running/ready/connected, ID `e9c8216c-44ad-42d5-9d9a-065bd6ada0b9`, ventana disponible. No prueba que sea el binario Drogon Preview. |
| Guías | Leídas las skills instaladas orca-cli/orchestration y sus guías completas servidas por este binario. Navigator 1.1.1 operativo, lectura determinista. |
| Worktree Orca actual | `06ca9545-81b7-43db-87f7-994c2796d7fe::/Users/carlos/Documents/Drogon-mentu-session`, identity `wt2:local:5a3689a6-b3f6-4257-885d-94c98f17ec14`. Los IDs del handoff anterior no deben reutilizarse a ciegas. |
| Registro proyecto | Actualmente declara `github:stablyai/orca`. Registrar y verificar el proyecto NUEVO por ruta/ID; no usar la inferencia de proyecto para crear ni publicar el rewrite. |
| AGY | Binario instalado; catálogo devuelve `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`. Propuesta: medium inicialmente. |
| Claude Code | 2.1.261 instalado. Control request `list_models` sin turno de inferencia confirma `sonnet` → `claude-sonnet-5`; soporta medium/high. El default de organización sigue en Sonnet 4.6: NO usar default. |
| OpenCode | Binario instalado; catálogo incluye `zai-coding-plan/glm-5.3-flash`. Lista de proveedores muestra credencial Z.AI Coding Plan configurada, sin leer su valor. No sustituir por OpenRouter, OpenCode Go o Z.AI general. |
| Rust | rustc/cargo 1.98.0 instalados. Esto no valida todavía PTY, empaquetado o cross-compilation. |

Existencia de binario/modelo/credencial NO demuestra autenticación efectiva, consumo del plan correcto ni lifecycle de un worker. No se hizo esa afirmación.

## Impedimento GitHub y migración de repositorios

GitHub no permite cambiar individualmente la visibilidad de un fork público. Referencia: https://docs.github.com/en/pull-requests/reference/forks . No intentar resolverlo borrando y recreando el repo, porque un mirror Git no conserva por sí mismo PRs/issues y demás metadatos.

Secuencia propuesta:

1. Inventario acotado y backup verificable del historial relevante, ramas/tags, PR1 y metadatos que deban preservarse. Mantener raw evidence local fuera del repo público nuevo.
2. Resolver separación de la red de forks mediante el mecanismo soportado disponible en GitHub; puede requerir intervención humana/soporte. Una copia independiente privada es una alternativa a discutir, no una sustitución silenciosa del repo existente.
3. Renombrar a `clioo/drogon-orca`, verificar identidad del repo y luego privacidad cuando esté desvinculado. Avisar que hacer privado no retira copias/commits ya públicos.
4. Crear `clioo/drogon` como repositorio independiente público, no fork. Recomiendo un monorepo con la app y la crate/binario `drogon-cli`, no dos repos desincronizados.
5. Actualizar remotes por repo ID y rutas explícitas. Crear el nuevo nombre rompe la utilidad del redirect viejo: verificar cada checkout y job antes de push. No publicar jamás con un remote inferido.

La fuente tiene licencia MIT, copyright Lovecast Inc. 2026. Conservar avisos en todo código reutilizado y registrar procedencia/revisión/licencia en THIRD_PARTY_NOTICES y en un inventario de migración. Auditar dependencias y assets por separado (incluidos retratos de personajes): la licencia del código no prueba permisos de imágenes. No reutilizar claves, cuentas, telemetría, servidores de update o servicios cloud de Orca como infraestructura propia.

## Stack elegido para validar en un corte vertical

- **Rust** para `drogon-core`, servicio `drogond` y binario **`drogon-cli`**. Tokio para I/O asíncrono, serde para contratos, clap para CLI, SQLite para persistencia transaccional. Fijar versiones tras el spike y medir, no prometer mejoras de rendimiento por cambiar de lenguaje.
- **Electron + React/TypeScript** para desktop. Reutilizar componentes, tokens, accesibilidad y estructura que ya funcionan. Mantener la solución de terminal/editor probada mientras se valida el límite PTY nuevo; no introducir a la vez un nuevo motor de UI.
- **Protocolo único versionado** compartido por CLI y app, con esquema que genere tipos TS y fixtures de contrato. IPC local con identidad/autorización del usuario; sockets Unix / named pipes Windows como propuesta a verificar. Remoto por canal autenticado/SSH, sin puertos públicos implícitos.
- **Un dueño del estado de ejecución por host**. CLI cliente del servicio, no otra base mutable paralela. SQLite local al host dueño, cola de escrituras; no compartir WAL sobre un filesystem de red.
- El renderer no controla procesos directamente: sandbox/contextIsolation, preload mínimo con operaciones tipadas y validación de emisor. Electron mantiene el ciclo de ventana; el servicio mantiene ejecución y reconexión.

Estructura propuesta, no creada:

```text
apps/desktop/          Electron + renderer reutilizado/adaptado
crates/drogon-core/    dominio, persistencia y lifecycle
crates/drogond/        servicio local/headless y transports
crates/drogon-cli/     comandos y salida JSON/humana
packages/protocol/    esquema y tipos generados
tests/contracts/      fixtures antiguos/nuevos y compatibilidad
tests/e2e/            recorridos CLI + Electron
skills/               guías de drogon-cli y orquestación
docs/migration/       paridad, procedencia, decisiones y evidencia
```

Referencias de elección técnica: https://tokio.rs/tokio/tutorial , https://www.electronjs.org/docs/latest/tutorial/security , https://www.sqlite.org/wal.html . La separación anterior es una decisión propuesta para este producto, no una garantía dada por esas tecnologías.

## Qué recuperar de Orca

Conservar/adaptar la experiencia de workspaces, sesiones, terminales/tabs, explorer/editor, diff/source control/checks, catálogo y reanudación de harnesses, skills, lifecycle de orquestación y evidencia. Recuperar los tests y edge cases, no solamente su apariencia.

Reescribir el núcleo de ownership, almacenamiento, servicio/CLI y protocolo por cortes verticales. SSH, folder workspaces, procesos huérfanos, reconexión, idempotencia, cancelación exacta y compatibilidad entre versiones son contratos del corte, no detalles a posponer hasta el final.

Mentu actual se conserva como adaptador a runtime fijado; no reescribir simultáneamente Mentu upstream. Se migra el recorrido que ya existe, pero el fix Qwen y benchmark v2 continúan pendientes hasta terminar la migración, como pidió el usuario. Bots/Meetings mantienen su estado honesto; la migración no los convierte mágicamente en features terminadas.

Inventariar móvil, billing, public sharing, servicios hosted y conectores que no sean necesarios para la demo como candidatos a diferir; no eliminarlos del alcance implícitamente. Deshabilitar superficies incompletas con explicación, no botones que simulan éxito.

## Orquestación: responsabilidades y comandos

Yo soy el coordinador: contratos, dependencias, revisión de evidencia, integración y decisión de aceptación. Orca proporciona estado/proveniencia, no decide ni agenda el DAG automáticamente.

Crear un **Run nuevo** para el rewrite, nunca reutilizar las Tasks ni autoridad del handoff bloqueado. Flujo: `run-create` → `task-create` para la ola → `worker-start` → verificar task/dispatch/launch → `check --wait` → leer reporte/diff/resultado real → responder preguntas → aceptar/rechazar → release/reusar terminal exacto → ack Delivery.

Cada Task lleva: objetivo acotado, archivos de propiedad, interfaces congeladas, tests, evidence path, criterios de éxito y exclusiones. Máximo inicial **tres workers hoja**, uno por harness. Nada de subagentes internos, Agent/Fork ni nuevos Runs para eludir profundidad. No ambos editores sobre el mismo archivo.

| Harness | Selección exacta | Propiedad principal | Revisión cruzada |
| --- | --- | --- | --- |
| AGY / Antigravity | `gemini-3.8-flash-medium` | Inventario/paridad, frontend Electron adaptado, fixtures visuales, documentación y experiencia de skills. | Ejercitar CLI contra casos de usuario y comparar UI. |
| Claude Code | `claude-sonnet-5`, medium; high en tareas críticas justificadas | Núcleo Rust, ownership/persistencia, procesos/PTY, recovery, límites de seguridad. | Revisar CLI/protocolo y pruebas adversariales. |
| OpenCode | `zai-coding-plan/glm-5.3-flash` | drogon-cli, contratos/serialización, adaptadores harness, tests de integración y packaging acotado. | Revisar núcleo/reconexión contra especificación. |

La distribución es por ownership, no por afirmaciones no medidas de que un modelo sea superior. Ajustarla según resultados del smoke y calidad comprobada. El coordinador posee cambios de esquema, lockfiles y wiring global para evitar carreras. Usar worktree compartido para rutas disjuntas; si dos tareas necesitan editar manifests/schema/lockfiles incompatiblemente, explicar el conflicto y usar worktrees aislados vía Orca con base explícita y política setup respetada.

Particularidad de la versión instalada: `worker-start --model/--effort` soporta Claude/Codex/Cursor, no AGY/OpenCode. Para Claude usar selección explícita por invocación. Para AGY/OpenCode, crear terminal en el workspace exacto con comando/modelo explícitos y adjuntarlo con `worker-start --terminal`; no combinar `--terminal` con `--model`. Propuesta de comandos de lanzamiento: `agy --model gemini-3.8-flash-medium`, `opencode --model zai-coding-plan/glm-5.3-flash`. No modificar defaults globales. El smoke deberá demostrar reconocimiento, inyección y ownership/retención real antes de confiar en esta ruta.

No llamar a `terminal send` una orquestación. No usar `dispatch --inject` como si tuviera cleanup supervisado: es una asignación unsupervised. Cuando una terminal creada previamente quede retained/no_owned_resource, registrar quién la creó y verificar identidad antes de cualquier limpieza.

Esperas acotadas con `check --wait`, no loops de sleep ni reinicio por timeout/TUI idle. Procesar toda la Delivery antes de ack, una sola aceptación por Task/Dispatch. worker_done viene del worker con sus IDs/capability reales; el coordinador no lo falsifica. Registrar failed como failed. Read-only reviews no autorizan al reviewer a corregir fuera de scope.

## Puertas de ejecución y validación

### P0 — prueba REAL de coordinación (smoke aprobado; fallo controlado y cancelación pendientes)

En fixture temporal sin datos privados ni repo productivo, cada uno de los tres workers debe leer un desafío, generar un artefacto diminuto, ejecutar un test determinista y enviar worker_done válido. El coordinador verifica contenido, salida, modelo efectivo cuando observable, Task/Dispatch y cleanup. Un caso incluye ask/reply; otro fallo controlado debe quedar como failed y no activar un duplicado. Probar cancelación sobre proceso propio, no sobre trabajo del usuario. No afirmar selección efectiva solo porque el modelo aparece en argv ni confiar en el nombre que escriba el agente.

PASS = tres rutas operativas y trazables; si una falla, arreglar esa ruta o reportar bloqueo, no sustituir provider/modelo. Durante construcción, los tres modelos aprobados sí pueden inferir; esto es independiente de la restricción Pi/Spark del benchmark Mentu posterior.

### P1 — contratos y repositorio

Inventario keep/reuse/rewrite/defer con escenario comprobable por capacidad; decisión de licencia/procedencia y ruta GitHub; esqueleto y CI; esquema de protocolo y tests de fallo versionados. Baseline de UI/CLI de Orca congelado. Evitar migrar todo el directorio runtime por copia sin saber sus dependencias.

### P2 — corte vertical completo

Desde Drogon Electron y desde drogon-cli: registrar folder/repo → abrir terminal → lanzar un harness real → observar salida/estado → cerrar/reabrir UI y reconectar → cancelar exactamente esa sesión → comprobar persistencia y ausencia de procesos huérfanos. El mismo contrato debe funcionar headless sin Electron. Si este corte no pasa, no paralelizar todas las features sobre una base inestable.

### P3 — olas paralelas

Núcleo (Sonnet), CLI/adapters (GLM) y desktop (AGY) avanzan por interfaces aprobadas. Capas de Git/workspaces/skills/orquestación y superficies de sesión se aceptan con sus casos de paridad. Cada ola termina en build integrable y revisión cruzada; DAG poco profundo por ola, no un megacommit de tres ramas al final.

### P4 — aceptación de migración

- Rust: tests, clippy/fmt, contratos y tests de concurrencia/crash/restart/migración de schema.
- CLI: JSON estable, errores/exit codes, idempotencia, límites/truncación y ausencia de secretos; fixtures diferenciales contra comportamiento preservado de Orca. Las diferencias intencionales quedan documentadas, no se clonan bugs.
- Desktop: Electron skill + Playwright CDP, screenshots y recorridos reales; accesibilidad/teclado, foco, terminal resize, dark/light y no referencias visibles antiguas fuera de avisos legales.
- Seguridad: IPC con identidad/versiones, privilegios acotados, no secretos en logs, confirmaciones de acciones destructivas, stop ligado al proceso exacto.
- Local y SSH: desconexión no implica muerte (`live`/`unverifiable`/`exited`), reconexión y compatibilidad mixta. macOS, Linux y Windows con evidencia por plataforma; no llamar cross-platform a un pase local macOS.
- Paquete: build reproducible, runtime incluido, identidades/paths aislados de Orca, instalación/arranque/reinicio real, sin usar feed de updates upstream ni modificar datos viejos. Soporte de rollback/migración explícita y backup; nunca abrir la base antigua como si fuera la nueva.
- Rendimiento: baseline medido de arranque, RAM, latencia de terminal y concurrencia; umbrales fijados antes de comparar, no números escogidos después.

### P5 — dogfooding y retorno al handoff

Usar **Drogon Electron + drogon-cli** para lanzar, supervisar y cerrar una ola real que antes coordinaba Orca. La orquestación debe sobrevivir a un reinicio de UI y producir la misma evidencia/lifecycle; solo entonces deja de necesitar Orca como herramienta de construcción. Sin delegar ocultamente a orca-cli en la versión final.

Después retomar pendientes Mentu/Bots/Meetings y comparación con/sin Mentu exclusivamente Pi + DGX Spark, conservando resultados v1 fallidos. Migración lista ≠ todas las features pendientes terminadas.

## Estado histórico al entregar la primera versión del plan

Única escritura: este documento local. Sin commit/PR nuevo, sin cambio de visibility/nombre, sin nuevos workers ni inferencia experimental, sin reactivación del goal antiguo. Preflight de discovery completado; aprobación técnica del transporte multiagente y validación de producto NO se han obtenido todavía. Próximo paso concreto: P0, no comenzar el rewrite masivo ni tocar repos antes de resolver las puertas descritas.

Este párrafo describe la primera entrega, no el estado actual. Ver [resultados del ambiente y las ejecuciones](preflight-results.md).
