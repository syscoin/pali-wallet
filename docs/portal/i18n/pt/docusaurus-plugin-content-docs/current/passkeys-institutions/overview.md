---
title: Passkeys e instituições
---

Smart accounts com passkey da Pali permitem que uma dapp solicite criação ou recuperação de conta pela carteira enquanto o usuário controla a execução por meio de WebAuthn.

Isso é útil para:

- onboarding institucional
- fluxos de gas apoiados por sponsor
- políticas coautorizadas
- recuperação de conta após reinstalação da carteira
- workflows atômicos de múltiplas chamadas
- dapps que querem UX de passkey sem construir uma carteira

## Por que passkeys zkSYS são possíveis

Passkeys usam WebAuthn, e o algoritmo de assinatura padrão do WebAuthn é ES256: ECDSA sobre a curva P-256, também conhecida como secp256r1. Carteiras EVM genéricas normalmente usam EOAs secp256k1, então uma assinatura de passkey não é diretamente uma assinatura EOA.

As contas com passkey da Pali são smart accounts zkSYS projetadas em torno de verificação P-256 on-chain. A carteira extrai as coordenadas da chave pública WebAuthn, challenge, dados do authenticator, dados do cliente e assinatura P-256; depois o caminho de smart account/fábrica verifica essa prova contra os metadados registrados da conta. É isso que torna biometria de dispositivo ou passkeys de plataforma utilizáveis para autorização de conta, mantendo a chave privada dentro do authenticator do usuário.

O resultado prático é uma UX de carteira que parece login biométrico, mas autoriza uma ação de chain:

1. A dapp solicita uma smart account com passkey ou execução em lote.
2. A Pali prepara um hash de ação para a chain, conta, chamadas, nonce, deadline e política de sponsor exatos.
3. O navegador/OS pede ao usuário aprovação de passkey.
4. A smart account zkSYS verifica a prova WebAuthn P-256 on-chain antes de executar.

## Redes suportadas

Contas com passkey não estão habilitadas em toda chain EVM. Elas exigem uma fábrica de passkey configurada e suporte zkSYS à verificação P-256.

| Rede | Chain id | Status nesta build da Pali |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Configurada. Fábrica: `0x04a52bc8B5fadBfeBBAF927832d545a270cA0cAb`. |
| `zkSYS` | TBD in wallet config | Alvo de produção pretendido para a mesma arquitetura de passkey assim que o endereço da fábrica estiver configurado na Pali. |

Se uma dapp chama `wallet_createPasskeyAccount` em uma rede sem uma fábrica configurada, a Pali rejeita a solicitação em vez de criar metadados sem suporte.

## Método da dapp

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Popup wallet_createPasskeyAccount da Pali com sponsorship desabilitado" />
</a>
  <figcaption>O fluxo padrão de passkey orientado por dapp deve começar com sponsorship desabilitado, a menos que a instituição precise explicitamente de política de sponsor.</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

O resultado inclui o `address` da smart account e metadados públicos da passkey.

## Modos de sponsor

| Modo | Significado |
| --- | --- |
| `disabled` | Sem política de sponsor. A carteira/usuário paga gas. |
| `gasOnly` | Serviço de sponsor pode pagar gas. A Pali exige uma URL de sponsor para este modo; se sponsorship falhar, fallback para gas da carteira pode ser permitido. |
| `required` | Coautorização do sponsor é exigida pela política. Um signer é obrigatório; a URL de sponsor é opcional quando a Pali pode obter a prova do signer de uma conta local na carteira. |

## Controle do usuário

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Folha de criação de passkey do navegador ou sistema operacional" />
</a>
  <figcaption>Após a revisão da carteira, o navegador ou sistema operacional cuida da criação de passkey WebAuthn.</figcaption>
</figure>

O usuário vê o site solicitante, rótulo, modo de sponsor, signer, URL e texto de política antes de aprovar. O navegador ou OS então mostra o prompt de passkey WebAuthn.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Fluxo de onboarding de dapp com passkey"></video>
  <figcaption>Fluxo de onboarding com passkey: introdução com marca, solicitação da dapp e aprovação de conta na Pali.</figcaption>
</figure>
