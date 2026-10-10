"""Turn linecast's colored terminal output into HTML.

linecast's ``--print`` writes one frame of text with SGR escape codes
(truecolor, 256-color or the 16 basic colors). This converts that frame
into ``<span>`` runs with inline colors so a browser can show the same
picture. Escape sequences other than SGR are dropped.
"""

from html import escape
import re
import unicodedata

# CSI sequences: ESC [ params intermediates final
_CSI = re.compile(r"\x1b\[([0-9;:?]*)[ -/]*([@-~])")
# OSC sequences (titles, hyperlinks): ESC ] ... BEL or ESC \
_OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")

_BASIC = [
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
]


def _xterm256(n):
    if n < 16:
        return _BASIC[n]
    if n < 232:
        n -= 16
        steps = (0, 95, 135, 175, 215, 255)
        return steps[n // 36], steps[(n // 6) % 6], steps[n % 6]
    v = 8 + (n - 232) * 10
    return v, v, v


def _hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(c))) for c in rgb)


class _Style:
    __slots__ = ("fg", "bg", "bold", "faint", "italic", "underline", "inverse")

    def __init__(self):
        self.reset()

    def reset(self):
        self.fg = self.bg = None
        self.bold = self.faint = self.italic = self.underline = self.inverse = False

    def key(self):
        return (self.fg, self.bg, self.bold, self.faint, self.italic,
                self.underline, self.inverse)

    def css(self):
        fg, bg = self.fg, self.bg
        if self.inverse:
            fg, bg = (bg or "var(--art-bg)"), (fg or "var(--art-fg)")
        parts = []
        if fg:
            parts.append("color:" + fg)
        if bg:
            parts.append("background:" + bg)
        if self.bold:
            parts.append("font-weight:700")
        if self.faint:
            parts.append("opacity:.6")
        if self.italic:
            parts.append("font-style:italic")
        if self.underline:
            parts.append("text-decoration:underline")
        return ";".join(parts)


def _apply_sgr(style, params):
    codes = [int(p) if p.isdigit() else 0 for p in params.replace(":", ";").split(";")]
    if not codes:
        codes = [0]
    i = 0
    while i < len(codes):
        c = codes[i]
        if c == 0:
            style.reset()
        elif c == 1:
            style.bold = True
        elif c == 2:
            style.faint = True
        elif c == 3:
            style.italic = True
        elif c == 4:
            style.underline = True
        elif c == 7:
            style.inverse = True
        elif c == 22:
            style.bold = style.faint = False
        elif c == 23:
            style.italic = False
        elif c == 24:
            style.underline = False
        elif c == 27:
            style.inverse = False
        elif 30 <= c <= 37:
            style.fg = _hex(_BASIC[c - 30])
        elif 90 <= c <= 97:
            style.fg = _hex(_BASIC[c - 90 + 8])
        elif 40 <= c <= 47:
            style.bg = _hex(_BASIC[c - 40])
        elif 100 <= c <= 107:
            style.bg = _hex(_BASIC[c - 100 + 8])
        elif c == 39:
            style.fg = None
        elif c == 49:
            style.bg = None
        elif c in (38, 48):
            color = None
            if i + 1 < len(codes) and codes[i + 1] == 2 and i + 4 < len(codes):
                color = _hex(codes[i + 2:i + 5])
                i += 4
            elif i + 1 < len(codes) and codes[i + 1] == 5 and i + 2 < len(codes):
                color = _hex(_xterm256(codes[i + 2] % 256))
                i += 2
            if color:
                if c == 38:
                    style.fg = color
                else:
                    style.bg = color
        i += 1


# Block elements drawn as two-color cells, so a field of half blocks
# tiles exactly whatever font the browser falls back to. Each maps to a
# gradient direction and which half takes the foreground.
_BLOCKS = {
    "\u2580": ("hu", "fg-first"),   # upper half block
    "\u2584": ("hl", "bg-first"),   # lower half block
    "\u258c": ("vl", "fg-first"),   # left half block
    "\u2590": ("vr", "bg-first"),   # right half block
}
_FULL_BLOCK = "\u2588"


def _cells(chunk, style):
    """HTML for one run of text in one style.

    ASCII stays plain monospace text. Every other character sits in a
    fixed-size cell (two cells when East Asian wide), so glyphs a
    fallback font draws wider or narrower cannot push the grid out of
    line. Half and full blocks become colored cells with no glyph at all.
    """
    fg = style.fg or "var(--art-fg)"
    bg = style.bg or "var(--art-bg)"
    if style.inverse:
        fg, bg = bg, fg
    parts = []
    plain = []

    def flush_plain():
        if plain:
            parts.append(escape("".join(plain), quote=False))
            plain.clear()

    for ch in chunk:
        if ch == "\n" or " " <= ch <= "~":
            plain.append(ch)
            continue
        flush_plain()
        if ch == _FULL_BLOCK:
            parts.append('<i class="b" style="--b:%s"></i>' % fg)
        elif ch in _BLOCKS:
            kind, order = _BLOCKS[ch]
            first, second = (fg, bg) if order == "fg-first" else (bg, fg)
            parts.append('<i class="b %s" style="--1:%s;--2:%s"></i>' % (kind, first, second))
        elif unicodedata.combining(ch):
            parts.append(escape(ch, quote=False))
        else:
            wide = unicodedata.east_asian_width(ch) in ("W", "F")
            parts.append('<i class="c%s">%s</i>' % (" w" if wide else "", escape(ch, quote=False)))
    flush_plain()
    return "".join(parts)


def ansi_to_html(text):
    """Return HTML for *text*, keeping its colors as inline styles.

    The result is meant to sit inside a ``<pre class="art">``; newlines
    are kept. The page's stylesheet sizes the ``<i>`` cells.
    """
    text = _OSC.sub("", text.replace("\r\n", "\n").replace("\r", ""))
    out = []
    style = _Style()
    run = []
    run_key = style.key()
    run_css = ""

    def flush():
        if not run:
            return
        body = "".join(run)
        if run_css:
            out.append('<span style="%s">%s</span>' % (run_css, body))
        else:
            out.append(body)
        run.clear()

    def add(chunk):
        # Compare styles only when text arrives: linecast resets after
        # nearly every cell, and the same color set again should extend
        # the current span rather than open a new one.
        nonlocal run_key, run_css
        if style.key() != run_key:
            flush()
            run_key = style.key()
            run_css = style.css()
        run.append(_cells(chunk.replace("\x1b", ""), style))

    pos = 0
    for m in _CSI.finditer(text):
        if m.start() > pos:
            add(text[pos:m.start()])
        pos = m.end()
        if m.group(2) == "m":
            _apply_sgr(style, m.group(1))
    if pos < len(text):
        add(text[pos:])
    flush()
    return "".join(out)
