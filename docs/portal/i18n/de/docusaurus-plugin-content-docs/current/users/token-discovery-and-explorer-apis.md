---
title: Token-Erkennung und Explorer-APIs
---

Pali kann über eine Explorer-API Token und NFTs finden, die Sie importieren können. Sie können ein Asset auch über seine Vertragsadresse hinzufügen. Die Guthaben importierter Token werden über den RPC des Netzwerks abgerufen; die automatische Erkennung ist daher optional.

## Was standardmäßig funktioniert

| Netzwerk             | Automatische Erkennung                                                                                          | Wenn ein Asset fehlt                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum Mainnet     | Routescan, ohne Konto oder API-Schlüssel. Unterstützt ERC-20-Token und unterstützte ERC-721-/ERC-1155-Bestände. | Verwenden Sie **Token importieren → Benutzerdefiniert hinzufügen**.                                                               |
| Base                 | Keine standardmäßige API zur Erkennung. Das Netzwerk und sein RPC bleiben verfügbar.                            | Fügen Sie Assets über ihre Vertragsadresse hinzu oder richten Sie eine kompatible Explorer-API ein, auf die Sie zugreifen dürfen. |
| Arbitrum One         | Keine standardmäßige API zur Erkennung. Das Netzwerk und sein RPC bleiben verfügbar.                            | Fügen Sie Assets über ihre Vertragsadresse hinzu oder richten Sie eine kompatible Explorer-API ein, auf die Sie zugreifen dürfen. |
| Andere EVM-Netzwerke | Abhängig von der für das Netzwerk eingerichteten Explorer-API.                                                  | Verwenden Sie **Benutzerdefiniert hinzufügen**, wenn die Erkennung nicht verfügbar ist.                                           |

Wenn keine Explorer-API eingerichtet ist, öffnet Pali **Benutzerdefiniert hinzufügen**, blendet **Ihre Token** aus und erklärt, wie Sie Assets hinzufügen oder eine API einrichten können. Das Löschen einer API-URL entfernt weder das Netzwerk noch seine importierten Assets. Ohne Explorer-API beruht die Transaktionshistorie auf lokal gespeicherten Transaktionen und RPC-Abfragen; eine vollständige ältere Historie lässt sich damit möglicherweise nicht wiederherstellen.

## Einen Token oder NFT manuell hinzufügen

1. Wählen Sie das richtige Netzwerk und Konto aus.
2. Öffnen Sie **Token importieren → Benutzerdefiniert hinzufügen**.
3. Geben Sie die Vertragsadresse des Assets in diesem Netzwerk ein.
4. Prüfen Sie die erkannten Asset-Details. Geben Sie bei einem ERC-1155-Asset zusätzlich seine Token-ID ein.
5. Importieren Sie das Asset.

Verwenden Sie die vom Projekt veröffentlichte oder in einem vertrauenswürdigen Explorer angezeigte Vertragsadresse. Nicht zusammengehörige Verträge können denselben Token-Namen verwenden, und eine Adresse kann in verschiedenen Netzwerken unterschiedliche Assets bezeichnen.

## Eine Explorer-API einrichten

Eine RPC-URL, eine Explorer-Webseite und eine Explorer-API-URL erfüllen unterschiedliche Aufgaben. Der RPC verbindet Pali mit dem Netzwerk; die Explorer-Webseite öffnet Adressen und Transaktionen im Browser; die Explorer-API liefert indexierte Bestände und Transaktionshistorien.

1. Öffnen Sie die Netzwerkauswahl in Pali und wählen Sie **Netzwerke verwalten**.
2. Wählen Sie das Stiftsymbol neben dem EVM-Netzwerk, das Sie bearbeiten möchten.
3. Suchen Sie **Block-Explorer-API-URL (optional)**. Fügen Sie die passende API-URL aus den folgenden Beispielen ein. Behalten Sie Ihre vorhandene RPC-URL und Chain-ID bei, sofern Sie diese Einstellungen nicht ebenfalls ändern möchten.
4. Wählen Sie **Speichern**. Pali prüft vor dem Speichern den RPC und den grundlegenden Zugriff auf die Explorer-API. Eine erfolgreiche Zugriffsprüfung garantiert nicht, dass jeder Endpunkt für die Erkennung oder Historie unterstützt wird.
5. Wechseln Sie zu einem anderen Netzwerk und anschließend zurück zu dem Netzwerk, das Sie bearbeitet haben. Dadurch wird dessen aktive API-Einstellung aktualisiert. Öffnen Sie erneut **Token importieren → Ihre Token**, um Bestände über die neue API zu laden.

Um stattdessen ein neues Netzwerk hinzuzufügen, wählen Sie **Benutzerdefiniertes RPC** in der Netzwerkauswahl. Das Formular enthält dasselbe optionale Feld für die Explorer-API. Um die indexierte Erkennung für ein Netzwerk auszuschalten, leeren Sie dieses Feld und speichern Sie.

## Unterstützte Formate und URL-Beispiele

### Ethereum: Routescan

Die integrierte Ethereum-API-URL lautet:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

Lassen Sie die URL für den öffentlichen Zugriff ohne Schlüssel. Pali verwendet die Bestands-APIs von Routescan für die Erkennung und dessen Etherscan-kompatible API für die Transaktionshistorie. Die Indexierung des Anbieters kann unvollständig oder verzögert sein. Eine Änderung der Chain-Nummer in dieser URL belegt nicht, dass Routescan ein anderes Netzwerk unterstützt. Angaben zur Abdeckung und zu den Endpunkten finden Sie in der [API-Referenz von Routescan](https://routescan.io/docs/api).

Routescan dokumentiert derzeit für den Zugriff ohne Schlüssel ein Limit von **2 Anfragen pro Sekunde und 10.000 Aufrufen pro Tag**. Pali verteilt Anfragen zeitlich und speichert Ergebnisse zwischen; die Limits des Anbieters gelten trotzdem. Siehe die [aktuellen Limits von Routescan](https://routescan.io/docs/plans-and-limits/rate-limits) und die [Tarife](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing).

Um einen persönlichen Routescan-API-Schlüssel zu verwenden, ersetzen Sie `YOUR_API_KEY` in:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

Pali sendet diesen Wert im [`apikey`-Anfrageheader](https://routescan.io/docs/api/conventions) des Anbieters. Es gelten die Limits Ihres Anbietertarifs.

### Blockscout-kompatible Erkennung

Pali unterstützt außerdem Explorer-APIs, die das Anfrageformat **account/tokenlist** von Blockscout implementieren. Richten Sie die Basis-URL der API sowie gegebenenfalls den erforderlichen Chain-Selektor oder API-Schlüssel ein; Pali ergänzt die Kontoadresse und die Anfrageparameter für die Erkennung. Siehe die [Blockscout-Dokumentation zur Token-Liste](https://docs.blockscout.com/devs/apis/rpc/account).

Eine selbst betriebene oder von einem Anbieter unterstützte Blockscout-API kann beispielsweise diese URL verwenden:

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

Falls der Anbieter die Authentifizierung über Abfrageparameter verlangt:

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

Host und Schlüssel oben sind Platzhalter. Verwenden Sie einen Dienst, der das ausgewählte Netzwerk unterstützt und Ihre Anfragen zulässt; die URL einer Explorer-Webseite allein reicht nicht aus.

Für **Base** dokumentiert Blockscout dieses PRO-API-Format:

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

Die Base-API von Blockscout erfordert einen autorisierten Schlüssel und einen kostenpflichtigen Tarif. Beziehen Sie den Schlüssel über das [Entwicklerportal von Blockscout](https://dev.blockscout.com), bestätigen Sie den Netzwerkzugriff Ihres Tarifs und ersetzen Sie `YOUR_API_KEY`. Der Selektor lautet **`chain_id`**, mit Unterstrich. Dieses Beispiel folgt der [offiziellen Base-API-Dokumentation](https://docs.blockscout.com/base-api); es ist kein öffentlicher Ersatz ohne Schlüssel.

Für **Arbitrum One** lautet der entsprechende Chain-Selektor `42161`:

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

Bestätigen Sie vor der Verwendung dieser Konfiguration bei Blockscout den Zugriff auf Arbitrum und die Unterstützung der Endpunkte. Die URL entspricht dem dokumentierten Multichain-Format; die Verfügbarkeit hängt von Ihrem Konto und Tarif ab. Pali enthält keinen gemeinsam genutzten Blockscout-Schlüssel.

### Etherscan und Alchemy

Eine Etherscan-V2-API-URL kann unterstützte Anfragen zur Transaktionshistorie bereitstellen, wenn Ihr Schlüssel und Tarif diese zulassen:

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

Verwenden Sie die Chain-ID des ausgewählten Netzwerks und prüfen Sie die [Endpunkt- und Tarifanforderungen von Etherscan](https://docs.etherscan.io/api-reference/endpoint/txlist). **Eine Etherscan-kompatible Historie bedeutet nicht, dass die automatische Token-Erkennung unterstützt wird.** Pali implementiert den separaten [PRO-Endpunkt für Token-Bestände](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance) von Etherscan nicht; ein Etherscan-Schlüssel allein aktiviert **Ihre Token** nicht.

Die Token-APIs von Alchemy verwenden andere Anfragen und Antworten, darunter [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances). Pali hat keinen Adapter für die Token-Erkennung über Alchemy. Ein Alchemy-RPC-Endpunkt kann im Feld **RPC-URL** verwendet werden, wenn er zum Netzwerk passt; er ist jedoch kein Ersatz für das Feld **Block-Explorer-API-URL**.

## API-Schlüssel und Datenschutz

Ein Explorer-API-Schlüssel erlaubt den Zugriff auf den jeweiligen Anbieter und kann Ihr Nutzungskontingent verbrauchen. Er ist vom privaten Schlüssel oder der Wiederherstellungsphrase Ihrer Wallet getrennt. Geben Sie niemals einen privaten Wallet-Schlüssel oder eine Wiederherstellungsphrase in einer API-URL ein.

Pali speichert eine eingerichtete API-URL in den Netzwerkeinstellungen der Erweiterung. Ein in dieser URL enthaltener Schlüssel ist für jeden sichtbar, der diese Einstellungen oder die Anfragen der Erweiterung untersuchen kann. Entfernen Sie Schlüssel, bevor Sie Screenshots, Protokolle oder Konfigurationsbeispiele teilen. Explorer-Dienste erhalten außerdem die öffentlichen Kontoadressen, die Sie abfragen lassen. Siehe [Datenschutz und Sicherheit](./privacy-and-safety).

## Leere Ergebnisse, nicht verfügbare APIs und erneute Versuche

- **Keine weiteren Token zum Importieren:** Die API hat nach Ausschluss bereits importierter Assets keine weiteren unterstützten Bestände zurückgegeben. Das beweist nicht, dass das Konto keine Assets besitzt; die Indexierung und die Abdeckung der Asset-Typen können unvollständig sein.
- **Erkennung ist nicht eingerichtet:** Für das Netzwerk ist keine Explorer-API-URL hinterlegt. Verwenden Sie **Benutzerdefiniert hinzufügen** oder richten Sie über **Netzwerke verwalten** einen kompatiblen Dienst ein.
- **API nicht verfügbar / Zugriff verweigert:** Prüfen Sie den Endpunkt des Anbieters, die ausgewählte Chain, den API-Schlüssel und den Tarif. Eine Antwort mit `403` bedeutet, dass der Anbieter den Zugriff verweigert hat.
- **Zu viele Anfragen:** Eine Antwort mit `429` bedeutet, dass der Anbieter Anfragen begrenzt. Sein Kontingent kann bereits beim ersten Öffnen der Liste erschöpft sein. Warten Sie, bevor Sie **Erneut versuchen** wählen, und prüfen Sie bei anhaltenden Fehlern die Nutzungslimits des Anbieters.

Eine fehlgeschlagene Erkennung bedeutet nicht, dass ein Token-Guthaben null ist. Sie können weiterhin **Benutzerdefiniert hinzufügen** und Guthabenabfragen über RPC verwenden, während ein Indexer nicht verfügbar ist.
