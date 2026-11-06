"""
How the deal inputs reach a Deal Desk session. Shared by run_deal_desk.py and
swarm_runner.py (the web UI) so both start sessions the same way.

Agents in a multi-agent session share one container filesystem but not a
conversation, so the inputs are uploaded with the Files API and mounted
read-only at /mnt/session/uploads/<name>. The coordinator is given their paths
and passes those paths (not the text) to each specialist.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
SUPPORTING_FILES = [
    ROOT / "synthetic-data" / "past-wins.json",
    ROOT / "synthetic-data" / "product-overview.md",
]

# A file mounted with mount_path "/name.ext" appears here inside the container.
UPLOADS_DIR = "/mnt/session/uploads"
# Originals only need to outlive session creation; the session keeps its own copy.
UPLOAD_TTL_SECONDS = 86_400


def input_files(rfp_path: Path) -> list[Path]:
    return [rfp_path, *SUPPORTING_FILES]


def container_path(path: Path) -> str:
    return f"{UPLOADS_DIR}/{path.name}"


def upload_inputs(client, rfp_path: Path, log=print) -> list[dict]:
    """Upload the RFP and supporting files; return session `resources` that mount them."""
    paths = input_files(rfp_path)
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Missing input file(s): {', '.join(missing)}")

    resources = []
    for path in paths:
        uploaded = client.files.upload(
            file=(path.name, path.read_bytes(), "text/plain"),
            expires_in_seconds=UPLOAD_TTL_SECONDS,
        )
        log(f"  uploaded {path.name:24s} -> {uploaded.id}")
        resources.append(
            {"type": "file", "file_id": uploaded.id, "mount_path": f"/{path.name}"}
        )
    return resources


def mounted_file_ids(session) -> set[str]:
    return {
        r.file_id for r in (session.resources or []) if getattr(r, "type", None) == "file"
    }


def is_input_file(f, session_file_ids: set[str], rfp_path: Path) -> bool:
    """True for a session file that is one of our mounted inputs, not a deliverable."""
    return f.id in session_file_ids or f.filename in {p.name for p in input_files(rfp_path)}


def build_user_message(rfp_path: Path) -> str:
    past_wins, product_overview = SUPPORTING_FILES
    return (
        "An RFP has just landed. The inputs are already on the shared disk, "
        "mounted read-only:\n"
        f"- RFP: {container_path(rfp_path)}\n"
        f"- Comparable past deals: {container_path(past_wins)}\n"
        f"- Product capability map: {container_path(product_overview)}\n\n"
        "Please run the standard Deal Desk process:\n"
        "1. Read the RFP at the path above.\n"
        "2. Delegate to all four specialists in one turn, following the "
        "delegation contract: pass file paths, not file contents.\n"
        "3. Synthesise from the specialists' report files.\n"
        "4. Produce the final proposal response as a branded Word document "
        "if you have access to a docx skill; otherwise output the response "
        "as a structured markdown document.\n\n"
        "Specialists have their own skills attached for their respective "
        "domains. Move fast — the RFP deadline is real."
    )
