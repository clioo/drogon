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

1. Profundidad 1: un coordinador y como máximo seis workers activos (Carlos, 2026-09-08), con rutas disjuntas.
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
| J9 Mentu | R3 | Sonnet | lanzada | |
| J6 Tasks | R3 | Muse A | fusionada: GitHub Issues, start crea worktree con badge #n | #38 |
| J3 CLI | R3 | Muse B | fusionada: terminal wait y guías skills get; browser CLI pendiente | #30 |
| J1 notificaciones | R3 | Muse C | fusionada: needs_input por hooks y notificación nativa | #35 |
| J10 Settings | R4 | Muse A | fusionada; falta tamaño de fuente en xterm | #33 |
| J11 Paquete | R4 | Muse B | fusionada: paquete sellado, aceptación 25/25, instalado en ~/Applications con builds previos preservados | #51 |
| Fidelidad exacta: oráculo fuente + render y auditoría | R5 | Muse | fusionada: `scripts/fidelity/compare-surfaces.mjs`, 30 diferencias rankeadas | #44 |
| Fidelidad R6-A: chrome de ventana, sidebar 280, nav rows y chords del fuente, landing | R6 | Muse | fusionada; oráculo: sidebar y barra inferior Δ0 | #48 |
| Fidelidad R6-C: settings como página completa, copy y ARIA de Automations, Bots, Tasks | R6 | Muse | fusionada | #46 |
| Fidelidad R6-B: activity bar derecha (Files, Changes), menú + de pestañas, browser como tab | R6 | Muse | lanzada | |
| J1 UI: añadir proyecto, crear y quitar worktree, pulido | R4 | Muse C | fusionada | #40 |
| J4 CLI browser por relay daemon → desktop | R4 | Muse B | fusionada: open, navigate, snapshot, click, fill, tabs | #41 |
