# Native Activity component fixture

This isolated entry renders the actual Activity controller and React Native
screen using public synthetic history. It does not open a wallet, sign, broadcast
or call an external endpoint. Browser controls inject feed failure and delayed
receipt reads so tests can exercise retry and back navigation during work.

Run `npm run test:activity-ui` from `apps/mobile`. The fixture uses port 4181 and
does not share the send fixture's 4178/4179 ports. Browser evidence is separate
from native networking and physical-device qualification.
