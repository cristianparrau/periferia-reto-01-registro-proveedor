# Proceso de registro como proveedor

## Contexto
- Llegan 8 a 12 solicitudes al mes de clientes en Colombia, Ecuador, Perú, Panamá y Honduras.
- La información de Periferia está en el repositorio maestro; los soportes en el repositorio de soportes con su fecha de vigencia.
- El cierre siempre es humano: firma del representante legal y envío al cliente.

## Formatos de salida
- **xlsx**: se escribe cada etiqueta y su valor en la hoja y celda que indica la plantilla del cliente.
- **pdf**: se genera un PDF con todos los campos en el orden de la plantilla.
- **portal**: no se automatiza. Se entregan los valores listos para copiar; una persona ingresa las credenciales y hace clic en "Enviar".

## Estados de un campo
- `lleno`: el valor viene del maestro, con su ruta.
- `faltante`: no existe en el maestro. Se completa a mano; no bloquea la firma.
- `requiere_confirmacion`: mapeo de baja confianza o regla de país. Una persona lo revisa antes de firmar.

## Identificador tributario por país
CO → NIT · EC, PE, PA → RUC · HN → RTN. Periferia solo tiene NIT colombiano: para clientes fuera de Colombia se diligencia el NIT y se marca "identificador extranjero".

## Soportes
- Un soporte vencido o ausente **bloquea** el paquete para firma.
- Un soporte que vence en 7 días o menos se advierte para enviarlo antes de esa fecha.
- La Cámara de Comercio tiene vigencia de 30 días: renovar con anticipación.
- Los soportes son colombianos; si el cliente es de otro país se advierte, sin bloquear.

## Datos bancarios
Solo se diligencian si la plantilla los pide. Nunca se incluyen en correos.
