---
title: 토큰 검색 및 탐색기 API
---

Pali는 탐색기 API로 가져올 수 있는 토큰과 NFT를 찾을 수 있습니다. 컨트랙트 주소로 자산을 추가할 수도 있습니다. 가져온 토큰의 잔액은 네트워크 RPC를 통해 읽으므로 자동 검색은 선택 사항입니다.

## 기본 지원 범위

| 네트워크          | 자동 검색                                                                                                    | 자산이 보이지 않는 경우                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Ethereum 메인넷   | 계정이나 API 키 없이 Routescan을 사용합니다. ERC-20 토큰과 지원되는 ERC-721/ERC-1155 보유 자산을 검색합니다. | **토큰 가져오기 → 사용자 정의 추가**를 사용하세요.                                |
| Base              | 기본 검색 API가 없습니다. 네트워크와 RPC는 계속 사용할 수 있습니다.                                          | 컨트랙트 주소로 자산을 추가하거나, 접근 권한이 있는 호환 탐색기 API를 설정하세요. |
| Arbitrum One      | 기본 검색 API가 없습니다. 네트워크와 RPC는 계속 사용할 수 있습니다.                                          | 컨트랙트 주소로 자산을 추가하거나, 접근 권한이 있는 호환 탐색기 API를 설정하세요. |
| 기타 EVM 네트워크 | 해당 네트워크에 설정된 탐색기 API에 따라 다릅니다.                                                           | 검색을 사용할 수 없으면 컨트랙트 주소로 자산을 추가하세요.                        |

탐색기 API가 설정되어 있지 않으면 Pali는 탭 없이 컨트랙트 주소 입력 양식을 바로 표시하며, 짧은 안내와 **토큰 가져오기 도움말** 링크를 제공합니다. API URL을 지워도 네트워크나 가져온 자산은 삭제되지 않습니다. 탐색기 API가 없으면 거래 내역은 로컬에 저장된 거래와 RPC 조회에 의존하므로 이전 내역을 모두 복구하지 못할 수 있습니다.

## 토큰이나 NFT를 직접 추가하기

1. 올바른 네트워크와 계정을 선택합니다.
2. **토큰 가져오기**를 엽니다. 탭이 표시되면 **사용자 정의 추가**를 선택합니다.
3. 해당 네트워크에서 자산의 컨트랙트 주소를 입력합니다.
4. 감지된 자산 정보를 확인합니다. ERC-1155 자산이면 토큰 ID도 입력합니다.
5. 자산을 가져옵니다.

프로젝트에서 공개했거나 신뢰할 수 있는 탐색기에 표시된 컨트랙트 주소를 사용하세요. 서로 무관한 컨트랙트가 같은 토큰 이름을 쓸 수 있으며, 한 네트워크의 주소가 다른 네트워크에서는 다른 자산을 가리킬 수 있습니다.

## 탐색기 API 설정하기

RPC URL, 탐색기 웹사이트, 탐색기 API URL은 용도가 다릅니다. RPC는 Pali를 네트워크에 연결하고, 탐색기 웹사이트는 브라우저에서 주소와 거래를 보여 줍니다. 탐색기 API는 인덱싱된 보유 자산과 거래 내역을 제공합니다.

1. Pali의 네트워크 선택 메뉴를 열고 **네트워크 관리**를 선택합니다.
2. 수정할 EVM 네트워크 옆의 연필 아이콘을 선택합니다.
3. **블록 탐색기 API URL (선택사항)** 항목을 찾아 아래 예시에서 적절한 API URL을 붙여 넣습니다. RPC URL과 체인 ID도 바꾸려는 경우가 아니라면 기존 값을 유지하세요.
4. **저장**을 선택합니다. Pali는 저장하기 전에 RPC와 기본적인 탐색기 API 접근을 확인합니다. 접근 확인에 성공해도 모든 검색 및 내역 엔드포인트가 지원된다는 뜻은 아닙니다.
5. 다른 네트워크로 전환한 뒤 수정한 네트워크로 다시 돌아옵니다. 이렇게 해야 현재 네트워크의 API 설정이 갱신됩니다. **토큰 가져오기 → 내 토큰**을 다시 열어 새 API로 보유 자산을 불러옵니다.

새 네트워크를 추가하려면 네트워크 선택 메뉴에서 **사용자 정의 RPC**를 선택하세요. 이 양식에도 같은 선택적 탐색기 API 항목이 있습니다. 네트워크의 인덱스 기반 검색을 끄려면 해당 항목을 비우고 저장하세요.

## 지원 형식과 URL 예시

### Ethereum: Routescan

기본 Ethereum API URL은 다음과 같습니다.

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

키를 추가하지 않으면 공개 API로 접근합니다. Pali는 검색에 Routescan의 보유 자산 API를 사용하고, 거래 내역에는 Etherscan 호환 API를 사용합니다. 제공업체의 인덱스가 불완전하거나 갱신이 지연될 수 있습니다. 이 URL에서 체인 번호를 바꾸는 것만으로 Routescan이 다른 네트워크를 지원한다고 볼 수는 없습니다. 지원 범위와 엔드포인트는 [Routescan API 참조](https://routescan.io/docs/api)를 확인하세요.

Routescan의 현재 문서에 따르면 키 없는 접근 제한은 **초당 요청 2회, 하루 호출 10,000회**입니다. Pali는 요청 간격을 조절하고 결과를 캐시하지만 제공업체의 제한은 계속 적용됩니다. [Routescan의 현재 제한](https://routescan.io/docs/plans-and-limits/rate-limits)과 [요금제](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing)를 확인하세요.

개인 Routescan API 키를 사용하려면 아래 `YOUR_API_KEY`를 바꾸세요.

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

Pali는 이 값을 제공업체의 [`apikey` 요청 헤더](https://routescan.io/docs/api/conventions)로 보냅니다. 사용 중인 요금제의 제한이 적용됩니다.

### Blockscout 호환 검색

Pali는 Blockscout의 **account/tokenlist** 요청 형식을 구현한 탐색기 API도 지원합니다. API 기본 URL과 필요한 체인 선택 매개변수 또는 API 키를 설정하세요. Pali가 계정 주소와 검색 요청 매개변수를 추가합니다. [Blockscout 토큰 목록 문서](https://docs.blockscout.com/devs/apis/rpc/account)를 참고하세요.

예를 들어 직접 운영하거나 제공업체가 지원하는 Blockscout API에는 다음 형식을 사용할 수 있습니다.

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

제공업체가 쿼리 매개변수로 인증하도록 요구하면 다음 형식을 사용합니다.

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

위 호스트와 키는 실제 값으로 바꿔야 하는 자리표시자입니다. 선택한 네트워크를 지원하고 요청을 허용하는 서비스를 사용하세요. 탐색기 웹사이트 URL만으로는 충분하지 않습니다.

**Base**의 경우 Blockscout은 다음 PRO API 형식을 안내합니다.

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

Blockscout의 Base API에는 접근 권한이 있는 키와 유료 요금제가 필요합니다. [Blockscout 개발자 포털](https://dev.blockscout.com)에서 키를 발급받고, 요금제가 해당 네트워크 접근을 허용하는지 확인한 다음 `YOUR_API_KEY`를 바꾸세요. 체인 선택 매개변수는 밑줄이 포함된 **`chain_id`**입니다. 이 예시는 [공식 Base API 문서](https://docs.blockscout.com/base-api)를 따른 것이며, 키 없이 쓸 수 있는 공개 API 대체 수단이 아닙니다.

**Arbitrum One**의 해당 체인 선택 값은 `42161`입니다.

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

이 설정을 사용하기 전에 Blockscout에 Arbitrum 접근 권한과 엔드포인트 지원 여부를 확인하세요. URL은 문서의 멀티체인 형식을 따르지만 이용 가능 여부는 계정과 요금제에 따라 달라집니다. Pali에는 공유 Blockscout 키가 포함되어 있지 않습니다.

### Etherscan과 Alchemy

키와 요금제에서 허용한다면 Etherscan V2 API URL로 지원되는 거래 내역 요청을 수행할 수 있습니다.

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

선택한 네트워크의 체인 ID를 사용하고 [Etherscan 엔드포인트 및 요금제 요구사항](https://docs.etherscan.io/api-reference/endpoint/txlist)을 확인하세요. **Etherscan 호환 내역을 지원한다고 자동 토큰 검색까지 지원하는 것은 아닙니다.** Pali는 Etherscan의 별도 [PRO 토큰 보유 내역 엔드포인트](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance)를 구현하지 않았으므로, Etherscan 키만으로는 **내 토큰**을 사용할 수 없습니다.

Alchemy의 토큰 API는 [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances)처럼 다른 요청과 응답을 사용합니다. Pali에는 Alchemy 토큰 검색 어댑터가 없습니다. Alchemy RPC 엔드포인트가 네트워크에 적합하다면 **RPC URL** 항목에서 사용할 수 있지만, **블록 탐색기 API URL** 항목을 대신할 수는 없습니다.

## API 키와 개인정보

탐색기 API 키는 제공업체 접근을 허용하며 사용량 한도를 소모할 수 있습니다. 지갑의 개인 키나 복구 문구와는 별개입니다. API URL에 지갑의 개인 키나 복구 문구를 입력하지 마세요.

Pali는 설정된 API URL을 확장 프로그램의 네트워크 설정에 저장합니다. 이 설정이나 확장 프로그램의 요청을 확인할 수 있는 사람은 누구나 URL에 포함된 키를 볼 수 있습니다. 스크린샷, 로그 또는 설정 예시를 공유하기 전에 키를 지우세요. 탐색기 서비스는 조회를 요청한 공개 계정 주소도 받습니다. [개인정보와 안전](./privacy-and-safety)을 참고하세요.

## 빈 결과, API 이용 불가 및 재시도

- **추가로 가져올 토큰 없음:** 이미 가져온 자산을 제외한 후 API가 지원되는 추가 보유 자산을 반환하지 않은 상태입니다. 계정에 자산이 없다는 증거는 아닙니다. 인덱스와 자산 지원 범위가 불완전할 수 있습니다.
- **검색이 설정되지 않음:** 네트워크에 탐색기 API URL이 없습니다. 컨트랙트 주소로 자산을 추가하거나 **네트워크 관리**에서 호환 서비스를 설정하세요.
- **API 이용 불가 / 접근 금지:** 제공업체의 엔드포인트, 선택한 체인, API 키 및 요금제를 확인하세요. `403` 응답은 제공업체가 접근을 거부했다는 뜻입니다.
- **요청이 너무 많음:** `429` 응답은 제공업체가 요청을 제한하고 있다는 뜻입니다. 목록을 처음 열 때도 할당량이 이미 소진되었을 수 있습니다. 기다린 후 **다시 시도**를 사용하고, 계속 실패하면 제공업체의 사용량 제한을 확인하세요.

검색에 실패했다고 토큰 잔액이 0이라는 뜻은 아닙니다. 인덱스 서비스를 사용할 수 없는 동안에도 **사용자 정의 추가**와 RPC를 통한 잔액 조회를 계속 사용할 수 있습니다.
