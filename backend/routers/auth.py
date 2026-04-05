"""Google OAuth2 login endpoints with cookie-based sessions."""

from __future__ import annotations

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from config import (
    BASE_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
    SESSION_SECRET,
)
from db import upsert_user, get_user_by_id

router = APIRouter(tags=["auth"])

# Session cookie signer (no external store needed)
_signer = URLSafeTimedSerializer(SESSION_SECRET)
_SESSION_COOKIE = "easwa_session"
_SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

# OAuth setup
oauth = OAuth()
oauth.register(
    name="google",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def _set_session_cookie(response: JSONResponse | RedirectResponse, user_id: int) -> None:
    token = _signer.dumps({"uid": user_id})
    response.set_cookie(
        key=_SESSION_COOKIE,
        value=token,
        max_age=_SESSION_MAX_AGE,
        httponly=True,
        samesite=SESSION_COOKIE_SAMESITE,
        secure=SESSION_COOKIE_SECURE,
    )


def get_current_user(request: Request) -> dict | None:
    """Extract the current user from the session cookie. Returns None if not logged in."""
    token = request.cookies.get(_SESSION_COOKIE)
    if not token:
        return None
    try:
        data = _signer.loads(token, max_age=_SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return get_user_by_id(data["uid"])


@router.get("/auth/login")
async def login(request: Request):
    """Redirect the user to Google's consent screen."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.")
    redirect_uri = f"{BASE_URL}/api/auth/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback")
async def callback(request: Request):
    """Handle the OAuth callback from Google."""
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if not userinfo:
        raise HTTPException(status_code=400, detail="Failed to get user info from Google.")

    user = upsert_user(
        google_id=userinfo["sub"],
        email=userinfo["email"],
        name=userinfo.get("name", userinfo["email"]),
        picture=userinfo.get("picture"),
    )

    # Redirect to frontend home with session cookie
    response = RedirectResponse(url="/", status_code=302)
    _set_session_cookie(response, user["id"])
    return response


@router.get("/auth/me")
async def me(request: Request):
    """Return the currently logged-in user, or 401."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "picture": user["picture"],
    }


@router.post("/auth/logout")
async def logout():
    """Clear the session cookie."""
    response = JSONResponse({"ok": True})
    response.delete_cookie(_SESSION_COOKIE)
    return response
