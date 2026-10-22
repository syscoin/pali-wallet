---
title: Smart accounts da Pali
---

As smart accounts da Pali são contas de contrato que a Pali pode criar, conectar e operar para o usuário. Para uma pessoa comum, a experiência parece uma conta de carteira: revisar a solicitação da dapp, aprovar com passkey ou uma chave da carteira e deixar a Pali enviar a transação. Por baixo, a conta é modular: validadores autorizam ações e executores adicionam recursos como recuperação.

## Ideia simples

- Um único endereço mantém os fundos e é o endereço visto pelas dapps.
- A conta pode usar passkey, ECDSA ou uma política composta.
- Guardian recovery pode substituir o validador ativo depois de uma espera.
- `wallet_sendCalls` pode executar várias chamadas como uma ação atômica.

## Modelo técnico

`PaliSmartAccount` executa chamadas e valida assinaturas por módulos estilo ERC-7579. `PaliSmartAccountFactory` deriva endereços determinísticos e implanta contas. A Pali prepara execuções com codificação estilo ERC-4337 e usa EIP-1271 para assinaturas de contrato.

A conta é implantada primeiro com um validador ECDSA controlado pela carteira. Se a dapp pediu passkey ou outro validador suportado, a Pali instala o validador solicitado e remove o bootstrap validator com uma execução da conta.

## Dois papéis: validadores assinam, guardiões recuperam

O ERC-7579 separa os papéis dos módulos, e a Pali adota essa separação deliberadamente:

- **Validadores** verificam assinaturas para aprovações normais da conta, como passkeys, ECDSA e políticas compostas.
- **Executores** podem executar ações por meio de um módulo instalado. O módulo de guardiões da Pali exige o limite configurado e um prazo de espera. O fluxo guiado substitui o validador ativo; o módulo on-chain não se limita a essa ação da interface.

Os guardiões têm, portanto, autoridade adiada sobre a conta. Um limite comprometido coloca o controle e os fundos em risco. O proprietário atual pode agir durante a espera, mas a ação protetora deve ser confirmada antes de uma execução maliciosa. Consulte [Recuperação com guardiões](../users/smart-account-validators).

## Políticas de assinatura compostas

O validador composite combina validadores filhos sob um threshold, o que transforma uma conta em um motor de políticas:

- **1-of-N** — qualquer um entre vários autenticadores pode aprovar. Conveniente para contas pessoais com um passkey em cada dispositivo.
- **t-of-N** — um quórum precisa aprovar. O formato natural para tesourarias compartilhadas, desks e contas controladas por equipes.
- **N-of-N** — todos os validadores configurados precisam aprovar. Contas de máxima garantia.

A Pali atualmente coleta aprovações de validadores filhos integrados disponíveis localmente até atingir o limite. Esta versão não oferece suporte a compostos aninhados nem à coleta de aprovações externas ou entre dispositivos. A recuperação com guardiões permanece independente da política do validador ativo.

## Agilidade de validadores e preparação pós-quântica

Em redes configuradas, a Pali suporta ECDSA controlado pela carteira, passkeys P-256 WebAuthn, SLH-DSA e validadores compostos. Os módulos on-chain correspondentes precisam estar implantados e as chaves ou credenciais locais necessárias devem estar disponíveis. Módulos substituíveis também permitem adotar novos esquemas de assinatura no mesmo endereço. Trocar o validador não move fundos, histórico ou integrações.

O módulo de guardiões verifica aprovações ECDSA de endereços normais e ERC-1271 de contas de contrato. A Pali pode usar guardiões locais baseados em chaves e contas inteligentes locais já implantadas para as quais pode assinar, incluindo SLH-DSA. Um guardião externo indisponível como assinador local precisa de um fluxo de aprovação externo.

## Para instituições e equipes

Instituições devem tratar essas contas como infraestrutura de conta, não apenas login com passkey. Usem passkeys para onboarding com menos atrito, ECDSA ou validadores compostos para controles de equipe ou hardware wallet, guardian recovery para substituição com atraso e contas pagadoras de gas financiadas para implantação e execução. Documentem quem controla cada validador, quem são os guardiões e o significado do atraso de recuperação.

A Pali mostra um aviso especial quando uma dapp solicita owners ECDSA externos, porque esses endereços podem aprovar ações futuras da conta.

## Método de dapp

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

Se `authenticator` não for informado, a Pali usa passkey por padrão.

## Redes suportadas

As smart accounts da Pali funcionam em chains EVM compatíveis onde a factory e os módulos da Pali existem nos endereços esperados pela Pali. Isso não é limitado a chains operadas pela Pali: se a chain ativa expõe o deployer CREATE2 canônico, a Pali pode implantar a configuração de smart account ausente diretamente pela carteira. Abra Pali Settings, vá para Advanced e use o botão Deploy em **Smart account setup**.

Validadores passkey precisam de verificação P-256 WebAuthn. Muitos ambientes EVM modernos expõem isso por meio de um precompile P-256/passkey, mas integradores devem verificar o suporte da chain antes de depender de validadores passkey.

## Controle do usuário

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>Após a revisão na carteira, o navegador ou o sistema operacional cuida da criação do passkey WebAuthn quando o validador escolhido é baseado em passkey.</figcaption>
</figure>

O usuário vê o site solicitante, o rótulo da conta, o autenticador solicitado e quaisquer endereços externos de owners ECDSA antes de aprovar. O navegador ou o sistema operacional mostra o prompt WebAuthn quando a Pali precisa de uma nova credencial passkey. A Pali mostra o progresso de implantação, instalação de módulos e confirmação antes de conectar a smart account à dapp.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>Onboarding iniciado pela dapp: revise a solicitação, confirme e a smart account fica pronta.</figcaption>
</figure>

## Referências de padrões

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
