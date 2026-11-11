# Offline tooling and asset pipelines

[Open PDF atlas](../visual-maps.pdf#page=25) | [Open in browser](../visual-maps.html#diagram-24)
[Map index](../README.md) · [Build map](development-and-release.md) · [Recording joins](../data/recording-and-review.md)

## Recording conversion and no-headset game testing

![Recording conversion and no-headset game testing](build-visuals/tooling-and-assets-recording-conversion-and-no-headset-game-testing.svg)

[Open full-size SVG](build-visuals/tooling-and-assets-recording-conversion-and-no-headset-game-testing.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    gui["OpenBCI GUI text recording"] --> convert["openbci_convert.read_gui_text + convert"]
    convert --> raw["BrainFlow-RAW CSV in data/recordings"]
    raw --> normal["Normal App: connect replay through backend"]
    normal --> verify["Service.ingest verifies samples against original rows"]
    raw --> trace["score_trace.trace: virtual clock + Service.ingest + baseline"]
    trace --> json["JSON: score[], usable[], rate_hz, calibration"]
    json --> picker["CairnPreview file picker or bundled development fixture"]
    picker --> stage["CairnStage + stepCairn; no live backend required"]
    garden["garden-preview query"] --> gpreview["GardenPreview: isolated scene review"]
```

</details>

The converter maps supported GUI text rows to BrainFlow's 24-row Cyton format. `score_trace` reuses the backend's feature/calibration pipeline with a deterministic virtual clock; it is not a substitute for testing the real board or fresh stimulus responses. Preview routes are enabled only in development.

| Tool | Input -> output / entry point |
| --- | --- |
| [backend/openbci_convert.py](../../../../backend/openbci_convert.py) | GUI text -> BrainFlow CSV; `python -m backend.openbci_convert <source.txt> --out data/recordings`. |
| [backend/score_trace.py](../../../../backend/score_trace.py) | BrainFlow CSV -> score trace JSON; `python -m backend.score_trace <recording.csv> --out <trace.json>`. Optional `--calibrate-at` and `--gate` control the trace. |
| [CairnPreview.tsx](../../../../apps/web/src/CairnPreview.tsx) | `/?cairn-preview`: load a trace, choose mode/speed, or use explicit slider/sine test inputs. Development fixture JSONs are discovered through `import.meta.glob`. |
| [GardenPreview.tsx](../../../../apps/web/src/GardenPreview.tsx) | `/?garden-preview`: review the garden presentation without an EEG acquisition session. |

Keep participant recordings and private-derived traces local. A fixture's presence in a development path does not make its data suitable for committing.

## Cairn photo assets

![Cairn photo assets](build-visuals/tooling-and-assets-cairn-photo-assets.svg)

[Open full-size SVG](build-visuals/tooling-and-assets-cairn-photo-assets.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    photos["Local reference photos in images/dump"] --> masks["Optional --segment: SAM ViT-H object masks"]
    masks --> cache["Cached masks in images/cairn-masks"]
    photos --> compose["compose: cutouts, stable faces, alignment, paper borders"]
    cache --> compose
    compose --> sprites["Sprites + backgrounds + manifest.json"]
    numbers["images/paper_numbers.jpg"] --> digits["build_digits: score digits"]
    digits --> assets["apps/web/src/assets/cairn"]
    sprites --> assets
    assets --> card["compose_card: chooser art"]
    assets --> stage["CairnStage: sprites + manifest geometry"]
    assets --> paper["PaperNumber: score presentation"]
    stage --> bundle["Vite frontend bundle"]
    paper --> bundle
    card --> bundle
```

</details>

The asset script is an on-demand authoring tool, not part of `npm run build`. Segmentation uses optional heavyweight model tooling; recomposition uses cached masks and image-processing libraries. Its defaults keep original photos under ignored `images/dump` and write reusable generated assets to the frontend asset directory.

| Mode | What it runs |
| --- | --- |
| `python tools/cairn_assets/build_cairn_assets.py --segment` | Run segmentation, then compose sprites/digits/card. |
| `python tools/cairn_assets/build_cairn_assets.py` | Recompose from existing photos/masks, then build digits/card. |
| `python tools/cairn_assets/build_cairn_assets.py --digits` | Rebuild score digits only. |

Source: [build_cairn_assets.py](../../../../tools/cairn_assets/build_cairn_assets.py), [manifest.json](../../../../apps/web/src/assets/cairn/manifest.json), [cairnGeometry.ts](../../../../apps/web/src/cairnGeometry.ts), [CairnStage.tsx](../../../../apps/web/src/CairnStage.tsx), [PaperNumber.tsx](../../../../apps/web/src/PaperNumber.tsx).

## Research export inspection

![Research export inspection](build-visuals/tooling-and-assets-research-export-inspection.svg)

[Open full-size SVG](build-visuals/tooling-and-assets-research-export-inspection.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    saved["Finalized research CSV / SQLite / Both"] --> export["Store.export_zip"]
    export --> zip["Portable CSV ZIP + metadata + manifest"]
    zip --> inspect["tools/research/check_export.py"]
    inspect --> counts["Row counts and SHA-256 checksums"]
    inspect --> joins["Event -> input frame -> window -> EEG links"]
    inspect --> integrity["Continuity, channel rows and export sanitization"]
```

</details>

Run `python tools/research/check_export.py <research-export.zip>` against an actual exported recording. The [checker](../../../../tools/research/check_export.py) inspects recorded structure and consistency; the result does not establish physiological validity or physical stimulus timing.
