import { useState } from "react";
import type { CairnRecord } from "../cairnScores";
import { loadLog } from "../gardenPrefs";
import { sourceName } from "../SignalPanel";
import { Plot } from "./Plots";
import { COLORS, pretty, value } from "./model";

type Saved = { id: string; label: string; at: string; source: string; condition: string; ending: string; note: string; metrics: Record<string, number | null> };
const CAIRN = [["stones", "Stones"], ["active", "Active seconds"], ["steady", "Steady time (%)"]];
const GARDEN = [["growth", "Growth (%)"], ["active", "Active seconds"], ["score", "Mean score"], ["above", "Time above baseline (%)"], ["pace", "Bloom pace (s)"], ["full", "Full bloom at (active s)"]];

export default function BrowserHistory({ record }: { record: CairnRecord }) {
  const [plants, setPlants] = useState(loadLog);
  const [game, setGame] = useState("cairn"), [source, setSource] = useState("all"), [mode, setMode] = useState("all");
  const [metric, setMetric] = useState("stones"), [selected, setSelected] = useState<string[]>([]);
  const cairns: Saved[] = record.rounds.map((r, i) => ({ id: `cairn-${i}-${r.at}`, label: `Round ${i+1}`, at: r.at, source: r.source,
    condition: r.mode, ending: r.ending, note: "", metrics: { stones: r.stones, active: r.seconds, steady: r.steady * 100 } }));
  const gardens: Saved[] = plants.map((p, i) => ({ id: p.id, label: `Plant ${i+1}`, at: p.startedAt, source: p.source,
    condition: `${value(p.pace, 0)} s pace`, ending: p.growth >= 1 ? "full bloom" : "ended", note: p.note,
    metrics: { growth: p.growth * 100, active: p.active, score: p.active > 0 ? p.scoreSum / p.active : null,
      above: p.active > 0 ? 100 * p.above / p.active : null, pace: p.pace, full: p.reached?.[2] ?? null } }));
  const all = game === "cairn" ? cairns : gardens;
  const rows = all.filter((r) => (source === "all" || r.source === source) && (game !== "cairn" || mode === "all" || r.condition === mode));
  const choices = game === "cairn" ? CAIRN : GARDEN;
  const chosen = rows.filter((r) => selected.includes(r.id));
  const sources = [...new Set(all.map((r) => r.source))];

  return <>
    <div className="vz-section-head"><div><h2>Your game history</h2><p>{record.rounds.length} Cairn rounds · {plants.length} Garden plants saved in this browser</p></div>
      <button className="secondary" onClick={() => setPlants(loadLog())}>↻ Refresh plant log</button></div>
    <p className="vz-context">These are browser-only game summaries: up to 100 Cairn rounds, 200 Garden plants and 1,000 Cairn flicker stretches. They contain no raw EEG. Full research recordings are available in Recorded runs.</p>
    <div className="vz-compare-controls"><label>Game<select value={game} onChange={(e) => { setGame(e.target.value); setMetric(e.target.value === "cairn" ? "stones" : "growth"); setSelected([]); setSource("all"); }}><option value="cairn">Cairn</option><option value="garden">Glowing Garden</option></select></label>
      <label>Input source<select value={source} onChange={(e) => { setSource(e.target.value); setSelected([]); }}><option value="all">All sources</option>{sources.map((s) => <option key={s} value={s}>{sourceName(s)}</option>)}</select></label>
      {game === "cairn" ? <label>Mode<select value={mode} onChange={(e) => { setMode(e.target.value); setSelected([]); }}><option value="all">Calm & Go</option><option value="calm">Calm</option><option value="go">Go</option></select></label> : <label>Trend metric<select value={metric} onChange={(e) => setMetric(e.target.value)}>{GARDEN.map(([k,label]) => <option key={k} value={k}>{label}</option>)}</select></label>}
    </div>
    <div className="vz-card"><Plot title={`${game === "cairn" ? "Cairn" : "Garden"} · ${choices.find(([k]) => k === metric)?.[1]}`} x1={Math.max(2, rows.length)} min={0} axis="Saved run number (oldest to newest)" unit="One observation per saved run" traces={[
      { label: choices.find(([k]) => k === metric)?.[1] ?? metric, color: COLORS[0], points: rows.map((r,i) => [i+1, r.metrics[metric] ?? null]) },
    ]} /><p className="rs-note">Each point summarizes a completed or ended round. Filter by source and mode to compare like conditions.</p></div>
    <div className="vz-card"><h3>Select up to four rounds to compare</h3><div className="vz-table-wrap"><table className="vz-table"><thead><tr><th>Select</th><th>Run / date</th><th>Source / condition</th>{choices.map(([key,label]) => <th key={key}>{label}</th>)}<th>Outcome / note</th></tr></thead><tbody>
      {[...rows].reverse().map((r) => <tr key={r.id}><td><input type="checkbox" aria-label={`Compare ${r.label}`} checked={selected.includes(r.id)} disabled={!selected.includes(r.id) && selected.length >= 4}
        onChange={(e) => setSelected((old) => e.target.checked ? [...old, r.id] : old.filter((id) => id !== r.id))} /></td>
        <td>{r.label}<small>{new Date(r.at).toLocaleString()}</small></td><td>{sourceName(r.source)}<small>{r.condition}</small></td>{choices.map(([key]) => <td key={key}>{value(r.metrics[key], 3)}</td>)}<td>{pretty(r.ending)}<small>{r.note}</small></td></tr>)}
      {!rows.length && <tr><td colSpan={choices.length+4}>No game summaries match these filters. End a round or plant to save it to the game’s existing history.</td></tr>}
    </tbody></table></div></div>
    {chosen.length > 0 && <div className="vz-card"><h3>Selected round comparison</h3><div className="vz-table-wrap"><table className="vz-table"><thead><tr><th>Metric</th>{chosen.map((r,i) => <th key={r.id} style={{ color: COLORS[i] }}>{r.label}<small>{sourceName(r.source)} · {r.condition}</small></th>)}{chosen.length === 2 && <th>Second − first</th>}</tr></thead><tbody>
      {choices.map(([key,label]) => { const a = chosen[0].metrics[key], b = chosen[1]?.metrics[key]; return <tr key={key}><td>{label}</td>{chosen.map((r) => <td key={r.id}>{value(r.metrics[key], 3)}</td>)}{chosen.length === 2 && <td>{a == null || b == null ? "—" : value(b-a,3)}</td>}</tr>; })}
    </tbody></table></div></div>}
    {record.stimuli.length > 0 && <details className="vz-card"><summary>Cairn flicker history · {record.stimuli.length} recorded stretches</summary><div className="vz-table-wrap"><table className="vz-table"><thead><tr><th>Started</th><th>Duration</th><th>Rate</th><th>Strength</th><th>Source / mode</th></tr></thead><tbody>
      {[...record.stimuli].reverse().map((s,i) => <tr key={i}><td>{new Date(s.start).toLocaleString()}</td><td>{value((s.end-s.start)/1000,3)} s</td><td>{value(s.hz)} Hz</td><td>{value(s.strength,3)}</td><td>{sourceName(s.source)} / {s.mode}</td></tr>)}
    </tbody></table></div><p className="rs-note">Software timestamps describe requested display frames; optical timing is unverified.</p></details>}
  </>;
}
