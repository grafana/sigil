import re

SERVICE_RE = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*$")
PORTS_EXIT_KEY_RE = re.compile(r"^    [A-Za-z0-9_.-]+:\s*.*$")
PORTS_KEY_RE = re.compile(r"^    ports:\s*(?:#.*)?$")
CONTAINER_NAME_RE = re.compile(r"^    container_name:\s*.*$")


def strip_service_ports_and_container_names(compose_text: str) -> str:
    lines = compose_text.splitlines()
    filtered: list[str] = []
    in_ports = False

    for line in lines:
        if in_ports:
            if line.startswith("      - ") or line.strip() == "":
                continue
            if PORTS_EXIT_KEY_RE.match(line) or SERVICE_RE.match(line):
                in_ports = False
            else:
                continue

        if CONTAINER_NAME_RE.match(line):
            continue

        if PORTS_KEY_RE.match(line):
            in_ports = True
            continue

        filtered.append(line)

    return "\n".join(filtered) + "\n"
