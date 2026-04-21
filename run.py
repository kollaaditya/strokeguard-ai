import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    env  = os.environ.get("FLASK_ENV", "development")

    if env == "production":
        app.run(host="0.0.0.0", port=port)
    else:
        app.run(host="0.0.0.0", port=port, debug=True, ssl_context="adhoc")
