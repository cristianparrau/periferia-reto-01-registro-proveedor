import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { escribirTexto } from "../core/archivos.ts"
import { fallo, ok, type Resultado } from "../core/tipos.ts"
import { cargar, etiquetasPlantilla, RUTAS, type Solicitud } from "./datos.ts"
import { mapearCampos, type Mapeo } from "./mapeo.ts"
import { generarExcel, generarPdf, generarValoresPortal } from "./formularios.ts"

/** Mapeo determinista de un caso a partir de su plantilla. Se persiste en out/<caso>/mapeo.json. */
export async function mapearCaso(dir: string, caso: string, etiquetas?: string[]): Promise<Resultado<{ solicitud: Solicitud; mapeo: Mapeo }>> {
  const sol = await cargar.solicitud(dir, caso)
  if (!sol.ok) return sol
  const [maestro, glosario, reglas] = await Promise.all([cargar.maestro(dir), cargar.glosario(dir), cargar.reglas(dir)])
  if (!maestro.ok) return maestro
  if (!glosario.ok) return glosario
  if (!reglas.ok) return reglas
  let lista = etiquetas
  if (!lista || lista.length === 0) {
    const plantilla = await etiquetasPlantilla(dir, caso, sol.data.formato)
    if (!plantilla.ok) return plantilla
    lista = plantilla.data
  }
  const mapeo = mapearCampos(lista, sol.data.pais, maestro.data, glosario.data, reglas.data)
  await escribirTexto(join(RUTAS.salida(dir, caso), "mapeo.json"), JSON.stringify(mapeo.orden, null, 2))
  return ok({ solicitud: sol.data, mapeo })
}

export type Formulario = { ruta: string; formato: Solicitud["formato"]; soportado: boolean }

/** Genera el formulario en el formato del cliente. Portal: no soportado, se entregan valores para copiar. */
export async function generarFormularioCaso(dir: string, caso: string): Promise<Resultado<Formulario & { mapeo: Mapeo; solicitud: Solicitud }>> {
  const base = await mapearCaso(dir, caso)
  if (!base.ok) return base
  const { solicitud, mapeo } = base.data
  const salida = RUTAS.salida(dir, caso)
  if (solicitud.formato === "xlsx") {
    const celdas = await cargar.celdas(dir, caso)
    if (!celdas.ok) return celdas
    return ok({ ruta: await generarExcel(celdas.data, mapeo.orden, salida), formato: "xlsx", soportado: true, mapeo, solicitud })
  }
  if (solicitud.formato === "pdf") {
    const campos = await cargar.campos(dir, caso)
    if (!campos.ok) return campos
    return ok({ ruta: await generarPdf(campos.data, mapeo.orden, solicitud, salida), formato: "pdf", soportado: true, mapeo, solicitud })
  }
  return ok({ ruta: await generarValoresPortal(mapeo.orden, solicitud, salida), formato: "portal", soportado: false, mapeo, solicitud })
}

type EstadoPaquete = { listo_para_firma: boolean; bloqueos: string[]; fecha: string }

export async function leerEstadoPaquete(dir: string, caso: string): Promise<Resultado<EstadoPaquete>> {
  try {
    const texto = await readFile(join(RUTAS.salida(dir, caso), "paquete", "estado.json"), "utf8")
    return ok(JSON.parse(texto) as EstadoPaquete)
  } catch {
    return fallo("El paquete no se ha armado todavía. Ejecuta primero armar_paquete.")
  }
}
