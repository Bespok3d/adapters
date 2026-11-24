# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A stand-in for ip that answers with chosen default routes, for the tests that ask for them."""
from pathlib import Path

import pytest

WIRED_ROUTE = "default via 192.0.2.1 dev eth0 proto dhcp src 192.0.2.6 metric 1002\n"
WIFI_ROUTE = "default via 192.0.2.1 dev wlan0 proto dhcp src 192.0.2.7 metric 3004\n"
WIRED_IPV6_ROUTE = "default via fe80::1 dev eth0 proto ra metric 1002 pref medium\n"
WIFI_IPV6_ROUTE = "default via fe80::1 dev wlan0 proto ra metric 3004 pref medium\n"
UNPLUGGED_WIRED_ROUTE = "default via 192.0.2.1 dev eth0 proto static metric 1002 linkdown\n"
UNREACHABLE_IPV6_ROUTE = "unreachable default dev lo proto kernel metric 4294967295 error -101\n"


def print_default_routes(
    monkeypatch: pytest.MonkeyPatch, tools_dir: Path, ipv4_routes: str, ipv6_routes: str = "",
) -> None:
    """Puts a stand-in for ip first on PATH, printing the given IPv4 or IPv6 default routes."""
    (tools_dir / "ip").write_text(
        "#!/bin/sh\n"
        f"[ \"$1\" = -6 ] && printf '%s' '{ipv6_routes}' || printf '%s' '{ipv4_routes}'\n",
    )
    (tools_dir / "ip").chmod(0o755)
    monkeypatch.setenv("PATH", str(tools_dir))
