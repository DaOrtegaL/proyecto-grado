# Supuestos y limitaciones

## Supuestos
- Los datos son **sintéticos**; no se usan certificados, equipos ni credenciales corporativas.
- La población de referencia (≈ 280 tiendas, 6 países) no equivale a datos descubiertos ni a resultados experimentales.
- No se conocen contratos ni endpoints de MSH; el adaptador es un contrato propuesto con implementación simulada.

## Limitaciones técnicas
- **SQL Server no verificado:** el sistema se probó con la base simulada (JSON). La migración y el seed no se han aplicado a SQL Server.
- **Motor JSON:** sin concurrencia real, índices ni SQL; transacciones serializadas con bloqueo global.
- **Motor de vencimientos:** temporizador en proceso (`SCHEDULER_INTERVAL_SECONDS`) y barrido manual. No hay colas con persistencia ni reintentos (BullMQ/Redis pendiente).
- **Notificaciones:** solo canal interno; no hay envío externo.
- **Emisor, instalación y MSH simulados:** el emisor crea una CA efímera con el DN del emisor real; no valida cadenas contra una CA real.
- **Modo laboratorio:** deshabilitado; no existe ejecución remota ni cliente de agente firmado.
- **Control de acceso:** global por rol; sin alcance por tienda o país. No hay política de contraseñas ni bloqueo de cuentas.
- **Permisos en el token:** viajan en el JWT (15 min); un cambio de rol se refleja al renovar.
- **Auditoría encadenada:** detecta alteraciones internas, no el truncamiento de los últimos eventos ni la reescritura completa por quien controle la base.
- **Reproducibilidad:** la semilla fija la estructura y los vencimientos; las claves y huellas varían entre generaciones.
- **Fechas relativas:** los vencimientos de `mock-database/` dependen de la fecha de generación; regenerar con `npm run mock:reset`.
- **Internacionalización:** `es` completo; `pt-BR` está registrado pero sin traducciones; no hay selector de idioma en la interfaz. La API devuelve mensajes en español.
- **Alcance de indicadores:** los indicadores se calculan con datos sintéticos; la cobertura pareada se ofrece por país.

## Limitaciones de inferencia
El diseño preexperimental antes-después no permite atribuir causalidad. No se declara significancia estadística; la prueba de Wilcoxon se menciona solo como posibilidad cuando haya datos y supuestos suficientes.
