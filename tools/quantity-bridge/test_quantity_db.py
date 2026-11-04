import unittest
from decimal import Decimal
import openpyxl
from quantity_db import candidates,normalize_angle_items,align_workbook,DbReviewRequired,CONTRACT_SHEET,quantity_rows,safe_unit

class DbTests(unittest.TestCase):
    def test_kp_manual_method_can_be_reviewed_without_automatic_guess(self):
        item,options=candidates('KP메커니컬 접합 및 부설','D80','work')
        self.assertIsNone(item)
        self.assertTrue(any(x['code']=='U0000000406' and x['role']=='assembly' for x in options))
        self.assertTrue(any(x['code']=='U0000000392' and x['role']=='assembly' for x in options))

    def test_priority_and_spelling(self):
        for name,spec,expected in [('PE직관','20SU','PE 직관'),('STS직관','D20mm','STS 직관'),('XL정티','D20','XL-삼방티')]:
            item,_=candidates(name,spec,'material')
            self.assertEqual(item['role'],'assembly');self.assertEqual(item['name'],expected)
        item,_=candidates('되메우기','백호(0.2㎥) 기계90%+인력10%','work')
        self.assertIn('다짐',item['name'])
    def test_angle_assembly(self):
        for diameter in [13,15,16,20,25,32,40,50]:
            item,_=candidates('앵글밸브(10kg/㎠)(자재포함)',f'D{diameter}','work')
            self.assertEqual(item['name'],'앵글밸브 교체');self.assertTrue(item['code'].startswith('U'))
        material={'name':'앵글밸브(10kg/㎠)','spec':'D15','unit':'개','qty':2}
        mats,works=normalize_angle_items([material],[])
        self.assertEqual(mats,[]);self.assertEqual(works[0]['qty'],2)
        mats,works=normalize_angle_items([material],works)
        self.assertEqual(len(works),1);self.assertEqual(works[0]['qty'],2)
        with self.assertRaises(ValueError):normalize_angle_items([material],[{**works[0],'qty':3}])
    def test_review_preserves_quantity_and_formula(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위'])
        ws.append(['3.자재대','PE직관','D20SU','=2+3','M'])
        ws.append(['','PE직관','D999',2,'M'])
        with self.assertRaises(DbReviewRequired) as cm:align_workbook(wb,'test')
        r=cm.exception.review['rows'][0]
        with self.assertRaises(DbReviewRequired):align_workbook(wb,'test',reviewed=True)
        stat=align_workbook(wb,'test',selections={r['key']:{'id':'keep','signature':r['signature']}},reviewed=True)
        self.assertEqual(stat['matched'],1);self.assertEqual(ws['D2'].value,'=2+3');self.assertEqual(ws['C2'].value,'D20mm');self.assertEqual(ws['C3'].value,'D999')
        self.assertEqual(wb[CONTRACT_SHEET].sheet_state,'veryHidden')
    def test_material_work_and_nearest_are_not_interchanged(self):
        self.assertIsNone(candidates('PE직관','D999','material')[0])
        self.assertIsNone(candidates('PE직관','D20','work')[0])
        self.assertIsNone(candidates('STS관 접합 및 부설','D20','work')[0])  # Joint method is unspecified.

    def test_angle_equivalent_diameter_does_not_duplicate(self):
        material={'name':'앵글밸브','spec':'D13','unit':'개','qty':2}
        work={'name':'앵글밸브 교체','spec':'15A','unit':'개소','qty':2}
        mats,works=normalize_angle_items([material],[work])
        self.assertEqual(mats,[]);self.assertEqual(len(works),1);self.assertEqual(works[0]['qty'],2)
        mats,works=normalize_angle_items([{**material,'qty':0}],[work])
        self.assertEqual(len(works),1)
        for value in ('nan','inf',float('nan'),-1,True,'bad'):
            with self.subTest(value=value),self.assertRaises(ValueError):normalize_angle_items([{**material,'qty':value}],[work])
        _,works=normalize_angle_items([],[work,{**work,'qty':3}])
        self.assertEqual(sum(w['qty'] for w in works),5)  # Separate work rows retain their quantity.

    def test_merged_name_blank_spec_is_saved_without_writing_merged_placeholder(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        for address,value in {'A1':'구분','B1':'품명','C1':'규격','G1':'산출근거','H1':'수량','I1':'단위','A2':'포장공','B2':'와이어메쉬 바닥깔기','H2':'=2*3','I2':'㎡'}.items():ws[address]=value
        ws.merge_cells('B2:D2');ws.merge_cells('E2:F2')
        result=align_workbook(wb,'test')
        self.assertEqual(result['matched'],1);self.assertEqual(ws['H2'].value,'=2*3')
        self.assertEqual(ws['B2'].value,'와이어메쉬 바닥깔기');self.assertIn('B2:D2',str(ws.merged_cells))

    def test_merged_name_review_writes_real_spec_box_without_losing_formula(self):
        import json
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        for address,value in {'A1':'구분','B1':'품명','C1':'규격','G1':'산출근거','H1':'수량','I1':'단위','A2':'포장공','B2':'콘크리트포장','H2':'=2*3','I2':'㎥'}.items():ws[address]=value
        ws.merge_cells('B2:D2');ws.merge_cells('E2:F2')
        with self.assertRaises(DbReviewRequired) as cm:align_workbook(wb,'test')
        row=cm.exception.review['rows'][0];item=next(x for x in row['candidates'] if x['role']=='assembly')
        align_workbook(wb,'test',selections={row['key']:{'signature':row['signature'],'id':item['id'],'confirmUnit':True}},reviewed=True)
        self.assertEqual(ws['B2'].value,item['name']);self.assertEqual(ws['E2'].value,item['spec']);self.assertEqual(ws['H2'].value,'=2*3')
        record=json.loads(wb[CONTRACT_SHEET]['A4'].value);self.assertEqual(record['refs']['spec'],'E2')

    def test_shared_name_original_keep_is_not_changed_by_another_row(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위']);ws.append(['자재대','PE직관','D20',2,'M']);ws.append(['','=B2','D999',3,'M'])
        with self.assertRaises(DbReviewRequired) as cm:align_workbook(wb,'test')
        row=cm.exception.review['rows'][0]
        with self.assertRaisesRegex(ValueError,'같은 품목 셀'):align_workbook(wb,'test',selections={row['key']:{'id':'keep','signature':row['signature']}},reviewed=True)
        self.assertEqual(ws['B2'].value,'PE직관')

    def test_numeric_reference_is_rejected_before_any_identity_is_changed(self):
        for value in (20,20.0,Decimal('20'),'20','20.0'):
            with self.subTest(value=value):
                wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
                ws.append(['구분','품명','규격','수량','단위'])
                ws.append(['자재대','PE직관','=Z2','=Z2*2','M']);ws['Z2']=value
                before={c.coordinate:c.value for row in ws for c in row}
                with self.assertRaisesRegex(ValueError,'숫자 입력 셀'):align_workbook(wb,'test')
                self.assertEqual({c.coordinate:c.value for row in ws for c in row},before)
                self.assertNotIn(CONTRACT_SHEET,wb.sheetnames)

    def test_cross_sheet_numeric_reference_chain_preserves_source_and_formulas(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위'])
        ws.append(['자재대','PE직관','=중간!A1',"='입력 값'!B1*2",'M'])
        wb.create_sheet('중간')['A1']="='입력 값'!B1"
        wb.create_sheet('입력 값')['B1']=20
        with self.assertRaisesRegex(ValueError,'숫자 입력 셀'):align_workbook(wb,'test')
        self.assertEqual(wb['입력 값']['B1'].value,20)
        self.assertEqual(wb['중간']['A1'].value,"='입력 값'!B1")
        self.assertEqual(ws['C2'].value,'=중간!A1');self.assertEqual(ws['D2'].value,"='입력 값'!B1*2")
        self.assertEqual(ws['B2'].value,'PE직관')

    def test_spec_reference_to_another_quantity_is_not_rewritten(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위'])
        ws.append(['자재대','PE직관','=D3',2,'M'])
        ws.append(['','STS직관','D20',20,'M'])
        with self.assertRaisesRegex(ValueError,'수량 또는 숫자 입력 셀'):align_workbook(wb,'test')
        self.assertEqual(ws['D3'].value,20);self.assertEqual(ws['C2'].value,'=D3')
        self.assertEqual(ws['B2'].value,'PE직관');self.assertEqual(ws['B3'].value,'STS직관')

    def test_numeric_reference_explicit_keep_preserves_source(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위'])
        ws.append(['자재대','PE직관','=Z2','=Z2*2','M']);ws['Z2']=20
        row=next(quantity_rows(wb))
        result=align_workbook(wb,'test',selections={row['key']:{'id':'keep','signature':row['signature']}},reviewed=True)
        self.assertEqual(result['unresolved'],1);self.assertEqual(ws['Z2'].value,20)
        self.assertEqual(ws['C2'].value,'=Z2');self.assertEqual(ws['D2'].value,'=Z2*2')

    def test_text_identity_reference_still_normalizes_without_replacing_formula(self):
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위'])
        ws.append(['자재대','PE직관','=Z2','=2*3','M']);ws['Z2']='D20'
        result=align_workbook(wb,'test')
        self.assertEqual(result['matched'],1);self.assertEqual(ws['Z2'].value,'D20mm')
        self.assertEqual(ws['C2'].value,'=Z2');self.assertEqual(ws['D2'].value,'=2*3')

    def test_confirmed_small_diameters_for_thread_and_meter_work(self):
        for name,expected in [('나사식접합','Φ15mm'),('계량기 설치','Φ13mm'),('계량기보호함 설치','Φ13mm')]:
            for diameter in (13,15,16):
                with self.subTest(name=name,diameter=diameter):
                    item,_=candidates(name,f'D{diameter}','work')
                    self.assertIsNotNone(item)
                    self.assertEqual(item['spec'],expected)
                    self.assertEqual(item['role'],'assembly')
            for spec in ('D14','D17','D15xH800'):
                with self.subTest(name=name,spec=spec):
                    self.assertIsNone(candidates(name,spec,'work')[0])
            self.assertIsNone(candidates(name,'D15','material')[0])

    def test_small_pressure_valve_alias_uses_the_existing_work_only(self):
        expected={13:'U0000000237',15:'U0000000237',16:'U0000000237',20:'U0000000413',
                  25:'U0000000414',32:'U0000000415',40:'U0000000416',50:'U0000000417'}
        for diameter,code in expected.items():
            with self.subTest(diameter=diameter):
                item,_=candidates('소형감압밸브설치',f'D{diameter}','work')
                self.assertIsNotNone(item)
                self.assertEqual((item['code'],item['name'],item['unit'],item['kind']),
                                 (code,'소형감압변 설치','개소','work'))
        for name in ('감압밸브설치','소형감압밸브','감압밸브일체형 수도용앵글밸브'):
            self.assertIsNone(candidates(name,'D15','work')[0])
        self.assertIsNone(candidates('소형감압밸브설치','D65','work')[0])
        self.assertIsNone(candidates('소형감압밸브설치','D15','material')[0])

    def test_existing_work_aliases_keep_exact_catalog_identity(self):
        for name,spec,target in [
            ('PE접합및부설','D20','PE관 접합및부설'),
            ('STS접합및부설','Φ20mm/HI-DR','STS관 접합 및 부설'),
            ('STS관부설및접합','Φ20mm/HI-DR','STS관 접합 및 부설'),
            ('소프트실제수밸브설치','D20','소프트지수밸브 설치'),
            ('계량기보호함 설치','D20','계량기보호통 설치'),
        ]:
            with self.subTest(name=name):
                item,_=candidates(name,spec,'work')
                self.assertIsNotNone(item)
                self.assertEqual(item['name'],target)
        self.assertIsNone(candidates('STS접합및부설','D20','work')[0])

    def test_work_alias_and_small_diameter_save_preserves_quantities(self):
        import json
        wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
        ws.append(['구분','품명','규격','수량','단위'])
        rows=[['배관공','소형감압밸브설치','D16',2.5,'개소'],
              ['','나사식접합','D13','=2+3','개소'],
              ['','계량기 설치','D15',3,'개소'],
              ['','계량기보호통 설치','D16',4,'개소']]
        for row in rows:ws.append(row)
        result=align_workbook(wb,'test')
        self.assertEqual(result['matched'],4)
        self.assertEqual([ws.cell(r,4).value for r in range(2,6)],[2.5,'=2+3',3,4])
        self.assertEqual([ws.cell(r,3).value for r in range(2,6)],['Φ15mm','Φ15mm','Φ13mm','Φ13mm'])
        self.assertEqual([ws.cell(r,5).value for r in range(2,6)],['개소','개소','개','개'])
        records=[json.loads(wb[CONTRACT_SHEET].cell(r,1).value) for r in range(4,8)]
        self.assertTrue(all(r['status']=='linked' for r in records))

    def test_non_equivalent_work_units_still_require_review(self):
        for name,spec,unit in [('관매달기','Φ20×T50/2M/ㄱ형강','M'),
                               ('옥외 소화전 설치','지상식 쌍구형','개소'),
                               ('제수변부설및접합','(인력:Φ50mm)','개소')]:
            with self.subTest(name=name):
                item,_=candidates(name,spec,'work')
                self.assertIsNotNone(item)
                self.assertFalse(safe_unit(unit,item['unit']))
                wb=openpyxl.Workbook();ws=wb.active;ws.title='수량'
                ws.append(['구분','품명','규격','수량','단위']);ws.append(['배관공',name,spec,6,unit])
                with self.assertRaises(DbReviewRequired) as cm:align_workbook(wb,'test')
                row=cm.exception.review['rows'][0]
                with self.assertRaisesRegex(ValueError,'수량 확인'):
                    align_workbook(wb,'test',selections={row['key']:{'id':item['id'],'signature':row['signature']}},reviewed=True)
                self.assertEqual(ws['D2'].value,6);self.assertEqual(ws['E2'].value,unit)
                self.assertNotIn(CONTRACT_SHEET,wb.sheetnames)

if __name__=='__main__':unittest.main()
