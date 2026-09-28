import { stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { z } from "zod"
import { copiarArchivo, escribirTexto } from "../core/archivos.ts"
import { fechaReferencia } from "../core/fechas.ts"
import { registrar } from "../core/log.ts"
import { definirHerramienta, fallo, ok, type ContextoHerramienta, type Resultado } from "../core/tipos.ts"
import { cargar, etiquetasPlantilla, RUTAS } from "../dominio/datos.ts"
import { borradorCorreo, checklistMarkdown, evaluarSoportes, motivosBloqueo } from "../dominio/paquete.ts"
import { generarFormularioCaso, leerEstadoPaquete, mapearCaso } from "../dominio/servicio.ts"

// Solo nombres de carpeta simples: evita rutas como "../../etc".
const argCaso = z.string().regex(/^[a-z0-9-]+$/, "caso inválido").describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/")

/** Serializa el resultado, deja rastro en los logs y nunca lanza. */
async function responder<T>(ctx: ContextoHerramienta, herramienta: string, caso: string, r: Resultado<T>, resumen: (d: T) => string): Promise<string> {
  // Solo se crea log por caso si el caso existe: una consulta a un caso inexistente no deja carpetas basura.
  const existe = await stat(RUTAS.caso(ctx.directory, caso)).then(() => true, () => false)
  await registrar(ctx.directory, { herramienta, caso: existe ? caso : undefined, sessionId: ctx.sessionId, ok: r.ok, resumen: r.ok ? resumen(r.data) : r.error })
  return JSON.stringify(r)
}

async function seguro<T>(fn: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await fn()
  } catch (e) {
    return fallo(`Error inesperado: ${e instanceof Error ? e.message : "desconocido"}`)
  }
}

const rel = (ctx: ContextoHerramienta, ruta: string) => relative(ctx.directory, ruta).replaceAll("\\", "/")

export const leer_solicitud = definirHerramienta({
  description: "Lee el correo de solicitud de un caso y devuelve país, cliente, formato de salida, campos pedidos y soportes exigidos.",
  args: { caso: argCaso },
  async execute({ caso }, ctx) {
    const r = await seguro(async () => {
      const sol = await cargar.solicitud(ctx.directory, caso)
      if (!sol.ok) return fallo(`Caso "${caso}": ${sol.error}`)
      const [plantilla, exigidos, reglas] = await Promise.all([etiquetasPlantilla(ctx.directory, caso, sol.data.formato), cargar.exigidos(ctx.directory, caso), cargar.reglas(ctx.directory)])
      const campos = plantilla.ok ? plantilla.data : []
      const ambiguos = reglas.ok ? campos.filter((c) => reglas.data.etiquetas_tributarias_genericas.includes(c)).map((c) => ({ etiqueta: c, estado: "requiere_confirmacion", propuesta: reglas.data.identificador_tributario[sol.data.pais] ?? null })) : []
      return ok({
        pais: sol.data.pais,
        cliente: sol.data.cliente,
        formato: sol.data.formato,
        campos,
        soportes: exigidos.ok ? exigidos.data : [],
        campos_ambiguos: ambiguos,
        avisos: [plantilla, exigidos].filter((x) => !x.ok).map((x) => (x.ok ? "" : x.error)),
      })
    })
    return responder(ctx, "proveedor_leer_solicitud", caso, r, (d) => `${d.cliente} (${d.pais}) formato ${d.formato}, ${d.campos.length} campos, ${d.soportes.length} soportes`)
  },
})

export const mapear_campos = definirHerramienta({
  description: "Cruza cada campo solicitado con el repositorio maestro y lo clasifica en lleno, faltante o requiere_confirmacion, con la ruta del dato.",
  args: {
    caso: argCaso,
    campos: z.array(z.string()).describe("Etiquetas de los campos pedidos, tal como las devolvió leer_solicitud. Vacío = todos los de la plantilla."),
  },
  async execute({ caso, campos }, ctx) {
    const r = await seguro(async () => {
      const base = await mapearCaso(ctx.directory, caso, campos)
      if (!base.ok) return base
      const { llenos, faltantes, requiere_confirmacion } = base.data.mapeo
      return ok({ llenos, faltantes, requiere_confirmacion, ruta_mapeo: rel(ctx, join(RUTAS.salida(ctx.directory, caso), "mapeo.json")) })
    })
    return responder(ctx, "proveedor_mapear_campos", caso, r, (d) => `${d.llenos.length} llenos, ${d.faltantes.length} faltantes, ${d.requiere_confirmacion.length} por confirmar`)
  },
})

const EntradaMapeo = z.object({ etiqueta: z.string().describe("Etiqueta del campo"), valor: z.string().describe("Valor devuelto por mapear_campos, como texto; vacío si es faltante") })

export const generar_formulario = definirHerramienta({
  description: "Genera el formulario lleno en el formato del cliente (xlsx o pdf); para portal web devuelve 'formato no soportado' y los valores listos para copiar.",
  args: {
    caso: argCaso,
    mapeo: z.array(EntradaMapeo).optional().describe("Opcional: pares etiqueta/valor de mapear_campos. Se verifican contra el maestro; los valores siempre salen del maestro."),
  },
  async execute({ caso, mapeo }, ctx) {
    const r = await seguro(async () => {
      const f = await generarFormularioCaso(ctx.directory, caso)
      if (!f.ok) return f
      const alterados = (mapeo ?? []).filter((m) => {
        const real = f.data.mapeo.orden.find((c) => c.etiqueta === m.etiqueta)
        return real !== undefined && String(real.valor ?? "") !== m.valor
      })
      if (alterados.length) return fallo(`El mapeo recibido no coincide con el maestro en: ${alterados.map((a) => a.etiqueta).join(", ")}. Se usa solo el maestro; vuelve a llamar sin modificar valores.`)
      const aviso = f.data.soportado ? null : "formato no soportado: portal web. Se generó valores-portal.md para diligenciarlo manualmente."
      return ok({ ruta: rel(ctx, f.data.ruta), formato: f.data.formato, soportado: f.data.soportado, aviso })
    })
    return responder(ctx, "proveedor_generar_formulario", caso, r, (d) => `${d.formato} → ${d.ruta}${d.soportado ? "" : " (no soportado)"}`)
  },
})

export const armar_paquete = definirHerramienta({
  description: "Arma el paquete para firma (formulario, soportes vigentes, checklist y borrador de correo) e indica si está listo_para_firma.",
  args: { caso: argCaso },
  async execute({ caso }, ctx) {
    const r = await seguro(async () => {
      const f = await generarFormularioCaso(ctx.directory, caso)
      if (!f.ok) return f
      const [exigidos, indice, reglas] = await Promise.all([cargar.exigidos(ctx.directory, caso), cargar.soportes(ctx.directory), cargar.reglas(ctx.directory)])
      if (!exigidos.ok) return exigidos
      if (!indice.ok) return indice
      if (!reglas.ok) return reglas
      const fecha = fechaReferencia()
      const items = evaluarSoportes(exigidos.data, indice.data, fecha, f.data.solicitud.pais, reglas.data)
      const bloqueos = motivosBloqueo(items)
      const listo = bloqueos.length === 0
      const carpeta = join(RUTAS.salida(ctx.directory, caso), "paquete")
      const formulario = basename(f.data.ruta)
      await copiarArchivo(f.data.ruta, join(carpeta, formulario))
      for (const i of items) if (i.archivo) await copiarArchivo(join(RUTAS.soportes(ctx.directory), i.archivo), join(carpeta, "soportes", i.archivo))
      await escribirTexto(join(carpeta, "checklist.md"), checklistMarkdown(f.data.solicitud, items, f.data.mapeo, fecha, formulario))
      await escribirTexto(join(carpeta, "borrador-correo.md"), borradorCorreo(f.data.solicitud, items, formulario, listo))
      await escribirTexto(join(carpeta, "estado.json"), JSON.stringify({ listo_para_firma: listo, bloqueos, fecha }, null, 2))
      return ok({
        ruta: rel(ctx, carpeta),
        listo_para_firma: listo,
        bloqueos,
        checklist: items,
        campos_faltantes: f.data.mapeo.faltantes.map((c) => c.etiqueta),
        campos_por_confirmar: f.data.mapeo.requiere_confirmacion.map((c) => c.etiqueta),
        fecha_referencia: fecha,
      })
    })
    return responder(ctx, "proveedor_armar_paquete", caso, r, (d) => `listo_para_firma=${d.listo_para_firma}${d.bloqueos.length ? ` (${d.bloqueos.join("; ")})` : ""}`)
  },
})

export const simular_envio = definirHerramienta({
  description: "Simula el envío del paquete al cliente escribiendo ENVIO-SIMULADO.md; solo procede con confirmación explícita del usuario y paquete listo para firma.",
  args: {
    caso: argCaso,
    confirmado: z.boolean().describe("true solo si el usuario confirmó explícitamente el envío en su último mensaje"),
  },
  async execute({ caso, confirmado }, ctx) {
    const r = await seguro(async () => {
      // Doble candado: el argumento del modelo Y la verificación del servidor sobre el último mensaje humano.
      if (!confirmado || ctx.confirmacionHumana === false) return fallo<{ ruta: string }>("requiere confirmación explícita")
      const estado = await leerEstadoPaquete(ctx.directory, caso)
      if (!estado.ok) return estado
      if (!estado.data.listo_para_firma) return fallo(`El paquete no está listo para firma: ${estado.data.bloqueos.join("; ")}.`)
      const ruta = join(RUTAS.salida(ctx.directory, caso), "ENVIO-SIMULADO.md")
      await escribirTexto(ruta, `# Envío simulado — ${caso}\n\nFecha: ${new Date().toISOString()}\nSesión: ${ctx.sessionId}\n\nNo se envió ningún correo real. El paquete en paquete/ queda para firma y envío por una persona.\n`)
      return ok({ ruta: rel(ctx, ruta) })
    })
    return responder(ctx, "proveedor_simular_envio", caso, r, (d) => `envío simulado en ${d.ruta}`)
  },
})
