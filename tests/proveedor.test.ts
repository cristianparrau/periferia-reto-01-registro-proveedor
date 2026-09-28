import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import ExcelJS from "exceljs"
import * as proveedor from "../src/tools/proveedor.ts"
import { resolverClave } from "../src/dominio/mapeo.ts"
import { parse, proyectoTemporal } from "./ayudas.ts"
import type { ContextoHerramienta } from "../src/core/tipos.ts"

type Campo = { etiqueta: string; estado: string; valor: unknown; nota: string | null }
type Mapeo = { llenos: Campo[]; faltantes: Campo[]; requiere_confirmacion: Campo[] }
type Paquete = { listo_para_firma: boolean; bloqueos: string[]; checklist: { tipo: string; estado: string }[] }

let p: Awaited<ReturnType<typeof proyectoTemporal>>
let ctx: ContextoHerramienta
before(async () => { process.env.FECHA_REFERENCIA = "2026-09-03"; p = await proyectoTemporal(); ctx = p.ctx })
after(async () => { delete process.env.FECHA_REFERENCIA; await p.limpiar() })

const mapear = async (caso: string) => parse<Mapeo>(await proveedor.mapear_campos.execute({ caso, campos: [] }, ctx)).data
const paquete = async (caso: string) => parse<Paquete>(await proveedor.armar_paquete.execute({ caso }, ctx))

describe("HU-1 leer solicitud", () => {
  it("devuelve país, cliente, formato, campos y soportes", async () => {
    const r = parse<{ pais: string; formato: string; campos: string[]; soportes: string[] }>(await proveedor.leer_solicitud.execute({ caso: "co-industrias-delta" }, ctx))
    assert.deepEqual([r.ok, r.data.pais, r.data.formato, r.data.campos.length, r.data.soportes.length], [true, "CO", "xlsx", 17, 4])
  })
  it("caso inexistente: error claro y sin carpetas basura en out/", async () => {
    const r = parse(await proveedor.leer_solicitud.execute({ caso: "no-existe" }, ctx))
    assert.equal(r.ok, false)
    assert.match(r.error ?? "", /No se encontró solicitud.json/)
    await assert.rejects(readFile(join(p.dir, "out", "no-existe", "log.jsonl")))
  })
})

describe("HU-2 mapeo de campos", () => {
  it("co-industrias-delta: 17 llenos, sin faltantes", async () => {
    const m = await mapear("co-industrias-delta")
    assert.deepEqual([m.llenos.length, m.faltantes.length, m.requiere_confirmacion.length], [17, 0, 0])
  })
  it("ec-corp-andina: 'Número de contribuyente especial' es faltante (no se confunde con el número de cuenta)", async () => {
    const m = await mapear("ec-corp-andina")
    assert.deepEqual(m.faltantes.map((c) => c.etiqueta), ["Número de contribuyente especial"])
    assert.equal(m.faltantes[0]?.valor, null)
  })
  it("RN1: RUC/RTN fuera de Colombia se llena con el NIT y queda por confirmar", async () => {
    for (const [caso, etiqueta] of [["ec-corp-andina", "RUC"], ["hn-agroexport-sula", "RTN"], ["pa-logistica-istmo", "RUC"]]) {
      const c = (await mapear(caso!)).requiere_confirmacion.find((x) => x.etiqueta === etiqueta)
      assert.equal(c?.valor, "900123456")
      assert.match(c?.nota ?? "", /Identificador extranjero/)
    }
  })
  it("resuelve sinónimos sin tildes ni mayúsculas", () => {
    const glosario = { "Identificación tributaria": "nit", NIT: "nit" }
    assert.equal(resolverClave("IDENTIFICACION TRIBUTARIA", glosario, { nit: "1" })?.clave, "nit")
  })
})

describe("HU-3 formulario", () => {
  it("xlsx: cada etiqueta y valor en la hoja y celda de la plantilla", async () => {
    const r = parse<{ ruta: string }>(await proveedor.generar_formulario.execute({ caso: "co-industrias-delta" }, ctx))
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(join(p.dir, r.data.ruta))
    const celdas = JSON.parse(await readFile(join(p.dir, "fixtures/reto-01/casos/co-industrias-delta/plantilla-celdas.json"), "utf8")) as { hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }[]
    for (const c of celdas) assert.equal(libro.getWorksheet(c.hoja)?.getCell(c.celda_etiqueta).value, c.etiqueta)
    assert.equal(libro.getWorksheet("Datos Bancarios")?.getCell("C5").value, "03100012345")
  })
  it("pdf: se genera para el formato pdf", async () => {
    const r = parse<{ ruta: string; formato: string }>(await proveedor.generar_formulario.execute({ caso: "ec-corp-andina" }, ctx))
    assert.equal(r.data.formato, "pdf")
    assert.equal((await readFile(join(p.dir, r.data.ruta))).subarray(0, 4).toString(), "%PDF")
  })
  it("portal: 'formato no soportado' y valores para copiar", async () => {
    const r = parse<{ soportado: boolean; aviso: string; ruta: string }>(await proveedor.generar_formulario.execute({ caso: "pa-logistica-istmo" }, ctx))
    assert.equal(r.data.soportado, false)
    assert.match(r.data.aviso, /formato no soportado/)
    assert.match(await readFile(join(p.dir, r.data.ruta), "utf8"), /COLOCOBM/)
  })
  it("CA2: si el modelo altera un valor del mapeo, no se genera", async () => {
    const r = parse(await proveedor.generar_formulario.execute({ caso: "co-industrias-delta", mapeo: [{ etiqueta: "NIT", valor: "999" }] }, ctx))
    assert.equal(r.ok, false)
    assert.match(r.error ?? "", /no coincide con el maestro en: NIT/)
  })
})

describe("HU-4 paquete para firma", () => {
  it("co-industrias-delta listo para firma; pa-logistica-istmo también", async () => {
    assert.equal((await paquete("co-industrias-delta")).data.listo_para_firma, true)
    assert.equal((await paquete("pa-logistica-istmo")).data.listo_para_firma, true)
  })
  it("ec-corp-andina bloqueado por soporte ausente", async () => {
    const r = await paquete("ec-corp-andina")
    assert.equal(r.data.listo_para_firma, false)
    assert.deepEqual(r.data.bloqueos, ["Soporte certificado_cumplimiento_tributario ausente"])
  })
  it("hn-agroexport-sula bloqueado por parafiscales vencidos", async () => {
    const r = await paquete("hn-agroexport-sula")
    assert.deepEqual(r.data.bloqueos, ["Soporte parafiscales vencido"])
  })
  it("RN2: ningún borrador de correo incluye datos bancarios", async () => {
    for (const caso of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) {
      await paquete(caso)
      const correo = await readFile(join(p.dir, "out", caso, "paquete", "borrador-correo.md"), "utf8")
      for (const dato of ["03100012345", "COLOCOBM", "Bancolombia", "Ahorros"]) assert.ok(!correo.includes(dato), `${caso} contiene ${dato}`)
    }
  })
  it("advierte la Cámara de Comercio por vencer y la bloquea una vez vencida", async () => {
    process.env.FECHA_REFERENCIA = "2026-09-28"
    assert.equal((await paquete("co-industrias-delta")).data.checklist.find((c) => c.tipo === "camara_comercio")?.estado, "por_vencer")
    process.env.FECHA_REFERENCIA = "2026-10-01"
    const r = await paquete("co-industrias-delta")
    assert.equal(r.data.listo_para_firma, false)
    process.env.FECHA_REFERENCIA = "2026-09-03"
  })
})

describe("envío simulado (RN4)", () => {
  it("sin confirmación no envía", async () => {
    const r = parse(await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: false }, ctx))
    assert.equal(r.error, "requiere confirmación explícita")
  })
  it("con confirmado=true pero sin confirmación humana en el servidor, no envía", async () => {
    const r = parse(await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, { ...ctx, confirmacionHumana: false }))
    assert.equal(r.ok, false)
  })
  it("paquete bloqueado no se envía aunque se confirme", async () => {
    await paquete("hn-agroexport-sula")
    const r = parse(await proveedor.simular_envio.execute({ caso: "hn-agroexport-sula", confirmado: true }, ctx))
    assert.match(r.error ?? "", /no está listo para firma/)
  })
  it("con confirmación y paquete listo escribe ENVIO-SIMULADO.md", async () => {
    await paquete("co-industrias-delta")
    const r = parse<{ ruta: string }>(await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, { ...ctx, confirmacionHumana: true }))
    assert.equal(r.data.ruta, "out/co-industrias-delta/ENVIO-SIMULADO.md")
  })
})

describe("HU-5 errores y RN5 log", () => {
  it("plantilla corrupta: error claro y el resto del proceso continúa", async () => {
    await writeFile(join(p.dir, "fixtures/reto-01/casos/hn-agroexport-sula/plantilla-celdas.json"), '[{"hoja": ')
    const leer = parse<{ avisos: string[] }>(await proveedor.leer_solicitud.execute({ caso: "hn-agroexport-sula" }, ctx))
    assert.ok(leer.ok)
    assert.match(leer.data.avisos[0] ?? "", /corrupto/)
    const gen = parse(await proveedor.generar_formulario.execute({ caso: "hn-agroexport-sula" }, ctx))
    assert.match(gen.error ?? "", /corrupto/)
    assert.ok(!(gen.error ?? "").includes("at "), "sin traza cruda")
  })
  it("cada ejecución deja registro en out/<caso>/log.jsonl", async () => {
    const lineas = (await readFile(join(p.dir, "out", "co-industrias-delta", "log.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
    assert.ok(lineas.length > 0)
    for (const l of lineas) assert.deepEqual(Object.keys(l).sort(), ["herramienta", "ok", "resumen", "ts"])
  })
})
