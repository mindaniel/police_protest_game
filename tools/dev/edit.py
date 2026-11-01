"""edit(f, [(old, new), ...]) exact-once replacement; keeps BOM and the file's line-ending style (CRLF if the original was)."""
from pathlib import Path
def edit(f, pairs, crlf=None):
    p = Path(f); raw = p.read_bytes(); bom = raw.startswith(b"\xef\xbb\xbf"); s = raw.decode("utf-8-sig")
    if crlf is None: crlf = s.count("\r\n") > s.count("\n") / 2
    s = s.replace("\r\n", "\n")
    for old, new in pairs:
        assert s.count(old) == 1, (f, s.count(old), old[:70]); s = s.replace(old, new)
    if crlf: s = s.replace("\n", "\r\n")
    p.write_bytes((b"\xef\xbb\xbf" if bom else b"") + s.encode())
