"""
WebSocket server for Unity ↔ Python game communication.

Runs in a dedicated daemon thread with its own asyncio event loop so it
never blocks the PyWebView main thread or the HTTP server thread.

Protocol summary (all messages are UTF-8 JSON with a "type" field):

  Python → Unity
    session_init  — sent immediately after Unity sends hello; carries word list
    ping          — keepalive
    session_end   — server-initiated disconnect (user quit, process cleanup)

  Unity → Python
    hello         — first frame; claims a session by session_id
    word_result   — streaming single-word result during gameplay
    submit_results — full batch on game over; triggers FSRS updates
    pong          — keepalive reply

WebSocket port: 18766
"""

import asyncio
import json
import logging
import threading
import time
from typing import Optional, TYPE_CHECKING

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    _WS_AVAILABLE = True
except ImportError:
    _WS_AVAILABLE = False
    WebSocketServerProtocol = object  # type: ignore[assignment,misc]

if TYPE_CHECKING:
    from gui.game_service import GameSessionManager

WS_HOST = "127.0.0.1"
WS_PORT = 18766
PING_INTERVAL_S = 20

logger = logging.getLogger(__name__)


class GameWsServer:
    """
    asyncio WebSocket server that runs in a background daemon thread.

    Thread safety:
    - self._connections is modified only inside coroutines on self._loop
      (no extra lock needed there).
    - Sync callers (from any thread) schedule work via
      asyncio.run_coroutine_threadsafe(coro, self._loop).
    """

    def __init__(self):
        self._loop:        Optional[asyncio.AbstractEventLoop] = None
        self._thread:      Optional[threading.Thread]          = None
        self._server       = None
        self._connections: dict[str, WebSocketServerProtocol]  = {}
        self._game_service: Optional["GameSessionManager"]     = None
        self._running      = False

    def set_game_service(self, game_service: "GameSessionManager"):
        """
        Called from main.py after both objects are constructed.
        Must be called before any Unity client connects.
        """
        self._game_service = game_service

    def start(self):
        """Start the WebSocket server in a background daemon thread."""
        if not _WS_AVAILABLE:
            logger.warning(
                "websockets package not installed — Unity WS server disabled. "
                "Run: pip install websockets>=12.0"
            )
            return
        if self._running:
            return
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
            name="game-ws-server",
        )
        self._thread.start()
        self._running = True
        logger.info("GameWsServer started on ws://%s:%d", WS_HOST, WS_PORT)

    def get_status(self) -> dict:
        """
        Called from any thread (e.g. PyWebView API thread).
        Reads are safe due to Python's GIL and primitive types.
        """
        return {
            "running": self._running,
            "port":    WS_PORT,
            "url":     f"ws://{WS_HOST}:{WS_PORT}",
            "clients": len(self._connections),
        }

    def notify_session_ended(self, session_id: str):
        """
        Called from GameSessionManager._unity_watcher (any thread) when
        the Unity process exits. Schedules a graceful close on the WS loop.
        """
        if self._loop and self._running:
            asyncio.run_coroutine_threadsafe(
                self._close_session_connection(session_id, reason="process_exit"),
                self._loop,
            )

    # ── Private: event-loop thread ─────────────────────────────────────────

    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())

    async def _serve(self):
        async with websockets.serve(
            self._handle_connection,
            WS_HOST,
            WS_PORT,
            ping_interval=PING_INTERVAL_S,
            ping_timeout=10,
        ) as server:
            self._server = server
            await asyncio.Future()   # run forever

    # ── Private: per-connection handler ───────────────────────────────────

    async def _handle_connection(self, ws: WebSocketServerProtocol):
        session_id: Optional[str] = None
        try:
            # --- handshake: first message must be "hello" ---
            raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            msg = json.loads(raw)

            if msg.get("type") != "hello":
                await ws.send(json.dumps({
                    "type": "error",
                    "message": "Expected hello as first message",
                }))
                return

            session_id = msg.get("session_id")
            if not session_id or not self._game_service:
                await ws.send(json.dumps({
                    "type": "error",
                    "message": "No active game service",
                }))
                return

            # Validate session exists
            with self._game_service._lock:
                session = self._game_service._sessions.get(session_id)

            if not session:
                await ws.send(json.dumps({
                    "type": "error",
                    "message": f"Session '{session_id}' not found",
                }))
                return

            # Register connection
            self._connections[session_id] = ws
            logger.info(
                "Unity client connected for session %s (game=%s)",
                session_id, session.game_id,
            )

            # Push word list to Unity
            await ws.send(json.dumps({
                "type":       "session_init",
                "session_id": session_id,
                "game_id":    session.game_id,
                "words":      session.words,
                "config":     session.config,
            }))

            # --- message loop ---
            async for raw in ws:
                try:
                    await self._handle_message(session_id, json.loads(raw))
                except json.JSONDecodeError:
                    logger.warning("Non-JSON message from session %s", session_id)

        except asyncio.TimeoutError:
            logger.warning("Unity connection timed out waiting for hello")
        except websockets.exceptions.ConnectionClosed:
            logger.info("Unity disconnected for session %s", session_id)
        except Exception as e:
            logger.exception("WS handler error for session %s: %s", session_id, e)
        finally:
            if session_id and session_id in self._connections:
                del self._connections[session_id]
                logger.debug("Removed connection for session %s", session_id)

    async def _handle_message(self, session_id: str, msg: dict):
        msg_type = msg.get("type")

        if msg_type == "pong":
            return  # keepalive reply — nothing to do

        elif msg_type == "word_result":
            # Streaming single-word result (optional; logged for debugging)
            logger.debug(
                "word_result session=%s word=%s correct=%s elapsed=%.1fs",
                session_id, msg.get("word"), msg.get("correct"), msg.get("elapsed_s", 0),
            )

        elif msg_type == "submit_results":
            # Full batch from Unity on game-over
            results = msg.get("results", [])
            if self._game_service:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None,
                    self._game_service.submit_results,
                    session_id,
                    results,
                )

            ws = self._connections.get(session_id)
            if ws:
                await ws.send(json.dumps({
                    "type":       "submit_ack",
                    "session_id": session_id,
                }))
            logger.info(
                "Unity submitted %d results for session %s", len(results), session_id
            )

        else:
            logger.warning(
                "Unknown WS message type '%s' from session %s", msg_type, session_id
            )

    async def _close_session_connection(self, session_id: str, reason: str = "ended"):
        """Gracefully close a Unity client's connection. Runs on the WS loop."""
        ws = self._connections.get(session_id)
        if not ws:
            return
        try:
            await ws.send(json.dumps({
                "type":       "session_end",
                "session_id": session_id,
                "reason":     reason,
            }))
            await ws.close()
        except Exception:
            pass
