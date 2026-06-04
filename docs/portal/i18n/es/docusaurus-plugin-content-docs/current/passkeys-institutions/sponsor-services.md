---
title: Servicios sponsor
---

Un servicio sponsor es un endpoint controlado por una institución que participa en la política de ejecución de cuentas inteligentes passkey.

## Objeto sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Estados pending y success de relay sponsor en Pali" />
</a>
  <figcaption>La ejecución patrocinada debe dejar claros los estados pending, success y failure para los usuarios.</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Significado de campos

| Campo | Propósito |
| --- | --- |
| `mode` | `disabled`, `gasOnly` o `required`. |
| `url` | Endpoint opcional de servicio que Pali contacta para soporte de ejecución sponsor. Pali lo requiere para sponsorship `gasOnly` porque no hay sponsor remoto de gas sin una URL de servicio. |
| `signer` | Dirección esperada del firmante sponsor para pruebas de política requerida. Obligatorio para modo `required`. |
| `policyText` | Explicación visible al usuario almacenada en metadatos de billetera. No es aplicación on-chain. |

## Política on-chain

La política de la cuenta inteligente almacena modo, firmante y una URL pública de sponsor. El texto de política es metadato de billetera usado para visualización.

## Idempotencia

Las solicitudes de ejecución sponsor usan una clave de idempotencia derivada del hash de acción passkey. Un servicio sponsor debe tratar solicitudes repetidas con la misma clave como la misma acción.

## Modo sponsor requerido

En modo `required`, la prueba de sponsor debe recuperar al firmante configurado. La URL de sponsor es opcional: Pali puede obtener la prueba del servicio sponsor cuando se configura una URL, o firmar localmente cuando el firmante configurado es una cuenta disponible en la billetera. Si Pali no puede obtener o validar la prueba de sponsor, la ejecución falla.

El pago de gas es independiente de la autorización del sponsor. Después de que haya una prueba de sponsor válida, Pali todavía puede pagar gas desde cualquier cuenta de software financiada seleccionada para ejecución passkey.

## Modo gas-only

En modo `gasOnly`, el servicio sponsor puede retransmitir o ayudar a pagar gas. Pali requiere una URL de sponsor para este modo porque la URL identifica el servicio de sponsorship de gas. Si sponsorship no está disponible, Pali puede hacer fallback a ejecución con gas de la billetera donde la política lo permita.

## Guía institucional

- Usa URLs de sponsor estables por usuario.
- Mantén las claves de firmante en infraestructura institucional, no en el frontend de la dapp.
- Haz que el texto de política sea corto, específico y comprensible.
- Devuelve estado consistente para claves de idempotencia repetidas.
- Monitorea solicitudes de sponsor fallidas y deadlines de ejecución expirados.
