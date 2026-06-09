---
title: Comptes intelligents et passkeys
---

Les comptes intelligents Pali sont des comptes de contrat EVM contrôlés par des modules. Un passkey est une manière prise en charge de les contrôler ; ils peuvent aussi utiliser ECDSA ou des politiques composites.

## Pourquoi les utiliser

- Aprobaciones con passkey para uso diario.
- Owners ECDSA cuando una wallet o equipo debe controlar la cuenta.
- Validadores composite para co-gestión.
- Acciones por lote y guardian recovery.

## Déploiement

Pali deriva la dirección de forma determinista, despliega mediante la factory y guarda metadatos duraderos. El despliegue empieza con un validador bootstrap ECDSA de la wallet; luego Pali instala el validador solicitado si es distinto.

## Guardian recovery

Guardian recovery no es instantáneo. Un guardian firma una intención, el módulo la programa con delay, y después cualquiera puede finalizar el reemplazo del validador. Pali usa una sal nueva por intento y solo permite una recovery activa por cuenta.
