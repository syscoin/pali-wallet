# Mobile polish pass — 12 November

Current React Native components rendered with synthetic public data. These captures cover the revised portfolio, copy controls, chart, navigation and settings. The viewport may show only part of scrollable content. Native OS authorization, camera, hardware and physical gestures require separate qualification.

The source is `79061519f` plus the reviewed polish patch recorded in [the capture manifest](manifest.json). The later amount-validation grammar correction and amber Smart-account address warning are not represented in these frames.

| Screen | 320px | Wider view |
| --- | --- | --- |
| All-networks home | ![All-networks home](home-all-320.png) | ![All-networks home](home-all-390.png) |
| Send from | ![Network source sheet](send-from-320.png) | |
| Receive, full copyable address | ![Receive](receive-320.png) | |
| Selected chart price | ![Chart](chart-selected-320.png) | |
| Activity | ![Activity](activity-320.png) | |
| Transaction detail | ![Transaction detail](activity-detail-320.png) | |
| Settings | | ![Settings](settings-390.png) |
| Auto-lock, default Off | ![Auto-lock](auto-lock-320.png) | |
| Watch-account setup | ![Watch-account setup](add-watch-320.png) | |

The Receive fix passed eight existing viewport/large-text cases plus a regression that checks actual text bounds, copy-icon visibility and exact clipboard contents. The chart's selected point was exercised through its native callback in the browser, using a deterministic market-data response; this does not establish live provider availability or a physical touch pass.


## GPT Pro follow-up

These new captures use the completed quality fixes, bound by the [follow-up source and capture manifest](followup-manifest.json). The original captures above retain their earlier source identity. See the [ten-item acceptance checklist](gpt-pro-followup.md) for coverage and pending device/CI gates.

| Updated screen | 320px | 390px |
| --- | --- | --- |
| Custom EVM network fee | ![EVM fee](evm-fee-320.png) | ![EVM fee](evm-fee-390.png) |
| Custom UTXO network fee | ![UTXO fee](utxo-fee-320.png) | ![UTXO fee](utxo-fee-390.png) |
| Guardian review, intent and timing first | ![Guardian review](guardian-review-320.png) | |
| Smart completion with local transaction navigation | ![Smart completion](smart-complete-320.png) | |
| Settings with current language, currency and alert state | ![Current Settings](settings-current-320.png) | ![Current Settings](settings-current-390.png) |
| About with maintenance separated from daily settings | ![About maintenance](about-maintenance-320.png) | |

The Guardian capture shows the top of a scrollable review; precise identities and fee details remain below. Focused browser checks cover both the content and reachable actions. Fee sheets keep presets, exact fee inputs and Apply inside the scrollable sheet; native keyboard behavior still requires device checks.
