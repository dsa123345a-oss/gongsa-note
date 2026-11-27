import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.prepare_release import verify_pdf_runtime


class PdfPackagingTests(unittest.TestCase):
    def test_release_rejects_missing_pdf_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'canvas'):
                verify_pdf_runtime(root)
            for name in ('reportlab/pdfgen/canvas.pyc', 'reportlab/pdfbase/ttfonts.pyc', 'print_pdf.pyc'):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'test')
            verify_pdf_runtime(root)
            (root / 'reportlab/pdfbase/ttfonts.pyc').unlink()
            with self.assertRaisesRegex(ValueError, 'ttfonts'):
                verify_pdf_runtime(root)


if __name__ == '__main__':
    unittest.main()
