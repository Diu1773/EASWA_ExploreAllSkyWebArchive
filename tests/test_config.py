import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import config


def test_load_dotenv_file_sets_missing_values_only(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "\n".join(
            [
                "# comment",
                "NEW_FLAG=true",
                'QUOTED_VALUE="hello world"',
                "export KEEP_ME=file-value",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.delenv("NEW_FLAG", raising=False)
    monkeypatch.delenv("QUOTED_VALUE", raising=False)
    monkeypatch.setenv("KEEP_ME", "process-value")

    config._load_dotenv_file(env_path)

    assert os.environ["NEW_FLAG"] == "true"
    assert os.environ["QUOTED_VALUE"] == "hello world"
    assert os.environ["KEEP_ME"] == "process-value"
