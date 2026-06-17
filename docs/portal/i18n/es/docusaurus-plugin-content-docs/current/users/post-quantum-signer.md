---
title: Firmante poscuántico para cuentas inteligentes
---

Las cuentas inteligentes de Pali pueden usar distintos validadores. Uno de ellos es un firmante poscuántico local basado en **SLH-DSA-SHA2-128s**, una familia de firmas hash estandarizada por NIST en FIPS 205.

En palabras simples: permite que una cuenta inteligente apruebe acciones con una firma diseñada para resistir ataques cuánticos conocidos contra firmas ECDSA actuales.

:::caution Nota alfa
Las cuentas inteligentes de Pali y el validador SLH-DSA son infraestructura temprana. Empieza en redes de prueba compatibles o con saldos pequeños, mantén una ruta de recuperación o validador alternativo y espera que la configuración y firma sean más lentas que una firma normal.
:::

## Qué cambia

Con una cuenta EVM normal, una clave privada ECDSA controla la dirección. Con una cuenta inteligente, la dirección es un contrato y un validador decide qué cuenta como aprobación. Ese validador puede ser ECDSA, passkey, una política compuesta o SLH-DSA.

Lo que se mantiene:

- La dirección de la cuenta inteligente no cambia.
- Las dapps siguen viendo una sola dirección EVM.
- Pali sigue mostrando una solicitud para revisar antes de firmar.
- La recuperación por guardianes y la rotación de validadores siguen disponibles.

Lo que cambia:

- La configuración tarda más porque Pali prepara una caché local.
- Firmar puede tardar más que ECDSA o passkeys.
- El estado local del firmante debe estar disponible en el dispositivo, o tendrás que regenerarlo.

## Cómo activarlo

1. Abre Pali y cambia a una red EVM compatible.
2. Abre **Settings**.
3. Entra en la pantalla de cuenta inteligente o política.
4. Elige **Post-quantum / SLH-DSA**.
5. Mantén Pali abierto mientras se prepara la caché.
6. Revisa y envía la transacción de cambio de validador.

Si Pali indica que falta el firmante local o no coincide con el validador activo, regenera el estado del firmante desde la pantalla de política.

## Límite de firmas

El perfil SLH-DSA actual tiene una capacidad absoluta de `2^24` firmas por firmante local preparado. Pali reserva `1,000` firmas para reintentos de rotación fuera de esa clave, así que la firma normal se detiene en `2^24 - 1,000`. Sigue siendo más de 16 millones de firmas, así que un usuario normal probablemente no llegará a ese límite.

Si se agota el presupuesto normal, Pali deja de firmar operaciones normales con esa clave y conserva la reserva para reintentos de rotación del validador. No firma silenciosamente con un firmante agotado.

## Referencias

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [Proyecto poscuántico de NIST](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
