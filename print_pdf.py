"""Render the same bounded vector pages used by the preview, without network access."""
from io import BytesIO
from pathlib import Path
import math
import os
import threading
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
_LOCK = threading.Lock()

def _font():
    name = 'GongsaGulimChe'
    if name not in pdfmetrics.getRegisteredFontNames():
        path = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Fonts' / 'gulim.ttc'
        if not path.is_file():
            raise ValueError('Windows 굴림 글꼴을 찾지 못했습니다. 인쇄창에서 PDF로 저장하세요.')
        pdfmetrics.registerFont(TTFont(name, str(path), subfontIndex=1))
    return name

def _number(v, low=-2000, high=5000):
    if isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or not low <= v <= high:
        raise ValueError('인쇄 좌표 또는 글자 크기를 확인하세요.')
    return v

def print_pdf(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('pages'), list) or not 1 <= len(payload['pages']) <= 1000:
        raise ValueError('출력 페이지를 확인하세요.')
    count = sum(len(p.get('ops', [])) for p in payload['pages'] if isinstance(p, dict))
    if count > 500000:
        raise ValueError('출력량이 너무 많습니다. 문서를 나누어 저장하세요.')
    with _LOCK:
        font = _font()
        out = BytesIO()
        pdf = canvas.Canvas(out, pageCompression=1)
        pdf.setTitle(str(payload.get('title', '설계내역서'))[:300])
        pdf.setAuthor('공사노트')
        for page in payload['pages']:
            width, height = _number(page['width'], 300, 1000), _number(page['height'], 300, 1000)
            pdf.setPageSize((width, height))
            for op in page['ops']:
                x, y = _number(op['x']), _number(op['y'])
                kind = op['type']
                if kind == 'line':
                    pdf.setLineWidth(_number(op['weight'], 0, 10))
                    pdf.line(x, height-y, _number(op['x2']), height-_number(op['y2']))
                elif kind == 'rect':
                    w, h = _number(op['width'], 0, 1200), _number(op['height'], 0, 1200)
                    fill = op.get('fill')
                    if fill is not None:
                        pdf.setFillGray(_number(fill, 0, 1))
                    pdf.setLineWidth(_number(op['weight'], 0, 10))
                    pdf.rect(x, height-y-h, w, h, stroke=int(op['weight'] > 0), fill=int(fill is not None))
                    pdf.setFillGray(0)
                elif kind == 'text':
                    text = op.get('text', '')
                    if not isinstance(text, str) or len(text) > 10000:
                        raise ValueError('인쇄 문장이 너무 깁니다.')
                    size = _number(op['size'], 4, 60)
                    scale = _number(op.get('scale', 1), .1, 2)
                    spacing = _number(op.get('spacing', 0), -1, 100)
                    align = op.get('align', 'left')
                    natural = pdfmetrics.stringWidth(text, font, size) + max(0, len(text)-1)*spacing
                    tw = natural*scale
                    # The preview records its measured width. Preserve that width
                    # even if a browser font fallback has different advances.
                    if 'width' in op:
                        tw = _number(op['width'], 0, 10000)
                        if natural > 0:
                            scale = tw/natural
                    if align == 'center': x -= tw/2
                    elif align == 'right': x -= tw
                    pdf.saveState()
                    t = pdf.beginText(x, height-y)
                    t.setFont(font, size)
                    t.setCharSpace(spacing)
                    t.setHorizScale(scale*100)
                    if op.get('bold'):
                        t.setTextRenderMode(2)
                        pdf.setLineWidth(.08)
                    t.textOut(text)
                    pdf.drawText(t)
                    pdf.restoreState()
                else:
                    raise ValueError('지원하지 않는 인쇄 요소입니다.')
            pdf.showPage()
        pdf.save()
        return out.getvalue()
