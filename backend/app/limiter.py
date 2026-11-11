"""Shared API rate limiter configured via slowapi."""

import os
from slowapi import Limiter
from slowapi.util import get_remote_address

RATE_LIMIT_ANALYZE = os.getenv("RATE_LIMIT_ANALYZE", "30/minute")
limiter = Limiter(key_func=get_remote_address)
