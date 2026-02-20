#!/usr/bin/env python3
"""Assert one-shot sdk-traffic records via Sigil query APIs."""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib import parse as urllib_parse
from urllib import request as urllib_request


REQUIRED_LANGUAGES = {"go", "javascript", "python", "java", "dotnet"}
REQUIRED_FRAMEWORKS = {
    ("python", "langchain"),
    ("python", "langgraph"),
    ("javascript", "langchain"),
    ("javascript", "langgraph"),
}


def _base_url() -> str:
    value = os.getenv("SIGIL_TRAFFIC_ASSERT_BASE_URL", "http://sigil:8080").strip()
    return value.rstrip("/")


def _timeout_seconds() -> int:
    raw = os.getenv("SIGIL_TRAFFIC_ASSERT_TIMEOUT_SECONDS", "180").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 180
    return max(30, value)


def _max_conversations() -> int:
    raw = os.getenv("SIGIL_TRAFFIC_ASSERT_MAX_CONVERSATIONS", "600").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 600
    return max(100, value)


def _request_json(path: str) -> Any:
    req = urllib_request.Request(
        f"{_base_url()}{path}",
        headers={"accept": "application/json"},
        method="GET",
    )
    with urllib_request.urlopen(req, timeout=10) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def _list_conversation_ids() -> list[str]:
    payload = _request_json("/api/v1/conversations")
    items = payload.get("items", []) if isinstance(payload, dict) else []

    ids: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_id = item.get("id")
        if isinstance(raw_id, str) and raw_id.strip() != "":
            ids.append(raw_id.strip())

    return ids[: _max_conversations()]


def _scan_generations() -> tuple[set[str], set[tuple[str, str]], int, int]:
    languages: set[str] = set()
    frameworks: set[tuple[str, str]] = set()

    conversation_ids = _list_conversation_ids()
    scanned_generations = 0

    for conversation_id in conversation_ids:
        encoded_id = urllib_parse.quote(conversation_id, safe="")
        detail = _request_json(f"/api/v1/conversations/{encoded_id}")
        generations = detail.get("generations", []) if isinstance(detail, dict) else []
        if not isinstance(generations, list):
            continue

        for generation in generations:
            if not isinstance(generation, dict):
                continue
            tags = generation.get("tags")
            if not isinstance(tags, dict):
                continue

            scanned_generations += 1

            lang = tags.get("sigil.devex.language")
            if isinstance(lang, str) and lang.strip() != "":
                languages.add(lang.strip())

            framework_name = tags.get("sigil.framework.name")
            framework_lang = tags.get("sigil.framework.language")
            if isinstance(framework_name, str) and isinstance(framework_lang, str):
                if framework_name.strip() != "" and framework_lang.strip() != "":
                    frameworks.add((framework_lang.strip(), framework_name.strip()))

    return languages, frameworks, len(conversation_ids), scanned_generations


def _main() -> int:
    timeout_seconds = _timeout_seconds()
    deadline = time.time() + timeout_seconds

    last_error = ""
    attempts = 0

    while time.time() < deadline:
        attempts += 1
        try:
            languages, frameworks, conversation_count, generation_count = _scan_generations()
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            time.sleep(2)
            continue

        missing_languages = REQUIRED_LANGUAGES - languages
        missing_frameworks = REQUIRED_FRAMEWORKS - frameworks

        if not missing_languages and not missing_frameworks:
            print(
                "[sdk-traffic] one-shot assertions passed "
                f"attempts={attempts} conversations={conversation_count} generations={generation_count}"
            )
            return 0

        print(
            "[sdk-traffic] waiting for expected records "
            f"attempts={attempts} missing_languages={sorted(missing_languages)} "
            f"missing_frameworks={sorted(missing_frameworks)}"
        )
        time.sleep(2)

    if last_error:
        print(f"[sdk-traffic] assertion failed: last API error: {last_error}")

    try:
        languages, frameworks, conversation_count, generation_count = _scan_generations()
    except Exception as exc:  # noqa: BLE001
        print(f"[sdk-traffic] assertion failed: unable to fetch final snapshot: {exc}")
        return 1

    missing_languages = REQUIRED_LANGUAGES - languages
    missing_frameworks = REQUIRED_FRAMEWORKS - frameworks

    print(
        "[sdk-traffic] assertion failed "
        f"conversations={conversation_count} generations={generation_count} "
        f"missing_languages={sorted(missing_languages)} "
        f"missing_frameworks={sorted(missing_frameworks)}"
    )
    return 1


if __name__ == "__main__":
    sys.exit(_main())
