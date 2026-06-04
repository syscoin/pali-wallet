---
title: Sponsor-Services
---

Ein Sponsor-Service ist ein institutionskontrollierter Endpoint, der an der Ausführungs-Policy von Passkey Smart Accounts teilnimmt.

## Sponsor-Objekt

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Ausstehende und erfolgreiche Pali-Sponsor-Relay-Zustände" />
</a>
  <figcaption>Gesponserte Ausführung sollte ausstehende, erfolgreiche und fehlgeschlagene Zustände für Benutzer klar machen.</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Feldbedeutung

| Feld | Zweck |
| --- | --- |
| `mode` | `disabled`, `gasOnly` oder `required`. |
| `url` | Optionaler Service-Endpoint, den Pali für Unterstützung bei Sponsor-Ausführung kontaktiert. Pali benötigt ihn für `gasOnly`-Sponsoring, weil es ohne Service-URL keinen entfernten Gas-Sponsor gibt. |
| `signer` | Erwartete Sponsor-Signer-Adresse für erforderliche Policy-Proofs. Erforderlich für den Modus `required`. |
| `policyText` | Benutzerseitige Erklärung, die in Wallet-Metadaten gespeichert wird. Kein on-chain Enforcement. |

## On-chain-Policy

Die Smart-Account-Policy speichert Modus, Signer und eine öffentliche Sponsor-URL. Der Policy-Text ist Wallet-Metadaten, die für die Anzeige verwendet werden.

## Idempotenz

Sponsor-Ausführungs-Requests verwenden einen Idempotency Key, der aus dem Passkey-Action-Hash abgeleitet ist. Ein Sponsor-Service sollte wiederholte Requests mit demselben Key als dieselbe Aktion behandeln.

## Erforderlicher Sponsor-Modus

Im Modus `required` muss der Sponsor-Proof zum konfigurierten Signer recovern. Die Sponsor-URL ist optional: Pali kann den Proof vom Sponsor-Service erhalten, wenn eine URL konfiguriert ist, oder lokal signieren, wenn der konfigurierte Signer ein verfügbares Konto in der Wallet ist. Wenn Pali den Sponsor-Proof nicht erhalten oder validieren kann, schlägt die Ausführung fehl.

Die Gas-Zahlung ist von der Sponsor-Autorisierung getrennt. Nachdem ein gültiger Sponsor-Proof verfügbar ist, kann Pali weiterhin Gas von jedem finanzierten Softwarekonto zahlen, das für die Passkey-Ausführung ausgewählt ist.

## Gas-only-Modus

Im Modus `gasOnly` kann der Sponsor-Service relayen oder helfen, Gas zu zahlen. Pali benötigt für diesen Modus eine Sponsor-URL, weil die URL den Gas-Sponsoring-Service identifiziert. Wenn Sponsoring nicht verfügbar ist, kann Pali auf Wallet-Gas-Ausführung zurückfallen, sofern die Policy dies erlaubt.

## Empfehlungen für Institutionen

- Verwenden Sie stabile Sponsor-URLs pro Benutzer.
- Halten Sie Signer-Schlüssel in institutioneller Infrastruktur, nicht im dapp-Frontend.
- Halten Sie Policy-Text kurz, spezifisch und verständlich.
- Geben Sie konsistenten Status für wiederholte Idempotency Keys zurück.
- Überwachen Sie fehlgeschlagene Sponsor-Requests und abgelaufene Ausführungs-Deadlines.
