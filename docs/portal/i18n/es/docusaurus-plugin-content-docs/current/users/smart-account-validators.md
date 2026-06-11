---
title: Cuentas inteligentes y passkeys
---

Las cuentas inteligentes de Pali son cuentas EVM de contrato controladas por módulos. Un passkey es una forma soportada de controlarlas; también pueden usar ECDSA o políticas compuestas.

Piensa en los validadores como la respuesta a "¿quién puede aprobar acciones de esta cuenta?" — y lo útil es que la respuesta puede cambiar sin cambiar tu cuenta:

- **Cualquiera de mis accesos** (1-of-N): aprueba con el passkey o la clave que tengas a mano.
- **Algunos de nosotros juntos** (t-of-N): un quórum de personas o dispositivos debe estar de acuerdo, ideal para fondos compartidos.
- **Todos nosotros juntos** (N-of-N): todos los accesos configurados deben aprobar, para las cuentas más sensibles.

Las políticas incluso pueden contener otras políticas, de modo que un equipo puede expresar cosas como "la clave del líder más dos passkeys cualesquiera de la mesa". Tu dirección, tus saldos y tu historial se mantienen exactamente iguales cuando la política cambia — y como la firma es modular, más adelante se pueden adoptar nuevos tipos de firma (incluidos los post-cuánticos) en la misma cuenta.

Los guardianes intencionalmente **no** forman parte de esta lista. Un guardián nunca puede aprobar una transacción; su único poder es iniciar una recuperación lenta y visible si pierdes el acceso. Esa separación te protege de la pérdida de acceso sin darle a nadie el control del día a día.

## Por qué usarlas

- Aprobaciones con passkey para uso diario.
- Owners ECDSA cuando una wallet o equipo debe controlar la cuenta.
- Validadores composite para co-gestión.
- Acciones por lote y guardian recovery.

## Despliegue

Pali deriva la dirección de forma determinista, despliega mediante la factory y guarda metadatos duraderos. El despliegue empieza con un validador bootstrap ECDSA de la wallet; luego Pali instala el validador solicitado si es distinto.

## Guardian recovery

Guardian recovery no es instantáneo. Un guardian firma una intención, el módulo la programa con delay, y después cualquiera puede finalizar el reemplazo del validador. Pali usa una sal nueva por intento y solo permite una recovery activa por cuenta.
