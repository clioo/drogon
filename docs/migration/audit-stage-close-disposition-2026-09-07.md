# Disposición de los 86 hallazgos al cerrar la etapa

Baseline audit: `252de85`; revisión de integración: `9c1b51d`. Esta es una
capa de seguimiento: no modifica el audit congelado ni recalcula sus resultados.
Solo dos regresiones puntuales se marcan cerradas. Una fila parcial conserva
sus criterios originales pendientes; no sumar estas filas como porcentaje.

Referencias: [matriz original](ux-parity-audit-252de85/matrix.md),
[evidencia ROOT](verticals/root-integration-2026-09-07.md),
[cierre settings/auth](verticals/root-stage-close-verification-2026-09-07.md).
Los criterios y fuentes exactos de cada ID permanecen en matrix.json.

| ID | Prioridad fuente | Estado al cierre | Evidencia o trabajo pendiente |
|---|---|---|---|
| UX-NAV-01 | P1 | parcial integrado | Rutas Files/Bots montadas con capability gates; Bots no anunciado como feature operativa; faltan Meetings/Automations/Mentu. |
| UX-BOTS-01 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-BOTS-02 | P1 | parcial integrado | ROOT 69fa9ed registra bot.create con ledger atómico y pruebas Engine; formulario, responsabilidad, run y capability operativa siguen pendientes. |
| UX-BOTS-03 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-BOTS-04 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-BOTS-05 | P1 | parcial integrado | Runner/history/storage y snapshot integrados y testeados; run RPC y journey de ejecución siguen retenidos. |
| UX-BOTS-06 | P2 | diferido fuente/alcance | Conservar el límite fuente; no añadir funcionalidad pendiente ni portar placeholders como paridad. |
| UX-AUTO-01 | P1 | parcial integrado | Contratos execution policy/runner integrados; no scheduler/precheck/dispatch operativo de punta a punta. |
| UX-AUTO-02 | P1 | parcial integrado | Historial monotónico/atómico integrado; falta reconciliación y UI de ciclo completo. |
| UX-AUTO-03 | P1 | parcial integrado | Contratos de ownership portados; no admitir ejecución automática por existir records. |
| UX-MENTU-01 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-MENTU-02 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-MENTU-03 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-MEET-01 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-MEET-02 | P2 | diferido fuente/alcance | Conservar el límite fuente; no añadir funcionalidad pendiente ni portar placeholders como paridad. |
| UX-MEET-03 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-MEET-04 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-MEET-05 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-NAV-01 | P1 | parcial integrado | Registry de paneles y gates existentes, no toda la taxonomía/visibilidad fuente. |
| UX-SHELL-NAV-02 | P1 | parcial integrado | 9c1b51d añade diálogo de apariencia e inspector; no cierra 35 panes, search ni deep links. |
| UX-SHELL-VIS-01 | P1 | parcial integrado | Temas light/dark/system y cambios del sistema verificados por CDP; no catálogo de fuentes ni sincronización móvil. |
| UX-SHELL-VIS-02 | P2 | parcial integrado | Tokens, contraste y geometría 1440/760 verificados; no identidad visual completa. |
| UX-SHELL-WS-01 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-SHELL-WS-02 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-WS-03 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-J-01 | P1 | parcial integrado | Files listado/lectura y geometría aceptados en be192c5; faltan toolbar, filtro, árbol completo y acciones fuente. |
| UX-SHELL-J-02 | P1 | parcial integrado | Edición de texto, borradores y guardado real aceptados en be192c5; no Monaco/diffs/notebooks/autosave equivalente. |
| UX-SHELL-J-03 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-J-04 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-J-05 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-J-06 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-K-01 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SHELL-K-02 | P2 | parcial integrado | Teclado y foco; 9c1b51d añade modal nativo y CDP Tab/ShiftTab/Escape/inert; no auditoría a11y completa. |
| UX-SHELL-K-03 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-RT-D-01 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-D-02 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-D-03 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-D-04 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-D-05 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-RT-D-06 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-E-01 | P1 | parcial integrado | Picker/CLI y prueba Sonnet acotada aceptados; dogfood coordinado final retenido, no breadth fuente. |
| UX-RT-E-02 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-E-03 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-E-04 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-RT-F-01 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-F-02 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-F-03 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-F-04 | P1 | parcial integrado | CLI nativa de coordinación y baseline V1 integrados; no 234 comandos equivalentes. |
| UX-RT-F-05 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-RT-F-06 | NIT | base preservada; no recertificada completa | Reutilizar el contrato nativo aceptado y ejecutar el journey original; la fila no certifica paridad global. |
| UX-SURFACE-01 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-02 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-03 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-04 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-05 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-06 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-07 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-08 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-09 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-10 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-11 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-12 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-13 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-14 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-15 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-16 | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-17 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-18 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-19 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-20 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-21 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-22 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-23 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-24 | P2 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-25 | NIT | diferido fuente/alcance | Conservar el límite fuente; no añadir funcionalidad pendiente ni portar placeholders como paridad. |
| UX-MENTU-CP | P2 | decisión de alcance pendiente | Registros formales ausentes en fuente caracterizada; no convertir logs/Tasks/receipts en compromisos. |
| UX-AUTO-APPROVAL | P2 | decisión de alcance pendiente | Preservar autorización general; approval dedicado requiere decisión explícita. |
| UX-PLATFORM-WINDOWS | P1 | parcial integrado | Named pipes/locks/ACL y fixture CI incorporados; 9c1b51d corrige token OS. Esperar ejecución Windows, no inferir paridad desde Mac. |
| UX-RECOVERY-PENDING | P2 | parcial integrado | Estados recovery/pending corregidos por V2 5800537; repetir exactamente el repro audit de latencia antes de cerrar esta fila. |
| UX-MENTU-RECORD-OBS | P2 | abierto | No copiar estado persistido como prueba live/exited; obtener observación independiente del host. |
| UX-SURFACE-PORTS | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-SKILLS | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-ARTIFACTS | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-SURFACE-TASKS | P1 | abierto | Sin evidencia posterior suficiente para cerrar el journey de esta fila. Consultar aceptación y dependencia en la matriz original. |
| UX-NAV-ACTIVE-WORKSPACE | P1 | cerrado acotado | V2 518e4cb / ROOT 02d3735; repro CDP con sesión/host/incarnation conservados. |
| UX-NAV-RESTORE-WORKSPACE | P1 | cerrado acotado | V2 518e4cb / ROOT 02d3735; selección persistida y repro CDP tras reload. |
