// Shapes of the optional experiment telemetry added to the existing WebSocket
// envelope (input protocol v1 and alpha semantics are unchanged).

export type ExperimentKind = "bilateral" | "ssvep";
export type ExperimentMode = "live" | "replay" | "simulated";

export type RecordingInfo = {
  state: "recording" | "saving" | "saved" | "failed";
  path: string;
  error: string | null;
  bytes: number;
  samples: number;
  events: number;
  frames: number;
  predictions: number;
  metrics: number;
  first_sample: number | null;
  last_sample: number | null;
};

export type WindowResult = {
  valid: boolean;
  reason: string | null;
  correlations: number[] | null;
  best: number | null;
  candidate: number | null;
  margin: number | null;
  channels: string[];
  excluded: { channel: string; reason: string }[];
  window: [number, number];
  trial_id: string;
  stable: boolean;
  accepted: number | null;
  computed_wall_s: number;
};

export type TrialDecision = {
  trial_id: string;
  block: string;
  interrupted: boolean;
  valid: boolean;
  decision: number | null;
  best?: number;
  correlation?: number;
  margin?: number;
  stable?: boolean;
  correlations?: number[];
  reason?: string;
  windows?: number;
  valid_windows?: number;
};

export type Counts = {
  trials: number;
  completed: number;
  interrupted: number;
  invalid: number;
  correct: number;
  incorrect: number;
  abstained: number;
  neutral_trials: number;
  neutral_false_activations: number;
  neutral_abstained: number;
  unlabelled: number;
  unlabelled_selections: number;
};

export type SetupReport = {
  ready: boolean;
  correlation: number | null;
  margin: number | null;
  reason: string | null;
  setup_trials: number;
  valid_target: number;
  valid_neutral: number;
  invalid: number;
  setup_correct?: number;
  setup_wrong?: number;
};

export type ChannelMetric = {
  name: string;
  valid: boolean;
  reason: string | null;
  rms?: number;
  theta?: number;
  alpha?: number;
  beta?: number;
};

export type PhaseSummary = {
  start_sample: number;
  end_sample: number | null;
  windows: number;
  boundary_excluded: number;
  discontinuous: number;
  channels: {
    name: string;
    valid: number;
    rejected: number;
    rms: number | null;
    theta: number | null;
    alpha: number | null;
    beta: number | null;
  }[];
};

export type Analysis = {
  windows: { valid: number; invalid: number };
  error: string | null;
  // SSVEP
  latest?: WindowResult | null;
  trial?: {
    id: string;
    block: string;
    state: string;
    reason?: string;
    alignment_uncertainty_ms?: number;
  };
  last_decision?: TrialDecision;
  spectrum?: {
    f: number[];
    amplitude_uv: number[];
    end: number;
    discontinuous: boolean;
  };
  thresholds?: (SetupReport & { frozen_at: string }) | null;
  thresholds_ready?: boolean;
  setup?: SetupReport;
  counts?: { setup: Counts; evaluation: Counts; single: Counts };
  // Bilateral
  phase?: string | null;
  sides?: number;
  phases?: Record<string, PhaseSummary>;
} & Record<string, unknown>;

export type ExperimentTelemetry = {
  id: string;
  kind: ExperimentKind;
  mode: ExperimentMode;
  state: "running" | "completed" | "interrupted" | "failed";
  reason: string | null;
  session_id: string;
  started_at: string;
  ended_at: string | null;
  stale: boolean;
  participant: string | null;
  electrodes: string[];
  events: number;
  frames: number;
  samples: number;
  clock: { offset_ms: number; rtt_ms: number };
  recording: RecordingInfo;
  saved: boolean;
  heartbeat_age_ms: number | null;
  settings: Record<string, unknown> | null;
  analysis: Analysis;
};

export const MODE_LABEL: Record<string, string> = {
  live: "Live Cyton EEG",
  replay:
    "Recorded EEG replay — pipeline check only; it cannot contain responses to these stimuli",
  simulated: "Simulated EEG — no headset",
  simulated_eeg: "Simulated EEG — no headset",
  synthetic: "Score-only simulation — no raw EEG for experiments",
};

export const ELECTRODE_SUGGESTIONS = [
  "O1",
  "Oz",
  "O2",
  "PO3",
  "POz",
  "PO4",
  "PO7",
  "PO8",
  "P3",
  "Pz",
  "P4",
  "C3",
  "Cz",
  "C4",
  "Fp1",
  "Fp2",
  "F3",
  "Fz",
  "F4",
  "T7",
  "T8",
];

export const isPosterior = (name: string) => /^(O|PO)/i.test(name.trim());
