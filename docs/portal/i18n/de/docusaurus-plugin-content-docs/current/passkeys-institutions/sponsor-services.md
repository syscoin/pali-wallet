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
| `url` | Service-Endpoint, den Pali für Unterstützung bei Sponsor-Ausführung kontaktiert. |
| `signer` | Erwartete Sponsor-Signer-Adresse für erforderliche Policy-Proofs. |
| `policyText` | Benutzerseitige Erklärung, die in Wallet-Metadaten gespeichert wird. Kein on-chain Enforcement. |

## On-chain-Policy

Die Smart-Account-Policy speichert Modus, Signer und eine öffentliche Sponsor-URL. Der Policy-Text ist Wallet-Metadaten, die für die Anzeige verwendet werden.

## Idempotenz

Sponsor-Ausführungs-Requests verwenden einen Idempotency Key, der aus dem Passkey-Action-Hash abgeleitet ist. Ein Sponsor-Service sollte wiederholte Requests mit demselben Key als dieselbe Aktion behandeln.

## Erforderlicher Sponsor-Modus

Im Modus `required` muss der Sponsor-Proof zum konfigurierten Signer recovern. Wenn Pali den Sponsor-Proof nicht erhalten oder validieren kann, schlägt die Ausführung fehl.

## Gas-only-Modus

Im Modus `gasOnly` kann der Sponsor-Service relayen oder helfen, Gas zu zahlen. Wenn Sponsoring nicht verfügbar ist, kann Pali auf Wallet-Gas-Ausführung zurückfallen, sofern die Policy dies erlaubt.

## Empfehlungen für Institutionen

- Verwenden Sie stabile Sponsor-URLs pro Benutzer.
- Halten Sie Signer-Schlüssel in institutioneller Infrastruktur, nicht im dapp-Frontend.
- Halten Sie Policy-Text kurz, spezifisch und verständlich.
- Geben Sie konsistenten Status für wiederholte Idempotency Keys zurück.
- Überwachen Sie fehlgeschlagene Sponsor-Requests und abgelaufene Ausführungs-Deadlines.
