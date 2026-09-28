import { diasEntre } from "../core/fechas.ts"
import type { Reglas, Soporte, Solicitud } from "./datos.ts"
import type { Mapeo } from "./mapeo.ts"

export type EstadoSoporte = "presente" | "por_vencer" | "vencido" | "ausente"

export type ItemChecklist = {
  tipo: string
  estado: EstadoSoporte
  archivo: string | null
  vigencia_hasta: string | null
  observacion: string | null
}

/** Evalúa cada soporte exigido contra el índice del repositorio y la fecha de ejecución. */
export function evaluarSoportes(exigidos: string[], indice: Soporte[], fecha: string, pais: string, reglas: Reglas): ItemChecklist[] {
  return exigidos.map((tipo) => {
    const s = indice.find((x) => x.tipo === tipo)
    if (!s) return { tipo, estado: "ausente", archivo: null, vigencia_hasta: null, observacion: "No existe en el repositorio de soportes." }
    const otroPais = s.pais_emisor !== pais ? `Emitido en ${s.pais_emisor}; el cliente es de ${pais}.` : null
    const base = { tipo, archivo: s.archivo, vigencia_hasta: s.vigencia_hasta }
    if (s.vigencia_hasta === null) return { ...base, estado: "presente", observacion: otroPais }
    const dias = diasEntre(fecha, s.vigencia_hasta)
    if (dias < 0) return { ...base, estado: "vencido", observacion: `Venció el ${s.vigencia_hasta}. Solicitar uno nuevo.` }
    if (dias <= reglas.dias_alerta_vencimiento) return { ...base, estado: "por_vencer", observacion: `Vence en ${dias} día(s): enviar antes del ${s.vigencia_hasta}.` }
    return { ...base, estado: "presente", observacion: otroPais }
  })
}

/** RN3: vencido o ausente bloquea la firma. Un campo faltante no bloquea (solo se informa). */
export function motivosBloqueo(items: ItemChecklist[]): string[] {
  return items
    .filter((i) => i.estado === "vencido" || i.estado === "ausente")
    .map((i) => `Soporte ${i.tipo} ${i.estado}`)
}

export function checklistMarkdown(sol: Solicitud, items: ItemChecklist[], mapeo: Mapeo, fecha: string, formulario: string): string {
  const bloqueos = motivosBloqueo(items)
  const icono: Record<EstadoSoporte, string> = { presente: "[x]", por_vencer: "[!]", vencido: "[ ] VENCIDO", ausente: "[ ] AUSENTE" }
  return [
    `# Checklist — ${sol.cliente} (${sol.id})`,
    "",
    `Fecha de verificación: ${fecha}`,
    `Estado: **${bloqueos.length === 0 ? "LISTO PARA FIRMA" : "BLOQUEADO"}**`,
    ...bloqueos.map((b) => `- Bloqueo: ${b}`),
    "",
    "## Formulario",
    `- ${formulario}`,
    "",
    "## Soportes exigidos",
    ...items.map((i) => `- ${icono[i.estado]} ${i.tipo}${i.archivo ? ` (${i.archivo})` : ""}${i.vigencia_hasta ? ` — vigente hasta ${i.vigencia_hasta}` : ""}${i.observacion ? ` — ${i.observacion}` : ""}`),
    "",
    "## Campos faltantes (no bloquean, completar a mano)",
    ...(mapeo.faltantes.length ? mapeo.faltantes.map((c) => `- ${c.etiqueta}`) : ["- Ninguno"]),
    "",
    "## Campos por confirmar antes de firmar",
    ...(mapeo.requiere_confirmacion.length ? mapeo.requiere_confirmacion.map((c) => `- ${c.etiqueta}: ${c.nota ?? ""}`) : ["- Ninguno"]),
    "",
  ].join("\n")
}

/** RN2: el borrador de correo NUNCA incluye datos bancarios; solo lista adjuntos. */
export function borradorCorreo(sol: Solicitud, items: ItemChecklist[], formulario: string, listo: boolean): string {
  const adjuntos = [formulario, ...items.filter((i) => i.archivo && i.estado !== "vencido").map((i) => i.archivo as string)]
  return [
    `Para: ${sol.de}`,
    `Asunto: RE: ${sol.asunto}`,
    "",
    "Buenos días,",
    "",
    `En atención a su solicitud, remitimos el formulario de registro de Periferia IT Group S.A.S. como proveedor de ${sol.cliente}, firmado por el representante legal, junto con los siguientes soportes:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier información adicional.",
    "",
    "Cordialmente,",
    "Área Administrativa — Periferia IT Group S.A.S.",
    "",
    "---",
    listo ? "_Borrador pendiente de firma del representante legal. No enviado._" : "_BORRADOR BLOQUEADO: faltan o están vencidos soportes (ver checklist.md). No enviar._",
    "",
  ].join("\n")
}
