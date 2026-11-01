"""Splice a DeepSeek region reply into a file.  python splice.py FILE REPLY 'R1:11-111' 'R2:174-241' ..."""
import re, sys
from pathlib import Path
f, reply = Path(sys.argv[1]), Path(sys.argv[2]).read_text(encoding="utf-8")
raw = f.read_bytes(); bom = raw.startswith(b"\xef\xbb\xbf")
text = raw.decode("utf-8-sig"); crlf = text.count("\r\n") > text.count("\n") / 2
lines = text.replace("\r\n", "\n").split("\n")
spans = {}
for a in sys.argv[3:]:
    k, r = a.split(":"); s, e = map(int, r.split("-")); spans[k] = (s, e)
blocks = {}
for m in re.finditer(r"###\s*([A-Z]\d+)[^\n]*\n+```(?:js|javascript)?\n(.*?)```", reply, re.S):
    blocks[m.group(1)] = m.group(2).rstrip("\n")
print("replacing:", sorted(blocks), "unchanged:", sorted(set(spans) - set(blocks)))
blocks = {k: v for k, v in blocks.items() if k in spans}
for k in sorted(blocks, key=lambda k: -spans[k][0]):
    s, e = spans[k]
    lines[s-1:e] = blocks[k].split("\n")
out = "\n".join(lines)
if crlf: out = out.replace("\n", "\r\n")
f.write_bytes((b"\xef\xbb\xbf" if bom else b"") + out.encode("utf-8"))
