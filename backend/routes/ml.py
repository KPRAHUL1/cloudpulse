"""Module 3 endpoints: K-Means clustering and Linear Regression prediction."""
from flask import Blueprint, jsonify, request

from ml import kmeans_model, regression_model

bp = Blueprint("ml", __name__, url_prefix="/api/ml")


@bp.get("/clusters")
def clusters():
    """K-Means: group usage patterns into Low / Medium / High."""
    window = request.args.get("window", type=int)
    result = kmeans_model.run(window=window)
    return jsonify(result)


@bp.get("/predict")
def predict():
    """Linear Regression: forecast future CPU or memory utilisation."""
    metric = request.args.get("metric", default="cpu")
    horizon = request.args.get("horizon", default=30, type=int)
    horizon = max(5, min(horizon, 240))

    result = regression_model.run(metric=metric, horizon_minutes=horizon)
    code = 400 if result.get("status") == "error" else 200
    return jsonify(result), code


@bp.get("/predict/all")
def predict_all():
    """Forecast every supported metric in one call."""
    horizon = request.args.get("horizon", default=30, type=int)
    horizon = max(5, min(horizon, 240))
    return jsonify({
        "status": "ok",
        "horizon_minutes": horizon,
        "results": regression_model.run_all(horizon_minutes=horizon),
    })


@bp.get("/analysis")
def analysis():
    """Both algorithms in one payload - backs the Analysis screen."""
    horizon = request.args.get("horizon", default=30, type=int)
    horizon = max(5, min(horizon, 240))
    return jsonify({
        "status": "ok",
        "clustering": kmeans_model.run(),
        "prediction": regression_model.run_all(horizon_minutes=horizon),
    })
