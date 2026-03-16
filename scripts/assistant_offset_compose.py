from __future__ import annotations

import argparse
import re
from collections.abc import Iterable
from pathlib import Path

try:
    from scripts.compose_yaml import (
        CONTAINER_NAME_RE,
        PORTS_EXIT_KEY_RE,
        PORTS_KEY_RE,
        SERVICE_RE,
    )
except ImportError:
    from compose_yaml import (  # type: ignore[no-redef]
        CONTAINER_NAME_RE,
        PORTS_EXIT_KEY_RE,
        PORTS_KEY_RE,
        SERVICE_RE,
    )

MAX_PORT = 65535

PORT_ITEM_RE = re.compile(r"""^(\s*-\s*)['"]?([^'"]+)['"]?(\s*(?:#.*)?)$""")
PUBLISHED_RE = re.compile(r'^(\s*published:\s*"?)(\d+)("?)(\s*(?:#.*)?)$')


def parse_port_mapping(spec: str) -> tuple[str | None, int | None, str | None, str]:
    suffix = ""
    if "/" in spec:
        base, proto = spec.rsplit("/", 1)
        suffix = "/" + proto
    else:
        base = spec

    parts = base.split(":")
    if len(parts) == 2:
        host, container = parts
        ip = None
    elif len(parts) == 3:
        ip, host, container = parts
    else:
        return None, None, None, suffix

    if not host.isdigit():
        return ip, None, container, suffix

    return ip, int(host), container, suffix


def render_mapping(ip: str | None, host: int, container: str | None, suffix: str) -> str:
    if ip is None:
        return f"{host}:{container}{suffix}"
    return f"{ip}:{host}:{container}{suffix}"


def safe_container_name(project: str, service: str) -> str:
    raw = f"{project}-{service}".lower()
    clean = re.sub(r"[^a-z0-9_.-]", "-", raw)
    clean = re.sub(r"-{2,}", "-", clean).strip("-")
    return clean or "assistant-offset"


def collect_reserved_ports(paths: Iterable[Path]) -> set[int]:
    reserved: set[int] = set()
    pattern = re.compile(r"""^\s*-\s*['"]?([^'"]+)['"]?(?:\s*#.*)?$""")
    for path in paths:
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            match = pattern.match(raw)
            if not match:
                continue
            _ip, host, _container, _suffix = parse_port_mapping(match.group(1).strip())
            if host is not None:
                reserved.add(host)
    return reserved


def choose_host_port(host: int, offset: int, used_ports: set[int]) -> int:
    preferred = host + offset
    if preferred <= MAX_PORT and preferred not in used_ports:
        used_ports.add(preferred)
        return preferred

    fallback_start = min(max(offset, 1), MAX_PORT)
    for candidate in range(fallback_start, MAX_PORT + 1):
        if candidate in used_ports:
            continue
        used_ports.add(candidate)
        return candidate

    raise ValueError(
        f"unable to allocate a remapped host port for {host}; exhausted {fallback_start}-{MAX_PORT}",
    )


def remap_compose_ports(
    compose_text: str,
    offset: int,
    project_name: str,
    reserved_ports: set[int],
) -> tuple[str, list[str], dict[str, list[str]]]:
    lines = compose_text.splitlines()

    in_services = False
    current_service: str | None = None
    in_ports = False
    services_order: list[str] = []
    ports_by_service: dict[str, list[str]] = {}
    service_has_container_name: dict[str, bool] = {}
    in_service_block = False
    used_ports = set(reserved_ports)

    out: list[str] = []

    for line in lines:
        if not in_services and line.strip() == "services:":
            in_services = True
            out.append(line)
            continue

        if in_services and line and not line.startswith(" "):
            if current_service and not service_has_container_name.get(current_service, False):
                out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')
            current_service = None
            in_ports = False
            in_service_block = False
            in_services = False
            out.append(line)
            continue

        svc_match = SERVICE_RE.match(line) if in_services else None
        if svc_match:
            if current_service and not service_has_container_name.get(current_service, False):
                out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')

            current_service = svc_match.group(1)
            in_service_block = True
            in_ports = False
            services_order.append(current_service)
            ports_by_service[current_service] = []
            service_has_container_name[current_service] = False
            out.append(line)
            continue

        if in_service_block and current_service:
            if PORTS_KEY_RE.match(line):
                in_ports = True
                out.append(line)
                continue

            if in_ports:
                published_match = PUBLISHED_RE.match(line)
                if published_match:
                    prefix, published_port, quote_suffix, trailing_comment = published_match.groups()
                    candidate = choose_host_port(int(published_port), offset, used_ports)
                    ports_by_service[current_service].append(str(candidate))
                    out.append(f"{prefix}{candidate}{quote_suffix}{trailing_comment}")
                    continue

                item_match = PORT_ITEM_RE.match(line.strip())
                if item_match:
                    original_spec = item_match.group(2).strip()
                    trailing_comment = item_match.group(3) or ""
                    ip, host, container, suffix = parse_port_mapping(original_spec)
                    if host is not None:
                        candidate = choose_host_port(host, offset, used_ports)
                        remapped = render_mapping(ip, candidate, container, suffix)
                        ports_by_service[current_service].append(remapped)
                        out.append(f'      - "{remapped}"{trailing_comment}')
                    else:
                        out.append(line)
                    continue

                if PORTS_EXIT_KEY_RE.match(line) or SERVICE_RE.match(line):
                    in_ports = False

            if CONTAINER_NAME_RE.match(line):
                service_has_container_name[current_service] = True
                out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')
                continue

        out.append(line)

    if current_service and not service_has_container_name.get(current_service, False):
        out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')

    return "\n".join(out) + "\n", services_order, ports_by_service


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Remap assistant docker compose host ports by offset with overflow fallback.",
    )
    parser.add_argument("compose_path", type=Path)
    parser.add_argument("output_path", type=Path)
    parser.add_argument("offset", type=int)
    parser.add_argument("project_name")
    parser.add_argument("reserved_sources", nargs="*", type=Path)
    args = parser.parse_args()

    reserved_ports = collect_reserved_ports(args.reserved_sources)
    remapped_text, services_order, ports_by_service = remap_compose_ports(
        args.compose_path.read_text(encoding="utf-8"),
        args.offset,
        args.project_name,
        reserved_ports,
    )
    args.output_path.write_text(remapped_text, encoding="utf-8")

    print(f"Generated remapped compose: {args.output_path}")
    print(f"Remapped services: {len([service for service in services_order if ports_by_service.get(service)])}")
    for service in services_order:
        if not ports_by_service.get(service):
            continue
        print(f"  {service}: {', '.join(ports_by_service[service])}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
