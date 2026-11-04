import json
import os
import shutil
from pathlib import Path
import subprocess
import unittest
from copy import deepcopy
from work_conditions import resolve, validate_material_conditions, diameters


def mat(name, spec='D80', qty=1, unit='개', identity='m', **conditions):
    return {'id':identity,'name':name,'spec':spec,'qty':qty,'unit':unit,'workConditions':{'version':2,**conditions}}


def joint(identity='J1', diameter=80, mode='separate', coveredBy=''):
    return {'id':identity,'diameter':diameter,'mode':mode,'coveredBy':coveredBy}


class ConditionalRules(unittest.TestCase):
    def check(self, materials):
        before=deepcopy(materials); result=resolve(materials)
        self.assertEqual(result['issues'], [], result['issues'])
        self.assertEqual(materials,before)
        self.assertEqual(validate_material_conditions(materials,result['works']),result['materials'])
        return result

    def test_diameters_are_not_pressure_or_material_length(self):
        for source in ('D20×15','D20*15','20SU×15A','D20mm×D15mm','S20SUx15'):
            self.assertEqual(diameters(source),[20,15])
        self.assertEqual(diameters('D80mm, 바깥나사식'),[80])
        self.assertEqual(diameters('10kg/cm2 D80'),[])

    def test_saddle_drilling_mandatory_even_legacy_false_or_missing(self):
        for conditions in ({},{'drilling':False},{'drilling':None},{'drilling':True}):
            base=mat('부단수할정자관','D200×80',flangeJoints=[joint()],**conditions)
            out=self.check([base])
            self.assertEqual([(w['name'],w['spec']) for w in out['works']],[('부단수할정자관부설및접합','D200'),('부단수 천공 분기점 분기','D80')])
            self.assertTrue(out['materials'][0]['workConditions']['drilling'])
            with self.assertRaises(ValueError):validate_material_conditions([base],out['works'][:1])

    def test_saddle_legacy_m_needs_count_and_preserves_original(self):
        base=mat('부단수할정자관','D200×80',qty=12,unit='M',drilling=False)
        self.assertTrue(resolve([base])['issues'])
        base['workConditions'].update(materialCount=3,installationCount=2,flangeJoints=[joint()])
        out=self.check([base]); self.assertEqual(out['materials'][0]['qty'],3)
        self.assertEqual(out['materials'][0]['originalQuantity'],{'qty':12,'unit':'M'})
        self.assertEqual(out['works'][0]['qty'],2)
        self.assertEqual(resolve(out['materials'])['works'],out['works'])

    def test_saddle_missing_branch_or_joint_and_branch_larger_block(self):
        for spec,wc in [('D200',{'drilling':False,'flangeJoints':[joint()]}),('D200×80',{}),('D80×200',{'flangeJoints':[joint()]})]:
            out=resolve([mat('부단수할정자관',spec,**wc)])
            self.assertTrue(out['issues']);self.assertTrue(out['materials'][0]['workConditions']['drilling'])
        missing=mat('부단수할정자관','D200',drilling=False,flangeJoints=[joint()])
        with self.assertRaises(ValueError):validate_material_conditions([missing],[])

    def test_d50_threaded_no_flange(self):
        out=self.check([mat('소프트실제수밸브(나사식)','D50')])
        self.assertEqual([(w['name'],w['spec']) for w in out['works']],[('소프트실제수밸브설치','D50')])
        self.assertTrue(resolve([mat('소프트실제수밸브(나사식)','D50',connectionType='flanged')])['issues'])

    def test_flange_valve_explicit_and_outer_stem_not_threaded(self):
        self.assertTrue(resolve([mat('소프트실제수밸브','D80mm, 바깥나사식')])['issues'])
        out=self.check([mat('소프트실제수밸브','D50',connectionType='flanged',flangeJoints=[joint(diameter=50)])])
        self.assertEqual(out['works'][0]['name'],'제수변부설및접합')

    def test_socket_both_programs_two_diameters_each_one(self):
        for name,prefix in [('PE청동밸브소켓','PE'),('STS밸브소켓','STS')]:
            out=self.check([mat(name,'D20×15')])
            self.assertEqual([(w['name'],w['spec'],w['qty']) for w in out['works']],[(prefix+'이형관접합','D20',1),('나사식접합','D15',1)])

    def test_same_physical_flange_once_and_distinct_twice(self):
        a=mat('PE소켓플랜지',identity='a',flangeJoints=[joint()])
        b=mat('합플랜지',identity='b',flangeJoints=[joint()])
        out=self.check([a,b]); self.assertEqual(sum(w['qty'] for w in out['works'] if w['name']=='플랜지조인트접합'),1)
        b['workConditions']['flangeJoints'][0]['id']='J2'
        out=self.check([a,b]); self.assertEqual(sum(w['qty'] for w in out['works'] if w['name']=='플랜지조인트접합'),2)

    def test_flange_included_actual_provider(self):
        a=mat('PE소켓플랜지',identity='a',flangeJoints=[joint(mode='included',coveredBy='v')])
        valve=mat('소프트실제수밸브',identity='v',connectionType='flanged',flangeJoints=[joint()])
        out=self.check([a,valve]); self.assertFalse(any(w['name']=='플랜지조인트접합' for w in out['works']))
        self.assertTrue(resolve([a])['issues'])
        valve['workConditions']['flangeJoints'][0]['id']='different'
        self.assertTrue(resolve([a,valve])['issues'])

    def test_flange_included_other_separate_owner(self):
        a=mat('KP 플랜지소켓관',identity='a',flangeJoints=[joint(mode='included',coveredBy='b')])
        b=mat('합플랜지',identity='b',flangeJoints=[joint()])
        out=self.check([a,b]); self.assertEqual(len(out['works']),2)
        self.assertEqual(out['works'][0]['unit'],'본')
        self.assertEqual(out['works'][1]['name'],'플랜지조인트접합')

    def test_drilling_valve_covered_once(self):
        saddle=mat('부단수할정자관','D200×80',identity='s',drilling=True,flangeJoints=[joint()])
        valve=mat('소프트실제수밸브',identity='v',connectionType='flanged',valveCoveredBy='s',flangeJoints=[joint(mode='included',coveredBy='s')])
        out=self.check([saddle,valve]); self.assertEqual(len(out['works']),2)
        duplicate=deepcopy(valve); duplicate['id']='v2'
        self.assertTrue(resolve([saddle,valve,duplicate])['issues'])
        valve['spec']='D100'
        self.assertTrue(resolve([saddle,valve])['issues'])

    def test_kp_6m_and_fitting_one(self):
        for m,qty in [(mat('KP 주철직관(2종)-에폭시분체',qty=12,unit='M'),2),(mat('KP 곡관'),1),(mat('KP 이음관'),1)]:
            out=self.check([m]); self.assertEqual(out['works'][0]['qty'],qty)

    def test_kp_allowance_conditions(self):
        base=mat('KP 주철직관',qty=12,unit='M',identity='k',kpVariant='standard')
        ring=mat('이탈방지압륜(KP부속)',identity='r',unit='조',kpAllowance={'targetMaterialId':'k','state':'add','percent':15,'reason':'현장 검토'})
        out=self.check([base,ring]); a=out['allowances'][0]
        self.assertEqual(a['targetQuantity'],2); self.assertEqual(a['basis'],'all-components'); self.assertEqual(a['percent'],15)
        ring['workConditions']['kpAllowance']['percent']=31
        self.assertTrue(resolve([base,ring])['issues'])
        base['workConditions']['kpVariant']='restraint-included'
        ring['workConditions']['kpAllowance']['state']='included'
        out=self.check([base,ring]); self.assertFalse(out['allowances']); self.assertIn('이탈방지압륜사용',out['works'][0]['spec'])
        ring['workConditions']['kpAllowance']['state']='add'
        self.assertTrue(resolve([base,ring])['issues'])

    def test_kp_d300_requires_review(self):
        base=mat('KP 주철직관','D300',qty=6,unit='M',kpVariant='restraint-included')
        self.assertTrue(resolve([base])['issues'])
        base['workConditions']['kpSourceReviewed']=True
        self.check([base])

    def test_sts_basic_extra_material_preserved(self):
        basic=mat('STS소켓','D20',stsSocketRole='basic')
        out=self.check([basic]); self.assertEqual(len(out['materials']),1); self.assertFalse(out['works'])
        basic['workConditions']['stsSocketRole']='extra'
        out=self.check([basic]); self.assertEqual(out['works'][0]['qty'],1)

    def test_unhandled_preserved_no_xl_pvc_added(self):
        data=[mat(name,identity=str(i)) for i,name in enumerate(('XL삼방티','PVC밸브소켓','앵글밸브(10kg/㎠)','PE티'))]
        out=self.check(data); self.assertFalse(out['works']); self.assertFalse(out['handledIndexes'])

    def test_wrong_size_missing_duplicate_and_tampered_allowance_rejected(self):
        data=[mat('PE청동밸브소켓','D20×15')]; correct=resolve(data)['works']
        for mutate in ('wrong','missing','duplicate'):
            works=deepcopy(correct)
            if mutate=='wrong': works[1]['spec']='D20'
            elif mutate=='missing':works.pop()
            else:works.append({'name':'나사식접합','spec':'D15','qty':1,'unit':'개소'})
            with self.assertRaises(ValueError): validate_material_conditions(data,works)
        base=mat('KP 주철직관',qty=12,unit='M',identity='k')
        ring=mat('이탈방지압륜(KP부속)',identity='r',kpAllowance={'targetMaterialId':'k','state':'add','percent':15,'reason':'검토'})
        works=resolve([base,ring])['works']; works[-1]['allowance']['targetQuantity']=100
        with self.assertRaises(ValueError):validate_material_conditions([base,ring],works)

    def test_invalid_numbers(self):
        for quantity in (True,-1,float('inf'),'invalid'):
            self.assertTrue(resolve([mat('PE청동밸브소켓','D20×15',qty=quantity)])['issues'])

    def test_kp_manual_duplicate_rejected_with_other_materials(self):
        data=[mat('KP 주철직관','D80',qty=12,unit='M'),mat('PE티','D20',identity='p')]
        for tagged in (True,False):
            rows=resolve(data)['works']
            if not tagged:
                for row in rows:row.pop('conditionKey');row.pop('sourceId')
            for name,spec in [('KP메커니컬 접합 및 부설','D80'),('KP 메커니컬 접합 및 부설(인력)','D100')]:
                with self.assertRaises(ValueError):validate_material_conditions(data,rows+[{'name':name,'spec':spec,'qty':1,'unit':'본'}])

    def test_suppressed_work_rejects_old_untagged_rows(self):
        basic=mat('STS소켓','D20',stsSocketRole='basic')
        old={'name':'STS 이형관 접합','spec':'D20','qty':1,'unit':'개소'}
        with self.assertRaises(ValueError): validate_material_conditions([basic],[old])
        # Other STS fittings can legitimately own the same manual work family.
        validate_material_conditions([basic,mat('STS티','D20',identity='t')],[old])
        saddle=mat('부단수할정자관','D200×80',drilling=False,flangeJoints=[joint()])
        generated=resolve([saddle])['works']
        drilling={'name':'부단수 천공 분기점 분기','spec':'D80','qty':1,'unit':'개소'}
        for tagged in (True,False):
            rows=deepcopy(generated)
            if not tagged:
                for row in rows:row.pop('conditionKey');row.pop('sourceId')
            with self.assertRaises(ValueError):validate_material_conditions([saddle],rows+[drilling])
        validate_material_conditions([mat('XL밸브소켓','D20')],[{'name':'나사식접합','spec':'D20','qty':1,'unit':'개소'}])

    def test_javascript_python_parity(self):
        runtime=os.environ.get('NODE_EXECUTABLE') or shutil.which('node')
        js=Path(__file__).with_name('work-conditions.js')
        if not runtime or not Path(runtime).is_file() or not js.is_file():self.skipTest('Node/JS unavailable; set NODE_EXECUTABLE to run parity checks')
        cases=[]
        fixture=os.environ.get('WORK_CONDITIONS_FIXTURE')
        if fixture:cases.extend(c['materials'] for c in json.loads(Path(fixture).read_text(encoding='utf8')))
        cases.extend([[mat('소프트실제수밸브(나사식)','D50')],
                      [mat('부단수할정자관','D200×80',qty=12,unit='M',drilling=False,materialCount=3,installationCount=2)],
                      [mat('부단수할정자관','D200×80',drilling=None)],
                      [mat('합플랜지','D80',flangeJoints=[joint('J1'),joint('J2')])]])
        code="const fs=require('fs'),vm=require('vm');vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));const cases=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(cases.map(c=>WorkConditions.resolve(c))));"
        completed=subprocess.run([str(runtime),'-e',code,str(js)],input=json.dumps(cases,ensure_ascii=False),text=True,encoding='utf8',capture_output=True,check=True)
        actual=json.loads(completed.stdout)
        for index,case in enumerate(cases):
            with self.subTest(index=index): self.assertEqual(resolve(case),actual[index])


if __name__=='__main__':unittest.main()
