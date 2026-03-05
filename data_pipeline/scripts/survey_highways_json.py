#!/usr/bin/env python3
"""Survey highway tags from a local Overpass JSON extract."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.osm_json_survey import survey_highways_from_overpass_json


def write_markdown_report(output_path: Path, summary_json_path: Path, input_path: Path) -> None:
    summary = json.loads(summary_json_path.read_text(encoding="utf-8"))

    lines: list[str] = []
    lines.append("# Berlin Highway Survey (Local Overpass JSON)")
    lines.append("")
    lines.append(f"Generated: {datetime.now(UTC).isoformat()}")
    lines.append("")
    lines.append("## Input")
    lines.append(f"- Source: `{input_path}`")
    lines.append("")

    lines.append("## Highway Counts (Top 25)")
    lines.append("")
    lines.append("| highway | ways |")
    lines.append("|---|---:|")
    for highway, count in summary["top_highway_counts"][:25]:
        lines.append(f"| `{highway}` | {count:,} |")
    lines.append("")

    lines.append("## Pedestrian-Usable Highway Values Observed")
    lines.append("")
    if summary["pedestrian_highway_values"]:
        values = ", ".join(f"`{value}`" for value in summary["pedestrian_highway_values"])
        lines.append("- " + values)
    else:
        lines.append("- None from configured walkable value set.")
    lines.append("")

    lines.append("## Typical Node Density Per Km Of Way")
    lines.append("")
    density = summary["node_refs_per_km"]
    if density is None:
        lines.append("- Could not compute (no measurable way length).")
    else:
        lines.append(f"- `{density:.2f}` node-refs/km")
    lines.append(f"- Total measured way length: `{summary['total_way_length_km']:.2f}` km")
    lines.append(f"- Highway ways measured: `{summary['total_highway_way_count']:,}`")
    lines.append(f"- Missing coordinate segments skipped: `{summary['missing_segment_count']:,}`")
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data_pipeline/input/berlin-routing.osm.json"),
        help="Path to local Overpass JSON extract.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=Path("data_pipeline/output/osm-highway-survey.json"),
        help="Path for machine-readable summary.",
    )
    parser.add_argument(
        "--output-markdown",
        type=Path,
        default=Path("docs/osm-highway-survey.md"),
        help="Path for markdown summary.",
    )
    args = parser.parse_args()

    summary = survey_highways_from_overpass_json(args.input)

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(
            {
                "generated_at_utc": datetime.now(UTC).isoformat(),
                "input": str(args.input),
                "top_highway_counts": summary.highway_counts.most_common(100),
                "pedestrian_highway_values": list(summary.pedestrian_highway_values),
                "node_refs_per_km": summary.node_refs_per_km,
                "total_highway_way_count": summary.total_highway_way_count,
                "total_way_length_km": summary.total_way_length_km,
                "missing_segment_count": summary.missing_segment_count,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    write_markdown_report(args.output_markdown, args.output_json, args.input)

    print(f"Wrote {args.output_json}")
    print(f"Wrote {args.output_markdown}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
