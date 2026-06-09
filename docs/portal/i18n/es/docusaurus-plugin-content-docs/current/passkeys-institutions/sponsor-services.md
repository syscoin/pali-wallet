---
title: Gas y financiación
---

La autorización de una cuenta inteligente y el pago de gas son cosas separadas. Un passkey o validador autoriza la acción; una cuenta financiada paga la comisión de red.

## Modelo actual

El flujo actual usa gas pagado por la wallet: despliegue, instalación de módulos, `wallet_sendCalls` y guardian recovery se envían con una cuenta local financiada. No anuncies una experiencia gasless salvo que una capability futura lo indique explícitamente.

## Guía para dapps

Explica que Pali creará una cuenta inteligente, que el usuario aprobará la acción y que puede necesitar native token para despliegue o recuperación. No pases objetos legacy de patrocinio a `wallet_prepareSmartAccount`; la solicitud actual usa label y configuración de authenticator/módulos.
