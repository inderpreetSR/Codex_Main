"""Bounded CSV profiling and independent-row baseline evaluation."""

import csv
import re
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    balanced_accuracy_score,
    f1_score,
    mean_absolute_error,
    r2_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.contracts import Features, JobError

MAX_ROWS = 100_000
MAX_COLUMNS = 100


def read_csv(path):
    """Read a rectangular UTF-8 CSV without inferring executable formats."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream, strict=True)
            columns = [value.strip() for value in next(reader, [])]
            if (
                not columns
                or len(columns) > MAX_COLUMNS
                or len(set(columns)) != len(columns)
                or any(
                    not name or len(name) > 120 or not name.isprintable()
                    for name in columns
                )
            ):
                raise JobError(
                    "Use 1–100 unique, nonempty column names of at most 120 characters."
                )
            rows = []
            for row in reader:
                if not row:
                    continue
                if len(row) != len(columns) or any("\x00" in value for value in row):
                    raise JobError(
                        "Each CSV row must have the same number of fields as the header."
                    )
                if len(rows) == MAX_ROWS:
                    raise JobError("CSV uploads are limited to 100,000 rows.")
                rows.append([value.strip() or None for value in row])
    except (UnicodeError, csv.Error) as error:
        raise JobError("Upload a valid, comma-separated UTF-8 CSV.") from error
    if not rows:
        raise JobError("The CSV has no data rows.")
    return pd.DataFrame(rows, columns=columns, dtype=object)


def numeric(series):
    """Coerce numbers, treating invalid or infinite values as missing."""
    return pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)


def profile(frame):
    """Summarize columns without retaining sample values."""
    columns = []
    for name, series in frame.items():
        filled = series.dropna()
        unique = int(filled.nunique())
        missing = int(series.isna().sum())
        slug = re.sub(r"[^a-z0-9]+", "_", name.lower())
        warnings = []
        if re.search(r"(^|_)(id|uuid|guid)(_|$)", slug):
            warnings.append("Possible identifier")
        if re.search(r"(^|_)(target|label|outcome|final|post|result)(_|$)", slug):
            warnings.append("Review for target leakage")
        if unique <= 1:
            warnings.append("Constant or empty")
        if missing > len(frame) / 2:
            warnings.append("More than half missing")
        kind = (
            "numeric"
            if len(filled) and numeric(filled).notna().all()
            else "categorical"
        )
        if kind == "categorical" and unique > 50:
            warnings.append("High cardinality")
        score = max(0, round(100 * (1 - missing / len(frame))) - 20 * len(warnings))
        columns.append(
            {
                "name": name,
                "kind": kind,
                "missing": missing,
                "unique": unique,
                "warnings": warnings,
                "score": score,
            }
        )
    return {
        "rows": len(frame),
        "columns": sorted(columns, key=lambda column: -column["score"]),
    }


def build_features(frame, spec, type_reference=None):
    """Apply only predefined, row-local transformations."""
    available = list(dict.fromkeys(spec.available))
    if (
        not available
        or spec.target in available
        or any(name not in frame for name in available)
    ):
        raise JobError(
            "Select prediction-time columns from this dataset and exclude the target."
        )
    if not set(spec.selected).issubset(available):
        raise JobError("Selected columns must also be marked as available.")
    originals = frame[available].copy()
    reference = originals if type_reference is None else type_reference[available]
    for column in profile(reference)["columns"]:
        if column["kind"] == "numeric":
            originals[column["name"]] = numeric(originals[column["name"]])
    selected = originals[list(dict.fromkeys(spec.selected))].copy()
    for transform in spec.transforms:
        source = originals[transform.source]
        if transform.operation == "missing":
            values = source.isna().astype(int)
        elif transform.operation == "log":
            numbers = numeric(source)
            if source.notna().any() and not numbers.notna().any():
                raise JobError("Log transforms require a numeric input.")
            values = np.log1p(numbers.where(numbers >= 0))
        elif transform.operation == "ratio":
            denominator = numeric(originals[transform.denominator])
            numerator = numeric(source)
            if not denominator.notna().any() or not numerator.notna().any():
                raise JobError("Ratio transforms require numeric inputs.")
            values = (numerator / denominator.replace(0, np.nan)).replace(
                [np.inf, -np.inf], np.nan
            )
        else:
            values = source.astype("string").astype(object).where(source.notna(), None)
        selected[transform.name] = values
    if not len(selected.columns):
        raise JobError("Select at least one input or create a derived feature.")
    return originals, selected


def preview(frame, specification):
    """Show a small local-only transformation preview."""
    spec = Features(**specification)
    _, derived = build_features(frame, spec)
    example = derived.head(8)
    encodings = {}
    for transform in spec.transforms:
        if transform.operation == "encode":
            values = example[transform.name]
            categories = sorted({value for value in values if value is not None})
            encodings[transform.name] = {
                "categories": categories,
                "rows": [
                    [int(value == category) for category in categories]
                    for value in values
                ],
            }
    return {
        "columns": example.columns.tolist(),
        "rows": example.astype(object).where(pd.notna(example), None).values.tolist(),
        "encodings": encodings,
    }


def pipeline(frame, classification):
    """Construct preprocessing fitted only with the training split."""
    number = frame.select_dtypes(include="number").columns.tolist()
    category = [name for name in frame if name not in number]
    prep = ColumnTransformer(
        [
            (
                "numeric",
                make_pipeline(
                    SimpleImputer(strategy="median", keep_empty_features=True),
                    StandardScaler(),
                ),
                number,
            ),
            (
                "categorical",
                make_pipeline(
                    SimpleImputer(
                        missing_values=None,
                        strategy="constant",
                        fill_value="(missing)",
                        keep_empty_features=True,
                    ),
                    OneHotEncoder(
                        handle_unknown="infrequent_if_exist", max_categories=50
                    ),
                ),
                category,
            ),
        ]
    )
    estimator = (
        LogisticRegression(max_iter=350, random_state=42)
        if classification
        else Ridge(solver="lsqr")
    )
    return make_pipeline(prep, estimator)


def scores(target, prediction, classification):
    """Calculate task-appropriate holdout metrics."""
    if classification:
        return {
            "macro_f1": float(
                f1_score(target, prediction, average="macro", zero_division=0)
            ),
            "balanced_accuracy": float(balanced_accuracy_score(target, prediction)),
        }
    return {
        "mae": float(mean_absolute_error(target, prediction)),
        "r2": float(r2_score(target, prediction)),
    }


def macro_f1(estimator, features, target):
    """Score multiclass predictions without requiring a positive label."""
    return f1_score(
        target, estimator.predict(features), average="macro", zero_division=0
    )


def evaluate(frame, specification, task):
    """Compare three models on the same deterministic holdout."""
    spec = Features(**specification)
    if spec.target not in frame:
        raise JobError("Confirm the target column in the saved feature specification.")
    classification = task == "classification"
    target = frame[spec.target] if classification else numeric(frame[spec.target])
    valid = target.notna()
    target = target[valid]
    if len(target) < 20:
        raise JobError("At least 20 rows with a valid target are required.")
    if classification:
        counts = Counter(target)
        if (
            not 2 <= len(counts) <= 20
            or min(counts.values()) < 5
            or len(counts) > np.ceil(len(target) / 5)
        ):
            raise JobError(
                "Use 2–20 target classes with enough rows per class for a stratified holdout."
            )
    train, test = train_test_split(
        target.index,
        test_size=0.2,
        random_state=42,
        stratify=target if classification else None,
    )
    original, selected = build_features(frame.loc[valid], spec, frame.loc[train])
    baseline = (
        DummyClassifier(strategy="most_frequent")
        if classification
        else DummyRegressor(strategy="median")
    )
    baseline.fit(original.loc[train], target.loc[train])
    original_model = pipeline(original, classification)
    selected_model = pipeline(selected, classification)
    original_model.fit(original.loc[train], target.loc[train])
    selected_model.fit(selected.loc[train], target.loc[train])
    scorer = macro_f1 if classification else "neg_mean_absolute_error"
    importance_rows = pd.Series(test).sample(n=min(len(test), 2000), random_state=42)
    importance = permutation_importance(
        selected_model,
        selected.loc[importance_rows],
        target.loc[importance_rows],
        scoring=scorer,
        n_repeats=3,
        random_state=42,
    )
    return {
        "training_rows": len(train),
        "holdout_rows": len(test),
        "excluded_missing_targets": int((~valid).sum()),
        "metrics": {
            "Dummy": scores(
                target.loc[test], baseline.predict(original.loc[test]), classification
            ),
            "Eligible originals": scores(
                target.loc[test],
                original_model.predict(original.loc[test]),
                classification,
            ),
            "Selected and engineered": scores(
                target.loc[test],
                selected_model.predict(selected.loc[test]),
                classification,
            ),
        },
        "importance": sorted(
            [
                {"feature": name, "mean": float(mean), "std": float(std)}
                for name, mean, std in zip(
                    selected.columns,
                    importance.importances_mean,
                    importance.importances_std,
                )
            ],
            key=lambda item: -item["mean"],
        ),
    }
