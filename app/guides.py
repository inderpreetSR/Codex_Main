"""Bundled use-case content used by the UI and local retrieval."""

GUIDES = [
    {
        "id": "churn",
        "title": "Customer churn",
        "task": "classification",
        "description": "Predict which active customers will cancel in the next 30 days.",
        "sections": {
            "Problem and target": "Predict cancellation in the next 30 days from a snapshot of active customers. The target is a yes or no churn label.",
            "Data and features": "Use tenure, activity frequency, account age, and support contacts available on the snapshot date. Exclude cancellation dates and post-cancellation events.",
            "Evaluation": "Use macro F1 and balanced accuracy when churn is rare. Compare with a dummy predictor and examine false negatives.",
        },
    },
    {
        "id": "lead",
        "title": "Lead conversion",
        "task": "classification",
        "description": "Predict whether a new lead will convert within a defined window.",
        "sections": {
            "Problem and target": "Classify whether a new lead converts within 60 days. Use an observation cutoff consistent with the lead scoring decision.",
            "Data and features": "Use channel, prior engagement, and profile attributes recorded before scoring. Exclude sales outcomes and activities after scoring.",
            "Evaluation": "Compare macro F1 and balanced accuracy. Review errors by channel and keep conversion timing consistent.",
        },
    },
    {
        "id": "sales",
        "title": "Sales estimation",
        "task": "regression",
        "description": "Estimate sales amount from inputs available at the time of a quote.",
        "sections": {
            "Problem and target": "Predict the sales amount for an independent quote. The target is a numeric amount, measured consistently across rows.",
            "Data and features": "Use product category, quoted quantity, and region. Exclude finalized invoice values and duplicate quotes.",
            "Evaluation": "Compare mean absolute error in the original currency and R squared with a median dummy model.",
        },
    },
    {
        "id": "forecasting",
        "title": "Time-series forecasting",
        "task": None,
        "description": "Predict future values when observations have a time order.",
        "sections": {
            "Evaluation": "Use rolling or expanding windows with an out-of-time holdout. A random split can put future observations in training and leak information.",
        },
    },
    {
        "id": "clustering",
        "title": "Clustering",
        "task": None,
        "description": "Find useful groups in data without a known target variable.",
        "sections": {
            "Method": "Scale comparable numeric inputs and compare cluster stability. Review whether each segment is actionable and distinct.",
        },
    },
]
