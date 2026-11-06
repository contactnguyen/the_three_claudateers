"""
Reusable Deal Desk runner for the web UI.

`run_swarm()` does what run_deal_desk.py does, but reports progress through an
`emit(dict)` callback instead of printing. `run_demo()` replays a scripted run
so the UI can be developed and demoed without an API key or a 5 minute wait.

Event dicts emitted (all have "type"):
    status     {msg}                     coarse progress line for the quest log
    delegate   {agent}                   orchestrator briefs a specialist
    reply      {agent, text}             specialist answers back
    tool       {name}                    a tool is running (docx building etc.)
    message    {text}                    coordinator prose
    done       {files: [{name, path}]}   finished, files saved locally
    error      {msg}
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).parent
SUPPORTING_FILES = [
    ROOT / "synthetic-data" / "past-wins.json",
    ROOT / "synthetic-data" / "product-overview.md",
]
BETA = "managed-agents-2026-04-01"

Emit = Callable[[dict], None]


def build_context(rfp_path: Path) -> str:
    blocks = []
    for path in [rfp_path, *SUPPORTING_FILES]:
        if path.exists():
            blocks.append(f"=====  DOCUMENT: {path.name}  =====\n{path.read_text()}")
    return "\n\n".join(blocks)


def _text_of(content) -> str:
    """Pull plain text out of an event's content (string or list of blocks)."""
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "".join(parts)


def run_swarm(rfp_path: Path, out_dir: Path, emit: Emit) -> None:
    from anthropic import Anthropic

    coord_file, env_file = ROOT / ".coordinator_id", ROOT / ".environment_id"
    if not coord_file.exists() or not env_file.exists():
        raise RuntimeError(
            "Missing .coordinator_id or .environment_id. Run create_specialists.py, "
            "upload_skills.py and create_coordinator.py first."
        )
    client = Anthropic()

    emit({"type": "status", "msg": f"Reading {rfp_path.name}"})
    session = client.beta.sessions.create(
        agent=coord_file.read_text().strip(),
        environment_id=env_file.read_text().strip(),
        title=f"Deal Desk (web) - {rfp_path.stem}",
    )
    (ROOT / ".last_session_id").write_text(session.id)

    user_message = (
        "An RFP has just landed. Please run the standard Deal Desk process:\n"
        "1. Read the RFP yourself.\n"
        "2. Delegate to all four specialists in parallel.\n"
        "3. Synthesise their replies.\n"
        "4. Produce the final proposal response as a branded Word document "
        "if you have access to a docx skill; otherwise output the response "
        "as a structured markdown document.\n\n"
        "Specialists have their own skills attached for their respective "
        "domains. Move fast, the RFP deadline is real.\n\n"
        f"{build_context(rfp_path)}"
    )

    with client.beta.sessions.events.stream(session.id) as stream:
        client.beta.sessions.events.send(
            session.id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": user_message}]}],
        )
        for event in stream:
            t = event.type
            if t == "agent.thread_message_sent":
                emit({"type": "delegate", "agent": event.to_agent_name})
            elif t == "agent.thread_message_received":
                emit({
                    "type": "reply",
                    "agent": event.from_agent_name,
                    "text": _text_of(getattr(event, "content", None)),
                })
            elif t == "agent.message":
                text = _text_of(event.content)
                if text:
                    emit({"type": "message", "text": text})
            elif t == "agent.tool_use":
                emit({"type": "tool", "name": getattr(event, "name", "tool")})
            elif t == "session.status_idle":
                break

    emit({"type": "status", "msg": "Collecting deliverables"})
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in client.beta.files.list(scope_id=session.id, betas=[BETA]).data:
        dest = out_dir / f.filename
        client.beta.files.download(f.id).write_to_file(str(dest))
        saved.append({"name": f.filename, "path": str(dest)})
    emit({"type": "done", "files": saved, "session_id": session.id})


# --------------------------------------------------------------------------- demo

DEMO_SCRIPT = [
    (1.0, {"type": "status", "msg": "Reading the RFP"}),
    (5.0, {"type": "status", "msg": "RFP read, briefing the team"}),
    (0.5, {"type": "delegate", "agent": "Pricing Specialist"}),
    (0.5, {"type": "delegate", "agent": "Legal Reviewer"}),
    (0.5, {"type": "delegate", "agent": "Technical Fit Specialist"}),
    (0.5, {"type": "delegate", "agent": "Competitive Intel Analyst"}),
    (9.0, {"type": "reply", "agent": "Competitive Intel Analyst",
           "text": "Biggest threat is Microsoft Fabric. Lock the CDO early on real-time ingest."}),
    (4.0, {"type": "reply", "agent": "Legal Reviewer",
           "text": "Two reds (liability, SLA termination), five ambers with counters."}),
    (4.0, {"type": "reply", "agent": "Technical Fit Specialist",
           "text": "Strong fit. Partial on connector breadth and ML depth."}),
    (4.0, {"type": "reply", "agent": "Pricing Specialist",
           "text": "Open at 25%, ceiling 30%, 30% Y1 then 25% Y2-3 plus migration credit."}),
    (1.0, {"type": "status", "msg": "Synthesising the proposal"}),
    (0.5, {"type": "tool", "name": "bash"}),
    (12.0, {"type": "tool", "name": "write"}),
]


def run_demo(out_dir: Path, emit: Emit, speed: float = 1.0) -> None:
    for delay, ev in DEMO_SCRIPT:
        time.sleep(delay / speed)
        emit(dict(ev))
    out_dir.mkdir(parents=True, exist_ok=True)
    sample = next(iter(sorted(ROOT.glob("outputs-run2-branded/*.docx"))), None)
    files = []
    if sample:
        dest = out_dir / sample.name
        dest.write_bytes(sample.read_bytes())
        files.append({"name": sample.name, "path": str(dest)})
    emit({"type": "done", "files": files, "session_id": "demo"})
