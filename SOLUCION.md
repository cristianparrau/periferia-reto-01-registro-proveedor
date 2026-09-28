# SOLUCIÓN — Reto 01 · Registro como Proveedor

## 1. Problema en una frase
El área administrativa transcribe a mano, en cada registro como proveedor, datos y soportes que ya existen en un repositorio interno. Esto le cuesta tiempo a la analista administrativa, genera riesgo de error en datos sensibles (NIT, cuenta) y retrasa la facturación.

## 2. Arquitectura
```
web/index.html (chat) ──HTTP──▶ src/server.ts ──▶ src/agente.ts (ciclo)
                                                   │        │
                                                   │        └─▶ src/llm/adapter.ts ◀── gemini.ts
                                                   ▼
                                     src/core/registro-herramientas.ts (valida con zod)
                                                   ▼
                                     src/tools/proveedor.ts ──▶ src/dominio/*
                                                   │
                         fixtures/reto-01 (solo lectura)      out/ (escritura)
```
- **Comportamiento**: `agent/prompt.md`.
- **Conocimiento**: `src/knowledge/registro-proveedor.md` (proceso) y `src/knowledge/reglas-pais.json` (identificador tributario por país, umbrales, días de alerta). Cambiar una regla de negocio no toca el servidor ni el código.
- **Ejecución**: `src/tools/proveedor.ts`. Herramientas delgadas que delegan en `src/dominio/`. Son importables desde `demo.ts` sin servidor.

## 3. Ciclo del agente
`Agente.turno()` (src/agente.ts):
1. Agrega el mensaje del usuario y llama al modelo con el prompt, el conocimiento, el historial y las declaraciones de herramientas (JSON Schema generado desde zod).
2. Si el modelo pide herramientas, `RegistroHerramientas` valida los argumentos con zod y ejecuta. Los resultados vuelven al modelo. Todas quedan en el chat y en `out/log.jsonl`.
3. Repite hasta que el modelo responda sin herramientas o se alcance `MAX_ITERACIONES` (25). En ese caso informa qué alcanzó a hacer.
4. **Tope de costo**: tokens acumulados por sesión (`MAX_TOKENS_SESION`) y timeout al proveedor.

**Confirmación humana (doble candado):**
- El prompt obliga a terminar con la marca `[CONFIRMAR]` cuando se necesita una decisión. El servidor la detecta, marca `needsConfirmation` y el front muestra el mensaje resaltado con botones.
- En el siguiente turno el servidor calcula `confirmacionHumana` solo si el turno anterior la pidió **y** el mensaje del usuario es afirmativo sin negaciones. `simular_envio` rechaza el envío si ese valor es `false`, aunque el modelo envíe `confirmado: true`. El modelo no puede auto-confirmarse.

## 4. Elección del modelo
- **Google Gemini 3.8 Flash** vía REST (`fetch`, sin SDK), temperatura 0.
- **Por qué**: buen *function calling*, latencia baja y costo bajo. El trabajo pesado es determinista (herramientas); el modelo solo orquesta y redacta. No se necesita un modelo grande.
- **Costo estimado por caso**: ~5 llamadas al modelo × ~6–8 k tokens de entrada (prompt + herramientas + historial) + ~1–2 k de salida ≈ 40 k tokens, alrededor de **USD 0,01–0,02 por caso** con precios de lista de Flash (verificar la tarifa vigente). Con 12 casos al mes: menos de USD 1.
- Cambiar de proveedor = una clase que implemente `ProveedorLLM` + un `case` en `src/llm/index.ts`. El ciclo no cambia.

## 5. Diseño del portal web (no implementado)
- **Hoy**: el agente responde "formato no soportado" y genera `valores-portal.md` con los valores listos para copiar y su estado.
- **Estrategia propuesta**: navegador controlado (Playwright) en modo **asistido**. El agente abre el portal y llena campos por etiqueta usando el mismo mapeo; el humano ve la pantalla en todo momento.
- **Límites**: CAPTCHA y MFA los resuelve siempre el humano. Los cambios de layout se mitigan buscando campos por etiqueta visible (no por selectores CSS) y, si un campo no se encuentra, el agente se detiene y lo reporta; no adivina.
- **Credenciales**: nunca en el repositorio, el prompt ni los logs. Las guarda un gestor de secretos (Azure Key Vault o el gestor corporativo) o, más simple y seguro, **las digita el humano** directamente en el navegador; el agente nunca las ve.
- **Reparto**: el agente navega, llena y adjunta soportes. El humano inicia sesión, resuelve CAPTCHA/MFA, revisa y hace clic en **Enviar**.

## 6. Decisiones y trade-offs
| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Mapeo determinista en cascada (glosario → normalizado → clave → similitud de Dice con umbrales 0.8/0.6) | Pedirle al LLM que mapee etiquetas | Reproducible, auditable (ruta del dato) y sin alucinación. Ejemplo: "Número de contribuyente especial" se parece a "Número de cuenta" (0.49); sin umbral se habría puesto la cuenta bancaria. |
| Las herramientas recalculan el mapeo desde el maestro; el `mapeo` que envía el modelo solo se **verifica** | Confiar en los valores que envía el modelo | Cumple CA2 por diseño: si el modelo altera un valor, la herramienta rechaza la generación. |
| Servidor con `node:http` nativo | Express/Fastify | Cuatro rutas no justifican una dependencia. Menos superficie de ataque. |
| Gemini por REST con `fetch` | SDK oficial | Una dependencia menos. El adaptador propio es justamente lo que pide el PRD. |
| PDF generado con `pdf-lib` | Rellenar AcroForm | El PRD lo acepta y no hay PDF original del cliente en los fixtures. |
| Fecha de referencia = hoy, sobreescribible con `FECHA_REFERENCIA` | Fecha fija en el código | En producción la vigencia depende del día real; en la demo se puede fijar para reproducir resultados. |

## 7. Supuestos
- La "fecha de ejecución" para vigencias es la fecha actual en Bogotá.
- Se advierte (sin bloquear) un soporte que vence en ≤ 7 días. Por ejemplo, la Cámara de Comercio vence el 2026-09-30.
- Los soportes emitidos en Colombia se entregan también a clientes de otros países, con una advertencia.
- El valor del maestro se escribe tal cual (ej. País = "CO", ingresos en COP sin formato); no se transforma para no alterar la fuente.
- En el formato portal, `listo_para_firma` evalúa solo los soportes, porque no hay documento que firmar.
- Si una plantilla está corrupta, `leer_solicitud` continúa con avisos y `mapear_campos` puede trabajar con los campos que se le indiquen.

## 8. Cobertura
Pruebas automatizadas: `npm test` (node:test) cubre el entorno, el ciclo del agente, el adaptador, el servidor con distintos `.env` y el dominio; ver README.

| HU | Estado | Nota / falta para producción |
|---|---|---|
| HU-1 Leer solicitud | Hecho | Leer adjuntos reales (xlsx/pdf del cliente) en lugar de JSON normalizado. |
| HU-2 Mapear campos | Hecho | Revisión periódica del glosario con usuarios; dueño del dato del maestro. |
| HU-3 Formulario | xlsx y pdf hechos; portal diseñado | Escribir sobre la plantilla original del cliente (conservar formato). |
| HU-4 Paquete | Hecho | Firma electrónica y envío real (fuera de alcance). |
| HU-5 Errores | Hecho | Monitoreo y alertas sobre `out/log.jsonl`. |
| Bonus módulo | Ver `modulo/` si está incluido | — |

Resultados de la demo: co-industrias-delta listo para firma (17/17 campos); ec-corp-andina bloqueado (falta certificado de cumplimiento tributario; 1 faltante; RUC por confirmar); hn-agroexport-sula bloqueado (parafiscales vencidos 2026-08-31; 1 faltante; RTN por confirmar); pa-logistica-istmo portal no soportado con valores para copiar.

## 9. Uso de IA
- **Asistente usado**: Claude (Anthropic), en modo agente con acceso a la carpeta del proyecto.
- **Para qué**: análisis de los PRD y fixtures; propuesta de arquitectura común a los tres retos; generación del código; pruebas automatizadas (LLM simulado, validación celda por celda del Excel, determinismo entre corridas); redacción de la documentación.
- **Decisiones propias**: runtime Node (estándar corporativo) sobre Bun, proveedor Gemini y la dinámica de trabajo (el asistente escribe, yo reviso y valido cada bloque).
- **Descartado o corregido**:
  - Se descartó el mapeo con el LLM (ver trade-offs).
  - Las pruebas detectaron que la regex de confirmación usaba `\b`, que en JavaScript no reconoce "sí" con tilde y bloqueaba confirmaciones válidas. Se reemplazó por delimitadores explícitos con 15 casos de prueba.
  - Se detectó que consultar un caso inexistente creaba carpetas en `out/`, y que las notas largas se cortaban en el PDF. Ambos se corrigieron.
  - Los esquemas con `null` no son aceptados por Gemini; se adaptaron en el adaptador.
- En la instalación desde cero se detectó que un valor no numérico en `.env` (ej. `MAX_ITERACIONES=abc`) dejaba el tope en `NaN` y el agente nunca llamaba al modelo. Se agregó la validación del entorno con zod al arrancar, `npm run verificar` y la suite `npm test`.

## 10. Riesgos para producción
| Riesgo | Mitigación |
|---|---|
| El maestro se desactualiza | Dueño del dato y fecha de última actualización visible en el checklist. |
| Plantillas reales más complejas (celdas combinadas, validaciones) | Escribir sobre la plantilla original con exceljs y pruebas por cliente. |
| Datos sensibles (cuenta bancaria) en archivos locales | Almacenamiento cifrado, acceso por rol y retención limitada de `out/`. |
| El modelo cambia su comportamiento con una nueva versión | Modelo fijado por variable, tests del ciclo con LLM simulado y evaluación con los casos de fixtures antes de actualizar. |
| Abuso del link público | Topes de iteraciones y tokens; en producción, autenticación corporativa (SSO) y rate limit. |
| Sesiones en memoria se pierden al reiniciar | Persistir sesiones en archivo o Redis si se requiere continuidad. |
| Link público que consume la clave del modelo | Límite de mensajes por IP (`LIMITE_CHAT_POR_MINUTO`, 429 con Retry-After), tope de iteraciones y de tokens por sesión, tope de sesiones en memoria; en producción, SSO corporativo. |
| Archivos generados descargables en `/out/` desde el link público | Los datos del reto son ficticios; en producción, `out/` no se publica y los archivos se entregan en SharePoint con permisos por rol. |
