from linecast_desktop.ansi import ansi_to_html


def test_plain_text_is_escaped():
    assert ansi_to_html("a < b & c") == "a &lt; b &amp; c"


def test_truecolor_runs_become_spans():
    html = ansi_to_html("\x1b[38;2;255;0;0mred\x1b[0m plain")
    assert html == '<span style="color:#ff0000">red</span> plain'


def test_background_bold_and_256_colors():
    html = ansi_to_html("\x1b[48;5;196;1mX\x1b[0m")
    assert 'background:#ff0000' in html
    assert 'font-weight:700' in html


def test_same_style_codes_merge_into_one_span():
    html = ansi_to_html("\x1b[31ma\x1b[0m\x1b[31mb\x1b[0m")
    assert html.count("<span") == 1
    assert ">ab<" in html


def test_other_escape_sequences_are_dropped():
    html = ansi_to_html("\x1b[2J\x1b[Hhi\x1b]0;title\x07!")
    assert html == "hi!"


def test_newlines_survive_inside_colored_runs():
    html = ansi_to_html("\x1b[32mone\ntwo\x1b[0m")
    assert "one\ntwo" in html


def test_markup_in_text_cannot_escape_the_span():
    html = ansi_to_html('\x1b[31m<script>alert(1)</script>\x1b[0m')
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_half_blocks_become_painted_cells():
    html = ansi_to_html("\x1b[38;2;255;0;0;48;2;0;0;255m▄\x1b[0m")
    # lower half: background on top, foreground below
    assert 'class="b hl" style="--1:#0000ff;--2:#ff0000"' in html
    assert "▄" not in html


def test_full_block_and_default_colors():
    html = ansi_to_html("█")
    assert '<i class="b" style="--b:var(--art-fg)"></i>' == html


def test_other_symbols_get_fixed_cells_and_wide_ones_two():
    html = ansi_to_html("a⡀b月")
    assert html == 'a<i class="c">⡀</i>b<i class="c w">月</i>'
