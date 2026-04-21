import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
workers = 1
threads = 2
timeout = 120
max_requests = 100
max_requests_jitter = 10
preload_app = True
