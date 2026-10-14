export type GameId = "garden" | "balance";

export type GameInfo = {
  id: GameId;
  title: string;
  blurb: string;
  cta: string;
  resume: string;
};

// A small typed registry, not a plugin framework. Garden is listed first.
export const GAMES: GameInfo[] = [
  {
    id: "garden",
    title: "Glowing Garden",
    blurb: "Watch your signal bring a plant to life.",
    cta: "Grow a garden",
    resume: "Return to garden",
  },
  {
    id: "balance",
    title: "Balance Beam",
    blurb: "Keep the ball balanced as your signal changes assistance.",
    cta: "Play Balance Beam",
    resume: "Return to Balance Beam",
  },
];

export const gameInfo = (id: GameId) => GAMES.find((g) => g.id === id)!;
