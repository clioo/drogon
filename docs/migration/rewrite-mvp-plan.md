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

1. Profundidad 1: un coordinador y como máximo cuatro workers activos.
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
| J1 contratos, worktrees, estado | R1 | Sonnet | contratos en main (#18); RPC y CLI en curso | #18 |
| J12 barra inferior | R1 | Muse A | fusionada | #19 |
| J5 paleta | R1 | Muse B | fusionada; falta revelar archivo desde quick open | #17 |
| J2 Git review | R1 | Muse C | en curso | |
| J8 Bots | R2 | Sonnet | pendiente | |
| J1 sidebar y pestañas | R2 | Muse A | en curso | |
| J7 Automations | R2 | Muse B | lanzada | |
| J4 Browser | R2 | Muse C | pendiente | |
| J9 Mentu | R3 | Sonnet | pendiente | |
| J6 Tasks | R3 | Muse A | pendiente | |
| J3 CLI | R3 | Muse B | pendiente | |
| J1 notificaciones | R3 | Muse C | pendiente | |
| J10 Settings | R4 | Muse A | pendiente | |
| J11 Paquete | R4 | Muse B | pendiente | |
