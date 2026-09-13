#!/usr/bin/env python3
"""Compatibility entrypoint for the current layered V8 announcement page.

The earlier whole-mockup/tiled-floor implementation was rejected. Keep old
callers on the corrected formal implementation instead of rebuilding it.
"""
from apply_v8_announcement_layers import main as apply

if __name__ == '__main__':
    apply()
