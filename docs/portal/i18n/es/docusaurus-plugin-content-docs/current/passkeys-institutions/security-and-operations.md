---
title: Seguridad y operaciones
---

Las integraciones institucionales passkey deben diseñarse como infraestructura de cuentas de producción, no solo como un botón de inicio de sesión.

## Dependencia de red y verificador

Las cuentas passkey dependen del soporte zkSYS para verificar firmas P-256 WebAuthn. No asumas que una cuenta passkey puede crearse en cualquier cadena EVM solo porque la cadena admite contratos inteligentes. La cadena debe tener desplegada la fábrica passkey y Pali debe tener esa dirección de fábrica configurada para la cadena activa.

Hoy, el despliegue de prueba configurado de Pali es `zkTanenbaum` (`57057`). Trata la producción zkSYS como el objetivo de despliegue de producción para la misma arquitectura una vez que su fábrica esté configurada en la billetera.

## Checklist operativo

- Decide si cada usuario recibe una cuenta passkey compartida de Pali o una credencial separada.
- Decide si sponsorship está deshabilitado, es solo gas o requerido.
- Mantén disponibilidad del servicio sponsor si usas modo `required`.
- Monitorea fallos de relayer, deadlines expirados y claves de idempotencia repetidas.
- Proporciona una ruta de soporte para usuarios con dispositivos perdidos y recuperación fallida.
- Documenta si la institución puede coautorizar ejecución.

## Financiación y despliegue

Las cuentas inteligentes passkey pueden ser contrafactuales antes del primer uso. La primera ejecución puede necesitar un pagador de gas de despliegue o una ruta de sponsor. Tu flujo de onboarding debe explicar si los usuarios necesitan financiar la cuenta antes de usarla.

La fábrica puede calcular la dirección de la cuenta antes del despliegue. Esto es útil para onboarding porque una dapp o institución puede mostrar o financiar la dirección antes de la primera transacción on-chain.

## Supuestos de recuperación

La recuperación está limitada a la billetera y a la passkey. Un usuario generalmente necesita:

- el contexto restaurado de Pali Wallet
- la credencial WebAuthn relevante
- soporte de cadena para la fábrica passkey

La recuperación no es una puerta trasera custodial. La cadena proporciona metadatos públicos descubribles y listas de cuentas, pero el usuario aún necesita el contexto de recuperación de la billetera y la credencial WebAuthn relevante para probar control.

## Estado de respaldo de credencial

Pali puede mostrar estado de respaldo de credenciales WebAuthn cuando el navegador y el autenticador lo exponen. Trátalo como una señal operativa, no como una regla de seguridad on-chain.

El estado de respaldo puede indicar si una credencial parece vinculada al dispositivo, elegible para respaldo o actualmente respaldada/sincronizada por el proveedor de passkey de plataforma. Una passkey sincronizada puede mejorar la conveniencia y la recuperación por pérdida de dispositivo porque el usuario puede restaurar la credencial mediante su cuenta de Apple, Google, Microsoft u otra plataforma. La compensación es que el límite de seguridad efectivo ahora incluye esa cuenta de plataforma, su proceso de recuperación y cualquier dispositivo donde la passkey esté sincronizada.

| Estado de credencial | Implicación para política institucional | Experiencia de usuario | Límite de riesgo |
| --- | --- | --- | --- |
| Respaldada o sincronizada | Aceptar cuando la recuperación de cuenta y conveniencia de onboarding importan más que el aislamiento estricto del dispositivo. | Mejor experiencia de reemplazo de dispositivo y multi-dispositivo. A menudo es el predeterminado de plataforma para passkeys de consumidor. | La confianza se extiende a la cuenta de plataforma, flujo de recuperación de plataforma y dispositivos sincronizados. |
| Elegible para respaldo | Decide si la elegibilidad por sí sola es aceptable, porque la credencial puede sincronizarse más adelante. | Flexible, pero los usuarios pueden no entender si la sincronización está activa. | Requiere guía clara para usuarios y revisión periódica de estado si cambia el valor de la cuenta. |
| Vinculada al dispositivo o no respaldada | Preferir para cuentas de alto valor, tesorería, administración o estilo cold. | Más fricción y mayor carga de soporte si se pierde el dispositivo. | Aislamiento más fuerte a un autenticador específico o llave hardware. |
| Desconocida o no disponible | Evitar para decisiones de política de alta garantía salvo que tengas controles de autenticador fuera de banda. | El usuario puede continuar, pero la institución no puede clasificar la credencial con confianza. | Ambiguo; no tratar como prueba de respaldo en la nube ni prueba de aislamiento vinculado al dispositivo. |

Para cuentas institucionales de mayor garantía, decide y documenta si las passkeys sincronizadas son aceptables. Las passkeys sincronizadas siguen siendo seguras para uso común de billetera y dapp porque Pali y la dapp nunca reciben la clave privada passkey, WebAuthn permanece limitado por origen y el autenticador de plataforma sigue realizando verificación de usuario. Simplemente no son el valor predeterminado adecuado para almacenamiento en frío, controles de tesorería o saldos grandes a largo plazo salvo que la institución acepte explícitamente el límite de recuperación de la cuenta de plataforma.

## Comunicación con usuarios

Usa texto de política claro. Una buena política explica:

- quién opera el servicio sponsor
- qué acciones requieren coautorización
- si la institución paga gas
- qué ocurre si el servicio sponsor no está disponible

## No dependas del texto de política para aplicar reglas

`policyText` es un campo de divulgación y metadatos de billetera. La aplicación de reglas ocurre mediante política on-chain y validación de prueba de sponsor.
