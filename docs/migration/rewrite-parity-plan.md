# Plan de reescritura con fidelidad completa

**Excepción autorizada, 6 de septiembre:** Carlos permite iniciar trabajo técnico
independiente con Sol sin esperar las decisiones de publicación/recursos/servicios
de E5. Estas quedan bloqueadas y E5 no se declara cerrado. Esta decisión sustituye
la secuencia histórica de espera completa descrita abajo, no los gates tests-first
ni el alcance. Véanse `audit-to-sol-decision.md` y `sol-test-wave.md`.

Estado: planificación en curso, 2026-09-05. Este documento sustituye el alcance
reducido de «foundation/MVP», **no** declara paridad conseguida. No empieza otra
ola de features hasta cerrar el inventario y el contrato de aceptación.
Decisión del usuario del 5 de septiembre: **tests primero, features después**.
Se inventaría y porta la suite completa antes de la siguiente ola de producto;
la preparación de fixtures/adaptadores de pruebas no cuenta como una feature.

## Actualización de coordinación — 6 de septiembre

La instrucción de Carlos sustituye la restricción histórica de auditoría plana:
cinco responsables Astra pueden trabajar sobre E1–E5 y delegar a un worker
hoja cada uno si el runtime lo permite. La asignación vigente y sus límites están en
`audit-closure-coordination.md`. Los gates de fidelidad/tests no cambian.
Las 24 horas son una referencia flexible; excederlas unas horas es aceptable.
No modificar ajustes globales ni eludir límites de anidamiento.

**Aclaración posterior del usuario, 6 de septiembre:** estos cinco Astra son
exclusivamente para acelerar el audit. Una vez que el coordinador acepte su
cierre completo, la implementación se organiza como **Astra coordinador →
responsables Sol → workers de los modelos aprobados**. El cambio se realiza
con entregas revisadas, hijos liquidados y nuevas asignaciones identificadas;
no se cambia el modelo de una sesión activa ni se da por aceptado el audit
porque haya terminado un informe. Astra conserva arquitectura, integración,
pruebas independientes y aceptación. Pi + DGX sigue destinado a las pruebas
reales y la comparación controlada, independientemente del modelo que desarrolle.

## 1. Qué significa terminar

El objetivo es conservar la experiencia completa de Orca y todos los cambios
ya realizados en Drogon. «Funciona la terminal» no equivale a «migración lista».
La marca visible pasa a Drogon; las atribuciones/licencias originales se
conservan. No se retiran features para cumplir la ventana deseada de 24 horas.
El plazo del hackathon no convierte un resultado parcial en aceptación.

La unidad de trabajo es una **capacidad observable**, no una carpeta ni una
tarea genérica como «hacer el frontend». Cada capacidad debe registrar:

- Identificador estable, fuente exacta y comportamiento anterior.
- Entrada de UI/CLI, parámetros, atajos, preferencias y permisos aplicables.
- Estados normal, vacío, carga, error, desconexión, recuperación y reinicio.
- Dependencias, plataforma/host, folder workspace o Git worktree.
- Implementación reutilizada o reescrita, propietario y archivos asignados.
- Pruebas y capturas exigidas, revisión independiente y versión instalada.

Estados separados: `discovered`, `specified`, `implementing`, `reported`,
`verified`, `installed`. Un `worker_done` solo llega a `reported`; no acepta la
capacidad. `blocked`/`unverifiable` no se transforman en `verified`. Una feature
que ya fallaba en el producto anterior se documenta como defecto de origen,
no se replica silenciosamente ni se elimina del inventario.

## 2. Tres referencias, nunca confundidas

1. **Fuente de migración:** `clioo/drogon-orca`, checkout de referencia
   `/Users/carlos/Documents/Drogon-mentu-session`, HEAD
   `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. En la comprobación del 5 de
   septiembre no había cambios tracked; el único untracked era el plan
   `.mentu/plans/drogon-rewrite-preflight.md`. No modificar ese checkout.
2. **Orca que usa Carlos:** instancia abierta `com.stablyai.orca`. Sirve para
   observar experiencia real, no para inferir que su binario corresponde al
   commit anterior. Registrar versión/hash por captura cuando sean conocidos.
3. **Drogon nuevo:** `/Users/carlos/Documents/Drogon-rewrite`, repo público
   independiente `clioo/drogon`. El checkpoint comprometido `09c728f` prueba
   únicamente el corte nativo inicial. Las correcciones y el empaquetado
   posteriores siguen pendientes de integración/aceptación independiente.

El handoff antiguo describe un paquete `Drogon Mentu Preview.app`, pero esa
ruta no existía al comprobarla ahora. No llamarlo instalación actual. Tampoco
convertir `out/` antiguo o capturas históricas en evidencia del nuevo build.

## 3. Inventario y controles contra omisiones

Las auditorías paralelas complementan los inventarios iniciales, que no eran
exhaustivos. Sus resultados se consolidan en un registro canónico de capacidades:

| Auditoría | Responsable actual | Salida |
| --- | --- | --- |
| UI, navegación, formularios, menús, atajos y estados | Claude Sonnet 5 | `parity-ui-audit.md` |
| CLI pública, skills y orquestación completa | Censo de registros y parser aceptado como metadata; semántica por handler pendiente | `parity-cli-audit.md`, `parity-source-contracts.json`, `parity-cli-argument-contract.json` |
| Plataformas, preferencias, contratos y servicios | Muse Spark 1.3 Contributor / OpenCode Go | `parity-platform-audit.md` |
| Cambios Drogon: Mentu, Bots, Meetings, marca y pendientes | GLM-5.3-Flash / Z.AI Coding Plan | `parity-drogon-delta-audit.md` |
| Consolidación, contradicciones, capturas y aceptación | Coordinador | Este plan y registro de evidencia |
| Censo reproducible de suites/tests/configs/fixtures | Muse Spark corrige y valida el censo inicial de GLM | `parity-source-tests.json`, `parity-test-inventory.md` |
| Contratos completos interfaz/motor, canales y registros RPC | Claude Sonnet 5 | `parity-source-bridges.json`, `parity-bridge-enumeration.md` |
| Portabilidad de assertions y contrato de doble ejecución | Muse Spark 1.3 Contributor | `parity-test-porting.md` |
| Ajustes/atajos y propiedades persistidas | Metadata verificada por coordinador; bindings y comportamiento pendientes | `parity-settings-keybindings.{json,md}`, `parity-settings-properties.{json,md}` |
| Catálogo de harnesses y sus registros de capacidades | 36 IDs y registros de probes reconciliados; no pruebas de modelos | `parity-harness-catalog.{json,md}` |
| Guías incluidas y registros de skills/proveedores | Censo estático y proyecciones verificados por coordinador | `parity-skill-provider-catalog.{json,md}` |

Los catálogos de ajustes/atajos y las 28 fichas UI son checkpoints de fuente,
no un inventario completo aceptado ni pruebas de funcionamiento. La matriz de
runners es un índice de referencias con ejemplos pendientes de concretar;
ninguna de sus filas es despachable todavía. El progreso y las correcciones
de afirmaciones anteriores se registran en `tests-first-checkpoint.md`.

Antes de congelar el registro hay que reconciliar: comandos/help/flags y
skill-guides; rutas, menús y atajos; preload/IPC/RPC; preferencias persistidas;
catálogos de harnesses, proveedores y capacidades de host; flujos del handoff.
Todo elemento enumerado debe mapear a una capacidad o a una razón explícita de
«interno/no observable». Ninguna lista desconocida puede contar como cubierta.
Se revisa además el inventario contra tests históricos y assets de features.

Los grupos iniciales que no pueden desaparecer son:

| Grupo | Experiencia que debe descomponerse y conservarse |
| --- | --- |
| Shell | Ventana, sidebar, navegación, tabs, splits, drag/drop, foco, estado y restauración |
| Proyectos | Repos, host setups, Git worktrees, folders, linaje, contextos y environment recipes |
| Terminal | Entrada, IME, Unicode, selección, enlaces, búsqueda, scrollback, resize, salida, reapertura |
| Harnesses | Detección, catálogo completo, modelos, cuentas, preferencias, launch/resume y estado |
| Archivos | Explorer, filtros, watchers, editor, guardar, documentos, previews y diffs |
| Git/review | Stage/unstage, commits, ramas, historial, reviews, checks, GitHub/GitLab y compatibilidad |
| Orquestación | Run, Task, Dispatch, DAG, mail, ask/reply, gates, waits, takeover, fencing y release |
| Automatizaciones | Crear/editar/pausar, calendarios, propietarios, ejecuciones, fallos e historial |
| Herramientas | Browser/tab/profile, artefactos, compartir skills, CLI y sus contratos públicos |
| Historial | Sesiones, búsqueda, vault/memoria cuando existe, archivos, notificaciones y recuperación |
| Preferencias | Todas las secciones, tema, idioma, accesibilidad, atajos, permisos y privacidad |
| Hosts | macOS/Linux/Windows, SSH/WSL, pairing/relay, host ownership y versiones mixtas |
| Companion | Mobile, voz, simuladores/emuladores, integraciones externas presentes en la fuente |
| Distribución | Instalación, CLI accesible, datos, backup, actualización, rollback y diagnósticos |
| Mentu | Panel derecho y pestaña de sesión sincronizados; receta, aprobación, grafo, ejecución y evidencia |
| Bots | Personaje/foto/nombre, chat persistente, personalidad, skills, harness y responsabilidades |
| Reactividad | Scripts/hooks/polling deterministas generados, inspeccionables y probables; dedupe y delegación |
| Proactividad | Horario determinista; evaluación del agente al despertar; seguimiento y responsabilidad |
| Meetings | Write That Down, espacios compartidos, transcripciones, consultas y acciones útiles |

Esta tabla es un índice, **no** un porcentaje de cobertura ni el denominador
final. «100%» solo se puede comprobar tras cerrar la enumeración granular.

## 4. Arquitectura elegida para preservar fidelidad

- Mantener Electron + React y reutilizar los componentes reales de Orca,
  incluyendo sus tokens, primitives, interacciones y lógica de presentación.
  No reconstruir toda la UI como una versión simplificada a partir de capturas.
- Rust posee el servicio de ejecución, persistencia/ownership y `drogon-cli`.
  El renderer continúa aislado: bridge estrecho, contratos versionados y sin
  permisos de ejecución/FS directos.
- Separar puertos de servicio por dominio. Congelar tipos y invariantes antes
  de asignar frontend y backend simultáneamente. Generar/verificar bindings
  entre Rust y TypeScript para evitar dos definiciones divergentes.
- Reutilizar lógica pura TypeScript y helpers nativos probados cuando conservarlos
  reduzca riesgo. No traducir por traducir todo a Rust. Documentar procedencia,
  licencia y dependencias; ninguna dependencia ejecutable oculta de Orca en el
  producto final.
- Los servicios externos de Orca no se heredan como si fueran infraestructura
  propia: registrar cada dependencia y el equivalente de Drogon. No copiar
  credenciales, feeds de update ni publicar datos en destinos ajenos.
- Datos antiguos: importación/versionado explícitos con backup y rollback;
  nunca abrir ni migrar destructivamente el perfil activo de Orca durante QA.

## 5. Orquestación asíncrona, con ownership explícito

Se usan los contratos oficiales de Orca: Run → Task → Dispatch, mail durable,
ask/reply, recibos, consumo FIFO con ack y release del worker exacto. El Run
no es un scheduler: el coordinador decide dependencias, conflictos y capacidad.

Cada tarjeta futura lleva `capabilityIds`, `sourceRevision`, `contractVersion`,
`readPaths`, `writePaths`, `dependsOn`, `acceptanceCommands`, `screenshotStates`,
`forbiddenEffects`, `reportPath`, `reviewer` y `rollback`. Un agente no amplía su
ownership. Cambios de contrato/manifiestos/lockfiles/Git son del coordinador.

Se lanzan **todas las tarjetas independientes disponibles antes de esperar**.
Inicialmente hasta seis implementadores/revisores activos, ajustables al estado
real de proveedores y máquina; pueden existir varios workers del mismo modelo
en módulos diferentes. Durante esta auditoría no hay swarms anidados. Un único
dueño escribe cada archivo.
Carlos autorizó explícitamente worktrees y PRs para distribuir la siguiente
fase. El aislamiento se decide por bloque de cambio coherente, no por generar
un checkout por cada agente. No se mezclan dos editores en `App.tsx`.

Flujo: ready → dispatch → report → revisión de otro contexto → pruebas del
coordinador → integración → prueba empaquetada → instalación. Reporte o timeout
no significan proceso terminado. Antes de reemplazar un worker se resuelve su
estado y se retira su autoridad/ownership exactos; nunca dos intentos escribiendo
la misma tarea. Cuota agotada pausa ese proveedor y redistribuye solo trabajo
no activo o ya asentado. No bucles de reintento contra una cuota conocida.

### Jerarquía autorizada para después de la auditoría

Carlos pidió una jerarquía de tres niveles y precisó que debe empezar **solo
después de terminar esta auditoría**. No se activan todavía coordinadores Sol,
ni se cambia el límite de anidamiento del runtime durante el inventario.

```text
Astra — arquitectura, contratos compartidos, aceptación e instalación
  ├─ Sol — experiencia desktop y recorridos
  │    └─ workers — tests y luego features dentro de paths asignados
  ├─ Sol — motor, hosts y CLI
  │    └─ workers — tests y luego features dentro de paths asignados
  └─ Sol — capacidades de trabajo e integraciones
       └─ workers — tests y luego features dentro de paths asignados
```

Este reparto es preliminar; el inventario completo determinará los límites
concretos. Cada Sol posee un subconjunto disjunto de capacidades, tareas y
workers del pool aprobado; no una copia del backlog entero. Los workers hoja
no delegan. Astra conserva los archivos compartidos, integración/Git, revisión
cruzada y aceptación final. Los Sol deben recibir y resolver los resultados de
sus hijos antes de declarar su trabajo terminado; un reporte de un hijo no es
evidencia suficiente de aceptación.

El cambio de jerarquía exige resolver las asignaciones planas existentes antes
de transferir su ownership, verificar el soporte real de anidamiento en Orca y
probar un ciclo pequeño Sol → worker → resultado. Tres niveles humanos implican
dos generaciones delegadas; comprobar la semántica de la versión instalada
antes de ajustar el límite. No eludir un rechazo del runtime creando otro Run
o declarando una identidad ajena. Todo ello queda después del gate de auditoría.

### Worktrees, ramas y PRs de la siguiente fase

- Un worktree/branch `codex/...` por bloque independiente con un PR revisable,
  source/test map y criterio de aceptación concretos. Un Sol puede coordinar
  varios bloques; sus workers escriben paths exclusivos en el checkout de su
  bloque. No se heredan cambios sin commit de otra tarea por accidente.
- Publicar primero la base revisada de contratos y herramientas de tests.
  Las ramas independientes parten de la base integrada; usar ramas apiladas
  solo cuando haya una dependencia real y declarar esa relación en los PRs.
- Los contratos globales, manifiestos y lockfiles tienen un propietario central.
  Un worker propone el cambio que necesita; no resuelve divergencias duplicando
  contratos ni alterando esos archivos desde varias ramas simultáneamente.
- El PR contiene procedencia, pruebas originales/equivalentes, resultados RED
  y GREEN aplicables, capturas, riesgos y rollback. Una revisión independiente
  comprueba el comportamiento, no solo que el diff compile.
- Astra resuelve la cola de integración, ejecuta las regresiones pertinentes en
  la combinación real, valida el paquete e instala el nuevo build verificado.
  Que cada rama esté verde no implica que su combinación también lo esté.
- Conservar los worktrees, cambios y evidencia mientras tengan sesiones o trabajo
  vigente. No cerrar terminales ni eliminar checkouts ajenos para limpiar ramas.
  La transición empieza tras la auditoría; los writers actuales conservan su
  asignación hasta que quede asentada y transferida explícitamente.

## 6. Olas y dependencias

```text
Inventario + capturas + diferencias Drogon + contratos
                         │
       Censo completo de tests + baseline de Orca
                         │
      Suite portada + revisión de equivalencia + RED
                         │
             Gate de alcance y fidelidad
                         │
      ┌──────────────────┼───────────────────┐
      │                  │                   │
 Shell/terminal     Proyectos/archivos   Hosts/persistencia
      │                  │                   │
      └────────────┬─────┴───────────────────┘
                   │
     ┌─────────────┼──────────────┬────────────────┐
     │             │              │                │
 Git/checks    Harnesses/CLI   Browser/tools   Orquestación
     └─────────────┴───────┬──────┴────────────────┘
                          │
      Preferencias/integraciones/companion + paridad restante
                          │
         Dogfood nativo + aceptación de migración
                          │
        Pendientes Mentu/Bots/Meetings + A/B Spark
```

Las olas son gates de integración, no cadenas que obligan a dejar ociosos todos
los workers. En cada ola se abren módulos independientes; se pueden preparar
pruebas/fixtures de la siguiente con contratos ya congelados. Los cambios de
Drogon **ya implementados** se preservan dentro de su ola correspondiente;
solo el trabajo que ya era pendiente se ejecuta después de aceptar la migración.
Mentu no desaparece hasta la última ola por el hecho de ser una adición.

### Gate tests-first

1. Congelar la revisión fuente y enumerar todas las suites, configuraciones,
   snapshots, fixtures y comprobaciones de CI; incluir exclusiones y tests
   dinámicos. Archivos de test no equivalen a casos ejecutados.
2. Establecer el baseline de Orca en entornos aislados. Registrar por separado
   PASS, fallo de origen, flaky y bloqueo de entorno. No ejecutar suites que
   afecten sesiones personales, sistemas externos o datos reales sin aislarlas.
3. Conservar los originales y un mapa fuente → contrato → test de Drogon.
   Reutilizar tests TypeScript cuando encajen; traducir los ligados al motor
   Rust conservando inputs, invariantes y resultados esperados. No traducir
   mecánicamente imports internos ni obligar al nuevo motor a imitar su diseño.
4. Preparar runners de doble destino para contratos observables de CLI/RPC,
   persistencia y journeys. Aprobar por revisión independiente la equivalencia
   de los tests portados antes de implementar las features correspondientes.
5. Obtener RED verificable en Drogon por comportamiento ausente/incorrecto.
   Un fallo de compilación, runner roto o fixture ausente no demuestra RED.
   Lo ya implementado puede estar verde: no introducir defectos para teñirlo rojo.
6. Implementar por capacidad hasta GREEN; exigir además regresiones, capturas,
   interacción real, revisión independiente y aceptación del paquete instalado.

No eliminar tests, relajar assertions, aceptar snapshots automáticamente ni
simular la propia implementación ausente para obtener verde. Los mocks de
dependencias externas pueden conservarse, pero no sustituyen pruebas reales
del contrato de Drogon. Tests pendientes/bloqueados no cuentan como PASS y
ningún incremento de cobertura reduce el denominador original silenciosamente.
Cambios deliberados de contrato, como la marca Drogon, se documentan como
deltas aprobados y se revisan antes de cambiar expectativas.

La suite histórica es el mínimo, no garantía por sí sola de 100% de fidelidad.
Todo comportamiento descubierto sin cobertura requiere caracterización nueva.
Un test imposible de portar literalmente conserva su obligación equivalente;
si falta entorno para probarla, la capacidad sigue sin verificar y no se declara
el gate completo. El registro distingue tests originales, portados, ejecutados,
fallidos y pendientes, sin confundir su número con la cobertura de features.

## 7. Modelos y separación estricta entre construir y probar

Desarrollo/revisión: Claude `claude-sonnet-5`, OpenCode
`zai-coding-plan/glm-5.3-flash`,
`alibaba-token-plan/deepseek-v4-flash-0731`,
`opencode-go/muse-spark-1.3-contributor`.
AGY `gemini-3.8-flash-medium` queda disponible al recuperar cuota, no se insiste
mientras siga bloqueado. Cada nuevo proveedor debe pasar lectura/escritura
acotada, herramienta, reporte y lifecycle antes de recibir código crítico.

Muse Contributor solicita opt-in de uso de datos para mejorar el modelo;
haberlo seleccionado no se toma como aceptación automática de esa condición.
Carlos autorizó el consentimiento y confirmó que activó el opt-in; la cuenta
lo mostraba habilitado y el worker retomó lecturas y entregó su auditoría.
No se cambiaron otros permisos ni preferencias de proveedores. DeepSeek también
produjo una lectura y mensaje de smoke observados.

**Pi + Qwen DGX no son desarrolladores delegados.** Se reservan a pruebas reales
de Drogon y comparación con/sin Mentu. Endpoint de modelos consultado de nuevo:
`qwen3.6-35b-a3b-nvfp4-fast` presente; listado no equivale a inferencia verificada.
No fallback cloud, ni juez cloud del benchmark. Medir input/output/cache/unknown,
reintentos y finish_reason; desconocido nunca se contabiliza como cero.

No imponer una feature `inference_budget`. Se puede usar ampliamente la Spark.
La comparación conserva controles experimentales iguales y límites operativos
predeclarados para detectar loops; no cambiar el experimento después de ver
resultados ni usar más tokens solo en la rama que convenga.

## 8. Capturas y pruebas de fidelidad

Para cada estado UI: misma plataforma, viewport/DPR, tema, idioma, datos de
fixture y punto de interacción. Guardar referencia/candidato/diff, revisión y
hash del build. Enmascarar solamente datos verdaderamente dinámicos enumerados
antes de la comparación, nunca ocultar una diferencia visual para pasar.
Revisar texto, tokens, geometría, densidad, foco/teclado, menús, tabs y scroll;
un pixel-diff solo no demuestra equivalencia funcional.

Capturas de la instancia personal son referencias locales, no artefactos para
el repositorio público. No publicar nombres de proyectos, conversaciones,
credenciales ni historial. Tests nuevos: perfiles y repos de fixture aislados,
Electron/Playwright CDP. No reiniciar la instancia personal para habilitar CDP.
El intento inicial en la instancia personal quedó bloqueado por permiso de
Accesibilidad; no se cambió ese permiso. Posteriormente sí se obtuvieron
capturas por Electron/Playwright de una copia independiente del commit fijado,
con perfil sintético y cinco protecciones de fixture documentadas en
`parity-reference-launch-audit.md`. Hay referencias de Bots y ajustes bajo
`reference-captures/`; no son capturas de aceptación de la reescritura. El
recorrido adicional de Mentu mostró un runtime ausente en esa copia y exigió
limpieza manual del daemon identificado: no prueba ejecución ni cierre sano.

Matriz obligatoria por capacidad aplicable: macOS/Linux/Windows; local/SSH/WSL;
folder/Git; claro/oscuro; ancho/estrecho; ratón/teclado/IME; éxito/error/retry;
desconexión/reload/reinicio; versiones mixtas. `not_applicable` requiere razón.
Si falta una máquina, se registra `unverified`, no «cross-platform pasó».

Se toman baselines de arranque, memoria, latencia de entrada/redraw y concurrencia
con las mismas cargas antes de fijar umbrales de regresión. Los presupuestos y
variación aceptable se congelan antes de evaluar el candidato. El benchmark de
Mentu es una comparación distinta, no sustituto de estas pruebas de producto.

## 9. Instalación continua y cierre

Después de cada bloque **verificado**: commit identificado, build reproducible,
prueba del paquete real, instalación versionada y acceso estable. Conservar
build anterior y datos; mostrar revisión en la app. No forzar cierre ni matar
el daemon con sesiones vivas para instalar. Indicar si la UI nueva todavía está
conectada a un runtime compatible anterior.

El gate final exige: inventario cerrado; cero capacidades requeridas sin aceptar;
capturas y journeys completos; pruebas negativas/recuperación; plataformas
verificadas; migración reversible; CLI propia; tarea real orquestada por Drogon
sin `orca-cli` por debajo; build instalado y handoff/recipes/evidencias vigentes.

Los borradores actuales de packaging no están instalados ni aceptados. La
implementación queda pausada en el gate de planificación solicitado; esos
cambios se preservan y se revisarán, no se borran ni se presentan como terminados.

## 10. Cambio recomendado del goal

Sí conviene reforzarlo: el goal actual habla de rewrite funcional y conserva
una plantilla de tres workers, pero ahora el requisito explícito es paridad
completa y un pool ampliado. Al terminar las auditorías se entregará el texto
consolidado en `rewrite-parity-goal.md` para cambiarlo sin marcar falsamente el
goal anterior como completado. Este documento no cambia por sí solo el goal de
Codex ni activa una automatización.
