import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from print_pdf import print_pdf
class PrintPdfTests(unittest.TestCase):
 def test_measured_width_and_spacing_survive_pdf_export(self):
  import pdfplumber
  from io import BytesIO
  text={'type':'text','text':'공사 123','x':200,'y':70,'size':10.5,'scale':.6,'spacing':.4,'width':60,'align':'right'}
  result=print_pdf({'pages':[{'width':595,'height':842,'ops':[text]}]})
  with pdfplumber.open(BytesIO(result)) as doc:
   chars=doc.pages[0].chars
   self.assertAlmostEqual(min(c['x0'] for c in chars),140,places=3)
   self.assertAlmostEqual(max(c['x1'] for c in chars),200,places=3)
  for key,value in [('width',float('nan')),('spacing',101)]:
   with self.assertRaises(ValueError):print_pdf({'pages':[{'width':595,'height':842,'ops':[{**text,key:value}]}]})
 def test_vector_pdf(self):
  pages=[{'width':w,'height':h,'ops':[{'type':'text','text':'원가계산서 0.006%','x':50,'y':70,'size':9,'scale':.8,'align':'left'},{'type':'line','x':20,'y':90,'x2':300,'y2':90,'weight':.35}]} for w,h in [(595.28,841.89),(841.89,595.28)]]
  result=print_pdf({'title':'출력 검증','pages':pages});self.assertTrue(result.startswith(b'%PDF-'));self.assertIn(b'/FontFile2',result);self.assertIn(b'/Count 2',result)
 def test_reject_invalid_geometry(self):
  with self.assertRaises(ValueError):print_pdf({'pages':[]})
  with self.assertRaises(ValueError):print_pdf({'pages':[{'width':595,'height':842,'ops':[{'type':'text','x':1,'y':float('nan'),'size':9,'text':'x'}]}]})
  with self.assertRaises(ValueError):print_pdf({'pages':[{'width':595,'height':842,'ops':[{'type':'file','x':1,'y':1,'path':'C:/private'}]}]})
if __name__=='__main__':unittest.main()
