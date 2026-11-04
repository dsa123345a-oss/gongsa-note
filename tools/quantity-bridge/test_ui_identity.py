import json
import unittest
import openpyxl
from quantity_db import align_workbook, candidates, catalog, name_key, spec_key, safe_unit, CONTRACT_SHEET, normalize_angle_items, DbReviewRequired


class UiIdentityTests(unittest.TestCase):
    def test_saddle_range_exact_main_and_contained_branch(self):
        for spec, code in [('D80×15','U0000000179'),('D80×20','U0000000179'),('D80×(15~20)','U0000000179'),('D80×25','U0000000180'),('D80×32','U0000000180'),('D100×20','U0000000182')]:
            wb, row = self.fixture('부단수 새들분수전 분기',spec,'개소',qty='=2+3')
            align_workbook(wb,'test')
            record=json.loads(wb[CONTRACT_SHEET]['A4'].value)
            self.assertEqual(record['target']['code'],code)
            self.assertEqual(record['target']['role'],'assembly')
            self.assertEqual(wb['수량']['D2'].value,'=2+3')
            self.assertEqual(record['original']['spec'],spec)
        for spec in ('D80×21','D80×(20~25)','D90×20','D80','D80×100'):
            self.assertIsNone(candidates('부단수 새들분수전 분기',spec,'work')[0])

    def test_saddle_wrong_range_and_main_are_rejected_before_export_writes(self):
        for code in ('U0000000180','U0000000182'):
            for ui in (True,False):
                wb, row = self.fixture('부단수 새들분수전 분기','D80×20','개소')
                target=self.select(row,code)
                kwargs={'ui_identities':[row]} if ui else {}
                if not ui:
                    from quantity_db import quantity_rows
                    record=next(quantity_rows(wb))
                    kwargs={'selections':{record['key']:{'signature':record['signature'],'id':target['id']}}}
                with self.assertRaisesRegex(ValueError,'본관·지관'):align_workbook(wb,'test',**kwargs)
                self.assertEqual(wb['수량']['C2'].value,'D80×20')
                self.assertNotIn(CONTRACT_SHEET,wb.sheetnames)

    def test_material_priority_and_notation_variants_reach_export(self):
        for name in ('PE소켓', 'PE 소켓', ' PE 소 켓 '):
            for spec in ('D20', 'D20SU', '20SU', 'S20SU', 'D 20 SU', 'Φ20mm'):
                for unit in ('개', 'EA', 'ea.', ' E A '):
                    with self.subTest(name=name, spec=spec, unit=unit):
                        wb, _ = self.fixture(name, spec, unit, 'material', qty='=2+3')
                        match, options = candidates(name, spec, 'material')
                        self.assertEqual(len(options), 9)
                        self.assertTrue(all(x['role']=='assembly' for x in options))
                        align_workbook(wb, 'test')
                        record = json.loads(wb[CONTRACT_SHEET]['A4'].value)
                        self.assertEqual(record['target']['id'], match['id'])
                        self.assertEqual(wb['수량']['D2'].value, '=2+3')
                        self.assertEqual(wb['수량']['E2'].value, '개')

    def test_saved_main_choice_is_preserved_but_review_offers_only_extra(self):
        wb, row = self.fixture('PE소켓', 'D20', '개', 'material')
        target = next(x for x in catalog()[0]['items'] if x['kind']=='material' and x['role']=='resource'
                      and name_key(x['name'])=='pe소켓' and spec_key(x['spec'])=='d20')
        row['quantityDb'] = {**target, 'original':{k:row[k] for k in ('name','spec','unit')}}
        align_workbook(wb, 'test', ui_identities=[row])
        self.assertEqual(json.loads(wb[CONTRACT_SHEET]['A4'].value)['target']['id'], target['id'])
        wb, _ = self.fixture('PE소켓', 'D999', '개', 'material')
        with self.assertRaises(DbReviewRequired) as error: align_workbook(wb, 'test')
        self.assertTrue(all(x['role']=='assembly' for x in error.exception.review['rows'][0]['candidates']))
        self.assertEqual(wb['수량']['C2'].value, 'D999')

    def test_unit_aliases_do_not_convert_quantities(self):
        for a,b in [('㎥','m^3'),('㎡','m²'),('T','톤'),('ℓ','리터'),('M','미터')]: self.assertTrue(safe_unit(a,b))
        for a,b in [('M','본'),('kg','Ton'),('개','조')]: self.assertFalse(safe_unit(a,b))

    def test_user_confirmed_sts_elbow_uses_threaded_material_family(self):
        item, options = candidates('STS엘보', 'D20', 'material')
        self.assertIsNotNone(item)
        self.assertEqual(item['name'], 'STS 엘보 (나사식)')
        self.assertEqual(item['role'], 'resource')
        self.assertTrue(all('나사식' in option['name'] for option in options))

    def test_angle_material_choice_moves_to_material_included_work(self):
        for field in ('spec','std'):
            for existing in (False, True):
                material={'name':'앵글밸브(10kg/㎠)',field:'D15','unit':'개','qty':2}
                target,_=candidates(material['name'],'D15','work')
                material['quantityDb']={**target,'original':{'name':material['name'],'spec':'D15','unit':'개'}}
                old=[{'name':'앵글밸브 교체',field:'D15','unit':'개소','qty':2}] if existing else []
                mats,works=normalize_angle_items([material],old,field)
                self.assertEqual(mats,[]); self.assertEqual(len(works),1)
                selected=works[0]['quantityDb']
                self.assertEqual(selected['id'],target['id'])
                self.assertEqual(selected['original'],{'name':'앵글밸브 교체','spec':'D15','unit':'개소'})
                wb,row=self.fixture('앵글밸브 교체','D15','개소')
                row['quantityDb']=selected
                align_workbook(wb,'test',ui_identities=[row])
                self.assertEqual(json.loads(wb[CONTRACT_SHEET]['A4'].value)['target']['id'],target['id'])

    def test_angle_stale_choice_is_not_rebased_as_valid(self):
        material={'name':'앵글밸브(10kg/㎠)','spec':'D20','unit':'개','qty':2}
        target,_=candidates(material['name'],'D15','work')
        material['quantityDb']={**target,'original':{'name':material['name'],'spec':'D15','unit':'개'}}
        with self.assertRaisesRegex(ValueError,'다시 선택'):normalize_angle_items([material],[])

    def test_angle_ui_can_store_the_known_material_included_work_identity(self):
        material={'name':'앵글밸브(10kg/㎠)','spec':'D15','unit':'개','qty':2}
        target,_=candidates(material['name'],'D15','work')
        material['quantityDb']={**target,'original':{'name':'앵글밸브 교체','spec':'D15','unit':'개소'}}
        _,works=normalize_angle_items([material],[])
        self.assertEqual(works[0]['quantityDb']['id'],target['id'])
        self.assertEqual(works[0]['quantityDb']['original']['name'],'앵글밸브 교체')

    def test_existing_frp_and_pe_saddle_labels_find_the_same_db_family(self):
        for alias, canonical in [('FRP보호통','FRP 제수밸브보호통'), ('새들붙이분수전(PE관용)','새들붙이분수전(PE용)')]:
            _, options = candidates(alias, '', 'material')
            self.assertTrue(any(x['role']=='assembly' and x['name']==canonical for x in options))

    def fixture(self, name, spec, unit, kind='work', qty=2):
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = '수량'
        ws.append(['구분', '품명', '규격', '수량', '단위'])
        ws.append(['자재대' if kind == 'material' else '배관공', name, spec, qty, unit])
        return wb, {'name': name, 'spec': spec, 'unit': unit, 'kind': kind, 'qty': qty}

    def select(self, source, code, **extra):
        _, options = candidates(source['name'], source['spec'], source['kind'])
        target = next(x for x in options if x['code'] == code and x['role'] == 'assembly')
        source['quantityDb'] = {**target, 'original': {k: source[k] for k in ('name','spec','unit')}, **extra}
        return target

    def test_canonical_name_unit_and_formula_are_preserved_together(self):
        wb, row = self.fixture('PE이형관접합', 'D20', '개소', qty='=2+3')
        target = self.select(row, 'U0000000009')
        align_workbook(wb, 'test', ui_identities=[row])
        self.assertEqual([wb['수량'][c].value for c in ('B2','C2','E2')], [target[k] for k in ('name','spec','unit')])
        self.assertEqual(wb['수량']['D2'].value, '=2+3')
        record = json.loads(wb[CONTRACT_SHEET]['A4'].value)
        self.assertEqual(record['target']['id'], target['id'])

    def test_selected_sts_method_and_kp_method_reach_workbook(self):
        for name, code in [('STS이형관접합','U0000000100'), ('KP메커니컬 접합 및 부설','U0000000406')]:
            with self.subTest(name=name):
                wb, row = self.fixture(name, 'D20' if name.startswith('STS') else 'D80', '개소' if name.startswith('STS') else '본')
                target = self.select(row, code)
                align_workbook(wb, 'test', ui_identities=[row])
                self.assertEqual(wb['수량']['C2'].value, target['spec'])
                self.assertEqual(json.loads(wb[CONTRACT_SHEET]['A4'].value)['target']['code'], code)

    def test_emergency_whitespace_normalization(self):
        wb, row = self.fixture('STS이형관접합', 'D20', '개소')
        row['name'] = 'STS 이형관 접합'
        target = self.select(row, 'U0000000100')
        align_workbook(wb, 'test', ui_identities=[row])
        self.assertEqual(wb['수량']['B2'].value, target['name'])

    def test_stale_original_and_forged_catalogue_are_rejected_before_writes(self):
        for corrupt in ('original', 'source', 'unit'):
            wb, row = self.fixture('PE이형관접합', 'D20', '개소')
            self.select(row, 'U0000000009')
            if corrupt == 'original': row['quantityDb']['original']['spec'] = 'D25'
            else: row['quantityDb'][corrupt] = 'wrong'
            with self.assertRaises(ValueError): align_workbook(wb, 'test', ui_identities=[row])
            self.assertEqual(wb['수량']['B2'].value, 'PE이형관접합')
            self.assertNotIn(CONTRACT_SHEET, wb.sheetnames)

    def test_same_source_cannot_silently_pick_two_kp_methods(self):
        wb, a = self.fixture('KP메커니컬 접합 및 부설', 'D80', '본')
        b = dict(a); self.select(a, 'U0000000406'); self.select(b, 'U0000000392')
        with self.assertRaisesRegex(ValueError, '서로 다른 DB'):
            align_workbook(wb, 'test', ui_identities=[a, b])

    def test_selected_record_not_exported_is_not_silently_ignored(self):
        wb, row = self.fixture('PE이형관접합', 'D20', '개소')
        self.select(row, 'U0000000009'); wb['수량']['C2'] = 'D25'
        with self.assertRaisesRegex(ValueError, '찾지 못했습니다'):
            align_workbook(wb, 'test', ui_identities=[row])

    def test_old_m_cannot_be_relabeled_to_count_even_with_confirmation(self):
        wb, row = self.fixture('부단수할정자관 부설및접합', 'D200', 'M')
        self.select(row, 'U0000000195', unitConfirmed=True, quantity=2)
        with self.assertRaisesRegex(ValueError, '수량·단위를 먼저'):
            align_workbook(wb, 'test', ui_identities=[row])
        self.assertEqual(wb['수량']['E2'].value, 'M')

    def test_count_set_requires_current_quantity_confirmation(self):
        for confirmation, allowed in [({}, False), ({'unitConfirmed':True,'quantity':1}, False), ({'unitConfirmed':True,'quantity':2}, True)]:
            wb, row = self.fixture('이탈방지압륜(KP부속)', 'D80', '개', 'material')
            self.select(row, 'M0000000107', **confirmation)
            if allowed:
                align_workbook(wb, 'test', ui_identities=[row])
                self.assertEqual(wb['수량']['E2'].value, '조'); self.assertEqual(wb['수량']['D2'].value, 2)
            else:
                with self.assertRaises(ValueError): align_workbook(wb, 'test', ui_identities=[row])


if __name__ == '__main__': unittest.main()
