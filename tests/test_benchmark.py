"""Collect a local baseline for deciding where Rust could help."""

import resource
from time import perf_counter

from app.ml import evaluate, preview, profile, read_csv


def test_representative_csv(tmp_path):
    """Measure a bounded synthetic tabular workload without timing assertions."""
    path = tmp_path / "representative.csv"
    names = [f"feature_{index}" for index in range(12)]
    with path.open("w", encoding="utf-8") as stream:
        stream.write(",".join([*names, "region", "target"]) + "\n")
        for row in range(50_000):
            values = [str((row * (index + 3)) % (317 + index)) for index in range(12)]
            stream.write(
                ",".join([*values, ("east", "west")[row % 2], str(row % 3)]) + "\n"
            )

    spec = {
        "target": "target",
        "available": [*names, "region"],
        "selected": names[:6],
        "transforms": [
            {
                "name": "ratio",
                "operation": "ratio",
                "source": names[0],
                "denominator": names[1],
            },
            {"name": "encoded", "operation": "encode", "source": "region"},
        ],
    }
    start = perf_counter()
    frame = read_csv(path)
    summary = profile(frame)
    profile_time = perf_counter() - start
    start = perf_counter()
    example = preview(frame, spec)
    preview_time = perf_counter() - start
    start = perf_counter()
    result = evaluate(frame, spec, "classification")
    evaluation_time = perf_counter() - start
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    print(
        f"50,000 x 14 synthetic CSV: profile {profile_time:.2f}s, preview {preview_time:.2f}s, "
        f"baseline {evaluation_time:.2f}s, process peak RSS {peak / 1024:.0f} MiB"
    )
    assert summary["rows"] == 50_000
    assert len(example["rows"]) == 8
    assert result["holdout_rows"] == 10_000
