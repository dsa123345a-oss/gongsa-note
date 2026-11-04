"""Explicit physical-joint rules shared with work-conditions.js; no price inference."""
from collections import defaultdict
from copy import deepcopy
import math
import json
import re
import unicodedata

VERSION = 2


def compact(value):
    return re.sub(r'\s', '', unicodedata.normalize('NFKC', str(value if value is not None else '')).lower())


def diameters(value):
    text = re.sub(r'\s', '', unicodedata.normalize('NFKC', str(value if value is not None else '')))
    text = re.sub(r'^(?:본관|관측)[:：]?', '', text)
    match = re.match(r'^(?:(?:DN|D|S|[ΦφØø∅])=?)*([0-9]+(?:\.[0-9]+)?)(?:mm|SU|A)?(?:[xX×*](?:(?:DN|D|S|[ΦφØø∅])=?)*([0-9]+(?:\.[0-9]+)?)(?:mm|SU|A)?)?(?=$|[(/,;·])', text, re.I)
    return [float(x) for x in match.groups() if x] if match else []


def diameter(value):
    values = diameters(value)
    return values[0] if len(values) == 1 and values[0] > 0 else None


def category(row):
    n = compact(row.get('name'))
    if '부단수할정자관' in n: return 'saddle'
    if re.match(r'^소프트(?:실)?(?:제수|지수)(밸브|변)', n) or n in ('제수밸브', '제수변'): return 'valve'
    if n in ('pe청동밸브소켓', 'sts밸브소켓'): return 'socket'
    if '이탈방지압륜' in n: return 'restraint'
    if 'pe소켓플랜지' in n or n in ('합플랜지', '플랜지관'): return 'flange'
    if 'kp' in n: return 'kp'
    if n == 'sts소켓': return 'sts-socket'
    return ''


def _fmt(value): return format(value, 'g')


def _quantity(value):
    if isinstance(value, bool) or value is None or value == '': return None
    try: result = float(value)
    except (TypeError, ValueError): return None
    return result if math.isfinite(result) else None


def resolve(input, existingWorks=None):
    materials = deepcopy(input or [])
    works, issues, allowances, handled_ids, handled_indexes = [], [], [], [], []
    ids, infos, ledger, restraints = {}, [], defaultdict(list), []
    def problem(m, message): issues.append({'materialId': str(m.get('id')), 'message': str(m.get('name', '자재')) + ': ' + message})
    for i, m in enumerate(materials):
        if not isinstance(m, dict): m = {'name': '잘못된 자재 행', 'qty': None}; materials[i] = m
        identity = m.get('id') if m.get('id') is not None else m.get('_id')
        m['id'] = str(identity if identity is not None else 'material-' + str(i))
        if m['id'] in ids: problem(m, '자재 식별번호가 중복되었습니다.')
        ids[m['id']] = m
    def add(m, name, spec, qty, unit, extra=None):
        condition_key = json.dumps([m['id'], name, spec, unit, (extra or {}).get('jointId') or ''], ensure_ascii=False, separators=(',', ':'))
        if qty and qty > 0: works.append({'name': name, 'spec': spec, 'qty': qty, 'unit': unit, 'sourceId': m['id'], 'conditionKey': condition_key, 'auto': True, **(extra or {})})
    def dspec(value): return 'D' + _fmt(value)
    def number(m, value, label, positive=False):
        n = _quantity(value)
        if n is None or n < 0 or (positive and n <= 0):
            problem(m, label + '을 ' + ('0보다 큰' if positive else '0 이상의') + ' 숫자로 입력하세요.'); return None
        return n
    def count(m, w):
        unit, q = compact(m.get('unit')), number(m, m.get('qty'), '수량')
        if q is None: return None
        if unit in ('개', '개소', '개당', '개소당', '기', '기당', 'ea', '조'):
            return number(m, w['installationCount'], '실제 설치 개소', True) if category(m) == 'saddle' and 'installationCount' in w and w.get('installationCount') != '' else q
        actual = number(m, w.get('materialCount'), '실제 자재 개수', True)
        installation = number(m, w.get('installationCount'), '실제 설치 개소', True)
        if actual is None or installation is None: return None
        m.setdefault('originalQuantity', {'qty': m.get('qty'), 'unit': m.get('unit')})
        m['qty'], m['unit'] = actual, '개'
        return installation
    def joints(m, w, default_diameter, provider='', capacity=None):
        raw_joints = w.get('flangeJoints')
        if not isinstance(raw_joints, list) or not raw_joints: problem(m, '실제 플랜지 접합부 번호를 입력하세요.'); return
        if capacity is not None and len(raw_joints) > capacity:
            problem(m, '실제 개소보다 플랜지 접합부 번호가 많습니다. 개수와 번호를 확인하세요.'); return
        own = set()
        for raw in raw_joints:
            j = {'id': raw} if isinstance(raw, str) else raw if isinstance(raw, dict) else {}
            identity, d = str(j.get('id') or '').strip(), diameter(j.get('diameter') or default_diameter)
            if not identity or identity in own or not d: problem(m, '접합부 번호 중복 또는 관경을 확인하세요.'); continue
            own.add(identity)
            if d != diameter(default_diameter): problem(m, '플랜지 접합부 관경이 해당 자재·밸브·지관 관경과 다릅니다.'); continue
            mode = j.get('mode') or 'separate'
            if mode not in ('separate', 'included'): problem(m, '접합부 계상 방식을 선택하세요.'); continue
            ledger[identity].append({'m': m, 'id': identity, 'd': d, 'mode': mode, 'coveredBy': str(j.get('coveredBy') or ''), 'provider': provider})
    for i, m in enumerate(materials):
        kind = category(m)
        if not kind: continue
        handled_ids.append(m['id']); handled_indexes.append(i)
        w = m.get('workConditions') or {}
        if not isinstance(w, dict): problem(m, '작업 조건을 다시 입력하세요.'); continue
        if kind == 'saddle':
            # User-confirmed workflow: saddle installation always includes drilling.
            # This does not infer missing diameters or convert old M quantities.
            w['drilling'] = True
            m['workConditions'] = w
        spec = str(m.get('spec', m.get('std', '')) or '')
        ds, name, q = diameters(spec), compact(m.get('name')), number(m, m.get('qty'), '수량')
        if q is None or q == 0: continue
        info = {'m': m, 'type': kind, 'w': w, 'spec': spec, 'ds': ds, 'q': q}; infos.append(info)
        first, second = (ds[0] if ds else None), (ds[1] if len(ds) > 1 else None)
        if kind == 'restraint': restraints.append(info); continue
        if kind == 'saddle':
            q = count(m, w)
            if q is None: continue
            main, branch = diameter(w.get('mainDiameter') or first), diameter(w.get('branchDiameter') or second)
            if ds and (main != first or (len(ds) > 1 and branch != second)):
                problem(m, '본관·지관 조건과 자재 규격이 다릅니다. 자재 규격을 함께 수정하세요.'); continue
            if not main: problem(m, '본관 관경을 지정하세요.'); continue
            if not branch or branch > main: problem(m, '본관 이하의 지관 관경을 지정하세요.'); continue
            info.update(main=main, branch=branch, q=q)
            add(m, '부단수할정자관부설및접합', dspec(main), q, '개소')
            add(m, '부단수 천공 분기점 분기', dspec(branch), q, '개소'); joints(m, w, branch, 'drilling', q)
        elif kind == 'valve':
            q = count(m, w)
            if q is None: continue
            info['q'] = q
            explicit_thread = bool(re.search(r'\(나사식\)$', name))
            connection = w.get('connectionType') or ('threaded' if explicit_thread else '')
            form = w.get('valveType') or ('soft-seal-gate' if name.startswith('소프트') else '')
            if connection not in ('threaded', 'flanged') or form not in ('soft-seal-gate', 'cast-iron-gate'): problem(m, '접합방식과 밸브 형식을 선택하세요.'); continue
            if explicit_thread and connection != 'threaded': problem(m, '나사식 자재에는 플랜지식 품을 적용할 수 없습니다.'); continue
            if connection == 'threaded' and form != 'soft-seal-gate': problem(m, '이 밸브 형식의 나사식 설치품을 확인하세요.'); continue
            d = diameter(first)
            if not d: problem(m, '밸브 관경을 지정하세요.'); continue
            info.update(d=d, connection=connection)
            if not w.get('valveCoveredBy'): add(m, '소프트실제수밸브설치' if connection == 'threaded' else '제수변부설및접합', dspec(d), q, '개소')
            if connection == 'flanged': joints(m, w, d, '' if w.get('valveCoveredBy') else 'valve', q * 2)
        elif kind == 'socket':
            q = count(m, w)
            if q is None: continue
            pipe, thread = diameter(w.get('pipeDiameter') or first), diameter(w.get('threadDiameter') or second or first)
            if ds and (pipe != first or thread != (second or first)):
                problem(m, '관측·나사측 조건과 자재 규격이 다릅니다. 자재 규격을 함께 수정하세요.'); continue
            if not pipe or not thread: problem(m, '관측·나사측 관경을 각각 확인하세요.'); continue
            add(m, 'PE이형관접합' if name.startswith('pe') else 'STS이형관접합', dspec(pipe), q, '개소'); add(m, '나사식접합', dspec(thread), q, '개소')
        elif kind == 'flange':
            q = count(m, w)
            if q is None: continue
            d = diameter(first)
            if not d: problem(m, '플랜지 관경을 지정하세요.'); continue
            if 'pe소켓플랜지' in name: add(m, 'PE이형관접합', dspec(d), q, '개소')
            joints(m, w, d, '', q)
        elif kind == 'kp':
            d = diameter(first)
            if not d: problem(m, 'KP 관경을 지정하세요.'); continue
            straight, unit = '직관' in name, compact(m.get('unit'))
            if straight and unit not in ('m', '미터', '본'): problem(m, '직관은 길이(M) 또는 6m 기준 본수로 입력하세요.'); continue
            if not straight:
                q = count(m, w)
                if q is None: continue
            elif unit != '본': q = math.ceil(q / 6)
            info.update(q=q, d=d)
            included = w.get('kpVariant') == 'restraint-included'
            if d == 300 and included and not w.get('kpSourceReviewed'): problem(m, 'D300 압륜포함 원본 DB는 일반품과 인력계수도 다릅니다. 산출근거를 확인하세요.')
            add(m, 'KP메커니컬 접합 및 부설', dspec(d) + ('(이탈방지압륜사용)' if included else ''), q, '본')
            if '플랜지' in name: joints(m, w, d, '', q)
        elif kind == 'sts-socket':
            role = 'basic' if m.get('autoSock') else w.get('stsSocketRole')
            if role not in ('basic', 'extra'): problem(m, '6m 정척관 기본 연결인지 중간 추가 소켓인지 선택하세요.'); continue
            if role == 'extra': add(m, 'STS이형관접합', spec, q, '개소')
    for identity, entries in ledger.items():
        if len({e['d'] for e in entries}) != 1:
            for e in entries: problem(e['m'], '접합부 ' + identity + '의 관경이 서로 다릅니다.')
            continue
        providers = [e for e in entries if e['provider']]
        if len({e['m']['id'] for e in providers}) > 1:
            for e in providers: problem(e['m'], '접합부 ' + identity + '가 둘 이상의 포함품에 계상되었습니다.')
            continue
        invalid = False
        for e in entries:
            if e['mode'] == 'included' and not any(p['m']['id'] == e['coveredBy'] and (p['provider'] or p['mode'] == 'separate') for p in entries):
                problem(e['m'], '접합부 ' + identity + '를 계상한 대상 품을 연결하세요.'); invalid = True
        if not invalid and not providers:
            owner = next((e for e in entries if e['mode'] == 'separate'), None)
            if not owner:
                for e in entries: problem(e['m'], '접합부 ' + identity + '를 실제로 계상하는 품이 없습니다.')
            else: add(owner['m'], '플랜지조인트접합', dspec(owner['d']), 1, '개소', {'jointId': identity})
    coverage = defaultdict(float)
    for info in [i for i in infos if i['type'] == 'valve' and i['w'].get('valveCoveredBy')]:
        source = next((i for i in infos if i['m']['id'] == str(info['w']['valveCoveredBy']) and i['type'] == 'saddle' and i['w'].get('drilling') is True), None)
        def joint_ids(value): return {str(x.get('id') or '') if isinstance(x, dict) else str(x) for x in value or []}
        valve_ids = joint_ids(info['w'].get('flangeJoints')); source_ids = joint_ids(source['w'].get('flangeJoints')) if source else set()
        if not source or info.get('connection') != 'flanged' or source.get('branch') != info.get('d') or source['q'] != info['q'] or not valve_ids.intersection(source_ids):
            problem(info['m'], '천공품에 이미 포함된 동일 밸브인지 지관 관경·개소·접합부 번호를 확인하세요.')
        elif source:
            coverage[source['m']['id']] += info['q']
            if coverage[source['m']['id']] > source['q']: problem(info['m'], '같은 천공품에 밸브 접합이 중복 연결되었습니다.')
    used_targets = set()
    for info in restraints:
        m, w = info['m'], info['w']; a = w.get('kpAllowance') or {}
        if not isinstance(a, dict): a = {}
        target = next((i for i in infos if i['m']['id'] == str(a.get('targetMaterialId')) and i['type'] == 'kp'), None)
        if a.get('state') == 'none':
            if not str(a.get('reason') or '').strip(): problem(m, '가산하지 않는 사유를 입력하세요.')
            continue
        if not target: problem(m, '압륜을 적용할 KP 자재·품을 선택하세요.'); continue
        key = target['m']['id']
        if key in used_targets: problem(m, '같은 KP 품에 압륜 가산이 중복 지정되었습니다.'); continue
        used_targets.add(key)
        if a.get('state') == 'included':
            if target['w'].get('kpVariant') != 'restraint-included': problem(m, '대상 KP 품은 압륜 가산 포함품이 아닙니다. 적용품을 확인하세요.')
            continue
        if a.get('state') != 'add': problem(m, '압륜 가산의 포함 여부를 선택하세요.'); continue
        if target['w'].get('kpVariant') == 'restraint-included': problem(m, '압륜 가산이 포함된 KP 품에 다시 가산할 수 없습니다.'); continue
        p = number(m, a.get('percent'), '가산율')
        if p is None: continue
        if p > 30: problem(m, '압륜 가산율은 30% 범위 안에서 지정하세요.'); continue
        reason = str(a.get('reason') or '').strip()
        if not reason: problem(m, '압륜 가산 적용 근거를 입력하세요.'); continue
        base = next((x for x in works if x['sourceId'] == target['m']['id'] and x['name'] == 'KP메커니컬 접합 및 부설'), None)
        if not base: problem(m, '대상 KP 품의 수량을 확인하세요.'); continue
        if p > 0:
            meta = {'targetMaterialId': target['m']['id'], 'targetName': base['name'], 'targetSpec': base['spec'], 'targetUnit': base['unit'], 'targetQuantity': base['qty'], 'percent': p, 'basis': 'all-components', 'reason': reason}
            allowances.append(meta); add(m, '이탈방지압륜 가산', 'KP ' + base['spec'] + ' · 대상 ' + _fmt(base['qty']) + '본', p, '%', {'allowance': meta})
    return {'materials': materials, 'handledIds': handled_ids, 'handledIndexes': handled_indexes, 'works': works, 'issues': issues, 'allowances': allowances,
            'workConnectionJoints': [{'id': key, 'diameter': entries[0]['d']} for key, entries in ledger.items()]}


def _work_key(row):
    name = compact(row.get('name'))
    name = re.sub(r'소프트(?:실)?(?:제수|지수)(밸브|변)', '소프트제수밸브', name).replace('제수변', '제수밸브')
    spec = row.get('spec', row.get('std', '')) or ''
    unit = compact(row.get('unit')).replace('당', '')
    if unit in ('개', '개소', '기', 'ea'): unit = 'count'
    size_key = tuple(diameters(spec))
    if name == '이탈방지압륜가산': size_key = (compact(spec),)
    return name, size_key, '압륜' if '이탈방지압륜' in spec else '', unit


def validate_material_conditions(materials, works):
    """Return normalized materials, rejecting uncertain or changed automatic work."""
    result = resolve(materials, works)
    problems = [i['message'] for i in result['issues']]
    expected, actual = defaultdict(float), defaultdict(float)
    for w in result['works']: expected[(str(w['sourceId']), str(w['conditionKey']), _work_key(w))] += float(w['qty'])
    for w in works or []:
        if w.get('conditionKey') or w.get('workConditionVersion'):
            q = _quantity(w.get('qty'))
            if q is None or q < 0: problems.append(str(w.get('name')) + ': 작업 수량이 올바르지 않습니다.'); continue
            actual[(str(w.get('sourceId')), str(w.get('conditionKey')), _work_key(w))] += q
    if actual:
        for key in set(expected) | set(actual):
            if abs(expected.get(key, 0) - actual.get(key, 0)) > 1e-8: problems.append('작업 조건과 자동 일위 수량/규격이 다릅니다. 다시 계산하세요: ' + key[0] + ' / ' + key[1])
        for w in works or []:
            if w.get('allowance'):
                original = next((x for x in result['works'] if x.get('conditionKey') == w.get('conditionKey')), None)
                if not original or original.get('allowance') != w.get('allowance'): problems.append('압륜 가산 대상과 근거가 작업 조건과 다릅니다.')
        for w in works or []:
            if not w.get('conditionKey') and str(w.get('sourceId')) in result['handledIds']:
                problems.append('조건이 지정된 자재의 기존 수동 일위를 확인하세요: ' + str(w.get('name')))
    else:
        totals, wanted = defaultdict(float), defaultdict(float)
        for w in works or []:
            q = _quantity(w.get('qty'))
            if q is not None: totals[_work_key(w)] += q
        for w in result['works']: wanted[_work_key(w)] += float(w['qty'])
        for key, q in wanted.items():
            if totals.get(key, 0) + 1e-8 < q: problems.append('조건별 일위가 누락되었거나 관경/수량이 다릅니다: ' + key[0])
    # The condition owns suppressed work as well as emitted work. For example,
    # basic STS sockets emit no joint labour, and a non-drilling saddle must not
    # retain an old manual drilling row even when there are no tagged rows.
    expected_totals, all_totals = defaultdict(float), defaultdict(float)
    for w in result['works']: expected_totals[_work_key(w)] += float(w['qty'])
    for w in works or []:
        q = _quantity(w.get('qty'))
        if q is not None: all_totals[_work_key(w)] += q
    exclusive = {'부단수할정자관부설및접합', '부단수천공분기점분기', '소프트제수밸브설치', '제수밸브부설및접합', '플랜지조인트접합', '이탈방지압륜가산'}
    active_categories = {category(m) for m in materials or [] if _quantity(m.get('qty'))}
    owned = {key[0] for key in expected_totals}
    for cat, names in {
        'saddle': ('부단수할정자관부설및접합', '부단수천공분기점분기'),
        'valve': ('소프트제수밸브설치', '제수밸브부설및접합'),
        'flange': ('플랜지조인트접합',),
        'restraint': ('이탈방지압륜가산',),
        'sts-socket': ('sts이형관접합',),
    }.items():
        if cat in active_categories: owned.update(names)
    all_handled = all(category(m) for m in materials or [] if _quantity(m.get('qty')))
    for key, q in all_totals.items():
        kp_owned = 'kp' in active_categories and bool(re.match(r'^kp.*접합.*부설', key[0]))
        if (kp_owned or key[0] in owned and (all_handled or key[0] in exclusive)) and abs(q - expected_totals.get(key, 0)) > 1e-8:
            problems.append('조건별 자동 일위에 기존 수동 일위가 중복되었거나 관경이 다릅니다: ' + key[0])
    if problems: raise ValueError('\n'.join(dict.fromkeys(problems)))
    return result['materials']
