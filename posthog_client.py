"""Process-wide PostHog client for the Streamlit application."""

import atexit
import os

from dotenv import load_dotenv
from posthog import Posthog


load_dotenv()

_PROJECT_TOKEN = os.getenv("POSTHOG_PROJECT_TOKEN")
_HOST = os.getenv("POSTHOG_HOST")
_ENVIRONMENT = os.getenv("ENVIRONMENT", os.getenv("APP_ENV", "development")).lower()


posthog_client = None
if _PROJECT_TOKEN and _HOST:
    posthog_client = Posthog(
        _PROJECT_TOKEN,
        host=_HOST,
        enable_exception_autocapture=True,
    )
    atexit.register(posthog_client.shutdown)
elif _ENVIRONMENT not in {"production", "prod"}:
    missing = "POSTHOG_PROJECT_TOKEN" if not _PROJECT_TOKEN else "POSTHOG_HOST"
    raise RuntimeError(
        f"{missing} variable required by PostHog is missing or un-configured, "
        f"this causes events to be silently missed. This error stops appearing "
        f"once {missing} is configured"
    )
