import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    env  = os.environ.get("FLASK_ENV", "development")

    if env == "production":
        # Production: gunicorn handles this, plain run for fallback
        app.run(host="0.0.0.0", port=port)
    else:
        # Development: use adhoc SSL so camera works on any IP
        app.run(host="0.0.0.0", port=port, debug=True, ssl_context="adhoc")
