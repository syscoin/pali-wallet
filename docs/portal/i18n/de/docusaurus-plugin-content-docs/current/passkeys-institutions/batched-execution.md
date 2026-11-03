---
title: Batch-Ausführung
---

Pali Smart Accounts unterstützen Batch-Ausführung über `wallet_sendCalls`. Der Nutzer genehmigt oder lehnt bei jeder `wallet_sendCalls`-Anfrage den gesamten Batch ab; einzelne Calls lassen sich nicht abwählen. Ein unterstützter Pali Smart Account bereitet den vollständigen Batch als eine Account-Ausführung vor. EOA-Calls laufen sequenziell; bereits gesendete Calls lassen sich bei einem späteren Fehler nicht zurückrollen. Contract-Deployment-Calls mit leerem Target werden in diesem Smart-Account-Flow nicht unterstützt.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Pali prüft den vollständigen Smart-Account-Batch und decodiert gängige Token-Calls vor einer einzigen Smart-Account-Autorisierung.</figcaption>
</figure>

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>Eine Freigabe führt den gesamten Batch atomar aus.</figcaption>
</figure>
