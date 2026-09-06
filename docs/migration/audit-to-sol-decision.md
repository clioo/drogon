# Audit → Sol: separación autorizada

Carlos respondió **«autorizo»** a la pregunta de iniciar Sol en trabajo técnico
independiente manteniendo bloqueadas publicación y decisiones de servicios.
La excepción de fase queda aprobada el 6 de septiembre de 2026. Las secciones
de propuesta/espera de abajo son el registro previo, no el estado vigente.
E5 continúa abierto; no se concedieron derechos ni se eligió una política de
servicios. El reparto operativo está en `sol-test-wave.md`.

Estado al 6 de septiembre de 2026, tras `f33bf85`. Este documento prepara el
relevo; no lo autoriza ni cambia los gates acordados.

## Estado comprobado

- Audit: 11/12 bloques aceptados (91.7%, confianza media en caracterización
  de fuente), sin incremento por nuevos documentos o tests aislados.
- Orca está disponible. El Run `run_97a755fdd5dd` devuelve cero tareas
  `dispatched`; Seti `ctx_a9bdf7c77130` está `completed/succeeded`.
  Sus terminales externos retenidos no significan agentes trabajando.
- E1–E4 y los contratos finitos de E5 están revisados. Seti tiene aceptación
  acotada en `e5-seti-root-review.md`; no hace falta repetir ese audit.
- E5 sigue abierto por disposiciones de recursos/publicación/servicios.
  Los 9037 archivos originales y 46 paquetes de pruebas siguen en alcance.
- Las pruebas originales ejecutadas no prueban la reescritura. T1–T4,
  capturas, plataformas y aceptación del paquete permanecen pendientes.

## Separación recomendada, todavía no aprobada

Permitir trabajo técnico independiente con Sol sin declarar E5 cerrado ni
publicar recursos o activar servicios cuya autorización falta. Es una excepción
explícita a la secuencia anterior de esperar E5 completo; un «continúa» genérico
no se registra como autorización de esta excepción.

| Pendiente | Qué permanece bloqueado | Qué puede prepararse sin resolverlo |
| --- | --- | --- |
| AO-RIGHTS / SN-U1 / SN-R1 | Publicar imágenes sin derechos acreditados, sustituir personajes o aprobar usos de marca | Contratos, componentes y pruebas con fixtures sintéticos sin copiar esos recursos |
| AO-RECORDINGS | Publicar grabaciones personales o sustituir las originales sin acuerdo | Guiones de captura y perfiles sintéticos; la aceptación visual sigue debida |
| AO-NOTICES | Declarar aceptado el distribuible sin inspeccionar sus avisos | Integrar procedencia ya verificada y preparar comprobaciones de empaquetado |
| AO-SERVICE | Provisionar destinos, enviar datos reales o elegir operador/región/retención por el usuario | Contratos y pruebas locales aisladas; nunca declarar equivalente el backend privado ausente |

Aceptar esta separación no autoriza ninguna de las acciones bloqueadas.
Si se mantiene la secuencia anterior, el relevo a Sol espera esas decisiones.

## Reparto propuesto tras la decisión

Se conserva el reparto preliminar de tres responsables del plan de paridad,
no cinco Astra permanentes. Cada responsable será una sesión Sol nueva,
verificada por su lanzamiento real, con su Task/Dispatch de Orca.

| Responsable Sol | Ámbito | Primer entregable, antes de features |
| --- | --- | --- |
| Desktop | Shell, navegación, preferencias, terminal visual y recorridos | Mapa de assertions fuente → tests candidatos y estados de captura; no editar el App compartido desde varios workers |
| Motor y CLI | Persistencia, host ownership, transporte, ejecución, contratos y comandos | Baselines/ports completos por paquete; fallos comportamentales verificables, no fallos de compilación |
| Trabajo e integraciones | Archivos/Git, orquestación, harnesses, automatizaciones y deltas Drogon existentes | Pruebas de contratos, recuperación y compatibilidad; Mentu conserva sus obligaciones y ruta de PR upstream |

Root asignará los 46 paquetes existentes sin duplicados ni omisiones antes de
despachar. Esta tabla no sustituye esa asignación ni otorga ownership de carpetas.
Cada Task recibirá archivos exclusivos, dependencias, efectos prohibidos,
comandos de aceptación y salida concreta. Manifiestos, lockfiles, wire contracts,
Git e integración siguen siendo de root; los cambios pendientes se preservan.

Primero un ciclo real Sol → worker → entrega revisada → release; después,
responsables independientes en paralelo, inicialmente un worker hoja por Sol.
Pool: Sonnet 5, GLM-5.3-Flash, Muse 1.3 y DeepSeek V4 Flash, condicionado a cuota
verificada. No reintentar un proveedor agotado ni cambiar ajustes globales.
Pi + Qwen en DGX Spark se reserva para inferencia de pruebas, sin fallback cloud.

Secuencia de cada capacidad: baseline original → port equivalente revisado →
RED comportamental cuando corresponda → implementación → GREEN integrado →
capturas/recuperación → paquete probado → instalación segura. No introducir
fallos artificiales en capacidades ya verdes ni rebajar assertions.

## Siguiente acción

Esperar la decisión de separación. No lanzar más auditorías de procedencia
indefinidas ni mantener agentes ociosos como si implementaran. Tras aprobación,
registrar la excepción en los contratos centrales y despachar la primera ola
de tests con Sol. Sin aprobación, conservar el bloqueo explícito de fase.

El riesgo frente a la referencia flexible de 24 horas sigue siendo alto; no hay
una ETA de paridad completa defendible. No se reinstaló producto en este bloque
documental, no se publicaron recursos y no se ejecutó una recipe de Mentu.
