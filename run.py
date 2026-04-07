"""EASWA — python run.py 하나로 로컬 개발 서버 실행."""

import argparse
import importlib
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"

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
DEFAULT_FRONTEND_DEV_PORT = int(os.getenv("EASWA_FRONTEND_DEV_PORT", "5173"))
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


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the EASWA local development servers.")
    parser.add_argument(
        "--backend-only",
        action="store_true",
        help="Run only the backend server and skip the frontend Vite dev server.",
    )
    parser.add_argument(
        "--frontend-port",
        type=int,
        default=DEFAULT_FRONTEND_DEV_PORT,
        help=f"Port for the frontend Vite dev server (default: {DEFAULT_FRONTEND_DEV_PORT}).",
    )
    return parser.parse_args()


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


def _npm_command() -> list[str] | None:
    if os.name == "nt":
        if shutil.which("npm.cmd"):
            return ["cmd", "/c", "npm"]
        return None
    if shutil.which("npm"):
        return ["npm"]
    return None


def _start_frontend_dev_server(port: int) -> subprocess.Popen[str] | None:
    if not FRONTEND_DIR.exists():
        print("[EASWA] Frontend directory not found. Skipping Vite dev server.")
        return None

    npm_command = _npm_command()
    if npm_command is None:
        print("[EASWA] npm not found. Skipping Vite dev server.")
        return None

    command = [
        *npm_command,
        "run",
        "dev",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        str(port),
    ]
    try:
        return subprocess.Popen(command, cwd=FRONTEND_DIR)
    except OSError as error:
        print(f"[EASWA] Failed to start Vite dev server: {error}")
        return None


def main():
    args = _parse_args()
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
    frontend_process: subprocess.Popen[str] | None = None

    if not args.backend_only:
        frontend_process = _start_frontend_dev_server(args.frontend_port)

    if frontend_process is not None:
        print(f"[EASWA] Frontend: http://localhost:{args.frontend_port}")
    print(f"[EASWA] Backend:  http://localhost:{DEFAULT_PORT}")
    if DEFAULT_HOST == "0.0.0.0" and lan_ip:
        if frontend_process is not None:
            print(f"[EASWA] Frontend LAN: http://{lan_ip}:{args.frontend_port}")
        print(f"[EASWA] Backend LAN:  http://{lan_ip}:{DEFAULT_PORT}")
        print("[EASWA] 같은 와이파이의 다른 기기에서는 위 LAN 주소로 접속하세요")
    if frontend_process is not None:
        print(
            f"[EASWA] UI는 http://localhost:{args.frontend_port} 로 접속하세요. "
            "API는 Vite proxy로 연결됩니다."
        )
    else:
        print("[EASWA] UI는 http://localhost:5895 로 접속하세요.")
    print("[EASWA] Ctrl+C to stop\n")

    try:
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
    finally:
        if frontend_process is not None and frontend_process.poll() is None:
            frontend_process.terminate()
            try:
                frontend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                frontend_process.kill()


if __name__ == "__main__":
    main()
