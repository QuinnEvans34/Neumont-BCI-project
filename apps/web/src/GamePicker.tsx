import GardenScene from "./GardenScene";
import { GAMES, type GameId } from "./games/catalog";
import cairnCard from "./assets/cairn/card.jpg";

export type GameStatus = { inProgress: boolean; detail: string };

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
        <p className="eyebrow">03 / CHOOSE A GAME</p>
        <h1>Pick how your signal plays.</h1>
        <p>
          Every game uses the same stream and the same baseline. Switching
          games pauses the one you leave; nothing reconnects or recalibrates.
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
          const disabled = !ready && !s.inProgress;
          return (
            <article key={g.id} className={`game-card ${g.id}`}>
              <div className="game-art">
                {g.id === "garden" ? (
                  <GardenIllustration />
                ) : g.id === "cairn" ? (
                  <CairnIllustration />
                ) : (
                  <BeamIllustration />
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
                {disabled && (
                  <p className="hint" id={`reason-${g.id}`}>
                    Needs usable input first.
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
