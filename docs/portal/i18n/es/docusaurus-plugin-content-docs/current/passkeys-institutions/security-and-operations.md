---
title: Seguridad y operaciones
---

Las cuentas inteligentes de Pali deben tratarse como infraestructura de cuenta. El contrato mantiene activos y los módulos instalados deciden quién puede moverlos.

## Dependencias

La chain debe tener la factory y módulos de Pali en las direcciones que usa Pali. En redes EVM compatibles con el deployer CREATE2 canónico, Pali puede desplegar esa configuración desde la wallet: Settings, Advanced, **Smart account setup**, Deploy. Los validadores passkey también requieren verificación P-256 WebAuthn.

## Checklist operativo

- Decide qué validador controla la cuenta: passkey, ECDSA, composite o recovery.
- Trata owners ECDSA externos como riesgo alto.
- Define guardianes, threshold y delay de recuperación.
- Mantén financiada la cuenta que paga gas.
- Monitorea despliegues fallidos, instalaciones de módulos fallidas y recoveries expiradas.

Un validador composite puede combinar validadores hijos bajo un threshold — 1-of-N, t-of-N o N-of-N — y los hijos pueden ser a su vez composites, de modo que las políticas jerárquicas son posibles.

Al diseñar una política composite, documenta la justificación del threshold: 1-of-N optimiza la disponibilidad, N-of-N optimiza la garantía y t-of-N equilibra ambas. Los validadores son módulos reemplazables, así que la política (e incluso el esquema de firma — incluidos futuros validadores post-cuánticos) puede actualizarse más adelante sin cambiar la dirección de la cuenta. Los guardianes son un módulo con rol de ejecutor y se mantienen independientes de la política de validadores que esté activa.

## Recovery

Guardian recovery es un reemplazo demorado de validador. Pali usa una sal nueva por intento y el módulo permite una sola recovery activa por cuenta. No es una puerta trasera custodial: requiere guardianes configurados y firmas válidas.
