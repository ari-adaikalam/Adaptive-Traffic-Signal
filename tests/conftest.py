import json
from pathlib import Path

import pytest

VECTORS = Path(__file__).parent / "vectors"


@pytest.fixture(scope="session")
def load_vectors():
    def load(name: str):
        return json.loads((VECTORS / name).read_text())
    return load
