---
title: Sécurité et opérations
---

Les comptes intelligents Pali doivent être traités comme une infrastructure de compte. Le contrat détient les actifs et les modules installés décident qui peut les déplacer.

## Dépendances

La chain debe tener la factory y módulos de Pali configurados. Los validadores passkey también requieren verificación P-256 WebAuthn.

## Checklist opérationnelle

- Decide qué validador controla la cuenta: passkey, ECDSA, composite o recovery.
- Trata owners ECDSA externos como riesgo alto.
- Define guardianes, threshold y delay de recuperación.
- Mantén financiada la cuenta que paga gas.
- Monitorea despliegues fallidos, instalaciones de módulos fallidas y recoveries expiradas.

## Recovery

Guardian recovery es un reemplazo demorado de validador. Pali usa una sal nueva por intento y el módulo permite una sola recovery activa por cuenta. No es una puerta trasera custodial: requiere guardianes configurados y firmas válidas.
