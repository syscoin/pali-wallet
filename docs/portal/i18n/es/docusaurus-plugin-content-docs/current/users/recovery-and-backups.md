---
title: Recuperación y respaldos
---

Los respaldos importan porque Pali es no custodial. La billetera no puede recuperar por ti una frase semilla, contraseña, clave privada ni secreto de autenticador passkey.

## Respaldo de frase semilla

Anota la frase semilla de tu billetera y mantenla offline. Cualquiera con la frase semilla puede controlar las cuentas derivadas.

## Estado de respaldo de passkey

Las passkeys pueden estar vinculadas al dispositivo o sincronizadas por el proveedor de cuenta de la plataforma. Pali muestra estado relacionado con respaldos donde esté disponible, pero el comportamiento exacto depende del autenticador, navegador y sistema operativo.

Puedes ver un estado que sugiere si una passkey está vinculada al dispositivo, es elegible para respaldo o está respaldada/sincronizada. Una passkey sincronizada suele ser más conveniente porque puede acompañarte mediante una cuenta de plataforma como Apple, Google o Microsoft. Una passkey vinculada al dispositivo o una llave de seguridad hardware puede ser más estricta, pero perder ese dispositivo puede dificultar la recuperación.

| Estado que puedes ver | Qué significa | Conveniencia | Compensación de seguridad | Buen ajuste |
| --- | --- | --- | --- | --- |
| Respaldada o sincronizada | La passkey parece estar almacenada por un proveedor de passkey de plataforma y puede sincronizarse con otros dispositivos de confianza. | Máxima. A menudo puedes recuperar tras reemplazar un teléfono o laptop iniciando sesión nuevamente en la cuenta de plataforma. | El secreto passkey sigue protegido por el sistema passkey de la plataforma, pero el límite de seguridad incluye la cuenta de plataforma, el proceso de recuperación de cuenta y los dispositivos sincronizados. | Billeteras cotidianas, cuentas de dapps, onboarding institucional y saldos menores. |
| Elegible para respaldo | El autenticador indica que la passkey puede respaldarse o sincronizarse, pero quizá no esté sincronizada actualmente. | Media a alta, según si la sincronización está habilitada. | Configuraciones futuras de la plataforma pueden mover la credencial a sincronización en la nube. Revisa los ajustes del proveedor y del dispositivo si esto te importa. | Usuarios que quieren flexibilidad de recuperación pero aún quieren inspeccionar si la sincronización está activa. |
| Vinculada al dispositivo o no respaldada | La passkey parece ligada a un autenticador o dispositivo. | Menor. Si el dispositivo se pierde y no existe otra ruta de recuperación, la recuperación puede ser más difícil o imposible. | Aislamiento más fuerte porque el control se concentra en ese autenticador en vez de una cuenta sincronizada en la nube. | Saldos mayores, cuentas de mayor seguridad, llaves de seguridad hardware y uso tipo cold wallet. |
| Desconocido o no disponible | El navegador, OS o autenticador no expuso suficiente información de respaldo. | Desconocida. | No asumas recuperación en la nube ni aislamiento vinculado al dispositivo. Trátalo como ambiguo hasta verificar la configuración del autenticador. | Uso temporal, pruebas o casos donde puedes verificar independientemente el proveedor de passkey. |

Las passkeys sincronizadas en la nube siguen siendo seguras para uso normal: la clave privada no se entrega a Pali ni a la dapp, WebAuthn permanece limitado por origen y la verificación de usuario sigue siendo realizada por el autenticador de plataforma. La compensación es que la cuenta de plataforma pasa a formar parte del modelo de seguridad de tu billetera. Para almacenamiento en frío, fondos de tesorería o saldos grandes a largo plazo, prefiere un autenticador vinculado al dispositivo o una llave de seguridad hardware, y mantén solo fondos operativos menores en cuentas passkey sincronizadas.

El estado de respaldo es una señal para ayudarte a elegir entre conveniencia y seguridad. No reemplaza tu respaldo de frase semilla y no significa que Pali o una institución puedan recuperar por ti un secreto passkey.

## Recuperar cuentas passkey

La recuperación passkey de Pali usa metadatos de recuperación limitados a la billetera y descubrimiento de cuentas on-chain. El flujo de recuperación:

1. Solicita una assertion WebAuthn descubrible.
2. Busca cuentas inteligentes coincidentes desde el registro de fábrica y logs de creación.
3. Omite cuentas que ya están en la billetera.
4. Agrega cuentas recuperables cuando se pueden resolver metadatos de sponsor.
5. Advierte si se necesitan metadatos de URL de sponsor para una política de sponsor requerida.

## Idempotencia de crear/recuperar desde dapp

Cuando una dapp llama `wallet_createPasskeyAccount`, Pali primero comprueba si una cuenta passkey on-chain existente coincide con la política de sponsor solicitada. Si la cuenta coincidente ya existe localmente, Pali la reutiliza en vez de crear un duplicado. Si existe on-chain pero no localmente, Pali puede recuperarla en la billetera.
