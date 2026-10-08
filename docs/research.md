# Reusable software and research shortlist

**Detailed source-level research:** [Reuse matrix](blueprint/reuse-matrix.md) identifies exact files, algorithms, decisions and alternatives.

Checked October 8, 2026. These are source/documentation findings, not proof of compatibility with our unidentified headset. Pin and test the chosen releases before the meeting. Keep upstream notices when copying licensed source/assets.

| Project | Reuse | License / decision |
| --- | --- | --- |
| [Phaser](https://github.com/phaserjs/phaser) | Renderer, scene lifecycle, keyboard input, animations | MIT; starter uses 3.90.0 deliberately, not latest-major selection |
| [Official React + TypeScript template](https://github.com/phaserjs/template-react-ts) | Reference architecture for React/Phaser bridge and Vite workflow | MIT; reference only, no source copied. README currently mentions Phaser 4 even though repo description says Phaser 3; don't infer version from description |
| [BrainFlow](https://github.com/brainflow-dev/brainflow) | Board acquisition, filters, band-power features, synthetic/playback support | MIT; preferred conditional on exact model/OS compatibility |
| [BrainFlow supported boards](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html) | Headset/OS/connection requirements | Read exact model entry during hardware spike |
| [BrainFlow examples](https://brainflow.readthedocs.io/en/stable/Examples.html) | Starting examples for acquisition/features/ML API | Use as small examples, not validated calmness measurements |
| [FastAPI](https://github.com/fastapi/fastapi) | Local health and WebSocket service | MIT; included in backend dependencies |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn) | Logistic regression and model evaluation | BSD-3-Clause; add when experiment starts |
| [pylsl](https://github.com/labstreaminglayer/pylsl) | Receive an existing LSL stream if vendor acquisition uses it | MIT; optional alternative, avoid adding a second streaming layer without need |
| [OpenBCI neurofeedback game tutorial](https://openbci.com/community/build-your-own-neurofeedback-game-with-openbci/) | Prior example of an EEG-to-game pipeline | Architectural reference; older article, not a turnkey dependency or evidence for health claims |

## What we bring into this repo

Install libraries rather than copy entire EEG/game applications. Our starter contains original React/Phaser integration, a tunable simulation, and a synthetic protocol producer. Do not import a large unmaintained “brain game” merely because its title matches ours. A small supported acquisition library is more useful than an opaque full app.

The official Phaser template uses a React bridge/event bus. We use component refs and callbacks for the initial narrow interface instead; this can evolve when multiple scenes require events.

## Hardware spike checklist

Record make/model, firmware, channel locations, raw-data availability, subscriptions/licensing restrictions, host OS, connection method, supported SDK, contact-quality output, and a saved raw test recording. Compare vendor app to our stream. Test at least a short continuous session and reconnect. Do not select electrodes or ML features before channel information is known.

## Alternative paths

If BrainFlow doesn't support the headset: vendor SDK → our existing protocol; or vendor app → LSL → our protocol. If raw EEG is locked but vendor metrics are accessible: label their origin and limits, and evaluate their usefulness. If neither is accessible by week 2: keep the software game demo, report the integration blocker, and use explicitly labeled simulation/replay.

## Dependencies and assets

Retain MIT/BSD notices for reused portions, attribute sources in this file, and inspect licenses for any later art/audio. Default starter shapes are drawn in code, not borrowed assets. Optional web fonts are DM Sans and Manrope via Google Fonts; system fallbacks work offline. Before release either self-host fonts with their license files or keep system fonts. Choose the club repo's license with its owners; dependency licenses do not automatically license our original work.
