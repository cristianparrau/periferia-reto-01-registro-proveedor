import { join } from "node:path"
import { z } from "zod"
import { leerJson } from "../core/archivos.ts"
import type { Resultado } from "../core/tipos.ts"

/** Rutas relativas a la raíz del proyecto (ctx.directory). Nunca absolutas. */
export const RUTAS = {
  fixtures: (dir: string) => join(dir, "fixtures", "reto-01"),
  caso: (dir: string, caso: string) => join(dir, "fixtures", "reto-01", "casos", caso),
  soportes: (dir: string) => join(dir, "fixtures", "reto-01", "repositorio", "soportes"),
  salida: (dir: string, caso: string) => join(dir, "out", caso),
  reglas: (dir: string) => join(dir, "src", "knowledge", "reglas-pais.json"),
}

export const CodigoPais = z.enum(["CO", "EC", "PE", "PA", "HN"])

export const SolicitudSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: CodigoPais,
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  adjuntos: z.array(z.string()),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const CeldaSchema = z.object({ hoja: z.string(), celda_etiqueta: z.string(), etiqueta: z.string(), celda_valor: z.string() })
export type Celda = z.infer<typeof CeldaSchema>
export const CampoSchema = z.object({ etiqueta: z.string(), obligatorio: z.boolean() })
export type Campo = z.infer<typeof CampoSchema>

export const SoporteSchema = z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.string().nullable(),
  pais_emisor: z.string(),
  descripcion: z.string(),
})
export type Soporte = z.infer<typeof SoporteSchema>

export const ReglasSchema = z.object({
  identificador_tributario: z.record(z.string(), z.string()),
  pais_origen_maestro: z.string(),
  etiquetas_tributarias_genericas: z.array(z.string()),
  claves_bancarias_prefijo: z.string(),
  umbral_confianza: z.number(),
  umbral_sugerencia: z.number(),
  dias_alerta_vencimiento: z.number(),
})
export type Reglas = z.infer<typeof ReglasSchema>

export type Maestro = Record<string, unknown>

export const cargar = {
  solicitud: (dir: string, caso: string) => leerJson(join(RUTAS.caso(dir, caso), "solicitud.json"), SolicitudSchema, "solicitud.json"),
  celdas: (dir: string, caso: string) => leerJson(join(RUTAS.caso(dir, caso), "plantilla-celdas.json"), z.array(CeldaSchema), "plantilla-celdas.json"),
  campos: (dir: string, caso: string) => leerJson(join(RUTAS.caso(dir, caso), "plantilla-campos.json"), z.array(CampoSchema), "plantilla-campos.json"),
  exigidos: (dir: string, caso: string) => leerJson(join(RUTAS.caso(dir, caso), "soportes-exigidos.json"), z.array(z.string()), "soportes-exigidos.json"),
  maestro: (dir: string): Promise<Resultado<Maestro>> => leerJson(join(RUTAS.fixtures(dir), "repositorio", "maestro.json"), z.record(z.string(), z.unknown()), "maestro.json"),
  glosario: (dir: string) => leerJson(join(RUTAS.fixtures(dir), "glosario-campos.json"), z.record(z.string(), z.string()), "glosario-campos.json"),
  soportes: (dir: string) => leerJson(join(RUTAS.soportes(dir), "index.json"), z.array(SoporteSchema), "index.json de soportes"),
  reglas: (dir: string) => leerJson(RUTAS.reglas(dir), ReglasSchema, "reglas-pais.json"),
}

/** Etiquetas de la plantilla en orden, sea Excel (celdas) o PDF/portal (campos). */
export async function etiquetasPlantilla(dir: string, caso: string, formato: Solicitud["formato"]): Promise<Resultado<string[]>> {
  if (formato === "xlsx") {
    const r = await cargar.celdas(dir, caso)
    return r.ok ? { ok: true, data: r.data.map((c) => c.etiqueta) } : r
  }
  const r = await cargar.campos(dir, caso)
  return r.ok ? { ok: true, data: r.data.map((c) => c.etiqueta) } : r
}
