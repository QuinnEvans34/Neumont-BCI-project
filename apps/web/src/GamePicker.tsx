import GardenScene from "./GardenScene";
import { GAMES, type GameId } from "./games/catalog";
import cairnCard from "./assets/cairn/card.jpg";

export type GameStatus = {
  inProgress: boolean;
  detail: string;
  ready?: boolean;
};

function GardenIllustration() {
  // A still frame of the real scene, so the card shows exactly what you'll play.
  return (
    <div className="game-art-scene">
      <GardenScene
        growth={0.85}
        response={0.8}
        sun={0.8}
        time={1.2}
        motion={0}
        paused={false}
        fit="xMidYMid slice"
      />
    </div>
  );
}

function CairnIllustration() {
  // Composed from the game's own photo cut-outs by tools/cairn_assets.
  return <img className="game-art-photo" src={cairnCard} alt="" />;
}

function BeamIllustration() {
  return (
    <svg
      viewBox="0 0 220 130"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="110" cy="114" rx="70" ry="5" fill="#0d2328" />
      <path d="M110,74 L96,110 L124,110Z" fill="#3d6063" />
      <g transform="rotate(-5 110 74)">
        <rect x="30" y="70" width="160" height="6" rx="2" fill="#b98b63" />
        <rect x="30" y="70" width="160" height="2" fill="#e6c49d" />
        <rect x="98" y="67" width="24" height="3" fill="#75e4c1" />
        <circle cx="132" cy="61" r="8" fill="#8ff1d0" />
        <circle cx="129" cy="58" r="2.2" fill="#d3fff1" />
      </g>
    </svg>
  );
}

function BilateralIllustration() {
  return (
    <svg
      viewBox="0 0 220 130"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <circle cx="58" cy="62" r="24" fill="#22383c" />
      <circle
        cx="58"
        cy="62"
        r="24"
        fill="none"
        stroke="#f2c96e"
        strokeWidth="3"
      />
      <circle cx="58" cy="62" r="34" fill="#f2c96e" opacity="0.12" />
      <circle cx="162" cy="62" r="24" fill="#22383c" />
      <path
        d="M110 55v14M103 62h14"
        stroke="#8fa8ab"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M30 108h160"
        stroke="#2e4a4f"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M30 108h56"
        stroke="#9db4ff"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SsvepIllustration() {
  return (
    <svg
      viewBox="0 0 220 130"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <rect
            x={22 + k * 64}
            y={30}
            width={48}
            height={48}
            fill={["#d9dede", "#8a9496", "#c2c9ca"][k]}
          />
          <text
            x={46 + k * 64}
            y={98}
            textAnchor="middle"
            fill="#8fa8ab"
            fontSize="12"
            fontWeight="600"
          >
            {"ABC"[k]}
          </text>
        </g>
      ))}
      <rect x="36" y="110" width="40" height="5" fill="#f2c96e" />
      <rect x="90" y="110" width="22" height="5" fill="#8ff1d0" />
      <rect x="126" y="110" width="14" height="5" fill="#9db4ff" />
    </svg>
  );
}

export default function GamePicker({
  ready,
  reason,
  status,
  onOpen,
  onConnect,
  onCalibrate,
}: {
  ready: boolean;
  reason: string;
  status: Record<GameId, GameStatus>;
  onOpen: (id: GameId) => void;
  onConnect: () => void;
  onCalibrate: () => void;
}) {
  return (
    <>
      <section className="intro">
        <p className="eyebrow">03 / CHOOSE AN EXPERIENCE</p>
        <h1>Games &amp; experiments.</h1>
        <p>
          Everything shares one input stream. Games use the alpha baseline;
          experiments record raw EEG and have their own setup. Switching never
          reconnects or recalibrates, and opening an experiment never starts it.
        </p>
      </section>
      {!ready && (
        <div className="notice picker-notice" role="status">
          <span>{reason}</span>
          <span className="picker-links">
            <button className="secondary small-button" onClick={onConnect}>
              Go to Connect
            </button>
            <button className="secondary small-button" onClick={onCalibrate}>
              Go to Calibrate
            </button>
          </span>
        </div>
      )}
      <div className="game-cards">
        {GAMES.map((g) => {
          const s = status[g.id];
          const experiment = g.kind === "experiment";
          const disabled = experiment ? false : !ready && !s.inProgress;
          return (
            <article key={g.id} className={`game-card ${g.id} kind-${g.kind}`}>
              <div className="game-art">
                {g.id === "garden" ? (
                  <GardenIllustration />
                ) : g.id === "cairn" ? (
                  <CairnIllustration />
                ) : g.id === "balance" ? (
                  <BeamIllustration />
                ) : g.id === "bilateral" ? (
                  <BilateralIllustration />
                ) : (
                  <SsvepIllustration />
                )}
                {experiment && (
                  <span className="exp-badge on-art">Experiment</span>
                )}
              </div>
              <div className="game-card-body">
                <h2>{g.title}</h2>
                <p>{g.blurb}</p>
                {s.detail && <p className="game-status">{s.detail}</p>}
                <button
                  disabled={disabled}
                  onClick={() => onOpen(g.id)}
                  aria-describedby={disabled ? `reason-${g.id}` : undefined}
                >
                  {s.inProgress ? g.resume : g.cta}
                </button>
                {(disabled || experiment) && (
                  <p className="hint" id={`reason-${g.id}`}>
                    {disabled ? "Needs usable input first. " : ""}
                    {experiment ? g.requirement : ""}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
