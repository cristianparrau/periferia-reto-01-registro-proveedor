/** Normaliza una etiqueta: minúsculas, sin tildes, sin signos, espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function bigramas(texto: string): string[] {
  const t = normalizar(texto).replace(/ /g, "")
  const salida: string[] = []
  for (let i = 0; i < t.length - 1; i++) salida.push(t.slice(i, i + 2))
  return salida
}

/** Coeficiente de Dice sobre bigramas: similitud 0..1 tolerante a errores de tipeo y orden parcial. */
export function similitud(a: string, b: string): number {
  const x = bigramas(a)
  const y = bigramas(b)
  if (x.length === 0 || y.length === 0) return 0
  const restantes = [...y]
  let comunes = 0
  for (const g of x) {
    const i = restantes.indexOf(g)
    if (i >= 0) {
      comunes++
      restantes.splice(i, 1)
    }
  }
  return (2 * comunes) / (x.length + y.length)
}

export function slug(texto: string): string {
  return normalizar(texto).replace(/ /g, "_")
}
