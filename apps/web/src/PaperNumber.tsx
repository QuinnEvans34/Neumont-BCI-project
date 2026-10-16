// A number spelled in paper cut-out digits (cut from images/paper_numbers.jpg by
// tools/cairn_assets). Digits are 1em tall, so font-size sets their size.
const digitUrls = import.meta.glob<string>("./assets/cairn/digit*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});
const DIGITS: Record<string, string> = Object.fromEntries(
  Object.entries(digitUrls).map(([path, url]) => [path.match(/digit(\d)\.webp$/)![1], url]),
);
/** Small, stable tilts so the digits look laid down by hand. */
const TILT = [-4, 3, -2, 5, -3, 2, -5, 4, -1, 3];

export default function PaperNumber({ value, className = "" }: { value: number; className?: string }) {
  const text = String(Math.max(0, Math.floor(value)));
  return (
    // Keyed on the value so a new score lands with the drop-in animation.
    <span key={text} className={`paper-number ${className}`} role="img" aria-label={text}>
      {[...text].map((d, i) => (
        <img
          key={i}
          src={DIGITS[d]}
          alt=""
          draggable={false}
          style={{ rotate: `${TILT[(Number(d) + i * 3) % TILT.length]}deg` }}
        />
      ))}
    </span>
  );
}
