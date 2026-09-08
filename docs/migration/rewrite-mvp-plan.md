# Drogon rewrite: plan MVP del hackathon

Fecha: 2026-09-07. Deadline: 2026-09-14. Repo del producto: `clioo/drogon`,
rama `main`. Este documento es la única referencia de alcance vigente; el resto
de `docs/migration/` es historia del proyecto.

Regla del hackathon: Drogon es un repositorio desde cero. El fork
`clioo/drogon-orca` no es el producto. La referencia de solo lectura
`/Users/carlos/Documents/Drogon-mentu-session` (Orca 1.4.197 más Mentu, Bots y
Meetings del fork) se usa para copiar código MIT con sus avisos y para comparar
comportamiento, nunca como cwd de builds o tests ni como destino de edición.

## 1. Punto de partida (`main` en `a6dc0b3`)

Existe: `drogond` y `drogon-cli` con sesiones PTY persistentes y veredictos
live/unverifiable/exited, workspaces por carpeta, Files (listar, leer, editar,
guardar), storage y RPC `bot.create`/`bot.run`/`bot.snapshot`, records y runner
de automations sin scheduler, correo y orquestación nativa (run, task,
dispatch, ask, check, reply), parsers de Git sin registrar como RPC, scripts de
paquete, aceptación e instalación, tema claro/oscuro. Renderer de ~11 k líneas
con lista de workspaces, pestañas de terminal, panel Files, panel Bots gated,
inspector y diálogo de ajustes.

No existe: shell visual de Orca (sidebar de proyectos con worktrees, barra de
pestañas con estado de agente, barra inferior, activity bar), worktrees Git,
estado del agente, RPC Git, paleta de comandos, Tasks, scheduler y página de
Automations, chat y ejecución visible de Bots, Mentu, pane de browser,
comandos de CLI para terminales/worktrees/browser, settings más allá del tema.

## 2. MVP acordado con Carlos: mínimo demostrable por journey

| # | Journey | Mínimo demostrable en el rewrite |
|---|---|---|
| J1 | Columna vertebral | Proyecto (repo o carpeta) → crear worktree → pestaña con harness (Claude Code, Pi, OpenCode) → estado del agente (trabajando, inactivo, esperando) en sidebar y pestaña → notificación nativa al pedir input → sesiones persisten tras reinicio del renderer |
| J2 | Revisión | Files y editor existentes → panel Changes con diff, stage, commit, push y crear PR con `gh` |
| J3 | drogon-cli | Orquestación existente más `terminal create/send/read/wait`, `worktree create/list/rm`, `project add/list`, `browser open/snapshot`, guías `drogon skills get` para agentes |
| J4 | Browser | Pane embebido con barra de dirección, navegación y control por CLI para agentes |
| J5 | Paleta y búsqueda | Cmd+K comandos, Cmd+P quick open, saltar entre workspaces y sesiones |
| J6 | Tasks | Página alimentada por GitHub Issues vía `gh`: listar, filtrar, crear worktree y sesión desde un issue |
| J7 | Automations | Scheduler cron en el daemon sobre el runner existente, página para crear y ver historial, una ejecución real de agente |
| J8 | Bots | Crear con preset, responsabilidades, chat visible sobre `bot.run`, historial |
| J9 | Mentu | Panel derecho y tab en sesión: elegir receta, aprobar, ejecutar con el runtime fijado, evidencia y retry |
| J10 | Settings mínimos | Tema, harness por defecto, atajos, auth Git y GitHub, notificaciones |
| J11 | Paquete | Build macOS firmado ad-hoc, instalación recuperable, sin telemetría ni updater |
| J12 | Barra inferior | La de Orca: ajustes y ayuda a la izquierda; medidores de uso por proveedor (Claude ventana y semana, Codex) con refresco; a la derecha awake On/Off, memoria, número de terminales y puertos |

Fuera del MVP: voz, computer use, emulator, mobile, AI Vault, plugins, cloud,
SSH remoto, Linear, Jira, GitLab, Meetings nuevos, benchmark Mentu.

## 3. Olas y reparto

Cuatro slots: uno Sonnet 5 para lo difícil, hasta tres Pi con Muse Spark 1.3
Contributor `--thinking max` para volumen. Cada tarea es un journey o un
trozo de journey de medio día con rutas propias disjuntas.

| Ola | Sonnet | Muse A | Muse B | Muse C |
|---|---|---|---|---|
| R1 hoy | Contratos y RPC de proyectos, worktrees y estado de agente; CLI `project` y `worktree` | J12 barra inferior con lectores de uso | J5 paleta, quick open y atajos | J2 RPC Git y panel Changes |
| R2 | J8 Bots chat y run visible | Sidebar de proyectos con cards de worktree y barra de pestañas con estado, port del shell de Orca | J7 scheduler y página Automations | J4 browser pane y CLI browser; oráculos CDP de J1 y J5 |
| R3 | J9 adaptador Mentu y panel | J6 Tasks con GitHub Issues | J3 CLI terminal, worktree y guías de skills | Notificaciones nativas y estado de agente en UI |
| R4 | Integración, correcciones y demo | J10 settings mínimos | J11 paquete e instalación nocturna | Oráculos CDP restantes y regresión |

Los contratos compartidos los publica primero el slot Sonnet (o el coordinador)
como commit temprano en `main`, y las tareas de renderer que dependen de ellos
se despachan después. Nada de líderes intermedios ni hojas de hojas.

## 4. Reglas de orquestación

1. Profundidad 1: un coordinador y hasta diez workers activos con rutas disjuntas (Carlos, 2026-09-08): Sonnet 5 para lo difícil, Pi + Muse Spark 1.3 Contributor para volumen, y dos slots cada uno para Pi + GLM 5.3 Flash (`--provider zai`) y OpenCode Go + Muse 1.3 (`-m opencode-go/muse-spark-1.3-contributor`, nunca el Zen gratuito; MCP desactivados vía OPENCODE_CONFIG).
2. Una tarea es un journey con rutas propias, oráculo y evidencia exigida.
3. Aceptación por evidencia: tests que fallan antes y pasan después, más
   captura CDP del paquete o del dev real. Un módulo exportado sin consumidor
   no cierra nada.
4. Sin documentos por tarea. El informe es la descripción del PR. Este archivo
   y la tabla de estado son los únicos documentos vivos.
5. Modelo fijo por lane toda la semana; cambio solo por bloqueo real.
6. Integración diaria por el coordinador con PRs pequeños contra `main`.
7. Tarea de medio día como máximo; si crece, se divide antes de asignar.
8. Los workers de Pi entregan por PR y evidencia; el `worker_done` es cortesía.
9. Fidelidad exacta: la experiencia y la UI deben ser iguales a orca-drogon.
   La fuente de verdad es el código fuente de la referencia, componente por
   componente (estructura, clases y tokens, textos, iconos, teclado, ARIA);
   la instancia orca-drogon corriendo (CDP 127.0.0.1:9445) solo confirma el
   render. Un oráculo automático compara ambas apps por superficie y cada
   diferencia se convierte en una tarea de corrección que cita el archivo fuente.
10. Higiene de procesos: cada worker cierra los Electron, daemons y fixtures
    que arranca y lo demuestra con `pgrep` en el PR. El coordinador cierra el
    terminal del agente en el mismo paso en que acepta y fusiona su PR, salvo
    reutilización inmediata; nada de agentes ociosos consumiendo RAM.

Archivos que solo edita el coordinador salvo concesión explícita en la Task:
`package.json`, `pnpm-lock.yaml`, `Cargo.toml`, `Cargo.lock`,
`crates/drogon-protocol/**`, `crates/drogon-core/src/lib.rs`,
`apps/desktop/src/preload/**`, `apps/desktop/src/shared/**`,
`apps/desktop/src/renderer/src/App.tsx`, `AGENTS.md`, `THIRD_PARTY_NOTICES.md`
y este documento.

## 5. Toolchain

Node 24 fijado: `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.
pnpm 11.19.0 por `packageManager`. Rust 1.98. Gates: `cargo test --workspace
--locked`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt
--check`, `pnpm typecheck`, `pnpm --filter @drogon/desktop test`,
`pnpm test:renderer-contracts`. App en desarrollo según README: `drogond
--data-dir <dir propio>` y `DROGON_DATA_DIR=<dir> pnpm --filter @drogon/desktop
dev`. Capturas por Playwright CDP como hace `scripts/accept-desktop.mjs`.

## 6. Estado

| Journey | Ola | Dueño | Estado | PR |
|---|---|---|---|---|
| J1 contratos, worktrees, estado | R1 | Sonnet | fusionada; falta needs_input por hooks de Claude | #18, #25 |
| J12 barra inferior | R1 | Muse A | fusionada | #19 |
| J5 paleta | R1 | Muse B | fusionada; falta revelar archivo desde quick open | #17 |
| J2 Git review | R1 | Muse C | fusionada | #21 |
| J8 Bots | R2 | Sonnet | fusionada: crear, chat sobre bot.run, historial; capability bot.snapshot.v1 activa | #42 |
| J1 sidebar y pestañas | R2 | Muse A | fusionada; estado de agente real llega con R1-S | #22 |
| J7 Automations | R2 | Muse B | fusionada; horarios solo UTC | #29 |
| J4 Browser | R2 | Muse C | fusionada (pane); CLI browser pendiente | #27 |
| J9 Mentu | R3 | Sonnet | fusionada: recetas .mentu, aprobación por hash, runtime fijado con lock, ejecución cancelable, panel y tab con estado compartido; faltan Graph/Metrics y streaming por paso | #52 |
| J6 Tasks | R3 | Muse A | fusionada: GitHub Issues, start crea worktree con badge #n | #38 |
| J3 CLI | R3 | Muse B | fusionada: terminal wait y guías skills get; browser CLI pendiente | #30 |
| J1 notificaciones | R3 | Muse C | fusionada: needs_input por hooks y notificación nativa | #35 |
| J10 Settings | R4 | Muse A | fusionada; falta tamaño de fuente en xterm | #33 |
| J11 Paquete | R4 | Muse B | fusionada: paquete sellado, aceptación 25/25, instalado en ~/Applications con builds previos preservados | #51 |
| Fidelidad exacta: oráculo fuente + render y auditoría | R5 | Muse | fusionada: `scripts/fidelity/compare-surfaces.mjs`, 30 diferencias rankeadas | #44 |
| Fidelidad R6-A: chrome de ventana, sidebar 280, nav rows y chords del fuente, landing | R6 | Muse | fusionada; oráculo: sidebar y barra inferior Δ0 | #48 |
| Fidelidad R6-C: settings como página completa, copy y ARIA de Automations, Bots, Tasks | R6 | Muse | fusionada | #46 |
| Fidelidad R6-B: activity bar derecha (Files, Changes), menú + de pestañas, browser como tab | R6 | Muse | fusionada: Explorer/Source Control/Session details con persistencia, menú + estático, browser en pestaña; Mentu provisional en el panel de sesión | #63 |
| J1 UI: añadir proyecto, crear y quitar worktree, pulido | R4 | Muse C | fusionada | #40 |
| J4 CLI browser por relay daemon → desktop | R4 | Muse B | fusionada: open, navigate, snapshot, click, fill, tabs | #41 |
| J1 R7-A: composer de nuevo workspace y Add Project desde carpeta del fuente; quita el formulario legado | R7 | Muse | fusionada: aceptación 15/15, oráculo empty/project-terminal Δ0 en sidebar y barra; etiquetas de paleta llegan con R7-I | #57 |
| J3 R7-C: shim `drogon-cli` en cada terminal, DROGON_* en el entorno de sesión | R7 | Muse | fusionada: shims en `<data-dir>/bin`, entorno de sesión con DROGON_* y TERM_PROGRAM=Drogon, hooks usan el shim | #56 |
| J8 R7-E: responsabilidades de Bots (tarjetas, alta con cron, historial, Back) | R7 | Muse | fusionada: bot.responsibility_create/delete sobre automations del bot, tarjetas e historial por bot, Back de cabecera cableado; 876 tests | #60 |
| J5/J10 R7-I: tabla de atajos del fuente, dispatcher por scope, sección de shortcuts en Settings | R7 | Muse | fusionada: 30 ids del fuente con chords por plataforma, registro sin conflictos, sección de atajos en orden del fuente | #70 |
| J6 R8-G1: Tasks con frame, source bar, filas GitHub, filtros y paginación del fuente; paging en tasks.list | R8 | GLM 5.3 Flash | fusionada: task-page del fuente, paging 1..10 × 36, cierre cableado; faltan celdas editables y modos PR/Projects | #71 |
| Fidelidad R8-G2: tokens `:root`/`.dark`, capa base y fuentes Geist + Nerd Symbols del fuente | R8 | GLM 5.3 Flash | fusionada: cabecera del oráculo idéntica (Geist 36px/700), tokens iguales en ambos esquemas, fuentes empaquetadas con OFL | #62 |
| J7 R8-O1: Automations con lista, editor, detalle e historial del fuente; horarios en hora local | R8 | OpenCode + Muse | fusionada: 43 tests nuevos, oráculo automations PASSED; faltan dashboard de runs y scopes externos | #65 |
| J1 R8-O2: terminal con terminal.css, tema xterm por esquema, zoom, búsqueda, links, menú contextual y overlay de salida | R8 | OpenCode + Muse | fusionada: 108 tests; la aceptación lee el buffer vía `window.__drogonTerminals` (WebGL); eventos de App pendientes en R10-C | #68 |
| J1 R9-A: acciones de tarjeta de worktree del fuente (menú contextual, renombrar, borrar con conteos, badges) | R9 | Muse | fusionada: worktree.rename con títulos persistentes, menú, rename inline, diálogo de borrado con conteos, badges | #87 |
| Fidelidad R9-B: remanente del chrome (Back/Forward en el titlebar, cabecera de Projects, pie del sidebar, Star on GitHub, ⌘J) | R9 | Muse | fusionada: titlebar en la columna del sidebar, Settings sin controles, cabecera/pie/vacío exactos, historial del fuente | #73 |
| J8 R9-C: bot.delete, ejecuciones programadas en el historial, acciones de cabecera de la tarjeta | R9 | Muse | fusionada; desvío conocido: diálogo de confirmación y etiquetas Scheduled/Manual que el fork no tiene | #67 |
| Fidelidad R10-A: primitivas UI (shadcn/Radix) del fuente en components/ui | R10 | GLM 5.3 Flash | fusionada: 26 primitivas con recetas idénticas, 43 tests, tw-animate-css importado como el fuente | #77 |
| J2 R10-B: contenido del panel Source Control del fuente (secciones, filas, commit, sync, Create PR) | R10 | OpenCode + Muse | fusionada: secciones/filas/commit/sync/discard del fuente, git.discard/line_counts/pull/fetch y amend; 1219 tests | #80 |
| J1/J9 R10-C: eventos del terminal cableados en App, `shell.openExternal`, Mentu como ítem de la barra derecha | R10 | Muse | fusionada: abrir archivo/reiniciar/cerrar desde el terminal, openExternal http(s), Mentu en la barra derecha en el orden del fork | #75 |
| J2 R10-D: panel Explorer del fuente (árbol, filtro, toolbar, menú contextual, crear/renombrar/borrar) | R10 | Muse | fusionada: FileExplorer del fuente con files.create/rename/delete reales; 1190 tests | #79 |
| Fidelidad R11-A: remates (glifos de teclas, títulos de paleta, hint de Search, puertos/memoria de la barra, ajuste GPU del terminal) | R11 | GLM 5.3 Flash | fusionada; GPU cableado por App con un solo escritor de settings | #88 |
| J4 R11-B: chrome de la pestaña de browser del fuente (barra de direcciones, navegación, banners, menú, buscar, menú contextual) | R11 | Muse | fusionada: 1278 tests, oráculo browser PASSED; chords con el guest enfocado pendientes | #83 |
| J11 R11-C: cobertura del paquete sellado para las superficies nuevas (barra derecha, menú +, composer, Automations, Bots, Tasks, Settings, barra) | R11 | OpenCode + Muse | fusionada: bundle sellado 40/40 PASSED sobre main | #82 |
| J9 R11-D: panel y pestaña de Mentu portados literalmente del fork (Draft, Graph, Metrics, controles de ejecución) sobre las primitivas | R11 | Muse | fusionada: Graph/Run/Evidence/Metrics del fork, verify.commands y step_status corregidos; Open full tab cableado | #84 |
| J2 R12-A: editor Monaco y visor de diff del fuente (cabecera, autosave, tema, DiffViewer) | R12 | Sonnet | fusionada: Monaco con workers locales, cola de guardado/autosave del fuente, CsvViewer, DiffViewer con navegación; 1604 tests | #99 |
| J5 R12-B: jump palette ⌘J y quick open ⌘P del fuente con files.search en el daemon y reveal en Explorer | R12 | Muse | fusionada: JumpPalette/QuickOpen del fuente, files.search con git ls-files y walk acotado, reveal en Explorer; 1489 tests | #95 |
| J1 R12-D: interacciones del tab strip (reordenar con dnd-kit, menú contextual, pin, cerrar variantes) | R12 | Muse | fusionada: orden persistido por workspace, menú del fuente, pin, renombrar, cierre variantes, chevrons | #90 |
| J1/J4 R12-E: remates de terminal y browser (política de pegado, popover de enlaces, reinicio con el mismo harness, chords con el guest enfocado) | R12 | GLM 5.3 Flash | fusionada: pegado con bracketed paste y límites del fuente, popover de enlaces, reinicio con harnessId en el registro de sesión, ⌘L/R/F con el guest enfocado; 1743 tests | #111 |
| J7 R12-F: dashboard de Runs y página de detalle de ejecución de Automations | R12 | GLM 5.3 Flash | fusionada: automation.runs_all y automation.run con snapshot honesto de salida, dashboard/tabla/detalle del fuente; 1615 tests | #101 |
| J6 R12-G: Tasks en modo pull requests con celdas de revisión/checks/merge y start desde PR | R12 | OpenCode Go + Muse 1.3 | fusionada: modo PR del fuente con celdas de revisión/checks/merge, start desde PR | #93 |
| J9 R12-H: edición de recetas Mentu con mentu.recipe_save y validación del fork | R12 | OpenCode Go + Muse 1.3 | fusionada: borrador, inspector en modo edición, familia de validación del fork, mentu.recipe_save; 1448 tests | #94 |
| J10 R12-I: paneles de Settings del fuente (Appearance, General, Agents, Notifications, Git y GitHub) | R12 | Muse | fusionada: orden de secciones del fuente, sección CLI en Agents con sonda real | #89 |
| J8 R13-A: exactitud de la página Bots frente al fork (estados, formulario, avatar, controlador) sobre las primitivas | R13 | Muse | fusionada: composición, formulario y controlador del fork; avatar con iniciales (arte no redistribuido) | #97 |
| J4 R13-B: panel Ports de la barra derecha con puertos del workspace y abrir en pestaña de browser | R13 | GLM 5.3 Flash | fusionada: ítem Ports (⌘⇧I), panel del fuente sobre drogon:workspacePorts, abrir en browser, copiar, diálogo de detalles; 1684 tests | #106 |
| Fidelidad R13-C: toasts del fuente (sonner) y sus llamadas en las superficies del MVP | R13 | Muse | fusionada: Toaster del fuente y toasts de worktree, source control, terminal, editor y automations con copy exacto | #98 |
| J1 R14-A: menú de acciones de proyecto del fuente (Project Settings, Remove Project) y filas del menú Options | R14 | Muse | fusionada: menú, diálogo de borrado, filas Show y sección Project Settings del fuente; 1701 tests | #107 |
| Shell R14-B: menú nativo de la app con submenú Appearance, persistencia de bounds de ventana, badge del dock | R14 | GLM 5.3 Flash | lanzada | |
| J1 R14-C: needs_input y working para OpenCode y Pi con el plugin/extensión de estado del fuente | R14 | Sonnet | fusionada: overlay OPENCODE_CONFIG_DIR con el plugin de estado, extensión Pi por --extension, eventos por drogon-cli hook-event con clasificación wait/clear; lanzamientos reales verificados | #113 |
| J9 R14-D: contenido de evidencia de ejecuciones Mentu en el panel de receta | R14 | OpenCode Go + Muse 1.3 | fusionada: mentu.run_evidence con lectura acotada, filas de evidencia con stdout/stderr y truncado; 1709 tests | #109 |
| J10 R14-E: tipografía del terminal del fuente (familia, peso, peso en negrita) | R14 | OpenCode Go + Muse 1.3 | fusionada: familia con búsqueda de fuentes del sistema, pesos 500/700, editor sigue al terminal; 1657 tests | #104 |
| Infra: ventana en segundo plano para pruebas (`DROGON_BACKGROUND_WINDOW=1`: showInactive, política accessory, sin throttling) y foco emulado por CDP en aceptación/oráculo | R14 | Coordinador | fusionada; comprobado: la app en primer plano nunca cambió durante la aceptación | #105 |
| Infra R15-A: probes del bundle sellado al día con la UI actual (barra de direcciones del browser y demás) para volver a 40/40 | R15 | Muse | fusionada: sellado 40/40 dos veces; destapó el issue qa #114 (barra colapsada en anchos estrechos) | #115 |
| QA fix R15-B: #114 barra de direcciones del browser en overlay al enfocar en anchos estrechos, como el fork | R15 | Muse | lanzada | |
| QA: manos de accesibilidad para el agente QA (`scripts/qa/drogon-ui.mjs`) y probes sellados al día (paleta "Jump to...", Select de Radix en Mentu, conteo de pestañas por tablist) | R14 | Coordinador | fusionada | #108 |
| QA ronda 1 sobre main 13d4e38: Pi + dgx-spark (qwen3.8-flash-next) usa la app compilada y reporta issues `qa` | QA | Pi local | lanzada | |

## 7. QA continuo

Un agente QA (Pi con el modelo local `dgx-spark/qwen3.8-flash-next-nvidia-nvfp4`,
sin costo por token) usa la app compilada desde `origin/main` como un usuario:
arranca daemon y Electron en ventana de fondo con `scripts/qa/drogon-ui.mjs`,
lee la pantalla por el árbol de accesibilidad (`snapshot`, `landmarks`) y actúa
con `click`, `fill`, `type`, `press`, `terminal-text`; nunca escribe scripts de
Playwright. En cada ronda crea un proyecto web desechable, recorre J1–J12,
abre un issue por defecto con la etiqueta `qa` en `clioo/drogon` (pasos,
esperado según el fork, actual, snapshot, captura, sha) y desecha todo lo que
creó. Se lanza una ronda tras cada uno o dos merges. Los issues `qa` son la
prioridad: cada uno se convierte en tarea para un worker Pi + Muse 1.3 que
localiza la experiencia y el código en el fork de referencia y los porta.
