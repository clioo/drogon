# Drogon: handoff para cinco verticales independientes

Preparado para Carlos el 7 de septiembre de 2026. Documento operativo de
planificación y transferencia; **no crea ramas, worktrees, agentes ni cron, no
autoriza un merge y no declara terminada la migración**. Snapshot local de refs y
borradores: aproximadamente 08:25 UTC. Los workers existentes conservan sus
asignaciones hasta su entrega estable.

## 1. Decisión recomendada

Sí: cinco ramas y cinco worktrees, con un agente responsable por vertical y
entregas pequeñas. No: cinco implementaciones independientes de los contratos
comunes ni esperar hasta el final para descubrir incompatibilidades.

Las cinco áreas históricas del audit fueron E1 interfaz, E2 settings, E3
bridge/servicios, E4 CLI y E5 plataforma/publicación. **No eran cinco verticales
de implementación**: E3 concentraría casi todo el motor y E1/E2 se disputarían
el renderer. Este documento redistribuye sus obligaciones en cinco frentes
con superficies completas y propiedad de archivos.

| Vertical | Resultado del que responde | Rama propuesta |
|---|---|---|
| V1 Motor y CLI | Ejecución, sesiones, harnesses y orquestación nativa sin Orca debajo | `codex/vertical-01-runtime-cli` |
| V2 Escritorio y preferencias | Shell fiel, navegación, terminales, ventanas, settings y teclado | `codex/vertical-02-desktop-settings` |
| V3 Workspaces y conectividad | Archivos/editor, Git/review, SSH/WSL remoto, browser, relay/mobile | `codex/vertical-03-workspaces-remote` |
| V4 Capacidades e integraciones | Bots, automations, Mentu, Meetings, chat, skills, plugins y proveedores | `codex/vertical-04-capabilities` |
| V5 Plataforma y entrega | Sistemas operativos, instalación, CI, notices, recursos, privacidad y evidencia de release | `codex/vertical-05-platform-release` |

La integración es un **rol**, no una sexta vertical de features: Carlos o un
coordinador revisa y combina checkpoints de las cinco. V5 mantiene las herramientas
y prepara paquetes; solo el integrador publica/instala el candidato combinado.
Las ramas anteriores son propuestas, todavía no creadas.

Recomiendo una cola de integración por checkpoint verde: revisar cada 30–60 minutos
cuando haya entregas, y hacer aceptación integrada antes de promover. No es una
promesa de duración de los tests. Un cron puede avisar de nuevas entregas/fallos,
pero no debe resolver conflictos, aprobarse a sí mismo ni instalar automáticamente.
No configurar un cron hasta que Carlos elija cadencia y responsable.

## 2. Qué significa terminar

La meta sigue siendo el producto completo, no un MVP de terminales: Rust
core/service/CLI independientes, Electron/React conservando todas las capacidades
enumeradas de Orca y las adiciones Drogon ya implementadas. Referencias normativas:
[plan de paridad](rewrite-parity-plan.md), [objetivo completo](rewrite-parity-goal.md)
y [objetivo inicial](rewrite-goal.md). Sus párrafos históricos sobre organización,
modelos y pausa deben leerse con las decisiones posteriores, no como instrucciones
para relanzar Sol, Pi o un audit ya cerrado.

- Preservar local/SSH/WSL, folder/Git, versiones cliente-servidor mixtas,
  persistencia, recuperación, errores, accesibilidad y plataformas.
- La pérdida de contacto significa `unverifiable`, nunca `exited`; el host de
  ejecución conserva autoridad sobre procesos, archivos y comandos.
- Conservar el diseño original con procedencia/licencias. No copiar credenciales,
  destinos de telemetría, update feeds, conversaciones ni marcas sin autorización.
- Preservar Bots/Mentu/Meetings ya existentes **durante** la migración. Solo los
  pendientes que ya lo eran van después; un registro almacenado no demuestra
  scheduler, ejecución, adaptador reactivo o UI funcional.
- Dogfood final: una tarea real coordinada mediante Drogon y su CLI/daemon, con
  artefacto revisado, fallo/reintento y cierre exacto. Invocar Orca por debajo no
  satisface independencia.
- La comparación con/sin Mentu sigue siendo un gate posterior, Pi + DGX Spark,
  condiciones equivalentes y uso real de tokens; no fallback/juez cloud ni nueva
  feature obligatoria de `inference_budget`. Pi está suspendido hasta reactivación
  explícita; no iniciar ese experimento desde este handoff.

El objetivo original de 24 horas ya fue excedido. La posterior ventana termina
el 7 de septiembre a las 13:49:44 UTC; es una meta de entrega, no garantía de que
todo el alcance quepa. Véase [ventana y política vigente](eight-hour-execution-window.md).
No reducir alcance ni aceptar evidencia más débil para cumplir el reloj.

## 3. Estado real del audit y del producto

### Fuente congelada y denominadores

Referencia autorizada de solo lectura: `/Users/carlos/Documents/Drogon-mentu-session`,
commit `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, fork preservado
`clioo/drogon-orca`. No ejecutar tests con ese directorio como cwd: incluso los
runners supuestamente read-only generan caches. Usar capsules aisladas existentes.

| Evidencia | Estado y límite |
|---|---|
| Índice estable del audit | 11/12 = 91.7%, confianza media a nivel de caracterización de fuente; M1–M7 y E1–E4 aceptados, E5 abierto |
| Inventario de archivos | 9,038 entradas, 9,037 paths únicos; un `Package.swift` byte-idéntico tiene dos roles, se asigna una vez |
| Paquetes de asignación | 46, sin omisiones/duplicados en el reparto aceptado; no son 46 tareas pequeñas ni 46 capacidades verificadas |
| E1 | 152 obligaciones iniciales, 22 contratos finales más límites previos, 50 features y 19 invariantes preservados |
| E2 | 214 campos; 187 defaults; 88 acciones de teclado; 13 contratos de persistencia y 16 límites de shortcuts |
| E3 | 47 grupos asignados + Mentu reutilizado; 615 métodos RPC, 66 callbacks main, 96 pushes (94 productores conocidos y 2 legacy desconocidos) |
| E4 | 234 comandos canónicos, 22 contratos de helpers y 30 límites finales; no confundir con los 18 métodos de la primera coordinación nativa |
| Producto | Shell local de workspaces/terminal/harness útil, pero paridad completa sin aceptar; muchas superficies todavía ausentes |

El porcentaje anterior **no mide producto, tests, pantallas ni esfuerzo restante**.
Autoridades: [progreso](audit-progress.md), [E3 final](e3-final-composition.md),
[ledger JSON](parity-audit-gate-ledger.json). El Markdown del ledger y algunos
reports conservan 10/12 o instrucciones antiguas; prevalecen revisiones finales
del coordinador y decisiones posteriores, sin reescribir evidencia histórica.

### E5: bloqueo de publicación, no de todo el desarrollo

[Decisión técnica/publicación](audit-to-sol-decision.md) registra autorización
para trabajo técnico independiente mientras E5 sigue abierto. Permanecen:

- AO-RIGHTS: procedencia y autorización de recursos/marca; no sustituir o publicar
  imágenes/branding por iniciativa del agente.
- AO-RECORDINGS: procedencia, consentimiento y privacidad de grabaciones faltantes.
- AO-NOTICES: notices correspondientes a los bytes realmente distribuidos;
  una lista de paquetes no equivale a inspección del paquete final.
- AO-SERVICE: operador, endpoints, región, retención y política de datos/servicios.
  No desplegar servicios ni enviar datos reales para resolver este punto.

V5 prepara decisiones concretas para Carlos. V3/V4 pueden implementar con fixtures
y contratos aislados; las integraciones reales siguen sin verificar mientras no
haya entorno/autorización. Referencias: [E5 final](e5-final-root-review.md),
[publicación](e5-publication-root-review.md), [fuentes/font notices](e5-font-provenance-review.md),
[paquetes/notices](e5-package-notice-review.md), [Seti](e5-seti-root-review.md),
[localización generada](e5-generated-localization-root-review.md).

### Audit UX adicional del preview: no confundirlo con el audit de origen

Un coordinador separado está auditando el candidato `252de85c`. Su
[reporte local provisional](/tmp/drogon-ux-parity-audit-252de85c2fd2/report.md),
[matriz de hallazgos](/tmp/drogon-ux-parity-audit-252de85c2fd2/matrix.md),
[matriz JSON](/tmp/drogon-ux-parity-audit-252de85c2fd2/matrix.json) y
[crosswalk de 50 IDs](/tmp/drogon-ux-parity-audit-252de85c2fd2/coverage.json)
deben incorporarse al paquete durable de handoff tras su cierre y revisión de
privacidad. Son paths locales temporales: **no asumir que existen en otra máquina**.
El reporte se declara ensamblado y pendiente de validación final/lifecycle.
Sus 86 filas (43 P1, 28 P2, 15 NIT) mezclan faltantes, contratos y problemas;
no son 86 bugs ejecutados. Doce detalles interiores siguen explícitamente sin
leer/ejecutar. Un `defer` del auditor no autoriza retirar una feature.

Dos fallos de navegación sí están reproducidos mediante CDP real:

1. `UX-NAV-ACTIVE-WORKSPACE`: pulsar el workspace ya seleccionado oculta su tab
   vivo (1 → 0), aunque el backend conserva la misma sesión `live`. El click
   limpia estado sin cambiar la dependencia que lo recarga. No prueba pérdida
   de datos o muerte del proceso.
2. `UX-NAV-RESTORE-WORKSPACE`: seleccionar la segunda carpeta y recargar vuelve
   a la primera; la selección no se persiste. Las sesiones sí sobreviven.

Dueño V2. [Revisión independiente y reproducción](/tmp/drogon-ux-parity-audit-252de85c2fd2/workers/navigation-review.md).
El run `desktop-1788767241615-bd578f1a-4f4a-4650-b1a2-3d58a534db32` conservó
14 checks positivos, falló estas dos expectativas y cerró sus procesos propios.
Las capturas/driver están bajo `harness/.preflight/acceptance/` y `harness/scripts/`
del directorio del audit; conservar los originales antes de limpiar `/tmp`.
La expectativa de selección tiene evidencia de contrato fuente, no una ejecución
completa nueva del persistence plumbing original.

El paquete auditado declara source `dc12c7ab4c8a5b82802da5f54dcc17824f9eb90f`,
árbol idéntico al merge `252de85c2fd28bbdc4c09c70c16063a0c7eb901e`;
seal v3 `320ab38c3e0fc4371532e0e59c82b3fa22dcc618c07332c942819eccdd59a7f9`,
293 entradas / 307543311 bytes. Es distinto del paquete histórico `ebbbb58`
descrito en [aceptación integrada](packaged-integrated-acceptance.md).
No relabelar receipts ni sumar ejecuciones repetidas como cobertura nueva.

## 4. Base y trabajo en curso: preservar antes de redistribuir

### Base común recomendada

Usar `252de85c2fd28bbdc4c09c70c16063a0c7eb901e` como **base de producto conocida**;
la ref local `origin/main` y el checkout limpio `final-audit` coinciden con ella
en este snapshot. No se hizo fetch para certificar el remoto en este documento.
No usar el viejo `0f915cf` ni el branch de integración antiguo como latest main.

Antes de crear las cinco ramas, el integrador prepara sobre esa base un commit
solo de handoff/contratos de propiedad (este documento, copias de audits
necesarios y extensión de interfaces acordada), registra su SHA completo y lo
publica como base común. No necesita esperar a que toda la coordinación nativa
esté completa. **No publicar este worktree entero como base**: contiene código
candidato y borradores. V1 adopta después los commits nativos revisados mediante
un PR explícito; V2/V3/V4 pueden portar tests y construir sus módulos contra
contratos congelados mientras tanto.

### Inventario local de transferencia

Rutas bajo `/Users/carlos/orca/workspaces/Drogon-rewrite/`, salvo donde se indica.
SHAs cortos son localizadores; resolver SHA completo, status y relación de commits
antes de adoptar. Estar committed no equivale a estar integrado o aceptado.

| Checkout / branch | HEAD observado | Contenido y destino |
|---|---|---|
| `final-audit` / `clioo/final-audit` | `252de85c` | Snapshot limpio del producto auditado; pertenece al audit separado, no reutilizar para edición |
| `codex-native-coordination-contract` / `codex/native-coordination-contract` | `ae066d9` | Candidato agregado de contratos/auth/run/task/worker/CLI; V1 revisa y adopta; no capability nativa anunciada |
| `codex-native-coordination-cli` / `codex/native-coordination-cli` | `e96f272` | CLI y source baselines; test `native_worker_lifecycle.rs` sin commit; conservar directorio de manifests parciales |
| `codex-native-coordination-auth` / `codex/native-coordination-auth` | `3c290ba` | Mail/questions candidato; seis archivos dirty bajo revisión, no incorporados al agregado |
| `codex-native-coordination-store` / `codex/native-coordination-store` | `c8fcde7` | Store corregido con 13 regresiones; ya incorporado al agregado, no duplicar cherry-pick |
| `codex-service-quiescence` / `codex/service-quiescence` | `4571eef` | Trabajo previo; verificar ascendencia, no reimplementar por aparecer como branch separado |
| `/Users/carlos/Documents/Drogon-rewrite` / `codex/rewrite-foundation` | `0f915cf` | Checkout histórico con cambios preservados; no tomar sus dirty files como nueva fuente canónica |

La ruta `codex-integration-main-checkpoint` **ya no existe** en el inventario
de disco comprobado; su ref Git permanece en `06e7616`. Las rutas antiguas de
[main-checkpoint](main-checkpoint.md) son históricas, no ubicaciones garantizadas.
No recrear/eliminar nada por inferencia ni modificar el checkout de otro agente.

En `contract` se observaron además `lib.rs` modificado y los nuevos
`coordination_receipts.rs` / `tests/native_receipt_recovery.rs` sin commit:
preservar como WIP del coordinador. Este documento no acepta ni transfiere esos
archivos. Inspeccionar estado de nuevo al iniciar la migración de ownership.

### Qué estaba en marcha al pedir este documento

- GLM, Task `task_cba4da2b53f4`, Dispatch `ctx_8b647bda4bd0`: pruebas reales de
  lifecycle en el checkout CLI. Entregar tests/procedencia/RED, no tocar producción.
- Sonnet, Task `task_00b11351c12d`, Dispatch `ctx_fb31d67c59a3`: cerrar límites
  residuales de mail en auth. Comprobar presupuesto de envelope + ACK acumulado,
  primera fila sobredimensionada y validación de replay/recipient/orden/max-sequence.
- Audit separado, Run `run_376bf45d5703`, coordinador
  `term_28e6bd9d-f911-4d8a-a765-577dcab19453`: fuente/candidato read-only;
  pedir entrega final, no cancelar ni apropiarse de sus agentes.

Estos son identificadores de transferencia y último estado observado, no prueba
de que el proceso continúe activo ahora. Antes de abrir cinco agentes, consultar
estado exacto, dejar terminar el encargo actual, recoger diff/tests/pendientes,
settle/release mediante Orca y transferir ownership expresamente. Un terminal
retenido o `unverifiable` no autoriza force-close. No crear otra tarea para la
misma corrección mientras el dueño existente escribe.

### Alcance del candidato nativo, sin exagerarlo

[Contrato](native-coordination-contract.md), [wire](native-coordination-wire-freeze-proposal.md),
[source gate](native-coordination-source-gate.md), [run/task](native-run-task-domain.md),
[auth](native-coordination-auth-implementation.md), [worker candidato](native-worker-engine-candidate.md),
[CLI](native-coordination-cli-implementation.md) y [siguiente ola](next-wave-contract.md).

Se aceptaron 51 casos de baseline original aislado para siete familias de
coordinación; no son 51 casos del motor candidato. El store corregido tiene 13
regresiones; run/task pasó 15 pruebas de Engine y después 16 al añadir history;
la CLI pasó 167 casos. Son snapshots de suites distintas, no totals acumulables.
History paginado y lectura terminal de 64 KiB funcionan en pruebas acotadas;
transcripts de proveedor, mailbox/report completo, cierre de preguntas,
configuración CLI emitida por daemon y reuse de sesión siguen pendientes.
El launch/stop/release candidato necesita pruebas PTY, fallos de receipts,
reinicio, retry y cancelación histórica; un stop viejo no debe bloquear su
reemplazo. No hubo tarea real de modelo orquestada por este candidato ni nuevo
preview instalado. La capability debe seguir apagada hasta completar su contrato.

## 5. Reglas para evitar conflictos

### Propiedad común

El integrador aplica cambios finales en `Cargo.toml`, `Cargo.lock`, los manifiestos
JS y lockfiles, `.github/**`, `crates/drogon-protocol/**`, registros centrales
de módulos/RPC y migrations. V1 es dueño técnico del protocolo/core; V5 de
manifiestos/CI. Los demás entregan un diff mínimo de wiring separado, no editan
esos archivos a la vez. Esta propiedad no autoriza al integrador a rediseñar
features sin consultar al dueño.

Excepciones necesarias a propiedad por carpeta:

- V1: `crates/drogon-core/**`, salvo `bots/**`, `automations/**` y los módulos
  de dominio de V3/V4 registrados abajo. `lib.rs`/`db.rs` se integran centralmente.
- V2: renderer común, `App.tsx`, `main.tsx`, terminales, `assets/main.css`,
  `components/ui/**`, `app-shell/**`, preferencias y navegación. Es el único
  dueño técnico de los puntos de montaje; los demás entregan componentes exportados.
- V3: `crates/drogon-core/src/workspace.rs` y nuevos módulos descriptivos de
  files/Git/remote/browser; renderer `features/workspaces/**`, `features/editor/**`,
  `features/source-control/**`, `features/browser/**`, `features/remote/**`.
- V4: `crates/drogon-core/src/bots/**`, `automations/**`, nuevos módulos de
  Mentu/meetings/integrations/plugins/chat; renderer `features/bots/**`,
  `features/automations/**`, `features/mentu/**`, `features/meetings/**`,
  `features/integrations/**`, `features/plugins/**`, `features/native-chat/**`.
- V5: `scripts/package-*`, `scripts/install-preview.mjs`, `scripts/desktop-artifacts*`,
  `scripts/preview-install-lock*`, herramientas y runners de aceptación/build;
  `apps/desktop/src/main/build-info*`, `daemon-path*`, `native-runtime-bootstrap*`.
  El cliente nativo de main y transporte/auth son V1; ventana/UX de main es V2.

Las carpetas `features/*` son destinos propuestos **nuevos**, no módulos que ya
existan. Antes de crearlos, buscar implementación reutilizable y registrar el
path concreto en la tarjeta. Fuera de esta lista no hay permiso implícito:
añadir una entrada de propiedad antes de editar. V3 controla relay/mobile y V4
integraciones cloud de producto; V5 no construye una segunda implementación.

Cada vertical escribe sus informes en `docs/migration/verticals/VN/**` y pruebas
en su paquete asignado. Los audits/base fixtures ya admitidos quedan congelados.
`tests/parity/ports/WP-ENG-RUNTIME/package-admission/**` es excepción existente
propiedad V5, aunque el resto de WP-ENG-RUNTIME corresponda a V1.

### Interfaces que se congelan en el arranque

No son nuevas APIs declaradas implementadas: son decisiones que deben fijarse en
un commit pequeño de seed, reutilizando el protocolo actual primero.

| Límite | Dueño / consumidores | Acuerdo exigido |
|---|---|---|
| Ejecución | V1 → V2/V3/V4/V5 | host/session/incarnation, liveness, cancel/release, errors, límites de bytes, capabilities |
| Workspaces/files/Git | V3 → V1/V2/V4 | identidad folder/Git + host, validación paths, lectura/escritura/errores, mutación segura |
| Rutas y paneles | V2 ← V3/V4 | props tipadas, descriptor de ruta, foco, estado persistido y cleanup; un solo montaje de App |
| Persistencia | dueño de dominio → integrador | versión/migration ordenada, restore/rollback, compatibilidad; no segundo almacén JSON paralelo |
| Automatización | V4 ↔ V1/V3 | schedule/trigger → dispatch con host explícito, resultado distinto de éxito de trabajo, sin ownership inventado |
| Paquete/servicio | V5 ↔ V1/V2 | versión/capability, bootstrap sin reemplazar servicio vivo, seal/receipt, rollback |

Los nuevos métodos se añaden por módulos de dominio, no duplicando enums/clientes
por vertical. Cambios de wire requieren revisión de cliente viejo/host nuevo y
viceversa; campos opcionales pueden ser aditivos, nuevos opcodes necesitan
negociación. Un stub debe rechazar con `unsupported`, nunca inventar éxito.
Los tests contra fixtures permiten avanzar; no habilitan aceptación E2E.

Si una interfaz falta: abrir una petición acotada con forma, consumidor, error y
test; mientras se resuelve, avanzar en tests/fixtures o componentes de otro
checkpoint. No esperar a que otra vertical termine todo su backlog ni construir
un backend paralelo para evitar una consulta.

## 6. Tarjetas de las cinco verticales

### V1 — Motor, harnesses, coordinación y CLI

**Misión:** servicio y CLI nativos operables, durable/seguro, con amplitud de
harnesses y todas las obligaciones E4; 18 métodos iniciales no cierran Orca.
Posee `crates/drogon-orchestration/**`, `crates/drogon-harness/**`,
`crates/drogon-cli/**`, `crates/drogond/**` y core conforme a las excepciones.
V5 propone implementación OS en server/endpoint, V1 integra el host authority;
no dos escritores simultáneos en esos archivos.

Lectura específica:
[E4 final](audit-closure/e4-cli/followup-final-boundaries.md),
[E4 report](audit-closure/e4-cli/report.md),
[argumentos CLI](parity-cli-argument-contract.md),
[terminales CLI](parity-cli-terminal-contracts.md),
[harness catalog](parity-harness-catalog.md),
[runtime E3](e3-runtime-root-review.md),
[proveedores/runtime](e3-provider-runtime-root-review.md),
[autoridad de sesión](native-session-authority-contract.md),
[quiescence](service-quiescence-contract.md), más todos los documentos nativos §4.

Primeras entregas:

1. Transferir WIP de coordinación; reproducir y cerrar cancelación de intento
   histórico, mail/ACK y receipts; tests concurrentes/rollback/reopen reales.
2. Integrar daemon → actor/auth → Engine → store/mail → CLI; emitir contexto
   acotado al worker, revocar sin filtrar secretos, completar report/reply/recovery.
3. Tarea fixture real con un modelo aprobado, resultado inspeccionado, retry y
   late-report rechazado, release exacto; después cerrar comandos/harnesses
   restantes por familias, no declarar paridad global tras el dogfood.

Gate: pruebas de dominio + Engine + daemon/CLI reales; salida JSON/humana y
exit codes; report guardado con respuesta perdida; no doble spawn; scopes y
generaciones; handles retenidos cuando sea necesario; no lock sobre I/O.
Los 36 elementos del catálogo harness requieren preservar su clasificación:
una diferencia con el registro especial no significa 26 harnesses faltantes.

### V2 — Escritorio, navegación y preferencias

**Misión:** UX fiel y usable, no un rediseño. Posee shell/window/tab/pane,
terminal renderer, menús/foco/shortcuts, settings, theme, localización UI,
onboarding/tips/pets/dashboard y montaje común. Las pantallas de V3/V4 se
integran aquí sin que V2 reimplemente su lógica de dominio.

Lectura específica:
[E1 report](audit-closure/e1-ui/report.md),
[E1 cierre](audit-closure/e1-ui/followup-final-source-gaps.md),
[navegación web](audit-closure/e1-ui/followup-web-navigation.md),
[cards](parity-ui-capability-cards.md),
[superficies restantes](parity-ui-remaining-surface-cards.md),
[E2](audit-closure/e2-settings/report.md),
[field routing](parity-settings-field-routing.md),
[consumers](parity-settings-consumers.md),
[persistencia](parity-settings-persistence-contracts.md),
[shortcuts](parity-settings-keybindings.md),
[checkpoint renderer](renderer-checkpoint-dependency-contract.md).

Primeras entregas:

1. Corregir los dos fallos de navegación §3 con RED de comportamiento, restore
   por host/workspace y prueba real CDP manteniendo sesión/incarnation.
2. Shell/nav/panes y contrato de montaje para V3/V4; recuperar settings/tema y
   shortcuts con mapa exacto de campos, defaults, persistencia y consumidores.
3. Completar terminal/layout/detach/search, estados vacíos/error/recovery y
   matrices visuales/interactivas; onboarding/dashboard y resto del censo E1/E2.

Gate: `$electron` + Playwright CDP, no computer-use para validar Orca. Fuente y
candidato con mismo viewport/DPR/tema/locale/fixture; capturas + interacción,
teclado/foco/IME donde aplique. No aceptar snapshots automáticamente.
El rewrite carece de `docs/STYLEGUIDE.md` en la base auditada: leer la guía
fijada en el fork autorizado y reutilizar sus tokens/primitivos, registrando
el traslado con procedencia; no inventar otro sistema visual. `CmdOrCtrl` y
labels por plataforma, nunca `e.metaKey` hardcodeado para todos.

### V3 — Workspaces, archivos/editor, Git y conectividad

**Misión:** trabajo útil local/remoto de punta a punta, incluidas sus pantallas.
Posee workspace/file/editor/Git/review/browser, SSH/WSL routing, ports,
remote-runtime/relay/mobile/cloud de conectividad. Los issue/account providers
son V4; V3 consume su contrato en worktree/task/review journeys.

Lectura específica:
[runtime/remote E3](e3-runtime-root-review.md),
[window/browser authority](parity-window-browser-authority.md),
[mobile methods](parity-mobile-method-review.md),
[relay wire](parity-relay-mobile-wire-contracts.md),
[relay composition](parity-relay-registration-composition.md),
[remote ENOENT](parity-remote-enoent-contract.md),
[transport baseline](remote-runtime-transport-source-baseline.md),
[admission baseline](remote-runtime-admission-source-baseline.md),
[shared-control recovery](shared-control-recovery-source-baseline.md),
[CLI workspaces](parity-cli-workspace-contracts.md), y cards E1 de sus pantallas.

Primeras entregas:

1. Folder/Git explorer + editor con lectura/guardado/error/restore contra core
   real; no asumir que todo workspace es worktree ni mutar fuera de fixture.
2. Status/diff/stage/commit y creación segura de worktrees, checks/review y
   proveedores genéricos; integrar comandos con V1 y UI con V2.
3. Host routing SSH/WSL, reconnect/version skew y Git remoto; browser/ports y
   relay/mobile completos con escenarios compartidos. Se pueden portar sus
   tests desde el primer checkpoint; no esperan la implementación local entera.

Gate: Git 2.25 baseline y fallbacks por host/capability, GitHub/GitLab y demás
providers explícitos; error/disconnect sin fallback a local; path traversal,
symlinks y publicación parcial; remote output/cancel y versiones mixtas.
Consultar referencias originales `ssh-execution-boundary.md`,
`remote-wire-compatibility.md`, `git-compatibility.md` y
`wsl-command-execution.md` antes de esos cambios. Tests fake-network no sustituyen
una ejecución SSH/WSL real. No provisionar cloud/relay sin decisiones E5.

### V4 — Bots, Mentu, Meetings y capacidades conectadas

**Misión:** preservar los flujos completos ya existentes y separar los pendientes
históricos. Posee storage y ejecución de Bots/automations, Mentu, Meetings/speech,
integraciones/account-provider/skills/plugins/native-chat/device y sus paneles.
Reutiliza spawn/sesiones/CLI de V1 y workspace/host/files de V3, nunca otro daemon.

Lectura específica:
[Bots state](native-bot-state-contract.md), [Bots input](native-bot-input-contract.md),
[Bots admisión](bot-state-admission.md),
[Bots/Mentu E3](audit-closure/e3-bridge/followup-bots-mentu.md),
[Drogon UI state](parity-drogon-ui-state-contracts.md),
[integraciones corregidas](e3-integrations-correction-root-review.md),
[account launch](e3-account-launch-root-review.md),
[provider inputs](e3-provider-inputs-root-review.md),
[skills catalog](parity-skill-provider-catalog.md),
[speech](parity-speech-catalog.md), [E5 speech qualifications](e5-final-root-review.md).

Primeras entregas:

1. Bots + schedule/trigger/history e interfaz, con host fencing de automations;
   estado durable no cuenta como ejecución. Preservar constraints/migrations
   admitidos y distinguir receipt idle/completed del resultado de la tarea.
2. Mentu panel/workbench/review/execute/evidence/retry, sesiones y quarantine;
   no convertir run records en supuestos registros del Commitment Protocol.
3. Meetings/transcripts/Q&A/availability y separación de speech; después cerrar
   native-chat, plugins/skills/accounts/artifacts/integraciones restantes por
   tarjetas. Preparar tests de todas las familias desde el inicio.

Gate: journeys positivos/negativos/reload con runtime real donde autorizado,
sin inventar botones de grabación o adaptadores que eran pendientes del origen.
Revisar explícitamente reactive responsibilities, authoring/inspection de triggers,
flush barriers, delegation UI, proactive responsibilities, recipe-81/90 y
shared-spaces: lo pendiente se conserva como pendiente, no desaparece.
Mentu upstream: propuesta estrecha, tests y rationale en inglés; PR/publicación
es responsabilidad del coordinador, probar revision local fijada sin esperar merge.
No acceder a micrófonos/grabaciones/cuentas reales ni usar secretos de origen
para demostrar éxito. Timeout de speech no demuestra exit físico.

### V5 — Plataformas, test infra, empaquetado y release

**Misión:** que lo construido por las otras cuatro se ejecute y distribuya con
pruebas honestas en sistemas soportados. No relegarla a «hacer packaging al final».
Posee runners/capsules, plataforma nativa propuesta, installer/update/deep-link,
CI/build, notices/recursos, diagnóstico/redacción y política de servicios.
Coordina cambios de runtime OS con V1 y consumer/UI con V2.

Lectura específica:
[build/distribution](parity-build-distribution-entrypoints.md),
[runner matrix](parity-runner-execution-matrix.md),
[Windows runner](parity-windows-render-runner.md),
[platform gaps](parity-platform-gap-reconciliation.md),
[packaged acceptance](packaged-integrated-acceptance.md),
[package identity](packaged-identity-admission.md),
[cleanup](packaged-quiescent-cleanup-admission.md),
[preview lock](preview-install-lock-admission.md),
[diagnostics/tray](parity-diagnostic-tray-contracts.md), E5 §3 y
[test porting](parity-test-porting.md).

Primeras entregas:

1. CI reproducible y soporte native IPC Windows con auth/same-user y lifecycle
   real, más Linux runtime; green compile Windows no significa runtime soportado.
2. Runners y acceptance de integración por vertical + paquete combinado,
   recursos/locales/notices exactos y cierre verificable de los gaps de inventario.
3. Build firmado según entorno, seal completo, instalación versionada/rollback,
   upgrade/uninstall/service cleanup y matrices OS; preparar decisiones E5 sin
   asumir aprobación. La falta de un runner queda `unverified`.

Gate: actual Windows/Linux/macOS donde aplique, glibc 2.31 para módulos Linux,
argv/paths/ACL Windows, runner `.cmd`/EDR/WSL conforme a las referencias fuente;
no process enumeration por PowerShell ad hoc. Paquete real con notices y bytes
probados; conservar archivos/datos/build anterior y daemon vivo. No force-close
para que un installer pase. V5 no instala una branch parcial como release común.

## 7. Reparto exhaustivo de los 46 paquetes existentes

Esta tabla cambia **ownership de implementación**, no el censo original, hashes,
assertions ni dependencias. [JSON original](parity-test-work-packages.json) sigue
siendo evidencia histórica `proposal/dispatchable:false`; su antigua plantilla
de tres Sol no es el nuevo plan. No modificarlo para aparentar ejecución.
Los IDs de la tabla son verificables contra sus 46 entradas.

| Vertical | Paquetes asignados |
|---|---|
| V1 | WP-ENG-RUNTIME, WP-ENG-SHARED, WP-ENG-IPC, WP-ENG-SHELL, WP-ENG-HARNESS, WP-ENG-DAEMON, WP-ENG-AGENTSVC, WP-ENG-CLI |
| V2 | WP-UI-TERM, WP-UI-STATE, WP-UI-SHELL-NAV, WP-UI-SHELL-WIN, WP-UI-SETTINGS, WP-UI-PANES, WP-UI-DASH, WP-UI-CORE, WP-UI-PRELOAD, WP-UI-JOURNEYS |
| V3 | WP-UI-WORK, WP-UI-EDITOR, WP-UI-BROWSER, WP-ENG-REMOTE, WP-ENG-BROWSER, WP-ENG-RELAY, WP-ENG-GIT, WP-ENG-CLOUD, WP-CAP-MOBILE |
| V4 | WP-UI-AUX, WP-UI-AUTO, WP-UI-NCHAT, WP-ENG-NCHAT, WP-ENG-PLUGINS, WP-CAP-BOTS, WP-CAP-MENTU, WP-CAP-MEET, WP-CAP-AUTO, WP-CAP-INT, WP-CAP-DEVICE |
| V5 | WP-ENG-NATIVE, WP-ENG-INSTALL, WP-CAP-DIAG, WP-SUP-CONFIG, WP-SUP-CI, WP-SUP-SCRIPTS, WP-SUP-ASSETS, WP-UNRESOLVED-01 |

8 + 10 + 9 + 11 + 8 = 46. WP-ENG-SHARED tiene dueño técnico V1 pero aplicación
central; WP-SUP-* dueño técnico V5 pero archivos globales centrales. Algunos
buckets UI mezclan features de V3/V4: el dueño del bucket conserva su obligación
y transfiere subpaths de test concretos por escrito antes de otro writer.
No asignar todo WP-UI-CORE o WP-ENG-RUNTIME como una única tarea ejecutable.

Mantener las cinco aceptaciones conjuntas ya definidas en
[work packages](parity-work-packages.md):

| Gate conjunto | Responsables |
|---|---|
| INT-PROTO-BINDINGS | V1 + V2: tipos/bridge y unknown-channel typed refusal |
| INT-GIT-REMOTE | V3 + V1: host/version, git-over-SSH y liveness |
| INT-NCHAT | V4 + V2: portal por tab y fallback-unsafe gating |
| INT-PROVIDER-UI | V3 + V4 + V2: provider real → workspace/task/review UI |
| INT-PACKAGED | V5 + V1 + V2: runtime/installer/journeys, luego instalación |

Los 14 gaps del manifest siguen asignados a V5 con cada dueño de dominio:
`candidates:unclassified-present`, `cases:static-markers-only`,
`cloud:pnpm-recursive`, `imports:binary-unscanned`,
`playwright-discovery:tests/playwright.config.ts`,
`reachability:inferred-not-verified`,
`vitest-include:computed:cloud/apps/relay/vitest.config.ts`,
`vitest-include:conditional:config/vitest.config.ts`, cinco
`vitest-include:defaulted:` y `workflows:dynamic-matrix`.
No reabrir un censo completo: resolver contra receipts y revisiones posteriores,
conservando lo todavía sin ejecutar. Los G1–G20 y pendientes 1–9 citados por el
plan original se reconcilian igual; una referencia antigua no invalida el cierre
posterior, ni un nuevo documento demuestra que un gap cerró.

## 8. Pruebas y formato de cada entrega

Cada tarjeta acotada declara: IDs fuente/capacidad y WP, paths exclusivos,
contratos consumidos, tests originales/fixtures y hashes, baseline observado,
RED esperado, criterio GREEN, matriz OS/host, riesgos y no-alcance. Ver
[test inventory](parity-test-inventory.md), [test porting](parity-test-porting.md),
[capsules](parity-baseline-capsule.md), [batches](parity-baseline-batches.md).

Secuencia: baseline fuente existente/reproducible → port con equivalencia
revisada → candidato compilable que falla por comportamiento → implementación
GREEN → prueba integrada real → paquete/instalación. Un import ausente, 0 tests,
skip, mock del producto ausente o test que solo compara hashes no es ese RED/PASS.
Si lo existente ya pasa, conservarlo; no introducir un bug artificial.

Comandos **del rewrite**, no `pnpm tc` copiado del repositorio viejo:

```sh
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
pnpm typecheck
pnpm --filter @drogon/desktop test
pnpm test:renderer-contracts
pnpm typecheck:renderer-contracts
pnpm test:packaging
```

Los commands anteriores existen o son invocaciones Cargo estándar; ejecutarlos
en el worktree asignado. Rerun por paquete (`-p drogon-core`, `-p drogon-cli`,
etc.) y tests de dominio durante iteración, todos los gates al integrar. Las
dependencias deben estar instaladas/fijadas por el proceso aprobado; un fallo de
entorno se informa, no dispara un cambio global o actualización de lockfile.

`pnpm accept:core-cli` y `pnpm accept:desktop` lanzan procesos fixture:
inspeccionar su configuración y ownership antes de usarlos. `pnpm package:desktop`,
`pnpm accept:packaged` y `pnpm install:preview` quedan al integrador/V5 en el
checkout combinado, con los argumentos de bundle/receipt que indiquen sus scripts;
no ejecutar instalación solo porque el nombre del script exista.

Entregar en `docs/migration/verticals/VN/checkpoint-NNN.md`:

```text
Vertical / scope / base SHA / head SHA / branch / worktree:
Capabilities and original contract/test IDs:
Changed paths; shared-file patch requested:
Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Integrated/rendered/platform evidence; exact package identity if applicable:
Unverified, missing, source defects, deliberate approved deltas:
Dependencies requested; next bounded checkpoint:
Owned processes: session/incarnation/host, settlement/release receipts:
Rollback; data/credentials/privacy check:
Ready for independent review: yes/no (not self-accepted):
```

## 9. Integración continua sin perder control

1. **Preparación única:** settle/transfer actual, recuperar artifacts locales
   necesarios, seed de propiedad/interfaces, verificar base limpia y publicarla.
   Crear cinco worktrees mediante Orca con ese mismo SHA; nunca copiar dirty
   files de otro checkout. No crear worktrees sobre el audit del usuario.
2. **Entrega por vertical:** commit pequeño con feature/tests y push solo a su
   rama asignada, sin force-push ni main. Esta es la política propuesta para la
   próxima asignación; debe constar en el prompt de lanzamiento, supersediendo
   la antigua regla workers-no-Git únicamente dentro de su propia rama.
3. **Revisión:** comprobar scope, provenance, assertions y fallos negativos;
   separar archivos globales/wiring. PR verde es entrada a la cola, no aceptación.
4. **Composición serial:** integrador combina uno por vez en una rama de
   integración propuesta `codex/vertical-integration`, aplica wiring compartido
   y corre tests de consumidores afectados. No cinco merges concurrentes.
5. **Gate combinado:** suites globales y gates conjuntos pertinentes; CDP y
   paquete real tras hitos aceptados. Cada green registra el SHA combinado.
6. **Promoción:** PR a main con checks del HEAD actual y revisión; V5 produce
   paquete de ese commit, integrador verifica e instala sin interrumpir sesiones.
7. **Sincronización:** las otras verticales incorporan el checkpoint aceptado
   al comenzar su siguiente entrega. No rebase de un proceso activo ni force-push
   de una rama compartida. Si el contrato cambió, resolver antes de nuevo trabajo.

Si una entrega rompe otra, mantener main/preview anterior, aislar el cambio y
devolver una corrección concreta a su dueño. No desactivar tests ni ocultar el
error en el adaptador. El integrador mantiene una tabla pequeña por checkpoint:
`base`, `vertical-head`, `review`, `combined-head`, `tests`, `package`, `installed`.

**Cron recomendado solo como monitor opcional:** mirar nuevos heads/checks y
avisar si hay entrega revisable, fallo o decisión requerida; silencio sin cambios.
No lanzar workers adicionales, resolver conflictos, hacer merge, desplegar,
instalar ni cerrar sesiones por calendario. Empezar con revisión por evento;
automatizar promociones solo cuando sus gates y autoridad estén definidos.

## 10. Prompts listos para abrir las cinco tareas

Usar el bloque común seguido del bloque de una vertical. Sustituir `BASE_SHA` y
`WORKTREE` por los valores **verificados**, nunca dejar placeholders al lanzar.
El usuario pidió este diseño; este documento no ha lanzado las cinco tareas.

### Bloque común

> Trabaja en el rewrite Drogon desde BASE_SHA, exclusivamente en WORKTREE y la
> rama asignada. Lee AGENTS.md/CLAUDE.md y docs/migration/five-vertical-handoff.md;
> sigue su tarjeta de vertical, ownership y lecturas fuente. Preserva toda la
> paridad original y las adiciones Drogon, sin reducir a MVP. Empieza con una
> tarjeta pequeña y tests existentes reutilizados, equivalencia/RED de comportamiento,
> implementación y GREEN. No relajes assertions ni confundas fuente, fixtures,
> tests de candidato y paquete instalado. No escribas paths de otro dueño.
> Propón cambios compartidos en un diff separado; no dupliques contratos.
> Puedes hacer commits y pushes normales únicamente de tus paths a tu rama
> asignada; no main, force-push, merges ajenos, deploy, instalación ni cambios de
> credenciales/globales. Publica checkpoints con SHA/evidencia/bloqueos usando
> el formato del handoff. No crees descendientes. Si falta una interfaz pide
> una decisión acotada y continúa en otro bloque independiente. Conserva procesos,
> sesiones y archivos; demuestra ownership exacto antes de release. No te
> autoaceptes ni declares paridad por compilar. Termina cada entrega en un
> checkpoint estable listo para revisión independiente.

### Bloques específicos

- **V1:** «Eres dueño de motor/CLI conforme a §6 V1, rama
  `codex/vertical-01-runtime-cli`. Primero recibe el candidato nativo y WIP
  mediante transferencia explícita; cierra lifecycle/mail/receipts sin duplicar
  lo ya aceptado. Tu primera prueba conjunta es daemon/CLI real; tu hito es
  dogfood sin proxy Orca, no dar por terminada la paridad restante.»
- **V2:** «Eres dueño de escritorio/settings conforme a §6 V2, rama
  `codex/vertical-02-desktop-settings`. Primera entrega: ambos fallos de
  navegación reproducidos, con tests y CDP. Publica enseguida contrato de
  montaje para V3/V4. Reutiliza estilo/tokens del origen y conserva restore,
  foco/teclado y todos los settings/consumers.»
- **V3:** «Eres dueño de workspaces/remoto conforme a §6 V3, rama
  `codex/vertical-03-workspaces-remote`. Primera entrega: explorer/editor para
  folder y Git contra core real, con UI de dominio aislada. Continúa Git/review
  y SSH/WSL/browser/relay/mobile. Host remoto caído nunca permite ejecutar local.»
- **V4:** «Eres dueño de capacidades conforme a §6 V4, rama
  `codex/vertical-04-capabilities`. Primera entrega: flujo Bots/schedule/history
  con host fencing, storage existente reutilizado y panel real. Prepara en
  paralelo tests de Mentu/Meetings y providers; diferencia pendientes históricos
  de funciones ya existentes. No modelos/servicios/datos fuera de autorización.»
- **V5:** «Eres dueño de plataforma/release conforme a §6 V5, rama
  `codex/vertical-05-platform-release`. Primera entrega: runners/CI y camino
  Windows IPC con pruebas reales acordado con V1. Mantén packaging y aceptación
  integrada utilizables desde el inicio. Prepara E5 con decisiones concretas;
  no publiques assets ni instales tu branch parcial.»

Política de modelos al cierre conocido: Sonnet 5, GLM-5.3-Flash y Kimi 2.7;
Pi/Qwen suspendido, sin fallback silencioso ni nuevos Sol leads. Cinco verticales
no implican cinco proveedores distintos. La nueva concurrencia de cinco debe
quedar explícita en las asignaciones, contando workers anteriores aún activos y
coordinándose con el audit separado; no lanzar cinco adicionales encima del pool
de tres existente. La decisión de Carlos de preparar este esquema no equivale a
que este documento haya activado esa concurrencia.

## 11. Checklist de arranque y cierre

Antes de lanzamiento: base SHA publicada, audits locales recuperables, owner por
path, contratos de la primera entrega, WIP transferido, workers previos asentados,
worktrees verificados, cinco prompts con scope y permisos claros. No hace falta
resolver todos los detalles futuros para empezar esas primeras entregas.

Antes de declarar la migración completa: ninguno de los 46 paquetes ni de los
contratos/capacidades enumerados carece de dueño o disposición aceptada; source
tests tienen equivalentes verificados; faltantes/no-ejecutados no cuentan como
PASS; gates conjuntos, plataformas, visuales, recovery, E5, CLI independiente y
dogfood están aceptados; paquete exacto instalado y rollback disponible. Las
mejoras postmigración y benchmark se cierran con su propia evidencia.

El beneficio de esta organización es eliminar espera innecesaria y conflictos
de ownership. No elimina dependencias reales ni permite convertir documentos,
cantidad de commits o respuestas de agentes en evidencia de producto terminado.
