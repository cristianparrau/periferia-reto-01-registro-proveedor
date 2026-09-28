import * as proveedor from "./tools/proveedor.ts"

/** Lo único que cambia entre aplicaciones: nombre y módulo de herramientas (prefijo = nombre del archivo). */
export const APLICACION = {
  nombre: "Registro de proveedores",
  ejemplo: "Procesa el caso \"ec-corp-andina\". No envíes nada todavía.",
  prefijo: "proveedor",
  herramientas: proveedor,
}
