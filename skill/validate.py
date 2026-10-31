#!/usr/bin/env python3
"""Validates a tour file against the tour format and the repository's real diff.

Usage: validate.py <tour.json> [--repo <path>]

Exits 0 when the tour is valid, 1 with one problem per line otherwise.
Uses only the standard library.
"""

import argparse
import json
import re
import subprocess
import sys

HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
STEP_ID = re.compile(r"^[a-z0-9-]+$")
TOP_LEVEL = {"version", "branch", "base", "base_sha", "head_sha", "author", "created_at",
             "intent", "reading_order", "steps", "concerns"}
STEP_KEYS = {"id", "tag", "hotspot", "title", "why", "check", "anchors"}
ANCHOR_KEYS = {"file", "side", "start", "end"}


def git(repo, *args):
    result = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def changed_lines(repo, base, head, path):
    """Line numbers touched by the diff, per side, including the hunk context."""
    lines = {"old": set(), "new": set()}
    for line in git(repo, "diff", "--no-ext-diff", "--no-color", base, head, "--", path).splitlines():
        match = HUNK.match(line)
        if not match:
            continue
        old_start, old_len, new_start, new_len = match.groups()
        old_start, new_start = int(old_start), int(new_start)
        old_len = 1 if old_len is None else int(old_len)
        new_len = 1 if new_len is None else int(new_len)
        lines["old"].update(range(old_start, old_start + old_len))
        lines["new"].update(range(new_start, new_start + new_len))
    return lines


def check_anchor(anchor, where, problems):
    if not isinstance(anchor, dict):
        problems.append(f"{where}: must be an object")
        return False
    unknown = set(anchor) - ANCHOR_KEYS
    if unknown:
        problems.append(f"{where}: unknown fields {sorted(unknown)}")
    for key in ("file", "start", "end"):
        if key not in anchor:
            problems.append(f"{where}: missing {key}")
            return False
    if anchor.get("side", "new") not in ("new", "old"):
        problems.append(f"{where}: side must be new or old")
        return False
    if not (isinstance(anchor["start"], int) and isinstance(anchor["end"], int)) or anchor["start"] < 1 or anchor["end"] < anchor["start"]:
        problems.append(f"{where}: start and end must be integers with 1 <= start <= end")
        return False
    return True


def validate(tour, repo):
    problems = []
    if not isinstance(tour, dict):
        return ["tour must be a JSON object"]
    unknown = set(tour) - TOP_LEVEL
    if unknown:
        problems.append(f"unknown top-level fields {sorted(unknown)}")
    missing = {"version", "branch", "base", "base_sha", "head_sha", "intent", "reading_order", "steps", "concerns"} - set(tour)
    if missing:
        return problems + [f"missing top-level fields {sorted(missing)}"]
    if tour["version"] != 1:
        problems.append("version must be 1")
    for key in ("intent", "branch", "base"):
        if not isinstance(tour[key], str) or not tour[key].strip():
            problems.append(f"{key} must be a non-empty string")

    try:
        base = git(repo, "rev-parse", "--verify", f"{tour['base_sha']}^{{commit}}").strip()
        head = git(repo, "rev-parse", "--verify", f"{tour['head_sha']}^{{commit}}").strip()
    except RuntimeError as error:
        return problems + [f"base_sha/head_sha: {error}"]

    anchors = []
    for i, entry in enumerate(tour["reading_order"]):
        if not isinstance(entry, dict) or not {"file", "why"} <= set(entry):
            problems.append(f"reading_order[{i}]: needs file and why")

    ids = set()
    hotspots = 0
    for i, step in enumerate(tour["steps"]):
        where = f"steps[{i}]"
        if not isinstance(step, dict):
            problems.append(f"{where}: must be an object")
            continue
        unknown = set(step) - STEP_KEYS
        if unknown:
            problems.append(f"{where}: unknown fields {sorted(unknown)}")
        for key in ("id", "tag", "title", "why", "anchors"):
            if key not in step:
                problems.append(f"{where}: missing {key}")
        step_id = step.get("id", "")
        if not isinstance(step_id, str) or not STEP_ID.match(step_id):
            problems.append(f"{where}: id must match [a-z0-9-]+")
        elif step_id in ids:
            problems.append(f"{where}: duplicate id {step_id}")
        ids.add(step_id)
        if step.get("tag") not in ("read_closely", "skim"):
            problems.append(f"{where}: tag must be read_closely or skim")
        if step.get("hotspot"):
            hotspots += 1
            if not step.get("check"):
                problems.append(f"{where}: a hotspot needs a check")
        if len(step.get("title", "")) > 60:
            problems.append(f"{where}: title is longer than 60 characters")
        step_anchors = step.get("anchors") or []
        if not step_anchors:
            problems.append(f"{where}: needs at least one anchor")
        for j, anchor in enumerate(step_anchors):
            if check_anchor(anchor, f"{where}.anchors[{j}]", problems):
                anchors.append((f"{where}.anchors[{j}] ({step_id})", anchor))
    if hotspots > 3:
        problems.append(f"{hotspots} hotspots; the tour asks for 2-3")

    for i, concern in enumerate(tour["concerns"]):
        if not isinstance(concern, dict) or not isinstance(concern.get("text"), str):
            problems.append(f"concerns[{i}]: needs text")
            continue
        if "anchor" in concern and check_anchor(concern["anchor"], f"concerns[{i}].anchor", problems):
            anchors.append((f"concerns[{i}].anchor", concern["anchor"]))

    diffs = {}
    for where, anchor in anchors:
        path = anchor["file"]
        if path not in diffs:
            diffs[path] = changed_lines(repo, base, head, path)
        side = anchor.get("side", "new")
        wanted = set(range(anchor["start"], anchor["end"] + 1))
        if not wanted & diffs[path][side]:
            problems.append(f"{where}: {path} {side} L{anchor['start']}-{anchor['end']} overlaps no hunk of the diff")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tour")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()
    try:
        with open(args.tour, encoding="utf-8") as file:
            tour = json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        print(f"cannot read tour: {error}")
        return 1
    problems = validate(tour, args.repo)
    for problem in problems:
        print(problem)
    if not problems:
        steps = tour["steps"]
        closely = sum(1 for s in steps if s["tag"] == "read_closely")
        print(f"ok: {len(steps)} steps ({closely} read closely), {len(tour['concerns'])} concerns")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
