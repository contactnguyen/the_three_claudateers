"""
Voice agent for the finished proposal.

Same voice stack and credentials as voice.oracle-aicoe.com/sky: OCI Generative AI's
OpenAI-compatible realtime endpoint (`openai.gpt-realtime`, voice `marin`,
`gpt-4o-transcribe` for the user's words). The Sky project runs it behind LiveKit;
here the browser talks to this Flask app over one WebSocket and the app relays to
OCI, so the API key never reaches the page.

    browser  --(PCM16 24 kHz, JSON)-->  /api/voice/<job_id>  --(realtime events)-->  OCI

The session only opens for a job whose Word document exists: the document's text
becomes the agent's instructions, so a voice session without one would have
nothing to ground on.

OCI only, never OpenAI-direct: the Sky contract records that OpenAI-direct bills a
personal account, so there is deliberately no fallback here.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Callable

import mammoth

log = logging.getLogger("dealdesk.voice")

DEFAULT_WS_URL = "wss://inference.generativeai.us-ashburn-1.oci.oraclecloud.com/openai/v1/realtime"
MAX_DOC_CHARS = 60_000           # ~15k tokens; gpt-realtime's context is 32k
MAX_SESSION_SECONDS = 15 * 60    # hard stop so a forgotten tab does not run up a bill

# Browser -> OCI: the only event types the page may send. Everything else is dropped,
# so the page cannot rewrite the instructions or swap the model.
ALLOWED_FROM_BROWSER = {
    "input_audio_buffer.append",
    "response.cancel",
    "conversation.item.truncate",
}

# OCI -> browser: what the widget needs to play audio, show the transcript and barge in.
FORWARD_TO_BROWSER = {
    "session.updated",
    "input_audio_buffer.speech_started",
    "input_audio_buffer.speech_stopped",
    "conversation.item.input_audio_transcription.completed",
    "response.created",
    "response.output_item.added",
    "response.output_audio.delta",
    "response.output_audio_transcript.delta",
    "response.output_audio_transcript.done",
    "response.done",
    "error",
}


def voice_config() -> dict:
    return {
        "url": os.getenv("OCI_REALTIME_WS_URL", DEFAULT_WS_URL),
        "model": os.getenv("OCI_REALTIME_MODEL", "openai.gpt-realtime"),
        "key": os.getenv("OCI_REALTIME_API_KEY", ""),
        "voice": os.getenv("REALTIME_VOICE", "marin"),
        "transcriber": os.getenv("INPUT_TRANSCRIBER", "gpt-4o-transcribe"),
        "noise": os.getenv("NOISE_REDUCTION", "near_field"),
    }


def voice_available() -> bool:
    return bool(voice_config()["key"])


def document_text(docx_path: str) -> str:
    with open(docx_path, "rb") as fh:
        text = mammoth.extract_raw_text(fh).value
    # mammoth separates every table cell with a blank line; collapse the runs
    lines = [ln.strip() for ln in text.splitlines()]
    out, blank = [], 0
    for ln in lines:
        blank = blank + 1 if not ln else 0
        if blank <= 1:
            out.append(ln)
    text = "\n".join(out).strip()
    if len(text) > MAX_DOC_CHARS:
        text = text[:MAX_DOC_CHARS] + "\n\n[... document truncated for the voice session ...]"
    return text


def build_instructions(doc_name: str, doc_text: str) -> str:
    return f"""You are the Deal Desk voice assistant for BTS-Synthetic. The swarm has just
produced a proposal response document, "{doc_name}", and the deal team is asking you about it
out loud. The complete text of the document is below, between the DOCUMENT markers. It is your
only source of truth.

How to answer:
- Answer from the document. Quote figures, dates, names, percentages and clause positions exactly
  as written. When it helps, say which section the answer comes from.
- If the document does not cover something, say so plainly and, if useful, say what the closest
  thing it does cover is. Never invent numbers, commitments or facts that are not in the document.
- This is a spoken conversation: keep answers short (two to four sentences) unless asked for
  detail, no markdown, no bullet lists, no reading out tables cell by cell; summarise them.
- Language: reply in the language the user is speaking, whatever it is, and switch whenever they
  switch. Translate the document's content into that language; keep proper names, product names
  and currency amounts as they are.
- Stay on the document and this deal. Politely steer unrelated requests back to the proposal.

DOCUMENT START
{doc_text}
DOCUMENT END"""


GREETING = (
    "Greet the user in one or two short sentences in English: say the proposal document is ready, "
    "that you have read all of it, and that they can ask you anything about it in any language."
)


def _session_update(cfg: dict, instructions: str) -> dict:
    audio_in: dict = {
        "format": {"type": "audio/pcm", "rate": 24000},
        # no `language`: the transcriber auto-detects, so any language works
        "transcription": {"model": cfg["transcriber"]},
        "turn_detection": {
            "type": "semantic_vad", "eagerness": "low",
            "create_response": True, "interrupt_response": True,
        },
    }
    if cfg["noise"] and cfg["noise"] != "none":
        audio_in["noise_reduction"] = {"type": cfg["noise"]}
    # OCI requires the GA session schema (session.type = "realtime"); it rejects the
    # legacy beta shape with `missing_required_parameter: 'session.type'`.
    return {"type": "session.update", "session": {
        "type": "realtime",
        "output_modalities": ["audio"],
        "instructions": instructions,
        "audio": {
            "input": audio_in,
            "output": {"format": {"type": "audio/pcm", "rate": 24000}, "voice": cfg["voice"]},
        },
    }}


def run_bridge(browser_ws, doc_name: str, doc_text: str) -> None:
    """Relay one voice session between the browser socket and OCI until either side closes."""
    from websockets.sync.client import connect

    cfg = voice_config()
    send_lock = threading.Lock()

    def to_browser(obj: dict) -> None:
        with send_lock:
            browser_ws.send(json.dumps(obj))

    if not cfg["key"]:
        to_browser({"type": "bridge.error", "message": "Voice is not configured (OCI_REALTIME_API_KEY is unset)."})
        return

    try:
        upstream = connect(
            f"{cfg['url']}?model={cfg['model']}",
            additional_headers={"Authorization": f"Bearer {cfg['key']}"},
            open_timeout=15, max_size=None,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("OCI realtime connect failed: %s", exc)
        to_browser({"type": "bridge.error", "message": f"Could not reach the voice service: {exc}"})
        return

    stop = threading.Event()
    started = time.monotonic()
    try:
        upstream.send(json.dumps(_session_update(cfg, build_instructions(doc_name, doc_text))))
        upstream.send(json.dumps({"type": "response.create", "response": {"instructions": GREETING}}))
        to_browser({"type": "bridge.ready", "model": cfg["model"], "voice": cfg["voice"]})

        def pump_upstream() -> None:
            try:
                for raw in upstream:
                    msg = json.loads(raw)
                    if msg.get("type") in FORWARD_TO_BROWSER:
                        to_browser(msg)
                    if msg.get("type") == "error":
                        log.warning("OCI realtime error: %s", msg.get("error"))
            except Exception as exc:  # noqa: BLE001
                if not stop.is_set():
                    log.info("upstream closed: %s", exc)
                    try:
                        to_browser({"type": "bridge.error", "message": "The voice service closed the session."})
                    except Exception:  # noqa: BLE001
                        pass
            finally:
                stop.set()

        threading.Thread(target=pump_upstream, daemon=True).start()

        while not stop.is_set():
            if time.monotonic() - started > MAX_SESSION_SECONDS:
                to_browser({"type": "bridge.error", "message": "Voice session time limit reached."})
                break
            raw = browser_ws.receive(timeout=1)
            if raw is None:
                continue
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if msg.get("type") in ALLOWED_FROM_BROWSER:
                upstream.send(json.dumps(msg))
    except Exception as exc:  # noqa: BLE001 - browser went away, or a send failed
        log.info("voice bridge ended: %s", exc)
    finally:
        stop.set()
        try:
            upstream.close()
        except Exception:  # noqa: BLE001
            pass


def register(app, sock, find_document: Callable[[str], tuple[str, str] | None]) -> None:
    """Mount the voice routes. `find_document(job_id)` returns (name, docx_path) or None."""
    from flask import jsonify

    @app.get("/api/voice/status/<job_id>")
    def voice_status(job_id: str):
        doc = find_document(job_id)
        return jsonify({"available": voice_available() and doc is not None,
                        "configured": voice_available(), "document": doc[0] if doc else None})

    @sock.route("/api/voice/<job_id>")
    def voice_socket(ws, job_id: str):
        doc = find_document(job_id)
        if doc is None:
            # Gate: no finished document, no conversation.
            ws.send(json.dumps({"type": "bridge.error",
                                "message": "The voice agent starts once the document has been produced."}))
            return
        name, path = doc
        run_bridge(ws, name, document_text(path))
