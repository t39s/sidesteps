"""Profile UI with fault injection, plus real localhost storage/WebCrypto/SW/offline."""
import os,json,threading,http.server,functools
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_smoke import make_page,trainer,new_exercise,tap,PIN
ROOT=Path(__file__).resolve().parents[1]
KEY='interval-lab:data:v6'
OLD='interval-lab:data:v5'
def state(p):return json.loads(p.evaluate('(key)=>localStorage.getItem(key)',KEY))
def test_migration(browser):
    raw=(ROOT/'tests/fixtures/v5-running.json').read_text()
    old=json.loads(raw)
    p,errors=make_page(browser,{OLD:raw})
    assert p.evaluate('(key)=>localStorage.getItem(key)',OLD)==raw
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY) is None
    p.locator('#pin-input').fill('wrong');p.get_by_role('button',name='Войти',exact=True).click()
    p.get_by_text('Неверный PIN',exact=True).wait_for()
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY) is None
    p.locator('#pin-input').fill(PIN);p.get_by_role('button',name='Войти',exact=True).click()
    p.locator('#base-choice').select_option(old['athletes'][1]['id'])
    p.get_by_role('button',name='Назначить базовым').click()
    p.wait_for_function('(key)=>localStorage.getItem(key)!==null',arg=KEY)
    s=state(p)
    assert s['baseProfileId']==old['athletes'][1]['id']
    assert s['attempts'][0]['status']=='interrupted'
    assert s['athletes']==old['athletes']
    assert p.evaluate('(key)=>localStorage.getItem(key)',OLD)==raw
    data=p.evaluate('window.__dump()');p.close()
    q,e=make_page(browser,data)
    assert state(q)['baseProfileId']==old['athletes'][1]['id']
    assert q.get_by_role('heading',name='Вход в интерфейс тренера').is_visible()
    assert not errors+e,errors+e
    q.close()
def test_deleted_session_migration(browser):
    original=json.loads((ROOT/'tests/fixtures/v5-deleted-session-workout.json').read_text())
    for all_deleted in (False,True):
        old=json.loads(json.dumps(original))
        if all_deleted:old['workouts']=[];old['attempts']=[]
        raw=json.dumps(old)
        p,errors=make_page(browser,{OLD:raw})
        assert p.evaluate('(key)=>localStorage.getItem(key)',KEY) is None
        p.locator('#pin-input').fill(PIN);p.get_by_role('button',name='Войти',exact=True).click()
        p.locator('#base-choice').select_option(old['athletes'][1]['id'])
        p.get_by_role('button',name='Назначить базовым').click()
        p.wait_for_function('(key)=>localStorage.getItem(key)!==null',arg=KEY)
        s=state(p)
        assert s['baseProfileId']==old['athletes'][1]['id']
        for field in ('athletes','workouts','attempts','archived','incomplete'):assert s[field]==old[field],field
        session=dict(s['childSessions'][0]);missing=session.pop('unavailableWorkoutIds')
        assert session==old['childSessions'][0]
        assert len(missing)==(2 if all_deleted else 1)
        assert p.evaluate('(key)=>localStorage.getItem(key)',OLD)==raw
        assert 'Нарушена связь занятия' not in p.locator('body').inner_text()
        for profile in old['athletes']:
            p.locator(f'[data-act="child-view"][data-id="{profile["id"]}"]').click()
            assert p.get_by_role('tabpanel').is_visible()
        data=p.evaluate('window.__dump()');p.close()
        q,e=make_page(browser,data)
        assert state(q)['attempts']==old['attempts']
        assert not errors+e,errors+e
        q.close()
def test_profiles(browser):
    p,errors=make_page(browser,viewport_width=320,mobile=True)
    trainer(p)
    p.locator('#new-athlete').fill('Дополнительный');p.get_by_role('button',name='Добавить',exact=True).click()
    aid=state(p)['athletes'][1]['id']
    assert p.locator('#coach-athlete,[data-act="coach-solo"]').count()==0
    p.locator('#trainer-a').select_option(aid)
    p.locator('#attempt-count').select_option('1')
    p.locator('#mode-select').select_option('stopwatch')
    p.get_by_role('button',name='Начать занятие').click()
    assert p.locator('#pin-input').count()==0
    p.get_by_role('link',name='К управлению занятием').click()
    p.get_by_role('button',name='Вернуться к занятию').click()
    # Exit cannot drop an active session or its current turn.
    p.get_by_role('link',name='Интерфейс спортсмена').click()
    assert state(p)['device']['activeChildSessionId']
    tap(p);tap(p)
    p.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert state(p)['attempts'][0]['athleteId']==aid
    assert state(p)['workouts'][0]['kind']=='child'
    p.get_by_role('button',name='История',exact=True).click()
    p.locator('summary').first.click()
    p.get_by_label('Комментарий спортсмена').fill('Со слов спортсмена')
    p.get_by_label('Комментарий тренера').fill('<b>Наблюдение</b>')
    p.get_by_role('button',name='Сохранить комментарии').click()
    assert state(p)['workouts'][0]['athleteComment']=='Со слов спортсмена'
    assert state(p)['workouts'][0]['trainerComment']=='<b>Наблюдение</b>'
    p.get_by_role('link',name='К управлению занятием').click()
    assert p.get_by_role('button',name='Начать занятие').is_visible()
    assert p.locator('#pin-input').count()==0
    p.get_by_role('link',name='Интерфейс спортсмена').click()
    new_exercise(p,attempts=1,mode='stopwatch');tap(p);tap(p)
    p.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert state(p)['attempts'][1]['athleteId']==state(p)['baseProfileId']
    p.get_by_role('button',name='На главную').click()
    p.locator('summary').first.click()
    assert p.get_by_label('Комментарий тренера').count()==0
    p.get_by_label('Комментарий спортсмена').fill('Личный комментарий')
    p.get_by_role('button',name='Сохранить комментарии').click()
    assert state(p)['workouts'][1]['athleteComment']=='Личный комментарий'
    trainer(p)
    def approve(d):
        d.accept('1') if d.type=='prompt' else d.accept()
    p.on('dialog',approve)
    p.locator(f'[data-act="set-base"][data-id="{aid}"]').click()
    assert state(p)['baseProfileId']==aid
    before=state(p)['attempts']
    p.locator('.athlete-row').filter(has=p.locator(f'form[data-athlete-id="{aid}"]')).locator('[data-act="rename-athlete"]').click()
    form=p.locator(f'form[data-athlete-id="{aid}"]')
    form.locator('input').fill('Новое имя');form.get_by_role('button',name='Сохранить').click()
    assert state(p)['athletes'][1]['id']==aid
    assert state(p)['attempts']==before
    p.remove_listener('dialog',approve)
    p.once('dialog',lambda d:d.dismiss())
    snapshot=p.evaluate('(key)=>localStorage.getItem(key)',KEY)
    p.locator(f'[data-act="delete-athlete"][data-id="{aid}"]').click()
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY)==snapshot
    p.on('dialog',approve)
    p.locator(f'[data-act="delete-athlete"][data-id="{aid}"]').click()
    assert len(state(p)['athletes'])==1
    assert state(p)['baseProfileId']!=aid
    assert state(p)['attempts']==[a for a in before if a['athleteId']!=aid]
    assert p.locator('[data-act="delete-athlete"]').count()==0
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    p.close()
def test_http_pwa(browser):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    context=browser.new_context();p=context.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
    try:
        url=f'http://127.0.0.1:{server.server_port}/'
        p.goto(url);p.get_by_role('tab',name='История').wait_for()
        assert p.evaluate('isSecureContext&&!!crypto.subtle')
        # Native PBKDF2 rejects wrong PIN; production verifier unchanged.
        p.get_by_role('link',name='Интерфейс тренера',exact=True).click();p.locator('#pin-input').fill('wrong')
        p.get_by_role('button',name='Войти',exact=True).click();p.get_by_text('Неверный PIN',exact=True).wait_for()
        p.get_by_role('button',name='Назад',exact=True).click()
        p.evaluate('navigator.serviceWorker.ready');p.wait_for_function('!!navigator.serviceWorker.controller')
        p.reload();p.get_by_role('tab',name='История').wait_for()
        q=context.new_page();q.goto(url);q.get_by_role('tab',name='История').wait_for()
        p.get_by_text('Конфликт нескольких вкладок.',exact=False).wait_for()
        assert state(q)['schemaVersion']==6
        q.close();context.set_offline(True);p.reload();p.get_by_role('tab',name='История').wait_for()
        assert state(p)['schemaVersion']==6
        assert not errors,errors
    finally:context.close();server.shutdown()
if __name__=='__main__':
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium') or None,headless=True,args=['--no-sandbox'])
        for check in [test_migration,test_deleted_session_migration,test_profiles,test_http_pwa]:
            check(b);print('PASS',check.__name__,flush=True)
        b.close()
