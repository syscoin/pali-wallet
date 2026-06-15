---
title: Gas y financiación
---

La autorización de una cuenta inteligente y el pago de gas son cosas separadas. Un passkey o validador autoriza la acción; una cuenta financiada paga la comisión de red.

## Modelo actual

El flujo actual usa gas pagado por la wallet: despliegue, instalación de módulos, `wallet_sendCalls` y guardian recovery se envían con una cuenta local financiada. No anuncies una experiencia gasless salvo que una capability futura lo indique explícitamente.

## Gas zkSYS mediante paymaster

En redes configuradas como zkTanenbaum, Pali puede pagar envíos elegibles de smart account con zkSYS mediante un paymaster de Pali. El primer uso puede requerir una aprobación única de zkSYS; esa transacción de configuración todavía puede necesitar gas nativo. Si el patrocinio con zkSYS es opcional y no está disponible, se rechaza o no es seguro para la operación, Pali vuelve al gas nativo. Las dapps deberían describirlo como gas de smart account pagado con zkSYS cuando esté disponible, no como un flujo completamente gasless.

## Guía para dapps

Explica que Pali creará una cuenta inteligente, que el usuario aprobará la acción y que puede necesitar native token para despliegue o recuperación. No pases objetos legacy de patrocinio a `wallet_prepareSmartAccount`; la solicitud actual usa label y configuración de authenticator/módulos.
