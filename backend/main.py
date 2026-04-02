from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from config import CORS_ORIGINS, DEBUG, SESSION_SECRET
from routers import topics, targets, observations, photometry, lightcurve, transit, auth, records

app = FastAPI(title="EASWA API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET)

app.include_router(auth.router, prefix="/api")
app.include_router(topics.router, prefix="/api")
app.include_router(targets.router, prefix="/api")
app.include_router(observations.router, prefix="/api")
app.include_router(photometry.router, prefix="/api")
app.include_router(lightcurve.router, prefix="/api")
app.include_router(transit.router, prefix="/api")
app.include_router(records.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------- Serve frontend build ----------
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if DEBUG:
    print(f"[EASWA] Frontend dist path: {FRONTEND_DIST}")
    print(f"[EASWA] Frontend dist exists: {FRONTEND_DIST.exists()}")

if FRONTEND_DIST.exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{path:path}")
    async def serve_spa(request: Request, path: str):
        # Serve actual file if it exists, otherwise index.html (SPA)
        file_path = FRONTEND_DIST / path
        if path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(
            FRONTEND_DIST / "index.html",
            headers={"Cache-Control": "no-store, max-age=0"},
        )
else:
    @app.get("/")
    def no_frontend():
        return {"error": "frontend/dist not found", "path": str(FRONTEND_DIST)}
