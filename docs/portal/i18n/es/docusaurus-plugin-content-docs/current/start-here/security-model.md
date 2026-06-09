---
title: Modelo de seguridad
---

Pali es una billetera no custodial. No expone claves privadas a las dapps. Las dapps envían solicitudes al proveedor inyectado, Pali valida y enruta esas solicitudes, y los usuarios aprueban acciones sensibles en la UI de la extensión.

## Principios centrales

- **Conexiones limitadas por origen:** las conexiones se almacenan por host de dapp.
- **Una cuenta activa por dapp:** un sitio conectado tiene una cuenta activa a la vez, aunque muchos sitios puedan estar conectados.
- **Aprobaciones serializadas:** las solicitudes bloqueantes que abren popups se coordinan para que los usuarios no queden enterrados bajo aprobaciones en competencia.
- **Comprobaciones de familia de red:** los métodos EVM y los métodos UTXO están separados. Las llamadas a la familia incorrecta deben manejarse como errores recuperables de la dapp.
- **Firma explícita:** transacciones, PSBTs, datos tipados, firma de mensajes, creación passkey, ejecuciones passkey, solicitudes de observación de activos y cambios de cadena requieren el estado correcto de la billetera y aprobación del usuario.
- **Aislamiento del proveedor:** Pali inyecta proveedores en la página de nivel superior. No los inyecta en iframes.

## Qué reciben las dapps

Las dapps reciben identificadores públicos de cuenta, estado del proveedor, firmas, hashes de transacción y resultados RPC explícitos. Nunca reciben frases semilla, claves privadas, material privado passkey ni secretos del autenticador.

## Seguridad de passkey

Las cuentas inteligentes passkey usan credenciales WebAuthn. Pali almacena metadatos públicos e identificadores de credenciales; el material de clave privada permanece dentro del autenticador. Pali rechaza assertions WebAuthn entre orígenes y verifica que los hashes de acción passkey coincidan con el conjunto de transacciones preparado.

## Seguridad de la política de módulos

La política de módulos institucional se divide en:

- **Política on-chain:** modo, firmante sponsor y URL de sponsor.
- **Metadatos de billetera:** texto de política mostrado y otro contexto local de billetera.

El campo `policyText` se muestra a los usuarios como contexto. No es una primitiva de aplicación on-chain.
