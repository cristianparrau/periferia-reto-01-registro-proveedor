/**
 * Verificación sin modelo: ejecuta todos los casos llamando directamente a las herramientas.
 * Uso: npm run demo   (opcional: FECHA_REFERENCIA=2026-09-03 npm run demo)
 */
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import * as proveedor from "./src/tools/proveedor.ts"
import type { ContextoHerramienta } from "./src/core/tipos.ts"

const directory = process.cwd()
const ctx: ContextoHerramienta = { directory, sessionId: "demo" }

type Respuesta = { ok: boolean; data?: Record<string, unknown>; error?: string }
const parse = (s: string) => JSON.parse(s) as Respuesta
const lista = (v: unknown) => (Array.isArray(v) ? v.length : 0)

async function procesar(caso: string): Promise<void> {
  console.log(`\n=== ${caso} ===`)
  const sol = parse(await proveedor.leer_solicitud.execute({ caso }, ctx))
  if (!sol.ok || !sol.data) return void console.log(`  ✗ ${sol.error}`)
  console.log(`  Cliente: ${sol.data.cliente} · País: ${sol.data.pais} · Formato: ${sol.data.formato}`)
  const campos = (sol.data.campos as string[]) ?? []
  const map = parse(await proveedor.mapear_campos.execute({ caso, campos }, ctx))
  if (map.ok && map.data) {
    console.log(`  Campos: ${lista(map.data.llenos)} llenos · ${lista(map.data.faltantes)} faltantes · ${lista(map.data.requiere_confirmacion)} por confirmar`)
    for (const f of (map.data.faltantes as { etiqueta: string }[])) console.log(`    - faltante: ${f.etiqueta}`)
    for (const f of (map.data.requiere_confirmacion as { etiqueta: string; nota: string }[])) console.log(`    - por confirmar: ${f.etiqueta} → ${f.nota}`)
  }
  const form = parse(await proveedor.generar_formulario.execute({ caso }, ctx))
  console.log(form.ok && form.data ? `  Formulario: ${form.data.ruta}${form.data.aviso ? ` (${form.data.aviso})` : ""}` : `  ✗ ${form.error}`)
  const paq = parse(await proveedor.armar_paquete.execute({ caso }, ctx))
  if (!paq.ok || !paq.data) return void console.log(`  ✗ ${paq.error}`)
  console.log(`  Paquete: ${paq.data.ruta} · listo_para_firma=${paq.data.listo_para_firma} (fecha ${paq.data.fecha_referencia})`)
  for (const i of paq.data.checklist as { tipo: string; estado: string; observacion: string | null }[]) console.log(`    [${i.estado}] ${i.tipo}${i.observacion ? ` — ${i.observacion}` : ""}`)
  const sinConfirmar = parse(await proveedor.simular_envio.execute({ caso, confirmado: false }, ctx))
  console.log(`  Envío sin confirmación: ${sinConfirmar.ok ? "ENVIADO (ERROR)" : sinConfirmar.error}`)
}

async function main(): Promise<void> {
  await rm(join(directory, "out"), { recursive: true, force: true })
  const casos = (await readdir(join(directory, "fixtures", "reto-01", "casos"))).sort()
  for (const caso of casos) await procesar(caso)

  console.log("\n=== Robustez ===")
  const inexistente = parse(await proveedor.leer_solicitud.execute({ caso: "no-existe" }, ctx))
  console.log(`  Caso inexistente: ${inexistente.error}`)
  const envio = parse(await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx))
  console.log(`  Envío confirmado (co-industrias-delta): ${envio.ok ? `ok → ${String(envio.data?.ruta)}` : envio.error}`)
  const bloqueado = parse(await proveedor.simular_envio.execute({ caso: "hn-agroexport-sula", confirmado: true }, ctx))
  console.log(`  Envío confirmado (hn-agroexport-sula, bloqueado): ${bloqueado.ok ? "ENVIADO (ERROR)" : bloqueado.error}`)
}

main().catch(() => {
  console.error("La demo falló de forma inesperada.")
  process.exitCode = 1
})
