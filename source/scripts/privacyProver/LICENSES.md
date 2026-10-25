# Classic prover source notices

Vendored snarkjs and websnark code and generated witness functions are GPL-3.0-or-later, copyright 2018/2019 0KIMS association. Full license: COPYING. Original headers are retained.

Sources: tornadocash/snarkjs@869181cfaf7526fe8972073d31655493a04326d5, tornadocash/websnark@4c0af6a8b65aabea3c09f377f63c44e7a58afa6d, tornadocash/tornado-cli@378ddf8b8b92a4924037d7b64a94dbfd5a7dd6e8.

Local adaptations: compile witness function strings into packaged JavaScript; omit unused debug metadata; compile standalone template signal writes as generator suspension points and execute components with an explicit depth-first frame stack preserving trigger order and scopes; use static MessagePort workers and Web Crypto; replace thread termination with host-owned termination. Public circuit/key assets retain their upstream project licensing. No trusted setup is generated or replaced.
