export type GameId = "garden" | "cairn" | "balance";

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
    id: "cairn",
    title: "Cairn",
    blurb: "Stay focused while a hand stacks real stones on a balancing plank.",
    cta: "Stack a cairn",
    resume: "Return to Cairn",
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
