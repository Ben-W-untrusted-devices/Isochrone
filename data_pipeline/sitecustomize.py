from __future__ import annotations

import os

if os.environ.get("ISOCHRONE_TESTS_BLOCK_NETWORK") == "1":
    from no_network_guard import install_network_guard

    install_network_guard()
