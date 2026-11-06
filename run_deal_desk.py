"""
Run the Deal Desk swarm against the synthetic RFP.

Uploads the RFP + past-wins + product-overview with the Files API and mounts
them read-only into the session at /mnt/session/uploads/. Every agent thread
shares that disk, so the coordinator hands specialists file paths instead of
pasted text. Streams events as they come in so you can watch the parallel
thread fan-out — this is the demo, narrate it live.

Saves the final transcript to outputs/.

Usage:
    python run_deal_desk.py
"""

import os
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

from deal_inputs import (
    build_user_message,
    is_input_file,
    mounted_file_ids,
    upload_inputs,
)


RFP_PATH = Path("synthetic-data/rfp-acme-corp.md")
OUTPUT_DIR = Path("outputs")


def main() -> None:
    load_dotenv()  # reads ANTHROPIC_API_KEY from .env when it isn't exported
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("Set ANTHROPIC_API_KEY before running.")

    if not Path(".coordinator_id").exists() or not Path(".environment_id").exists():
        raise SystemExit(
            "Missing .coordinator_id or .environment_id. Run "
            "create_specialists.py, upload_skills.py, then create_coordinator.py first."
        )

    coordinator_id = Path(".coordinator_id").read_text().strip()
    environment_id = Path(".environment_id").read_text().strip()

    client = Anthropic()

    print("Uploading RFP + supporting docs...")
    try:
        resources = upload_inputs(client, RFP_PATH)
    except FileNotFoundError as exc:
        raise SystemExit(str(exc))

    print(f"\nStarting session against coordinator {coordinator_id}...")
    session = client.beta.sessions.create(
        agent=coordinator_id,
        environment_id=environment_id,
        title="Deal Desk — Acme Corp RFP",
        resources=resources,
    )
    Path(".last_session_id").write_text(session.id)

    session_file_ids = mounted_file_ids(session)
    for r in session.resources or []:
        if getattr(r, "type", None) == "file":
            print(f"  mounted {r.mount_path:24s} ({r.file_id})")

    user_message = build_user_message(RFP_PATH)

    # Stream the events — this is the demo. Watch for parallel thread spawns.
    print("\n=== EVENT STREAM (this is the demo) ===\n")
    final_text_parts: list[str] = []

    with client.beta.sessions.events.stream(session.id) as stream:
        client.beta.sessions.events.send(
            session.id,
            events=[
                {
                    "type": "user.message",
                    "content": [{"type": "text", "text": user_message}],
                }
            ],
        )
        for event in stream:
            t = event.type
            if t == "session.thread_created":
                print(f"  [thread spawned]   {event.agent_name}", flush=True)
            elif t == "session.thread_status_running":
                name = getattr(event, "agent_name", "?")
                print(f"  [thread running]   {name}", flush=True)
            elif t == "agent.thread_message_received":
                print(f"  [reply ←]          {event.from_agent_name}", flush=True)
            elif t == "agent.thread_message_sent":
                print(f"  [delegate →]       {event.to_agent_name}", flush=True)
            elif t == "agent.message":
                for block in event.content:
                    if getattr(block, "type", None) == "text":
                        final_text_parts.append(block.text)
                        print(block.text, end="", flush=True)
            elif t == "agent.tool_use":
                print(f"\n  [tool: {getattr(event, 'name', '?')}]", flush=True)
            elif t == "session.status_idle":
                print("\n\n[swarm finished]")
                break

    OUTPUT_DIR.mkdir(exist_ok=True)
    transcript_path = OUTPUT_DIR / "coordinator-transcript.txt"
    transcript_path.write_text("".join(final_text_parts))
    print(f"\nCoordinator transcript saved to {transcript_path}")

    # Pull every file the agents produced in the container
    print("\nDownloading deliverables from the session container...")
    files = client.beta.files.list(
        scope_id=session.id,
        betas=["managed-agents-2026-04-01"],
    )
    file_count = 0
    for f in files.data:
        if is_input_file(f, session_file_ids, RFP_PATH):
            continue  # our own inputs, mounted at session creation
        # Skip Office lock/temp files (e.g. "~$proposal.docx") that can leak
        # into the container's outputs dir when a doc is opened for validation.
        if f.filename.startswith("~$") or f.filename.startswith("."):
            print(f"  skipping lock/temp file: {f.filename}")
            continue
        out_path = OUTPUT_DIR / f.filename
        print(f"  {f.filename}  ->  {out_path}")
        content = client.beta.files.download(f.id)
        content.write_to_file(str(out_path))
        file_count += 1

    if file_count == 0:
        print("  (no files found — agents may have produced text-only output)")
    else:
        print(f"\nDownloaded {file_count} file(s) to {OUTPUT_DIR}/")

    print(f"\nView the full session (including all sub-agent threads) at:")
    print(f"  https://platform.claude.com/sessions/{session.id}")


if __name__ == "__main__":
    main()
