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

Pali recopila actualmente aprobaciones de validadores hijos integrados disponibles localmente hasta alcanzar el umbral. Esta versión no admite compuestos anidados ni la recopilación de aprobaciones externas o entre dispositivos. La recuperación con guardianes sigue siendo independiente de la política del validador activo.

Al diseñar una política composite, documenta la justificación del threshold: 1-of-N optimiza la disponibilidad, N-of-N optimiza la garantía y t-of-N equilibra ambas. Los validadores son módulos reemplazables, así que la política (e incluso el esquema de firma — incluidos futuros validadores post-cuánticos) puede actualizarse más adelante sin cambiar la dirección de la cuenta. Los guardianes son un módulo con rol de ejecutor y se mantienen independientes de la política de validadores que esté activa.

## Recovery

El flujo guiado de recuperación con guardianes de Pali sustituye al validador activo tras una espera. El método anterior sigue activo hasta la finalización confirmada. Sin embargo, el ejecutor on-chain puede ejecutar acciones de cuenta aprobadas por los guardianes y no se limita a la sustitución de validador de la interfaz; los hooks instalados pueden imponer más restricciones. Un umbral de guardianes comprometido pone en riesgo el control y los fondos. El módulo instalado exige aprobaciones válidas; Pali usa una sal nueva por intento y el contrato permite un único proceso activo no vencido por cuenta.

:::tip Guía actual de recuperación con guardianes

La [guía completa](../users/smart-account-validators#guardian-recovery-guide) explica la configuración, el inicio, la finalización y **Disable guardian recovery**. Las políticas nuevas ofrecen esperas de 3 o 7 días; 10 minutos se limita a testnets conocidas. La desactivación confirmada requiere el método de aprobación actual y gas, invalida las recuperaciones pendientes y elimina esa vía de recuperación, pero no revierte una recuperación ya finalizada. Si una transacción es incierta, comprueba primero su estado on-chain. Las alertas opcionales de Sysnode requieren un correo verificado y una firma de la wallet; no reciben claves ni garantizan la entrega.

:::
