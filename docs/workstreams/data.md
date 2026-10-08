# EEG / data flow brief

## Own

`backend/`, live adapter, buffer, features, calibration, quality assessment, local development recordings. Coordinate InputFrame changes with frontend. The existing server is synthetic-only.

## First task: DATA-01

Inventory exact headset, OS, firmware, channels and SDK access. Follow that device's vendor/BrainFlow example to acquire a short recording. Report actual sample rate, channel map, obvious artifacts, and a reconnect test. If blocked, document the exact missing SDK/subscription/driver rather than rewriting the frontend.

## Deliver

An explicit synthetic/live/replay adapter interface, quality-gated feature pipeline, participant baseline calibration, and a 4-Hz InputFrame output. Acquisition should run independently from individual browser clients and stop cleanly. Do not treat synthetic sine waves as evidence for hardware or ML performance.

## Calibration plan

Choose a feature after reviewing channels. Collect a stable baseline; establish a robust mapping to [0,1]; clip/smooth outputs; reject insufficient/flat/noisy baselines. Inspect repeated sessions before naming the feature as attention or relaxation. Preserve raw samples before processing for development evaluation.

## Acceptance

Live output includes correct source, quality and calibration flags. Bad contact/movement/sample gaps don't increase score. Disconnect and restart work. Sessions remain anonymous/local/ignored by Git. Provide plots and a replay fixture or synthetic packet fixture for other members.
