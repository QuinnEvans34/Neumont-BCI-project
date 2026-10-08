# DATA-01: headset feasibility spike

Budget: 4–8 focused person-hours; access/subscription waiting is separate. This task selects acquisition, not the final mental-state feature.

## Inventory

Fill in: manufacturer/model; firmware; number of EEG channels and electrode locations; reference arrangement; host OS; connection transport; raw-data access/license; supplied SDK/app; contact-quality output; actual sample rate; data units; device/SDK documentation links. Do not commit personal account credentials or device identifiers unnecessarily.

## Experiment

1. Confirm the vendor app receives recognizable data. Note fitting/connection time.
2. Look up the exact model/OS in BrainFlow supported boards. If absent, evaluate official vendor SDK or available LSL output.
3. Run the smallest acquisition example, with the actual device configuration.
4. Record at least 5 minutes, including still eyes-open baseline and brief labeled blink/jaw/head-movement examples. Optional eyes-closed observation is a device check, not the game's intended interaction.
5. Verify channel axis, timestamps, units, sample rate and packet continuity. Inspect traces and spectrum; preserve raw data locally.
6. Disconnect/reconnect and release the session cleanly. Repeat a short recording.
7. Report result with a plot, environment, acquisition command without secrets, observed failures and recommended adapter.

## Completion

Pass: usable raw recording with metadata, working repeat connection and exact supported route. Conditional pass: only vendor metrics available; document stream identity/limits and revise the data/ML plan. Blocked: no authorized accessible stream; identify required access/driver/hardware step and the next owner. Timebox alternative routes rather than writing a brand-new Bluetooth protocol.

## Report template

- Headset / firmware / OS:
- Selected SDK and version:
- Channels / locations / rate / units:
- Raw access and contact flags:
- Setup and reconnect times:
- Recording duration / continuity:
- Artifact observations:
- Local recording location (ignored by Git):
- Pass / conditional / blocked:
- Next task and precise blocker:
