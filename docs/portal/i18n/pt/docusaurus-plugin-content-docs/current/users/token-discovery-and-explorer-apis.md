---
title: Descoberta de tokens e APIs de exploradores
---

A Pali pode usar a API de um explorador para encontrar tokens e NFTs que você pode importar. Você também pode adicionar um ativo pelo endereço do contrato. Os saldos dos tokens importados são consultados pelo RPC da rede, portanto a descoberta automática é opcional.

## O que funciona por padrão

| Rede                       | Descoberta automática                                                                                          | Se um ativo estiver faltando                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Rede principal do Ethereum | Routescan, sem conta ou chave de API. Oferece suporte a tokens ERC-20 e a ativos ERC-721/ERC-1155 compatíveis. | Use **Importar Token → Adicionar Personalizado**.                                                                 |
| Base                       | Não há API de descoberta padrão. A rede e seu RPC continuam disponíveis.                                       | Adicione ativos pelo endereço do contrato ou configure uma API de explorador compatível à qual você tenha acesso. |
| Arbitrum One               | Não há API de descoberta padrão. A rede e seu RPC continuam disponíveis.                                       | Adicione ativos pelo endereço do contrato ou configure uma API de explorador compatível à qual você tenha acesso. |
| Outras redes EVM           | Depende da API de explorador configurada para essa rede.                                                       | Adicione ativos pelo endereço do contrato se a descoberta estiver indisponível.                                   |

Quando não há uma API de explorador configurada, a Pali mostra diretamente o formulário de endereço do contrato, sem abas, com um aviso breve e um link de **Ajuda para importar tokens**. Limpar uma URL de API não remove a rede nem seus ativos importados. Sem uma API de explorador, o histórico de transações depende das transações salvas localmente e das consultas RPC; ele pode não recuperar todo o histórico anterior.

## Adicionar um token ou NFT manualmente

1. Selecione a rede e a conta corretas.
2. Abra **Importar Token**. Se houver abas, escolha **Adicionar Personalizado**.
3. Insira o endereço do contrato do ativo nessa rede.
4. Confira os detalhes detectados do ativo. Para um ativo ERC-1155, insira também seu ID de token.
5. Importe o ativo.

Use o endereço do contrato publicado pelo projeto ou exibido em um explorador confiável. Contratos sem relação entre si podem usar o mesmo nome de token, e um endereço em uma rede pode identificar um ativo diferente em outra.

## Configurar uma API de explorador

Uma URL de RPC, um site de explorador e uma URL de API de explorador têm finalidades diferentes. O RPC conecta a Pali à rede; o site do explorador abre endereços e transações no navegador; a API do explorador fornece os ativos e o histórico indexados.

1. Abra o seletor de redes da Pali e escolha **Gerenciar redes**.
2. Selecione o ícone de lápis ao lado da rede EVM que deseja editar.
3. Encontre **URL da API do Explorador de Blocos (opcional)**. Cole a URL de API apropriada dos exemplos abaixo. Mantenha a URL de RPC e o ID da rede atuais, a menos que também pretenda alterar essas configurações.
4. Escolha **Salvar**. A Pali verifica o RPC e o acesso básico à API do explorador antes de salvar. Uma verificação de acesso bem-sucedida não garante que todos os endpoints de descoberta ou histórico sejam compatíveis.
5. Troque para outra rede e depois volte à rede que editou. Isso atualiza a configuração de API ativa dela. Abra novamente **Importar Token → Seus Tokens** para carregar os ativos com a nova API.

Para adicionar uma nova rede, escolha **RPC personalizado** no seletor de redes. O formulário inclui o mesmo campo opcional de API de explorador. Para desativar a descoberta indexada em uma rede, limpe esse campo e salve.

## Formatos compatíveis e exemplos de URL

### Ethereum: Routescan

A URL de API integrada para o Ethereum é:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

Deixe-a sem chave para usar o acesso público. A Pali usa as APIs de ativos da Routescan para a descoberta e sua API compatível com Etherscan para o histórico de transações. A indexação do provedor pode estar incompleta ou atrasada. Alterar o número da rede nessa URL não confirma que a Routescan oferece suporte a outra rede. Consulte a [referência da API da Routescan](https://routescan.io/docs/api) para conhecer sua cobertura e seus endpoints.

Atualmente, a Routescan documenta um limite sem chave de **2 solicitações por segundo e 10.000 chamadas por dia**. A Pali espaça as solicitações e armazena os resultados em cache, mas os limites do provedor ainda se aplicam. Consulte os [limites atuais da Routescan](https://routescan.io/docs/plans-and-limits/rate-limits) e seus [planos](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing).

Para usar uma chave de API pessoal da Routescan, substitua `YOUR_API_KEY` em:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

A Pali envia esse valor no [cabeçalho de solicitação `apikey`](https://routescan.io/docs/api/conventions) do provedor. Os limites do seu plano com o provedor se aplicam.

### Descoberta compatível com Blockscout

A Pali também oferece suporte a APIs de exploradores que implementam o formato de solicitação **account/tokenlist** do Blockscout. Configure a URL base da API e qualquer seletor de rede ou chave de API exigidos; a Pali fornece o endereço da conta e os parâmetros da solicitação de descoberta. Consulte a [documentação de listagem de tokens do Blockscout](https://docs.blockscout.com/devs/apis/rpc/account).

Por exemplo, uma API do Blockscout hospedada por você ou compatível com seu provedor pode usar:

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

Se esse provedor exigir autenticação por parâmetros de consulta:

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

O host e a chave acima são valores de exemplo. Use um serviço que ofereça suporte à rede selecionada e permita suas solicitações; apenas a URL do site de um explorador não é suficiente.

Para a **Base**, o Blockscout documenta este formato de API PRO:

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

A API da Base do Blockscout exige uma chave autorizada e um plano pago. Obtenha a chave no [portal de desenvolvedores do Blockscout](https://dev.blockscout.com), confirme o acesso à rede no seu plano e substitua `YOUR_API_KEY`. O seletor é **`chain_id`**, com sublinhado. Este exemplo segue a [documentação oficial da API da Base](https://docs.blockscout.com/base-api); não é uma alternativa pública sem chave.

Para a **Arbitrum One**, o seletor de rede equivalente é `42161`:

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

Confirme com o Blockscout o acesso à Arbitrum e o suporte aos endpoints antes de usar essa configuração. A URL segue o formato multirrede documentado; a disponibilidade depende da sua conta e do seu plano. A Pali não inclui uma chave compartilhada do Blockscout.

### Etherscan e Alchemy

Uma URL de API do Etherscan V2 pode atender a solicitações de histórico de transações compatíveis quando sua chave e seu plano permitirem:

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

Use o ID da rede selecionada e confira os [requisitos de endpoints e planos do Etherscan](https://docs.etherscan.io/api-reference/endpoint/txlist). **Um histórico compatível com Etherscan não implica descoberta automática de tokens.** A Pali não implementa o [endpoint PRO separado de ativos em tokens](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance) do Etherscan; uma chave do Etherscan por si só não habilita **Seus Tokens**.

As APIs de tokens da Alchemy usam solicitações e respostas diferentes, incluindo [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances). A Pali não tem um adaptador de descoberta de tokens para a Alchemy. Um endpoint RPC da Alchemy pode ser usado no campo **URL do RPC** se for adequado à sua rede, mas não substitui o campo **URL da API do Explorador de Blocos**.

## Chaves de API e privacidade

Uma chave de API de explorador autoriza o acesso a esse provedor e pode consumir sua cota de uso. Ela é diferente da chave privada ou da frase de recuperação da sua carteira. Nunca insira uma chave privada de carteira ou uma frase de recuperação em uma URL de API.

A Pali salva a URL de API configurada nas configurações de rede da extensão. Uma chave incluída nessa URL fica visível para qualquer pessoa que possa inspecionar essas configurações ou as solicitações da extensão. Remova as chaves antes de compartilhar capturas de tela, logs ou exemplos de configuração. Os serviços de exploradores também recebem os endereços públicos das contas que você pede para consultar. Consulte [Privacidade e segurança](./privacy-and-safety).

## Resultados vazios, APIs indisponíveis e novas tentativas

- **Nenhum token adicional para importar:** a API não retornou ativos adicionais compatíveis após a exclusão dos ativos já importados. Isso não prova que a conta não tenha ativos; a indexação e a cobertura de ativos podem estar incompletas.
- **A descoberta não está configurada:** a rede não tem uma URL de API de explorador. Adicione ativos pelo endereço do contrato ou configure um serviço compatível por meio de **Gerenciar redes**.
- **API indisponível / acesso proibido:** confira o endpoint do provedor, a rede selecionada, a chave de API e o plano. Uma resposta `403` indica que o provedor recusou o acesso.
- **Muitas solicitações:** uma resposta `429` significa que o provedor está limitando as solicitações. A cota dele pode já estar esgotada quando você abrir a lista pela primeira vez. Aguarde antes de usar **Tentar novamente** e confira os limites de uso do provedor se as falhas continuarem.

Uma falha na descoberta não comprova que o saldo de um token seja zero. Você pode continuar usando **Adicionar Personalizado** e as consultas de saldo por RPC enquanto um indexador estiver indisponível.
