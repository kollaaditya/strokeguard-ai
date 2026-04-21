from flask import Blueprint, render_template, redirect, url_for
from flask_login import login_required, current_user
from app.models.models import HealthRecord

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/dashboard")
@login_required
def dashboard():
    latest = (
        HealthRecord.query
        .filter_by(user_id=current_user.id)
        .order_by(HealthRecord.timestamp.desc())
        .first()
    )
    return render_template("dashboard/dashboard.html", user=current_user, latest=latest)


@dashboard_bp.route("/history")
@login_required
def history():
    records = (
        HealthRecord.query
        .filter_by(user_id=current_user.id)
        .order_by(HealthRecord.timestamp.desc())
        .limit(50)
        .all()
    )
    records_json = [r.to_dict() for r in records]
    return render_template("dashboard/history.html", records=records, records_json=records_json, user=current_user)
