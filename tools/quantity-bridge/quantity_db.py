"""Shared DB identity contract for the two quantity generators.

Only presentation/identity is aligned here. Quantities, formulas and prices
are not recalculated or replaced. Ambiguous specifications require review.
"""
from functools import lru_cache
from numbers import Number
from pathlib import Path
import hashlib
import json
import re
import unicodedata
import math
from copy import deepcopy
from openpyxl.cell.cell import MergedCell

CONTRACT_SHEET = '_공사노트연동'
CONTRACT_MAGIC = 'gongsa.quantity.v1'


def normalize_angle_items(materials, works, spec_field='spec'):
    """The user's angle-valve work is a material-included assembly, once only."""
    materials, works = deepcopy(materials or []), deepcopy(works or [])
    is_angle = lambda row: name_key(row.get('name')) == '앵글밸브교체'
    def selected_work(row):
        selected = row.get('quantityDb')
        if not selected:
            return None
        original = {'name':row.get('name'), 'spec':row.get(spec_field, ''), 'unit':row.get('unit')}
        transformed = {**original, 'name':'앵글밸브 교체', 'unit':'개소'}
        accepted = {_ui_identity_key(original, 'work'), _ui_identity_key(transformed, 'work')}
        if not isinstance(selected, dict) or selected.get('kind') != 'work' or not isinstance(selected.get('original'), dict) or _ui_identity_key(selected['original'], 'work') not in accepted:
            raise ValueError('앵글밸브는 자재 포함 교체 일위를 다시 선택하세요.')
        return deepcopy(selected)
    def attach_work(row, selected):
        if selected:
            row['quantityDb'] = deepcopy(selected)
            row['quantityDb']['original'] = {'name':row['name'], 'spec':str(row.get(spec_field, '') or ''), 'unit':str(row.get('unit', '') or '')}
    def quantity(row):
        raw=row.get('qty',0)
        try:value=float(str(raw if raw is not None else '').replace(',','').strip() or 0)
        except (TypeError,ValueError):raise ValueError('앵글밸브 수량을 숫자로 입력하세요.')
        if not math.isfinite(value) or value<0 or isinstance(raw,bool):
            raise ValueError('앵글밸브 수량은 0 이상의 유효한 숫자로 입력하세요.')
        return value
    materials=[r for r in materials if not is_angle(r) or quantity(r)>0]
    works=[r for r in works if not is_angle(r) or quantity(r)>0]
    size_key=lambda row:pipe_diameter_key(row.get(spec_field))
    groups = {}
    for row in works:
        if is_angle(row):
            selected = selected_work(row)
            row['name']='앵글밸브 교체'
            attach_work(row, selected)
    for row in materials:
        if is_angle(row):groups.setdefault(size_key(row),[]).append(row)
    for spec, group in groups.items():
        related=[r for r in works if is_angle(r) and size_key(r)==spec]
        total=sum(quantity(r) for r in group)
        selected = [choice for row in group+related if (choice := selected_work(row))]
        if len({choice['id'] for choice in selected}) > 1:
            raise ValueError('같은 앵글밸브에 서로 다른 교체 일위를 선택했습니다.')
        choice = selected[0] if selected else None
        if related:
            if abs(total-sum(quantity(r) for r in related))>1e-8:
                raise ValueError('앵글밸브는 자재 포함 일위로 계산합니다. 자재와 교체 작업의 수량이 달라 확인이 필요합니다: '+str(group[0].get(spec_field,'')))
            for row in related:
                attach_work(row, choice)
        else:
            row={**group[0],'name':'앵글밸브 교체','qty':total,'unit':'개소'}
            attach_work(row, choice)
            works.append(row)
    return [r for r in materials if not is_angle(r)],works


def compact(value):
    return re.sub(r'[\s\u200b-\u200d\ufeff,._\-()\[\]]', '', unicodedata.normalize('NFKC', str(value or '')).lower())


def name_key(value):
    name = compact(value)
    name = re.sub(r'소프트(?:실)?(?:제수|지수)(?:밸브|변)', '소프트제수밸브', name)
    name = re.sub(r'보도(?:용)?블[럭록]', '보도블록', name)
    name = name.replace('계량기보호함', '계량기보호통').replace('xl정티', 'xl삼방티')
    name = name.replace('관로모래부설', '모래부설')
    name = re.sub(r'^앵글밸브(?:10kg/cm2)?(?:자재포함)?$', '앵글밸브교체', name)
    aliases = {'pe접합및부설':'pe관접합및부설', 'sts접합및부설':'sts관접합및부설',
               'sts관부설및접합':'sts관접합및부설', '되메우기':'되메우기및다짐',
               '이탈방지압륜kp부속':'이탈방지압륜', '아스팔트소운반':'아스콘소운반',
               '소형감압밸브설치':'소형감압변설치',
               'frp보호통':'frp제수밸브보호통',
               '새들붙이분수전pe관용':'새들붙이분수전pe용',
               'sts엘보':'sts엘보나사식'}
    return aliases.get(name, name)


def spec_key(value):
    text = unicodedata.normalize('NFKC', str(value or '')).lower()
    text = re.sub(r'\s+', '', text).replace('×', 'x').replace('*', 'x').replace('ton', '톤')
    text = re.sub(r'(금강송|후포|온정|평해|울진|죽변|기성|근남|매화|북)(?:읍|면)', r'\1', text)
    text = re.sub(r'(dn|d|[φø∅])=', r'\1', text)
    text = re.sub(r'(^|[=(/,x·;\-])(?:dn|d|s(?=\d+(?:\.\d+)?su)|[φø∅])?(\d+(?:\.\d+)?)(?:su|a|mm)?(?=$|[)/,x·;\-])',
                  lambda m:m[1]+'d'+format(float(m[2]), 'g'), text)
    if '백호' in text:
        text = re.sub(r'기계(?=\d+%)', '', text)
    return text


def unit_key(value):
    unit = compact(value).replace('당', '').replace('^', '')
    return {'톤':'ton', 't':'ton', '리터':'l', '미터':'m', '제곱미터':'m2', '세제곱미터':'m3'}.get(unit, unit)


def pipe_diameter_key(value):
    return re.sub(r'd(?:13|15|16)(?=$|[)/,x·;\-])', 'd15', spec_key(value))


def safe_unit(a, b):
    x, y = unit_key(a), unit_key(b)
    return not x or x == y or {x, y} <= {'개', '개소', 'ea'}


def saddle_pair(value):
    text = re.sub(r'\s', '', unicodedata.normalize('NFKC', str(value or '')).lower())
    text = re.sub(r'[×*]', 'x', text)
    text = re.sub(r'[〜∼–—]', '~', text)
    text = re.sub(r'(dn|d|[φø∅])=', r'\1', text)
    number = r'(?:dn|d|[φø∅])?(\d+(?:\.\d+)?)(?:su|a|mm)?'
    match = re.fullmatch(number + r'x\(?' + number + r'(?:[~\-]' + number + r')?\)?', text)
    if not match:
        return None
    main, low, high = float(match[1]), float(match[2]), float(match[3] or match[2])
    return (main, low, high) if main > 0 and 0 < low <= high <= main else None


def saddle_contains(source, target):
    a, b = saddle_pair(source), saddle_pair(target)
    return bool(a and b and a[0] == b[0] and a[1] >= b[1] and a[2] <= b[2])


def saddle_work(name, kind):
    return kind == 'work' and name_key(name) == '부단수새들분수전분기'


@lru_cache(maxsize=1)
def catalog():
    data = json.loads(Path(__file__).with_name('quantity_db_catalog.json').read_text(encoding='utf8'))
    if data.get('schema') != 1:
        raise ValueError('단가 DB 품목 기준 파일을 확인하세요.')
    index = {}
    for item in data['items']:
        index.setdefault(name_key(item['name']), []).append(item)
    return data, index


@lru_cache(maxsize=1)
def additional_material_families():
    return frozenset(name_key(x['name']) for x in catalog()[0]['items']
                     if x['kind'] == 'material' and x['role'] == 'assembly')


def visible_candidates(items):
    families = additional_material_families()
    return [x for x in items if x['kind'] != 'material' or x['role'] == 'assembly'
            or name_key(x['name']) not in families]


def candidates(name, spec, kind, *, include_saved=False):
    _, index = catalog()
    family = [x for x in index.get(name_key(name), []) if not kind or x['kind'] == kind]
    available = visible_candidates(family)
    exact = [x for x in available if spec_key(x['spec']) == spec_key(spec)]
    # Explicitly confirmed pipe-diameter equivalents; never a generic nearest size.
    confirmed_diameter_work = kind == 'work' and name_key(name) in (
        '나사식접합', '계량기설치', '계량기보호통설치', '소형감압변설치')
    if not exact and (confirmed_diameter_work or re.search('관|밸브|소켓|파이프|티|엘보|플랜지', name_key(name))):
        exact = [x for x in available if pipe_diameter_key(x['spec']) == pipe_diameter_key(spec)]
    if saddle_work(name, kind):
        exact = [x for x in available if saddle_contains(spec, x['spec'])]
    preferred = [x for x in exact if x['role'] == 'assembly'] or exact
    canonical = [x for x in preferred if compact(x['name']) == name_key(name)]
    preferred = canonical or preferred
    match = preferred[0] if len(preferred) == 1 else None
    # Missing construction methods are suggestions only, never inferred.
    if not family:
        for key,items in index.items():
            if key.startswith(name_key(name)) and len(name_key(name))>=4:
                family.extend(x for x in items if (not kind or x['kind']==kind) and x['name'].split('(')[0].replace(' ','')==str(name).replace(' ',''))
    # A generic KP family exists alongside the explicitly manual method. Keep
    # method selection deliberate, but do not hide that method from the review.
    if kind=='work' and name_key(name)=='kp메커니컬접합및부설':
        family=list(family)
        seen={x['id'] for x in family}
        for key,items in index.items():
            if key.startswith(name_key(name)):
                family.extend(x for x in items if x['kind']=='work' and x['id'] not in seen)
                seen.update(x['id'] for x in items)
    # Only existing validated UI identities may reference the hidden main copy.
    # New choices/review lists always use the additional material family first.
    ordered = sorted(family if include_saved else visible_candidates(family), key=lambda x:(x['role'] != 'assembly', spec_key(x['spec']) != spec_key(spec), x['spec'], x['code']))
    return match, ordered


def resolved_cell(wb, sheet, cell, seen=None):
    """Follow only simple references and IF(ref="","",ref), never arbitrary formula code."""
    seen = set() if seen is None else seen
    key = (sheet.title, cell.coordinate)
    if key in seen:
        return None, None
    seen.add(key)
    value = cell.value
    if value is None:
        return '', cell
    if not isinstance(value, str) or not value.startswith('='):
        return str(value), cell
    ref = r"(?:(?:'([^']+)'|([\w가-힣]+))!)?(\$?[A-Z]+\$?\d+)"
    matches = list(re.finditer(ref, value[1:]))
    identifiers = {(m[1] or m[2] or sheet.title, m[3].replace('$','')) for m in matches}
    stripped = re.sub(ref, 'REF', value[1:]).replace(' ', '').upper()
    if len(identifiers) != 1 or stripped not in ('REF', 'IF(REF="","",REF)'):
        return None, None
    tab, address = next(iter(identifiers))
    if tab not in wb.sheetnames:
        return None, None
    return resolved_cell(wb, wb[tab], wb[tab][address], seen)


def quantity_rows(wb):
    """Identify the generator's left/right quantity blocks by their actual headers."""
    if '수량' not in wb.sheetnames:
        raise ValueError('수량 시트를 찾지 못했습니다.')
    ws = wb['수량']
    maps = {}
    for row in ws:
        headers = [c for c in row if compact(c.value) in ('공종','품목','품명')]
        for head in headers:
            right = [c for c in row if c.column > head.column]
            get = lambda label:next((c.column for c in right if compact(c.value) == label), None)
            q, u, s = get('수량'), get('단위'), get('규격')
            if not q or not u or not s:
                continue
            groups = [c.column for c in row if c.column < head.column and compact(c.value) == '구분']
            maps[head.column] = {'name':head.column,'spec':s,'qty':q,'unit':u,'basis':get('산출근거') or q,'group':max(groups) if groups else 1,'header':head.row,'groupName':''}
        for block in maps.values():
            r = row[0].row
            if r <= block['header']:
                continue
            group = ws.cell(r, block['group']).value
            if isinstance(group, str) and group.strip() and not group.startswith('='):
                block['groupName'] = group.strip()
            cells = {k:ws.cell(r, block[k]) for k in ('name','spec','qty','unit')}
            name, origin_name = resolved_cell(wb, ws, cells['name'])
            spec, origin_spec = resolved_cell(wb, ws, cells['spec'])
            if not spec:
                for column in range(block['spec']+1, block['basis']):
                    alternate=ws.cell(r,column)
                    if re.fullmatch(r'(?:D|DN|Φ|φ|ø)?\s*\d+\s*(?:A|SU|mm)?',str(alternate.value or '').strip(),re.I):
                        cells['spec']=alternate
                        spec,origin_spec=resolved_cell(wb,ws,alternate)
                        break
                # Paving rows merge the name across the nominal specification
                # column. Their real specification box is the next empty anchor.
                if isinstance(origin_spec,MergedCell):
                    for column in range(block['spec']+1,block['basis']):
                        alternate=ws.cell(r,column)
                        if not isinstance(alternate,MergedCell) and alternate.value in (None,''):
                            cells['spec']=alternate
                            spec,origin_spec=resolved_cell(wb,ws,alternate)
                            break
            unit, origin_unit = resolved_cell(wb, ws, cells['unit'])
            q = cells['qty'].value
            if not name or compact(name) in ('공종','품목','품명','합계','소계') or not unit or not isinstance(q,(str,int,float)) or isinstance(q,bool):
                continue
            if isinstance(q,str) and not q.startswith('='):
                try:float(q)
                except ValueError:continue
            if isinstance(q,(int,float)) and q == 0:
                continue
            if spec is None:
                continue  # Compound regional formulas stay intact and use the normal workbook reader.
            original = {'name':name.strip(),'spec':spec.strip(),'unit':unit.strip()}
            key = f"{ws.title}!{cells['name'].coordinate}/{cells['qty'].coordinate}"
            signature = hashlib.sha256(json.dumps(original,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:20]
            kind = 'material' if re.search('자재|재료|관급',block['groupName']) else 'work'
            match, options = candidates(name, spec, kind)
            if match and not safe_unit(unit, match['unit']):match = None
            yield {'key':key,'signature':signature,'sheet':ws.title,'group':block['groupName'],'kind':kind,
                   'refs':{k:c.coordinate for k,c in cells.items()},'original':original,
                   'target':match,'candidates':options,'origins':{'name':origin_name,'spec':origin_spec,'unit':origin_unit}}


class DbReviewRequired(Exception):
    def __init__(self, review):
        self.review = review
        super().__init__('단가 DB 품목을 확인하세요.')


def numeric_input(value):
    """Numeric identity references may also supply dimensions/quantity formulas."""
    if isinstance(value, Number):
        return True
    if isinstance(value, str):
        try:
            float(value.replace(',', '').strip())
            return True
        except ValueError:
            pass
    return False


def _ui_identity_key(row, kind):
    # The emergency writer removes whitespace. No other spelling or dimension
    # transformation is allowed when checking that a saved selection is current.
    clean = lambda value: re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(value or '')))
    return (kind,) + tuple(clean(row.get(k)) for k in ('name', 'spec', 'unit'))


def _ui_identity_choices(rows, identities):
    if identities is None:
        return {}
    if not isinstance(identities, list):
        raise ValueError('입력화면의 DB 품목 선택 정보를 확인하세요.')
    by_id = {item['id']: item for item in catalog()[0]['items']}
    forced = {}
    available = {_ui_identity_key(row['original'], row['kind']) for row in rows}
    for source in identities:
        if not isinstance(source, dict):
            raise ValueError('입력화면의 DB 품목 선택 정보를 확인하세요.')
        selected = source.get('quantityDb')
        if not selected:
            continue
        if not isinstance(selected, dict) or source.get('kind') not in ('material', 'work'):
            raise ValueError('입력화면의 DB 품목 종류를 확인하세요.')
        kind = source['kind']
        original = selected.get('original')
        if not isinstance(original, dict) or _ui_identity_key(original, kind) != _ui_identity_key(source, kind):
            raise ValueError('DB 품목 선택 후 품명·규격·단위가 바뀌었습니다. 입력화면에서 다시 선택하세요: '+str(source.get('name', '')))
        target = by_id.get(selected.get('id'))
        if not target or any(selected.get(k) != target[k] for k in ('source', 'code', 'name', 'spec', 'unit', 'kind')) or target['kind'] != kind:
            raise ValueError('입력화면에서 선택한 DB 품목이 현재 기준과 다릅니다: '+str(source.get('name', '')))
        if not safe_unit(source.get('unit'), target['unit']):
            count_units = {'개', '개소', 'ea', '조', '기', '본'}
            if not {unit_key(source.get('unit')), unit_key(target['unit'])} <= count_units:
                raise ValueError('입력화면의 수량·단위를 먼저 DB 기준으로 수정하세요: '+str(source.get('name', '')))
            if selected.get('unitConfirmed') is not True:
                raise ValueError('DB 단위 적용 후 수량 확인이 필요합니다: '+str(source.get('name', '')))
            try:
                before, current = float(selected.get('quantity')), float(source.get('qty'))
            except (ValueError, TypeError):
                raise ValueError('DB 단위 변경의 확인 수량을 다시 입력하세요: '+str(source.get('name', '')))
            if not math.isfinite(before) or not math.isfinite(current) or abs(before-current)>1e-8:
                raise ValueError('DB 단위 확인 후 수량이 바뀌었습니다. 다시 확인하세요: '+str(source.get('name', '')))
        key = _ui_identity_key(source, kind)
        if key not in available:
            try: zero = float(source.get('qty')) == 0
            except (ValueError, TypeError): zero = False
            if zero:
                continue
            raise ValueError('입력화면에서 선택한 품목을 수량산출서에서 찾지 못했습니다: '+str(source.get('name', '')))
        if key in forced and forced[key]['id'] != target['id']:
            raise ValueError('같은 품명·규격 행에 서로 다른 DB 품목을 선택했습니다. 규격·공법을 구분하세요: '+str(source.get('name', '')))
        forced[key] = target
    return forced


def align_workbook(wb, producer, project_name='', location='', selections=None, reviewed=False, work_conditions=None, ui_identities=None):
    if (work_conditions or {}).get('issues'):
        raise ValueError('접합 조건을 확인하세요: '+' / '.join(x['message'] for x in work_conditions['issues']))
    data,_ = catalog()
    rows = list(quantity_rows(wb))
    ui_choices = _ui_identity_choices(rows, ui_identities)
    # Percentage work created by an explicit, validated KP condition is an
    # adjustment, not a missing catalogue item. Match the visible identity.
    allowance_works=[w for w in (work_conditions or {}).get('works',[]) if w.get('allowance')]
    used_allowances=set()
    for row in rows:
        visible_quantity,_=resolved_cell(wb,wb[row['sheet']],wb[row['sheet']][row['refs']['qty']])
        try:visible_quantity=float(visible_quantity)
        except (TypeError,ValueError):visible_quantity=None
        matches=[(i,w) for i,w in enumerate(allowance_works) if i not in used_allowances and
                 all(str(row['original'][k]).strip()==str(w[k]).strip() for k in ('name','spec','unit'))
                 and visible_quantity is not None and abs(visible_quantity-w['qty'])<1e-8]
        if matches:
            i,w=matches[0];used_allowances.add(i);row['allowance']=deepcopy(w['allowance'])
    if len(used_allowances)!=len(allowance_works):
        raise ValueError('압륜 가산의 수량·요율 행이 수량 시트와 일치하지 않습니다.')
    selections = selections if isinstance(selections,dict) else {}
    for row in rows:
        ui_target = ui_choices.get(_ui_identity_key(row['original'], row['kind']))
        if ui_target:
            _, saved_family = candidates(row['original']['name'], row['original']['spec'], row['kind'], include_saved=True)
            if not any(item['id'] == ui_target['id'] for item in saved_family):
                raise ValueError('입력화면의 DB 선택이 현재 품목과 다릅니다: '+row['original']['name'])
            row['target'] = ui_target
        choice = selections.get(row['key'])
        if choice:
            if not isinstance(choice,dict) or choice.get('signature') != row['signature']:
                raise ValueError('품목 선택 후 입력 내용이 바뀌었습니다. 다시 확인하세요.')
            if ui_target and choice.get('id') != ui_target['id']:
                raise ValueError('입력화면의 DB 선택과 엑셀 품목 선택이 다릅니다. 입력화면에서 변경하세요: '+row['original']['name'])
            if choice.get('id') == 'keep':row['target'] = None
            else:
                target = next((x for x in row['candidates'] if x['id'] == choice.get('id')), None)
                if not target:raise ValueError('선택한 DB 품목이 현재 입력과 일치하지 않습니다.')
                if not safe_unit(row['original']['unit'],target['unit']) and not choice.get('confirmUnit'):
                    raise ValueError('DB 단위 적용 후 수량 확인이 필요합니다: '+row['original']['name'])
                row['target'] = target
        target=row.get('target')
        if target and saddle_work(row['original']['name'], row['kind']) and not saddle_contains(row['original']['spec'], target['spec']):
            raise ValueError('새들분수전 분기의 본관·지관 관경이 선택한 DB 적용범위와 다릅니다: '+row['original']['spec'])
        if work_conditions and target and 'kp' in name_key(row['original']['name']):
            expected_included='이탈방지압륜' in row['original']['spec']
            selected_included='이탈방지압륜' in target['spec']
            if expected_included!=selected_included:
                raise ValueError('KP 압륜 가산 포함 여부가 작업 조건과 다릅니다. 적용품을 다시 선택하세요.')
    unresolved = [r for r in rows if not r['target'] and not r.get('allowance')]
    if unresolved and (not reviewed or any(r['key'] not in selections for r in unresolved)):
        raise DbReviewRequired({'version':data['version'],'matched':len(rows)-len(unresolved),'rows':[
            {k:r[k] for k in ('key','signature','group','original','target','candidates')} for r in unresolved]})
    # A referenced identity cell can be shared by several lines. Do not let the
    # last line silently replace an earlier line's chosen identity.
    writes = {}
    conflicts = set()
    quantity_cells = {(row['sheet'], row['refs']['qty']) for row in rows}
    for row in rows:
        expected=row['target'] or row['original']
        for field, origin in row['origins'].items():
            if origin is None:raise ValueError('품목 셀의 연결을 확인하세요.')
            if isinstance(origin,MergedCell):
                if expected[field]:raise ValueError('병합된 품목 행에 규격 입력 칸이 없습니다. 원본 입력을 확인하세요: '+row['original']['name'])
                continue
            key = (origin.parent.title, origin.coordinate)
            # Following a specification reference is safe for text identities,
            # but its numeric source can also drive a quantity elsewhere. Check
            # every planned write before changing any cell, including item names.
            if row['target'] and origin.value != expected[field] and (key in quantity_cells or numeric_input(origin.value)):
                raise ValueError('DB 품목 적용이 수량 또는 숫자 입력 셀을 변경하므로 중단했습니다: '
                                 + f'{key[0]}!{key[1]}. 품목·규격 입력을 수량 계산 셀과 분리해 주세요.')
            prior = writes.get(key)
            if prior and prior[0] != expected[field]:
                conflicts.update([row['key'], prior[1]])
            writes[key] = (expected[field], row['key'])
    if conflicts:
        raise ValueError('여러 행이 같은 품목 셀을 참조하지만 서로 다른 DB 품목을 선택했습니다. 원본 입력을 나누어 주세요.')
    records = []
    for row in rows:
        target = row['target']
        if target:
            for field in ('name','spec','unit'):
                origin = row['origins'][field]
                if origin is None:raise ValueError('품목 셀의 연결을 확인하세요.')
                if not isinstance(origin,MergedCell):origin.value = target[field]
        expected = {k:(target or row['original'])[k] for k in ('name','spec','unit')}
        records.append({'key':row['key'],'sheet':row['sheet'],'refs':row['refs'],'expected':expected,
                        'target':target,'original':row['original'],'status':'linked' if target else 'unresolved'})
        if row.get('allowance'):
            records[-1]['status']='conditional'
            records[-1]['allowance']=row['allowance']
    for record in records:
        a=record.get('allowance')
        if not a:continue
        targets=[r for r in records if name_key(r['original']['name'])==name_key(a['targetName'])
                 and spec_key(r['original']['spec'])==spec_key(a['targetSpec'])
                 and unit_key(r['original']['unit'])==unit_key(a['targetUnit'])]
        if not targets:raise ValueError('압륜 가산의 대상 KP 품을 수량 시트에서 찾지 못했습니다.')
        if any('이탈방지압륜' in r['expected']['spec'] for r in targets):
            raise ValueError('이미 압륜 가산이 포함된 KP 품에 별도 가산을 연결할 수 없습니다.')
        a['targetKeys']=[r['key'].replace('/', ' / ') for r in targets]
        a['targetIdentities']=[r['expected'] for r in targets]
        a['targetTotalQuantity']=sum(float(w['qty']) for w in (work_conditions or {}).get('works',[])
            if name_key(w['name'])==name_key(a['targetName']) and spec_key(w['spec'])==spec_key(a['targetSpec'])
            and unit_key(w['unit'])==unit_key(a['targetUnit']))
    if CONTRACT_SHEET in wb.sheetnames:del wb[CONTRACT_SHEET]
    meta = wb.create_sheet(CONTRACT_SHEET);meta.sheet_state = 'veryHidden'
    meta['A1'] = CONTRACT_MAGIC
    meta['A2'] = json.dumps({'schema':1,'producer':producer,'catalogVersion':data['version'],
                            'projectName':project_name,'location':location,'titleRef':'수량!E2',
                            'workConnectionJoints':(work_conditions or {}).get('workConnectionJoints',[])},ensure_ascii=False)
    for i,record in enumerate(records,4):meta.cell(i,1,json.dumps(record,ensure_ascii=False,separators=(',',':')))
    return {'matched':len(rows)-len(unresolved),'unresolved':len(unresolved),'total':len(rows),'version':data['version']}
