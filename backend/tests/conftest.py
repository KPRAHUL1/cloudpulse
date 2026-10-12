"""Test configuration.

The backend modules import each other as top-level packages (`from config
import Config`), matching how app.py runs, so `backend/` has to be on the path.
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
