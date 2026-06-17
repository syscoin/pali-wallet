---
title: Cuentas inteligentes SLH-DSA
---

Las cuentas inteligentes de Pali admiten validadores modulares. El validador poscuántico usa firmas locales **SLH-DSA-SHA2-128s** administradas por Pali. En las APIs el identificador del autenticador es `slh-dsa`.

:::caution Nota alfa
Las cuentas inteligentes de Pali y SLH-DSA son infraestructura temprana. Usa redes de prueba compatibles o cuentas con saldos pequeños, conserva una ruta de recuperación o validador alternativo y no diseñes UX de dapp basada en tiempos fijos de configuración o firma.
:::

## Solicitud de dapp

Solicita una cuenta inteligente con `wallet_prepareSmartAccount`:

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Cuenta poscuántica de prueba',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

No incluyas `keyId`, `pkSeed`, `pkRoot` ni material de clave SLH-DSA. Pali genera y administra el firmante local. Las claves SLH-DSA suministradas por una dapp se rechazan para evitar crear cuentas que Pali no pueda firmar.

## Flujo de firma

Pali firma el hash de acción de la cuenta inteligente con el firmante SLH-DSA local. Antes de firmar comprueba que la cuenta objetivo sea la correcta, que los metadatos estén hidratados, que el validador activo sea `slh-dsa`, que la clave pública coincida con el estado local y que la sesión pueda descifrar el estado local.

Si algo falla, Pali no firma y pide regenerar el estado local o usar otro método de aprobación.

## Límites y gas

- capacidad absoluta por clave: `2^24`;
- límite de firma normal: `2^24 - 1,000`;
- firmas reservadas para rotación: `1,000`;
- longitud de firma: `3,856` bytes;
- `preVerificationGas` SLH-DSA: `130,000`;
- `verificationGasLimit` SLH-DSA: `700,000` como límite conservador.

Cuando `signatureCount >= signatureLimit`, Pali deja de firmar operaciones normales con esa clave y solo permite el presupuesto reservado para ejecuciones explícitas de `rotateValidator`. Las dapps no deben asumir tiempos fijos de firma.

## Referencias

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
