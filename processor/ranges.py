"""Bounded parsing for single byte-range downloads, using integer offsets."""
import re


def download_range(header, size):
    match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", header)
    if size <= 0 or not match or not any(match.groups()):
        raise ValueError("Invalid download range")
    first, last = match.groups()
    if first:
        start = int(first)
        end = min(size - 1, int(last)) if last else size - 1
    else:
        suffix = int(last)
        if suffix == 0:
            raise ValueError("Invalid download range")
        start, end = max(0, size - suffix), size - 1
    if start > end or start >= size:
        raise ValueError("Invalid download range")
    return start, end
