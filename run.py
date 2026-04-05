"""EASWA — python run.py 하나로 서버 실행."""

import importlib
import os
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
BACKEND_DIR = ROOT / "backend"

# .env 파일 자동 로드
_env_file = BACKEND_DIR / ".env"
if _env_file.exists():
    for line in _env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and value and key not in os.environ:
            os.environ[key] = value
DEFAULT_HOST = os.getenv("EASWA_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.getenv("EASWA_PORT", "5895"))
_REQUIRED_BACKEND_MODULES = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn[standard]",
    "numpy": "numpy",
    "astropy": "astropy",
    "PIL": "pillow",
    "scipy": "scipy",
    "batman": "batman-package",
    "emcee": "emcee",
}


def _detect_lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass

    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET)
        for info in infos:
            ip = info[4][0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass

    return None


def _find_missing_backend_modules() -> list[str]:
    missing: list[str] = []
    for module_name, package_name in _REQUIRED_BACKEND_MODULES.items():
        try:
            importlib.import_module(module_name)
        except ImportError:
            missing.append(package_name)
    return missing


def main():
    missing_packages = _find_missing_backend_modules()
    if missing_packages:
        print(
            "[EASWA] Installing missing backend dependencies: "
            + ", ".join(sorted(set(missing_packages)))
        )
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", str(BACKEND_DIR / "requirements.txt")],
            check=True,
        )

    lan_ip = _detect_lan_ip()

    print(f"[EASWA] Local: http://localhost:{DEFAULT_PORT}")
    if DEFAULT_HOST == "0.0.0.0" and lan_ip:
        print(f"[EASWA] LAN:   http://{lan_ip}:{DEFAULT_PORT}")
        print("[EASWA] 같은 와이파이의 다른 기기에서는 위 LAN 주소로 접속하세요")
    print("[EASWA] Ctrl+C to stop\n")

    subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--reload",
            "--host",
            DEFAULT_HOST,
            "--port",
            str(DEFAULT_PORT),
        ],
        cwd=BACKEND_DIR,
    )


if __name__ == "__main__":
    main()
