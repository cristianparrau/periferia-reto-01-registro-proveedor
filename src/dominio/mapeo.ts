import { normalizar, similitud, slug } from "./texto.ts"
import type { Maestro, Reglas } from "./datos.ts"

export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion"

export type CampoMapeado = {
  etiqueta: string
  estado: EstadoCampo
  clave: string | null
  /** Ruta trazable del dato, ej. "maestro.json#banco.numero_cuenta". */
  ruta: string | null
  valor: string | number | boolean | null
  confianza: number
  nota: string | null
}

type Resolucion = { clave: string; confianza: number; metodo: string } | null

/** Lee una clave con puntos ("banco.nombre") del maestro. */
export function leerRuta(maestro: Maestro, clave: string): unknown {
  let actual: unknown = maestro
  for (const parte of clave.split(".")) {
    if (typeof actual !== "object" || actual === null) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

/** Paso 1: ¿a qué clave del maestro corresponde la etiqueta? Glosario exacto > normalizado > clave literal > similitud. */
export function resolverClave(etiqueta: string, glosario: Record<string, string>, maestro: Maestro): Resolucion {
  const exacta = glosario[etiqueta]
  if (exacta) return { clave: exacta, confianza: 1, metodo: "glosario" }
  const objetivo = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === objetivo) return { clave, confianza: 0.95, metodo: "glosario normalizado" }
  }
  if (leerRuta(maestro, slug(etiqueta)) !== undefined) return { clave: slug(etiqueta), confianza: 0.9, metodo: "clave del maestro" }
  let mejor: Resolucion = null
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    const s = similitud(etiqueta, sinonimo)
    if (!mejor || s > mejor.confianza) mejor = { clave, confianza: Number(s.toFixed(2)), metodo: `similar a "${sinonimo}"` }
  }
  return mejor
}

function esValorEscalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
}

/** RN1: el identificador tributario cambia de nombre por país; Periferia solo tiene NIT colombiano. */
function reglaTributaria(etiqueta: string, pais: string, reglas: Reglas): string | null {
  const equivalente = reglas.identificador_tributario[pais] ?? "identificador local"
  if (pais !== reglas.pais_origen_maestro) {
    return `Identificador extranjero: el cliente (${pais}) pide ${equivalente}; se diligencia el NIT colombiano. Confirmar si lo acepta.`
  }
  if (reglas.etiquetas_tributarias_genericas.includes(etiqueta)) {
    return `Campo ambiguo: en ${pais} equivale a ${equivalente}.`
  }
  return null
}

function campo(etiqueta: string, estado: EstadoCampo, parcial: Partial<CampoMapeado>): CampoMapeado {
  return { etiqueta, estado, clave: null, ruta: null, valor: null, confianza: 0, nota: null, ...parcial }
}

/** Paso 2: estado final del campo. Nunca inventa: sin fuente → faltante. */
export function mapearCampo(etiqueta: string, pais: string, maestro: Maestro, glosario: Record<string, string>, reglas: Reglas): CampoMapeado {
  const r = resolverClave(etiqueta, glosario, maestro)
  if (!r || r.confianza < reglas.umbral_sugerencia) {
    return campo(etiqueta, "faltante", { confianza: r?.confianza ?? 0, nota: "No existe en el repositorio maestro." })
  }
  const valor = leerRuta(maestro, r.clave)
  const base = { clave: r.clave, ruta: `maestro.json#${r.clave}`, confianza: r.confianza }
  if (!esValorEscalar(valor)) {
    return campo(etiqueta, "faltante", { ...base, nota: `La clave ${r.clave} no tiene valor en el maestro.` })
  }
  if (r.confianza < reglas.umbral_confianza) {
    return campo(etiqueta, "requiere_confirmacion", { ...base, valor, nota: `Mapeo con baja confianza (${r.metodo}).` })
  }
  const notaPais = r.clave === "nit" ? reglaTributaria(etiqueta, pais, reglas) : null
  if (notaPais) return campo(etiqueta, "requiere_confirmacion", { ...base, valor, nota: notaPais })
  return campo(etiqueta, "lleno", { ...base, valor, nota: r.confianza < 1 ? `Resuelto por ${r.metodo}.` : null })
}

export type Mapeo = { llenos: CampoMapeado[]; faltantes: CampoMapeado[]; requiere_confirmacion: CampoMapeado[]; orden: CampoMapeado[] }

export function mapearCampos(etiquetas: string[], pais: string, maestro: Maestro, glosario: Record<string, string>, reglas: Reglas): Mapeo {
  const orden = etiquetas.map((e) => mapearCampo(e, pais, maestro, glosario, reglas))
  return {
    orden,
    llenos: orden.filter((c) => c.estado === "lleno"),
    faltantes: orden.filter((c) => c.estado === "faltante"),
    requiere_confirmacion: orden.filter((c) => c.estado === "requiere_confirmacion"),
  }
}
