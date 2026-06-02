---
title: Pruebas con Pali
---

Usa la dapp de prueba de Syscoin para pruebas manuales de integración y tus propias pruebas automatizadas para la lógica de aplicación.

## Dapp de prueba alojada

La dapp de prueba de Syscoin está alojada en:

```text
https://syscoin-test-dapp.vercel.app/
```

Incluye flujos passkey de Pali, `wallet_createPasskeyAccount`, `wallet_sendCalls`, generación de lotes de allowance ERC-20 y solicitudes comunes de billetera.

## Dapp de prueba local

Si necesitas probar cambios no publicados:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Extensión Pali local

```bash
git clone https://github.com/syscoin/pali_wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

Luego carga `build/chrome` mediante la página de desarrollo de extensiones del navegador.

## Checklist de pruebas passkey

1. Conecta Pali mediante el selector de proveedor predeterminado.
2. Crea o recupera una cuenta passkey con sponsorship deshabilitado.
3. Financia o despliega la cuenta passkey si tu prueba lo requiere.
4. Construye un approve ERC-20 más un lote `transferFrom`.
5. Envía el lote con `wallet_sendCalls`.
6. Confirma que la billetera muestra calldata decodificada y una sola aprobación WebAuthn para el lote passkey.
