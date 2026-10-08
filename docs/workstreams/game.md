# Phaser gameplay brief

## Own

`Game.tsx` (render/input) and `simulation.ts` (deterministic physics). UI and EEG algorithms remain outside this workstream.

## First task: GAME-01

Run identical rounds at score 0 and 1 without keyboard. Measure time in center zone and ball-position variation. Tune bounded disturbance so the difference is clear, without making the low-score round unusable or both extremes trivially perfect. Share a short comparison clip and numbers.

## Deliver

A forgiving 60-second game with smooth motion, visible target zone, controllable difficulty, repeatable disturbances, pause and reset. State explicitly that automated stabilization provides assistance. A full rigid-body engine is optional, not required.

## Design knobs

Beam angle limit; disturbance amplitude/frequency; centering gain; damping; target-zone width; ball end behavior; input smoothing. Keep named values in a configuration object when tuning begins. Use fixed-step simulation; never make the game depend on EEG packet rate.

## Acceptance

Works at low/high render rates; ball never becomes NaN or escapes defined boundaries; timer and scoring stop on pause; new round resets everything; physics can be tested without a browser. Direct EEG steering is a separate experiment gated on usable directional input.
