---
title: Recuperación y respaldos
---

Los respaldos importan porque Pali es no custodial. La billetera no puede recuperar por ti una frase semilla, contraseña, clave privada ni secreto de autenticador passkey.

## Respaldo de frase semilla

Anota la frase semilla de tu billetera y mantenla offline. Cualquiera con la frase semilla puede controlar las cuentas derivadas.

## Desbloqueo y cambios de passkey

Un servicio del navegador no disponible, un problema de almacenamiento o una función criptográfica no compatible pueden impedir el desbloqueo sin que la contraseña sea incorrecta. Lee el error, restablece el servicio o la conexión necesarios y vuelve a intentar desbloquear. No elimines ni reimportes la billetera para solucionar un error operativo. Los errores operativos no cuentan como intentos fallidos de contraseña.

Al reemplazar una passkey, tanto la credencial anterior como la nueva pueden seguir disponibles. La anterior aún puede controlar otra cadena o una política compartida. No elimines ninguna de las dos solo porque la configuración se canceló o falló; primero confirma qué credenciales siguen necesitando las cuentas correspondientes. Conserva los datos actuales de la billetera mientras investigas un cambio interrumpido.

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

## Recuperar cuentas inteligentes

La recuperación de cuentas inteligentes de Pali depende de los módulos instalados. Una cuenta controlada por passkey necesita la credencial WebAuthn correspondiente para aprobar acciones futuras. Un módulo de recuperación mediante guardianes puede reemplazar el validador activo tras el bloqueo temporal configurado si el umbral requerido de guardianes firma la intención de recuperación. El flujo de recuperación puede:

1. Reconstruir registros deterministas de cuentas Pali a partir de los metadatos de la billetera.
2. Solicitar una aserción WebAuthn cuando un validador de passkey deba demostrar el control.
3. Usar la recuperación mediante guardianes cuando sea necesario reemplazar el validador activo.
4. Omitir cuentas que ya están en la billetera.
5. Mostrar cuentas recuperables con indicaciones de saldo y actividad cuando estén disponibles.
6. Importar las cuentas que seleccione el usuario.

## Creación desde dapps y recuperación de la billetera

Cuando una dapp llama `wallet_prepareSmartAccount`, Pali crea una cuenta inteligente y guarda metadatos duraderos localmente una vez completados el despliegue y la configuración de validadores solicitada. Pali también conserva registros locales de la configuración pendiente de passkeys antes de su instalación, para que un cambio interrumpido no descarte silenciosamente esos detalles de recuperación. Estos registros no sustituyen una copia de seguridad de la frase semilla ni el acceso a la passkey.

Si una cuenta inteligente existe on-chain pero no aparece localmente, usa el flujo de recuperación de la billetera de Pali. Pali omite las cuentas que ya están presentes y permite al usuario elegir cuáles de las restantes desea importar.
