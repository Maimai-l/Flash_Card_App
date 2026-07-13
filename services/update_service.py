"""
Self-update service: check GitHub Releases for a newer version and, on macOS,
download + swap the .app bundle via a detached updater script.

Kept separate from the API bridge so the update flow can evolve without
touching the (thin) js_api surface.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

RELEASES_API = "https://api.github.com/repos/Maimai-l/Flash_Card_App/releases/latest"
RELEASES_PAGE = "https://github.com/Maimai-l/Flash_Card_App/releases/latest"


class UpdateService:
    # Shared progress state for the active download (only one at a time).
    _progress = {"state": "idle", "pct": 0, "error": None}

    def check_for_updates(self) -> dict:
        import urllib.request
        import json as _json
        from version import APP_VERSION

        try:
            req = urllib.request.Request(
                RELEASES_API,
                headers={"User-Agent": "FlashCardApp-updater/1.0",
                         "Accept": "application/vnd.github+json"},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = _json.loads(resp.read().decode())

            latest_tag = data.get("tag_name", "").lstrip("v")
            release_notes = data.get("body", "").strip()
            download_url = data.get("html_url", RELEASES_PAGE)

            asset_url = None
            for asset in data.get("assets", []):
                name = asset.get("name", "").lower()
                if name.endswith(".zip") and "mac" in name:
                    asset_url = asset.get("browser_download_url")
                    break

            def _ver(v):
                try:
                    return tuple(int(x) for x in v.split("."))
                except Exception:
                    return (0,)

            return {
                "up_to_date": _ver(APP_VERSION) >= _ver(latest_tag),
                "current": APP_VERSION,
                "latest": latest_tag,
                "download_url": download_url,
                "asset_url": asset_url,
                "release_notes": release_notes[:400] if release_notes else "",
            }
        except Exception as e:
            return {"error": str(e)}

    def get_update_progress(self) -> dict:
        return dict(UpdateService._progress)

    def download_and_install_update(self, asset_url: str) -> dict:
        import sys
        import tempfile
        import threading
        import urllib.request
        import zipfile

        if not asset_url:
            return {"error": "No download URL available for this release."}

        UpdateService._progress = {"state": "downloading", "pct": 0, "error": None}

        def _run():
            try:
                cache_dir = Path(tempfile.gettempdir()) / "FlashCardApp_update"
                cache_dir.mkdir(parents=True, exist_ok=True)
                zip_path = cache_dir / "update.zip"
                extract_dir = cache_dir / "extracted"

                req = urllib.request.Request(asset_url, headers={"User-Agent": "FlashCardApp-updater/1.0"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    total = int(resp.headers.get("Content-Length", 0))
                    downloaded = 0
                    with open(zip_path, "wb") as f:
                        while True:
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total:
                                UpdateService._progress["pct"] = int(downloaded / total * 90)

                UpdateService._progress = {"state": "extracting", "pct": 90, "error": None}
                if not zipfile.is_zipfile(zip_path):
                    raise ValueError("Downloaded file is not a valid zip archive.")

                if getattr(sys, "frozen", False):
                    app_path = Path(sys.executable).parent.parent.parent
                else:
                    app_path = Path("/Applications/FlashCardApp.app")

                updater_path = cache_dir / "updater.sh"
                updater_path.write_text(_UPDATER_SH.format(
                    app_path=app_path, zip_path=zip_path, extract_dir=extract_dir))
                updater_path.chmod(0o755)

                UpdateService._progress = {"state": "launching", "pct": 100, "error": None}

                import subprocess
                subprocess.Popen(
                    ["bash", str(updater_path)], start_new_session=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                UpdateService._progress = {"state": "done", "pct": 100, "error": None}

                import time
                time.sleep(0.5)
                import webview
                webview.windows[0].destroy()
            except Exception as e:
                UpdateService._progress = {"state": "error", "pct": 0, "error": str(e)}

        threading.Thread(target=_run, daemon=True).start()
        return {"ok": True}


_UPDATER_SH = """#!/bin/bash
set -e
APP_PATH="{app_path}"
ZIP_PATH="{zip_path}"
EXTRACT_DIR="{extract_dir}"

sleep 2

rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
unzip -o "$ZIP_PATH" -d "$EXTRACT_DIR"

EXTRACTED_APP=$(find "$EXTRACT_DIR" -name "*.app" -maxdepth 3 | head -1)
if [ -z "$EXTRACTED_APP" ]; then
    echo "ERROR: No .app found in zip" >&2
    exit 1
fi

APP_PARENT=$(dirname "$APP_PATH")
rm -rf "$APP_PATH"
cp -R "$EXTRACTED_APP" "$APP_PARENT/"

xattr -cr "$APP_PATH" 2>/dev/null || true

open "$APP_PATH"

rm -rf "$EXTRACT_DIR" "$ZIP_PATH"
"""
