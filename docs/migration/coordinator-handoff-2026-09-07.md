# Traspaso de coordinación — Drogon, 7 de septiembre de 2026

Estado: etapa cerrada con integración parcial y preview verificado; no certifica
paridad completa ni release público. Los cinco líderes entregaron su checkpoint;
V1/V3/V4 necesitaron recuperación explícita de settlement, detallada abajo.

## 1. Leer primero: decisión vigente de Carlos

Carlos pidió cerrar **lo trabajado hasta aquí**, terminar los workers actuales,
integrar las entregas aceptables y dejar el contexto para otro coordinador.
Esto supersede continuar abriendo features para alcanzar el 90% en esta sesión.
No confundir cierre de la etapa con migración terminada.

Inmediatamente antes solicitó PRs para las integraciones, 100% de cobertura
medida del alcance entregado y al menos un test conductual 1:1 por feature,
primero portando tests del fork y después implementando. Se transmitió a los
cinco líderes. La cobertura de líneas/ramas sigue **sin medir**; los recuentos
de tests no cumplen ese requisito. No se fabricó retrospectivamente RED.
La meta Codex del 90% se creó antes de la orden de cierre y no se ha alcanzado.

## 2. Repositorios, referencias y checkout

- Producto independiente: `clioo/drogon`, Rust core/daemon/CLI y Electron/React.
- Fork preservado: `clioo/drogon-orca`, upstream `stablyai/orca`.
- Fuente congelada: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, referencia
  local de solo lectura `/Users/carlos/Documents/Drogon-mentu-session`.
  Nunca ejecutar tests allí como cwd: también escriben caches ignoradas.
- Checkout de integración de esta etapa:
  `/Users/carlos/orca/workspaces/Drogon-rewrite/codex-native-coordination-contract`.
  Rama `codex/vertical-integration`; no usar el checkout histórico dirty como base.
- Semilla común de las cinco verticales: main tras PR9,
  `596ddbd9e8b6fdc5d5fa26616479e910b34ba604`.
- Snapshot al iniciar el cierre: integración `9cdebff`, limpio y publicado.
  [PR10](https://github.com/clioo/drogon/pull/10) es la integración combinada.
  No fusionar indiscriminadamente las ramas de líderes: contienen propuestas
  retenidas y adaptadores alternativos que ROOT adaptó al contrato común.

## 3. Arquitectura y límites que no deben perderse

El producto debe funcionar con `drogond` y `drogon-cli`, sin usar Orca por debajo
para ejecutar su trabajo. Orca se usó como herramienta de desarrollo y
orquestación de los workers; eso no demuestra independencia del producto.

El host de ejecución conserva autoridad sobre procesos, archivos y comandos.
Los veredictos son `live` / `unverifiable` / `exited`: pérdida de contacto,
timeout, cancelación solicitada y registro terminado no prueban salida.
Preservar folder workspaces, Git 2.25, SSH/WSL y versiones cliente/host mixtas;
no resolver una operación remota por ejecución local. Nuevas capacidades se
anuncian solo después de registrar, probar y aceptar su implementación.

Reutilizar storage, ledger, admisión IPC y contratos existentes; no crear
tablas de receipts o rutas paralelas para el mismo efecto. ROOT es dueño de
manifests/locks, registro RPC, preload/IPC compartidos, integración y release.
UI: usar tokens/primitivas existentes y guía fuente; validar Electron con
Playwright CDP y la skill `electron`, no computer-use.

## 4. Audit: qué se incorporó y qué significa

La copia portable de texto ya está en
[ux-parity-audit-252de85](ux-parity-audit-252de85/README.md): report, matriz,
crosswalk, validación y manifiestos. Conserva los bytes/hashes originales.
El directorio `/tmp/drogon-ux-parity-audit-252de85c2fd2` contiene evidencia
adicional local; no asumir que sobreviva o esté incluida en Git.

El audit corresponde a candidato `252de85`, no al HEAD de integración actual.
No produjo código ni un PR nuevo para fusionar. Sus 86 filas y 50 IDs fuente
son inventario de hallazgos/contratos, no 86 features aprobadas.
El 11/12 = 91,7% es caracterización documental de fuente; E5 continúa abierto.
No es paridad UX, cobertura de tests ni aceptación de instalación.

Los dos P1 de navegación (`UX-NAV-ACTIVE-WORKSPACE` y
`UX-NAV-RESTORE-WORKSPACE`) sí se corrigieron en esta etapa: V2 `518e4cb`,
ROOT `02d3735`, unit tests y repro real CDP con misma sesión/host/incarnation.
Ver [ledger de integración](vertical-integration-ledger.md).
Files también avanzó después del audit: lectura/edición/guardado, conservación
de borradores y paquete real tienen evidencia posterior, no actualizar el
audit congelado para fingir que eso existía en su baseline.

Los demás gaps siguen abiertos salvo cierre explícito en la evidencia posterior:
Git/review/CI, remoto/WSL/skew, catálogos completos de settings/shortcuts,
Bots/automations operativos, Mentu/Meetings y superficies complementarias.
Una función exportada, un parser o un registro almacenado no cierra su journey.

La [disposición de cierre de las 86 filas](audit-stage-close-disposition-2026-09-07.md)
conserva cada ID, severidad fuente y límite de aceptación. No elimina filas ni
reescribe los resultados originales. Para seleccionar trabajo, cruzar sus
criterios con `parity-test-work-packages.json`, no con recuentos de commits.

## 5. Lecturas por orden para el siguiente coordinador

1. Este documento y los informes finales de cada vertical (índice de cierre abajo).
2. [Integraciones y pruebas ROOT](verticals/root-integration-2026-09-07.md),
   [Windows](verticals/root-windows-transport-integration-2026-09-07.md),
   [Bot create](verticals/root-bot-create-boundary-2026-09-07.md).
3. [Audit congelado](ux-parity-audit-252de85/report.md) y
   [matriz completa](ux-parity-audit-252de85/matrix.md).
4. [Reparto de verticales](five-vertical-handoff.md),
   [paquetes de tests](parity-test-work-packages.json),
   [plan de paridad](rewrite-parity-plan.md) y
   [test porting](parity-test-porting.md).
5. [Contrato nativo](protocol-v1.md) y
   [aceptación de coordinación nativa](native-coordination-combined-acceptance.md).

Los documentos históricos contienen staffing, deadlines, paths y holds
supersedidos. Leer sus fechas y las correcciones posteriores; no relanzar una
ola antigua porque su prompt siga incluido como ejemplo.

## 6. Mentu: recetas, evidencia y protocolo formal

Receta existente en este rewrite:
`.mentu/recipes/rewrite-foundation-verification.json`. Ejecuta verificación
de checkout limpio, builds/tests, core/CLI y Electron en secuencia. No
implementa paridad, no hace el benchmark ni certifica release completo.
Sus comandos shell son POSIX; no asumir que sea un runner Windows nativo.
No se ejecutó esa receta como parte de este cierre por el mero hecho de
leerla. Los tests ejecutados directamente tienen sus propias evidencias.

Para crear/modificar recetas: cargar la skill oficial `writing-recipes`,
validar con `mentu-recipes check` y `mentu-recipes doctor --strict`.
No ejecutar la receta fuente `drogon-dev-day` sin aprobación explícita.
Para interpretar `.mentu/runs`, usar `reading-run-records` y conservar
quarantine, causas de fallo, ownership y reintento seguro.

**Mentu Commitment Protocol no equivale a logs de recipes.** El audit
caracterizó quarantine existente en la fuente y distinguió registros de
ejecución de compromisos formales; no se estableció que estos últimos
existieran. No inventar IDs de commitments, ni llamar a un Task/Dispatch
de Orca o receipt SQL un compromiso Mentu. `protocol-v1.md` describe el
protocolo nativo de Drogon, no el Commitment Protocol.

Lecturas fuente/contratos:
[Bots/Mentu E3](audit-closure/e3-bridge/followup-bots-mentu.md) y
[caracterización de evidencia](ux-parity-audit-252de85/mentu-evidence-characterization.json).
Faltan los journeys integrados de revisión/aprobación/ejecución, panel y tab
de sesión, grafo, retry/quarantine e inspección de evidencia del candidato.
No confundir contratos de V4 con esas superficies terminadas.

Mentu upstream: cambios acotados, tests y justificación/PR en inglés;
verificar builds locales de revisiones fijadas sin esperar merge upstream.
La comparación difícil con/sin Mentu queda pendiente: Pi + Qwen en DGX Spark,
condiciones iguales predeclaradas y tokens reales medidos; sin fallback ni juez
cloud. La autorización de Pi/Muse para desarrollo no reactiva ese experimento.
No iniciar inferencia, servicios, downloads ni provisioning desde este handoff.

## 7. Identidades de orquestación

Run ROOT `run_ddca7735397e`; runtime observado
`e9c8216c-44ad-42d5-9d9a-065bd6ada0b9` (Orca 1.4.197).
Coordinador de esta etapa: `term_fa0de916-26da-4394-ba54-86a2ab8597e7`.
Estos identificadores son evidencia histórica, **no autoridad para que otro
agente suplante ese terminal o reutilice capabilities**.

Los cinco líderes se lanzaron como Pi / `muse-code` /
`muse-spark-1.3-contributor` / `--thinking max`; hojas aprobadas Sonnet,
GLM/Muse, máximo dos por líder y dos generaciones delegadas. El cierre
prohíbe abrir nuevas hojas/features. Una futura ola necesita asignaciones
actuales, ownership explícito y modelo/proveedor verificado sin sustitución.

| Vertical | Task | Dispatch | PR |
|---|---|---|---|
| V1 motor/CLI | `task_bbb62f343b3c` | `ctx_c62f0e47ad7a` | [14](https://github.com/clioo/drogon/pull/14) |
| V2 desktop/settings | `task_9e42feed8627` | `ctx_b8999954bf9c` | [11](https://github.com/clioo/drogon/pull/11) |
| V3 archivos/remoto | `task_a12105de2816` | `ctx_62b07c551e42` | [12](https://github.com/clioo/drogon/pull/12) |
| V4 capacidades | `task_565c41f74577` | `ctx_6f0e78e8230d` | [13](https://github.com/clioo/drogon/pull/13) |
| V5 plataforma/release | `task_1546a2a90f4c` | `ctx_3dc8d5809559` | [15](https://github.com/clioo/drogon/pull/15) |

Worktrees bajo `/Users/carlos/orca/workspaces/Drogon-rewrite/`, con nombres
`codex-vertical-01-runtime-cli`, `codex-vertical-02-desktop-settings`,
`codex-vertical-03-workspaces-remote`, `codex-vertical-04-capabilities`,
`codex-vertical-05-platform-release`. No escribir en el checkout de otro dueño.

Antes de operar Orca, cargar skills y guía de la versión instalada. `check`
entrega un batch FIFO que se ACKea solo después de procesarlo íntegro.
`worker_done` no equivale a aceptación de producto; después corresponde
`worker-release`. Si devuelve retained/external/no_owned_resource, preservar
ese estado: no forzar cierre. TUI idle o timeout tampoco significa terminado.

## 8. Verificación y preview

Usar Node24 fijado, no el Node global observado históricamente (Node26):
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.
En el checkout correcto: Cargo workspace tests, clippy estricto y fmt;
`pnpm typecheck`, renderer-contracts, packaging y suite/build desktop.
Los scripts `accept-*` crean procesos: revisar ownership y cleanup antes.
No ejecutar tests en la fuente de solo lectura ni instalar deps sin necesidad.

Al inicio del cierre el preview aceptado es `be192c5`:
15 checks de paquete real y Files, seal v3
`43396fc17300489fd69646ca5752841b1e6c0c6074b507883316b6452f1b1d47`.
Ver informe ROOT para receipt local y rollback. `9cdebff` todavía no era
ese paquete. Instalación local ad-hoc firmada, no notarización ni clearance E5.
Nunca reemplazar un daemon activo o cerrar sesiones del usuario para instalar.

## 9. Cierre final y siguiente paso

Integración entregada mediante [PR10](https://github.com/clioo/drogon/pull/10).
Último cambio de código/test: `7122c66519651837095b7d9007bcb7c6c20eb44d`;
[CI 34140539442](https://github.com/clioo/drogon/actions/runs/34140539442)
pasó en Ubuntu 22.04, macOS 14 y Windows. Los commits de relevo posteriores
solo documentan el cierre. Consultar el PR para su estado GitHub vigente.

Preview instalado: `1629b5ca698028c1eeee6d823d67fa9389ac6feb`, Node24,
Electron 44.2.0, macOS arm64, firma local ad-hoc sin notarización.
Los 15 checks del paquete real pasaron, incluido Files, quit/reopen,
continuidad de la sesión y misma identidad sellada antes/después. Todos los
procesos/sesiones del fixture se observaron `exited`. ROOT inspeccionó capturas
wide-dark y narrow-light. [Receipt portable](stage-close-packaged-acceptance-2026-09-07.json).

Seal v3: `da1ddde81c38e5e1dcd086a6a0bd0307a8b172ceb6d708e01edb1150ad380fe4`
(293 archivos, 311448093 bytes). App: `/Users/carlos/Applications/Drogon.app`.
Archivo inmutable instalado bajo `~/Applications/.drogon-builds/`
`1629b5ca6980-v3-<seal>/Drogon.app`; el installer retuvo el preview `be192c5`,
los anteriores y todos los datos. No detuvo procesos del usuario. El JSON
portable conserva los paths locales exactos; las capturas permanecen en
`.preflight/acceptance/desktop-1788796635900-51891bb4-1c25-49ac-910f-5f55c3011e1b/`.
Los cambios documentales posteriores no forman parte del bundle instalado.

Estado final de coordinación: cinco tareas de líderes completed, cero
Dispatches activos en ROOT y cero en los cinco child Runs observados.
No significa que toda tarea hija haya sido exitosa ni que los terminales
retenidos hayan salido. V2/V5 cerraron normalmente; V1/V3/V4 fueron cercados
sin acción de proceso tras su informe final y cerrados por recuperación.

Siguiente dueño: comenzar por secciones 10–12, revisar los holds y definir
el siguiente bloque. No continuar automáticamente la ola antigua, relanzar
workers por sus viejos prompts o ejecutar la receta raíz/benchmark.

## 10. Qué código se aceptó y qué NO debe integrarse a ciegas

| Vertical | Integrado por ROOT | Preservado para revisión posterior |
|---|---|---|
| V1 | Baseline CLI; fixtures de cancelación; seis archivos Windows de `d175143` en `9cdebff`; token OS corregido por ROOT en `9c1b51d` | `1080749` dogfood coordinado final sin ejecutar; launcher/script-launch no integrado. No volver a copiar todo `530b0e7` ni `7f39ff6`: transporte ya adaptado. |
| V2 | Registry/gates, temas, navegación, Files/Bots mount controlado, contraste/layout; diálogo final `8406e02` adaptado en `9c1b51d` | Catálogo completo de settings/shortcuts/deep links; Bots no anunciado por tener un botón o componente montable. |
| V3 | Servicio Files y protocolo/bridge; seguridad de lectura/guardado; borradores y UI; `f649040` limpieza final aceptada | Git wrapper/parser/worktree, remoto/browser y onSave. Wrapper no registrado; probarlo en su rama no lo integra en el producto. |
| V4 | Records/policies/runner/history/snapshot; `bot.create` nativo en `69fa9ed` con ledger canónico, autorización anterior al replay y rollback atómico | `bot.run` y propuestas alternativas de create/run no registradas; no reemplazar el adaptador ROOT por los ledger traits de la rama. Formularios/scheduler/Meetings/Mentu no completos. |
| V5 | Bootstrap y CI, verifier fail-closed, corpus de notices en `7cebf42` | `3a17a17` fixture Windows: si sale el daemon pero falla/cancela el hijo, todavía borra evidencia. No integrar esa limpieza; falta propagar resultado del hijo antes de remover fixture. E5 sigue abierto. |

Checkpoint V1 publicado en PR14: `1080749`; V2 PR11: `8406e02`;
V3 PR12: `1e59034`; V4 PR13: `3114bd7`; V5 PR15: `3a17a17`.
Todos esos commits quedaron publicados en sus ramas. Las ramas de líderes son propuestas preservadas,
no reemplazos de `codex/vertical-integration`. Usar `git show <SHA>:<path>`
desde el checkout de integración para leerlas sin escribir en otro checkout.

Archivos centrales para orientarse:

- `crates/drogon-core/src/lib.rs`: Engine, dispatch/admisión, capabilities.
- `crates/drogon-core/src/bot_mutation_rpc.rs`: creación ROOT integrada.
- `crates/drogon-core/src/workspace_files.rs` y tests `native_files_rpc`:
  Files nativo; consumidores usan el contrato de `crates/drogon-protocol`.
- `crates/drogond/src/endpoint.rs`, `server.rs`, `auth.rs`, `lock.rs`:
  transporte, límites de conexiones/drain, token privado, instancia única.
- `apps/desktop/src/renderer/src/App.tsx`: rutas, capabilities y montaje.
  No reemplazarlo con la variante completa de otra vertical.
- `scripts/package-desktop.mjs`, `accept-desktop.mjs`, `install-preview.mjs`:
  checkout limpio → paquete → aceptación sellada → instalación recuperable.

## 11. Inventario de workers y significado de su estado

[Inventario portable JSON](coordinator-handoff-2026-09-07-workers.json):
126 tareas de los cinco child Runs, con IDs, estados, paths declarados,
mensajes de cierre y recursos. Exportación por lista permitida de campos:
sin capabilities, tokens, raw transcripts ni variables de credenciales.
Los paths de reportes corresponden a la rama de su vertical, salvo integración
expresa; no asumir que todos existen en main. El estado de tarea, el de su
último intento y el de su terminal son dimensiones distintas.

Snapshot child Runs (sin Dispatch activo observado):

| Vertical | Run | Tareas | Estado de tareas | Recursos released / retained |
|---|---|---:|---|---:|
| V1 | `run_797122265fda` | 22 | 22 completed | 10 / 12 |
| V2 | `run_56d16f671133` | 22 | 22 completed | 10 / 11 |
| V3 | `run_da3c31d0e3d6` | 32 | 30 completed, 1 failed, 1 blocked | 13 / 19 |
| V4 | `run_5040a80fa6dd` | 24 | 23 completed, 1 blocked | 11 / 13 |
| V5 | `run_3de36bede2a3` | 26 | 26 completed | 18 / 8 |

No forzar igualdad entre #Tasks y #Dispatches; una tarea puede no haberse
despachado o tener intentos distintos. `retained` no es `exited` ni falta de
limpieza automáticamente: puede ser terminal externo, identidad no probada,
reutilización o retención persistida. En V4 hubo retenciones `user_requested`
puestas sin petición del usuario; ROOT pidió release de esos 11 intentos,
pero diez conservaron ese motivo en la respuesta y uno `identity_unproven`.
Se conserva la discrepancia, no se convierte en consentimiento ni se fuerza
`terminal close`. No reusar capabilities históricas al retomar.

V1 informó fin estable, pero perdió su capability original. Dos cierres fueron
rechazados y `task-update` tampoco admitió completar un Dispatch activo.
Después del handoff explícito `msg_1aa30c43274d`, ROOT hizo recuperación:
`worker-abandon` cercó el intento **sin acción de proceso**, luego marcó la
tarea completed con causa/ID del informe y ejecutó worker-release, que devolvió
retained/identity_unproven. Por tanto: tarea completed, intento failed/abandoned,
terminal retenido; NO worker_done válido y NO proceso declarado exited.

V2 cerró con `msg_11d1abcff867`; V5 con `msg_d4817db587c9`.
Ambos worker-release devolvieron retained/external_terminal, processAction none.
V3/V4 entregaron su informe final por el terminal exacto (cursores 3558 y 4344),
confirmando capability irrecuperable y checkpoint estable. ROOT repitió la
recuperación sin acción de proceso: intentos abandoned/failed, tareas completed
con causa, release retained/identity_unproven. El JSON incluye las tres
dimensiones y el resultado real de release; no reconstruye un worker_done.

V3 `1e59034` corrige el antiguo poll-error-as-done, pero el nuevo test de timeout
todavía muta `PATH` global con `unsafe set_var` mientras otros tests leen el
entorno. Encadenar luego el Git real evita resultados vacíos, no aísla el
entorno concurrente; además la fixture usa shell/PATH POSIX. ROOT mantiene
el wrapper sin integrar ni registrar: sustituir por entorno por-proceso o
fixture aislada y revalidar límites/reap/fallbacks antes de activar Git.

V4 conserva dos directorios locales no trackeados, declarados como held:
`tests/parity/ports/WP-CAP-DEVICE/` y `tests/parity/ports/WP-CAP-INT/` en su
worktree. No se publicaron ni se borraron; revisar procedencia/contenido antes
de cualquier cleanup. Su existencia no prueba tests portados/ejecutados.

## 12. Porcentajes, riesgos y recomendaciones de relevo

No existe una medición comparable de paridad inicial/final por vertical.
V1 estimó 5/12 (=42%) de sus entregables de ola verificados en su rama,
pero 0/17 filas audit completamente cerradas bajo otra lente; V2 estimó
10/16 (=62%) entregables de ola verificados en rama y 2/2 regresiones de
navegación corregidas. Son denominadores distintos, no porcentajes de
producto. V3/V4/V5 no tienen una cifra final comparable aceptada por ROOT.
No promediar estas cifras, 11/12 grupos documentales o tests PASS para
afirmar 90%. Las 46 obligaciones de paquetes siguen siendo el alcance.

Antes de reactivar implementación:

1. Confirmar checkout/branch/CI y leer los holds, sin relanzar líderes viejos.
2. Definir una rúbrica común por journey: source test portado, RED real,
   GREEN nativo, consumidor, render, plataforma/host y paquete.
3. Instrumentar cobertura del alcance y publicar líneas/ramas + exclusiones;
   el requisito 100% no se cumplió con contadores de tests.
4. Priorizar un bloque integrado pequeño: p. ej. flujo Bots create/run o Git
   seguro, con ownership de registro y protocolo explícito, antes de más
   módulos exportados sin consumidores.
5. Mantener held el dogfood completo y el benchmark DGX hasta decidir sus
   condiciones y autoridad; una prueba real previa no autoriza nuevas llamadas.

Prueba real previa aceptada: una respuesta Sonnet 5 el 7 de septiembre a
13:19 UTC por daemon/CLI nativos, salida observada exited y coste reportado
US$0.137132; no fue el journey coordinado artifact/failure/retry completo.
No convertir ocho casos opt-in omitidos en ocho ejecuciones reales exitosas.

Riesgos abiertos: E5/redistribución y backend propio; hardening ACL de data-dir
Windows; skew/SSH/WSL y Git de hosts heterogéneos; fixture Windows de V5;
paridad amplia de editor/review/automations/Mentu/Meetings; cobertura sin medir.
Los tests sintéticos y el corpus de notices verifican sus contratos acotados,
no autorización legal, privacidad de datos reales ni compatibilidad universal.
