export type GameId = "garden" | "cairn" | "balance" | "bilateral" | "ssvep";

/** What an experience needs before it can start (opening setup never needs anything). */
export type Requirement = "calibrated-score" | "raw-eeg";

export type GameInfo = {
  id: GameId;
  kind: "game" | "experiment";
  title: string;
  blurb: string;
  cta: string;
  resume: string;
  requires: Requirement;
  requirement: string;
};

// A small typed registry, not a plugin framework. Games first, then experiments.
export const GAMES: GameInfo[] = [
  {
    id: "garden",
    kind: "game",
    title: "Glowing Garden",
    blurb: "Watch your signal bring a plant to life.",
    cta: "Grow a garden",
    resume: "Return to garden",
    requires: "calibrated-score",
    requirement: "Needs a calibrated alpha baseline (or Simulation).",
  },
  {
    id: "cairn",
    kind: "game",
    requires: "calibrated-score",
    requirement: "Needs a calibrated alpha baseline (or Simulation).",
    title: "Cairn",
    blurb: "Stay focused while a hand stacks real stones on a balancing plank.",
    cta: "Stack a cairn",
    resume: "Return to Cairn",
  },
  {
    id: "balance",
    kind: "game",
    title: "Balance Beam",
    blurb: "Keep the ball balanced as your signal changes assistance.",
    cta: "Play Balance Beam",
    resume: "Return to Balance Beam",
    requires: "calibrated-score",
    requirement: "Needs a calibrated alpha baseline (or Simulation).",
  },
  {
    id: "bilateral",
    kind: "experiment",
    title: "Bilateral Visual Stimulation",
    blurb:
      "Alternating left/right cues while raw EEG is observed and recorded.",
    cta: "Open setup",
    resume: "Open setup",
    requires: "raw-eeg",
    requirement:
      "Setup opens anytime. Recording needs fresh raw EEG; no alpha baseline.",
  },
  {
    id: "ssvep",
    kind: "experiment",
    title: "SSVEP Cards",
    blurb: "Three flickering cards and a CCA decoder that selects or abstains.",
    cta: "Open setup",
    resume: "Open setup",
    requires: "raw-eeg",
    requirement:
      "Setup opens anytime. Needs raw EEG, posterior electrodes and a display check.",
  },
];

export const gameInfo = (id: GameId) => GAMES.find((g) => g.id === id)!;
export const isExperiment = (id: GameId) => gameInfo(id).kind === "experiment";
