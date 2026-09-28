import { join } from "node:path"
import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { escribirTexto } from "../core/archivos.ts"
import type { Campo, Celda, Solicitud } from "./datos.ts"
import type { CampoMapeado } from "./mapeo.ts"

const AMARILLO = "FFFFF2CC" // faltante
const NARANJA = "FFFCE4D6" // requiere confirmación

function textoValor(c: CampoMapeado): string {
  return c.valor === null ? "" : String(c.valor)
}

/** P0: escribe etiqueta y valor exactamente en la hoja/celda que indica plantilla-celdas.json. */
export async function generarExcel(celdas: Celda[], mapeo: CampoMapeado[], salida: string): Promise<string> {
  const libro = new ExcelJS.Workbook()
  libro.creator = "Registro de proveedores"
  const porEtiqueta = new Map(mapeo.map((c) => [c.etiqueta, c]))
  for (const celda of celdas) {
    const hoja = libro.getWorksheet(celda.hoja) ?? libro.addWorksheet(celda.hoja)
    const campo = porEtiqueta.get(celda.etiqueta)
    hoja.getCell(celda.celda_etiqueta).value = celda.etiqueta
    hoja.getCell(celda.celda_etiqueta).font = { bold: true }
    const destino = hoja.getCell(celda.celda_valor)
    destino.value = campo?.valor ?? null
    if (!campo || campo.estado !== "lleno") {
      const color = campo?.estado === "requiere_confirmacion" ? NARANJA : AMARILLO
      destino.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }
      destino.note = campo?.nota ?? "Faltante: no existe en el repositorio maestro."
    }
  }
  libro.eachSheet((h) => h.columns.forEach((col) => (col.width = 38)))
  const ruta = join(salida, "formulario.xlsx")
  await escribirTexto(ruta, new Uint8Array(await libro.xlsx.writeBuffer()))
  return ruta
}

function partirLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of texto.split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, tamano) > ancho && actual) {
      lineas.push(actual)
      actual = palabra
    } else actual = prueba
  }
  if (actual) lineas.push(actual)
  return lineas
}

type Lienzo = { doc: PDFDocument; pagina: PDFPage; y: number; normal: PDFFont; negrita: PDFFont }

function escribirLinea(l: Lienzo, texto: string, fuente: PDFFont, tamano: number, x: number, color = rgb(0, 0, 0)): void {
  if (l.y < 60) {
    l.pagina = l.doc.addPage([595, 842])
    l.y = 790
  }
  l.pagina.drawText(texto, { x, y: l.y, size: tamano, font: fuente, color })
  l.y -= tamano + 6
}

/** P1: PDF generado (no AcroForm) con todos los campos, etiqueta y valor, en el orden de la plantilla. */
export async function generarPdf(campos: Campo[], mapeo: CampoMapeado[], solicitud: Solicitud, salida: string): Promise<string> {
  const doc = await PDFDocument.create()
  const l: Lienzo = { doc, pagina: doc.addPage([595, 842]), y: 790, normal: await doc.embedFont(StandardFonts.Helvetica), negrita: await doc.embedFont(StandardFonts.HelveticaBold) }
  escribirLinea(l, `Formulario de registro de proveedor - ${solicitud.cliente}`, l.negrita, 14, 50)
  escribirLinea(l, `Solicitud ${solicitud.id} del ${solicitud.fecha}. (*) obligatorio`, l.normal, 9, 50, rgb(0.4, 0.4, 0.4))
  l.y -= 8
  const porEtiqueta = new Map(mapeo.map((c) => [c.etiqueta, c]))
  for (const campo of campos) {
    const m = porEtiqueta.get(campo.etiqueta)
    escribirLinea(l, `${campo.etiqueta}${campo.obligatorio ? " *" : ""}`, l.negrita, 10, 50)
    const valor = m && m.valor !== null ? textoValor(m) : "[FALTANTE - no existe en el repositorio maestro]"
    const color = !m || m.estado === "faltante" ? rgb(0.75, 0.1, 0.1) : rgb(0, 0, 0)
    for (const linea of partirLineas(valor, l.normal, 10, 480)) escribirLinea(l, linea, l.normal, 10, 65, color)
    if (m?.estado === "requiere_confirmacion") {
      for (const linea of partirLineas(`Por confirmar: ${m.nota ?? ""}`, l.normal, 8, 480)) escribirLinea(l, linea, l.normal, 8, 65, rgb(0.8, 0.45, 0))
    }
    l.y -= 4
  }
  escribirLinea(l, "Firma del representante legal: ______________________________", l.normal, 10, 50)
  const ruta = join(salida, "formulario.pdf")
  await escribirTexto(ruta, await doc.save({ updateFieldAppearances: false }))
  return ruta
}

/** P2: el portal web no se automatiza; se entregan los valores listos para copiar. */
export async function generarValoresPortal(mapeo: CampoMapeado[], solicitud: Solicitud, salida: string): Promise<string> {
  const filas = mapeo.map((c) => `| ${c.etiqueta} | ${c.valor === null ? "**FALTANTE**" : textoValor(c)} | ${c.estado}${c.nota ? ` — ${c.nota}` : ""} |`)
  const contenido = [
    `# Valores para el portal de ${solicitud.cliente}`,
    "",
    "> Formato no soportado para automatización: el portal lo diligencia una persona.",
    "> Las credenciales las ingresa el humano directamente en el portal; nunca pasan por el agente.",
    "",
    "| Campo | Valor para copiar | Estado |",
    "|---|---|---|",
    ...filas,
    "",
  ].join("\n")
  const ruta = join(salida, "valores-portal.md")
  await escribirTexto(ruta, contenido)
  return ruta
}
