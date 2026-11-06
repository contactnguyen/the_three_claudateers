"""
Web UI for the Deal Desk swarm.

    python webapp/app.py            # real runs (needs ANTHROPIC_API_KEY + agent ids)
    python webapp/app.py --demo     # scripted ~45s replay, no API calls

Open http://127.0.0.1:5000
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import uuid
from pathlib import Path

import mammoth
from dotenv import load_dotenv
from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import swarm_runner  # noqa: E402

load_dotenv(ROOT / ".env")

app = Flask(__name__, static_folder="static", static_url_path="/static")
OUT_ROOT = ROOT / "outputs" / "web"
RFP_DIR = ROOT / "synthetic-data"
DEMO = False
DEMO_SPEED = 1.0


class Job:
    def __init__(self, rfp: Path):
        self.id = uuid.uuid4().hex[:12]
        self.rfp = rfp
        self.events: list[dict] = []
        self.replies: list[dict] = []
        self.files: list[dict] = []
        self.finished = False
        self.cond = threading.Condition()

    def emit(self, ev: dict) -> None:
        with self.cond:
            if ev["type"] == "reply":
                self.replies.append({"agent": ev["agent"], "text": ev.get("text", "")})
            if ev["type"] == "done":
                self.files = ev["files"]
            self.events.append(ev)
            if ev["type"] in ("done", "error"):
                self.finished = True
            self.cond.notify_all()

    def run(self) -> None:
        out_dir = OUT_ROOT / self.id
        try:
            if DEMO:
                swarm_runner.run_demo(out_dir, self.emit, DEMO_SPEED)
            else:
                swarm_runner.run_swarm(self.rfp, out_dir, self.emit)
        except Exception as exc:  # surface any failure to the UI
            self.emit({"type": "error", "msg": str(exc)})


JOBS: dict[str, Job] = {}


def rfp_files() -> list[Path]:
    return sorted(RFP_DIR.glob("rfp-*.md"))


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/config")
def config():
    return jsonify({
        "demo": DEMO,
        "rfps": [{"id": p.name, "label": p.stem.removeprefix("rfp-").replace("-", " ").title()}
                 for p in rfp_files()],
    })


@app.post("/api/generate")
def generate():
    rfp_id = (request.get_json(silent=True) or {}).get("rfp", "")
    rfp = next((p for p in rfp_files() if p.name == rfp_id), None)
    if rfp is None:
        abort(400, "Unknown RFP")
    job = Job(rfp)
    JOBS[job.id] = job
    threading.Thread(target=job.run, daemon=True).start()
    return jsonify({"job": job.id})


@app.get("/api/events/<job_id>")
def events(job_id: str):
    job = JOBS.get(job_id) or abort(404)

    def stream():
        i = 0
        while True:
            with job.cond:
                while i >= len(job.events) and not job.finished:
                    job.cond.wait(timeout=15)
                    if i >= len(job.events) and not job.finished:
                        yield ": keepalive\n\n"
                batch, i = job.events[i:], len(job.events)
                finished = job.finished
            for ev in batch:
                # replies carry long text; the UI only needs it in the result view
                slim = {k: v for k, v in ev.items() if k != "text"} if ev["type"] == "reply" else ev
                yield f"data: {json.dumps(slim)}\n\n"
            if finished and i >= len(job.events):
                return

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/result/<job_id>")
def result(job_id: str):
    job = JOBS.get(job_id) or abort(404)
    docx = next((f for f in job.files if f["name"].lower().endswith(".docx")), None)
    html = None
    if docx:
        with open(docx["path"], "rb") as fh:
            html = mammoth.convert_to_html(fh).value
    return jsonify({
        "html": html,
        "specialists": job.replies,
        "files": [{"name": f["name"], "url": f"/api/download/{job.id}/{f['name']}"} for f in job.files],
    })


@app.get("/api/download/<job_id>/<name>")
def download(job_id: str, name: str):
    job = JOBS.get(job_id) or abort(404)
    match = next((f for f in job.files if f["name"] == name), None) or abort(404)
    return send_file(match["path"], as_attachment=True, download_name=name)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="replay a scripted run, no API calls")
    ap.add_argument("--speed", type=float, default=1.0, help="demo speed multiplier")
    ap.add_argument("--port", type=int, default=5000)
    args = ap.parse_args()
    DEMO, DEMO_SPEED = args.demo, args.speed
    app.run(host="127.0.0.1", port=args.port, threaded=True)
