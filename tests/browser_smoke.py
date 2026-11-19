"""Browser-in-memory checks. Chromium policies block navigation: embed assets into about:blank.
This validates UI flow, but NOT HTTP/PWA/offline/WebCrypto native behavior."""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
PIN='246810'
CONFIG={'minTapGapMs':0,'intervalCount':1,'restDurationSec':120,'resultDisplaySec':5,'recordDisplaySec':10,'audioPolicy':'off','trainerAccess':{'algorithm':'PBKDF2-SHA256','iterations':200000,'saltB64':'AAAAAAAAAAAAAAAAAAAAAA==','verifierB64':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}}

def make_page(browser, data=None, pin=True, config_overrides=None, viewport_width=430, mobile=False):
    page=browser.new_page(viewport={'width':viewport_width,'height':900}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'index.html').read_text())
    config={**CONFIG,**(config_overrides or {})};config['trainerAccess']=CONFIG['trainerAccess'] if pin else None
    js=f'''(()=>{{
      const data=new Map(Object.entries({json.dumps(data or {})}));
      Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),clear:()=>data.clear()}}}});
      window.__dump=()=>Object.fromEntries(data.entries());
      window.fetch=async()=>({{ok:true,json:async()=>({json.dumps(config)})}});
      Object.defineProperty(window.crypto,'subtle',{{configurable:true,value:{{importKey:async(f,x)=>new Uint8Array(x),deriveBits:async(o,key,bits)=>new Uint8Array(32).fill(new TextDecoder().decode(key)==='{PIN}'?0:1).buffer}}}});
    }})();'''
    page.evaluate(js)
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    page.add_script_tag(content=(ROOT/'model.js').read_text())
    page.add_script_tag(content=(ROOT/'migration.js').read_text())
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.get_by_role('tab',name='История').wait_for(timeout=5000) if not data else page.wait_for_timeout(350)
    return page,errors

def tap(page):
    page.locator('.tap-surface').dispatch_event('pointerdown', {'button':0,'isPrimary':True})
    page.wait_for_timeout(90)

def trainer(page):
    page.get_by_role('link',name='Войти',exact=True).click()
    page.locator('#pin-input').fill(PIN)
    page.get_by_role('button',name='Войти',exact=True).click()
    page.get_by_text('Управление занятием').wait_for(timeout=5000)

def new_exercise(page, attempts=None, mode=None):
    if attempts is not None or mode is not None:
        page.get_by_role('button',name='Настройки',exact=True).click()
        if attempts is not None:
            page.locator('#attempt-count').select_option(str(attempts))
        if mode is not None:
            page.locator('#mode-select').select_option(mode)
        page.get_by_role('button',name='Назад из настроек',exact=True).click()
    page.get_by_role('tab',name='Новая тренировка').click()

def test_adult(browser):
    page,errors=make_page(browser,pin=False)
    page.get_by_role('tab',name='Новая тренировка').click()
    page.get_by_role('heading',name='Попытка 1 из 2').wait_for()
    assert page.locator('.tap-surface').get_by_text('0 / 1 интервалов',exact=True).is_visible()
    state=page.evaluate('window.__dump()')
    assert not json.loads(state['interval-lab:data:v6'])['workouts']

    page.get_by_role('button',name='Настройки',exact=True).click()
    assert page.locator('.panel > h2:first-child').all_text_contents()==['Тренировка','Анимация запуска']
    assert page.get_by_role('button',name='Звук',exact=True).is_visible()
    mode=page.locator('#mode-select')
    assert mode.input_value()=='intervals'
    assert mode.locator('option:checked').inner_text()=='1 отсечка (по умолчанию)'
    page.locator('#attempt-count').select_option('1')
    mode.select_option('stopwatch')
    page.get_by_role('button',name='Назад из настроек',exact=True).click()
    page.get_by_role('heading',name='Попытка 1 из 1').wait_for()
    assert page.locator('.play-glyph').is_visible()

    data=page.evaluate('window.__dump()')
    page.close()
    page,reopened_errors=make_page(browser,data,pin=False)
    page.get_by_role('tab',name='Новая тренировка').click()
    page.get_by_role('heading',name='Попытка 1 из 2').wait_for()
    assert page.locator('.play-glyph').is_visible()
    page.get_by_role('button',name='Настройки',exact=True).click()
    assert page.locator('#mode-select').input_value()=='intervals'
    assert page.locator('#attempt-count').input_value()=='2'
    page.locator('#attempt-count').select_option('1')
    page.locator('#mode-select').select_option('stopwatch')
    page.get_by_role('button',name='Назад из настроек',exact=True).click()
    page.get_by_role('heading',name='Попытка 1 из 1').wait_for()
    assert page.locator('.play-glyph').is_visible()
    tap(page);tap(page)
    page.get_by_text('Тренировка завершена').wait_for(timeout=6500)
    state=json.loads(page.evaluate('localStorage.getItem("interval-lab:data:v6")'))
    assert not reopened_errors,reopened_errors
    assert len(state['workouts'])==1
    assert state['attempts'][0]['mode']=='stopwatch'
    assert state['attempts'][0]['status']=='completed',state
    assert state['workouts'][0]['status']=='completed'
    assert state['attempts'][0]['totalMs']>0
    assert 'Мой прогресс' in page.locator('body').inner_text()
    page.screenshot(path=str(ROOT/'tests'/'adult_screenshot.png'))
    page.get_by_role('link',name='Приставные шаги на время').click()
    assert page.get_by_role('tab',name='История').get_attribute('aria-selected')=='true'
    assert not errors, errors
    page.close()
    return state

def test_child_pair(browser):
    page,errors=make_page(browser)
    trainer(page)
    page.locator('#new-athlete').fill('Маша');page.get_by_role('button',name='Добавить',exact=True).click()
    page.locator('#trainer-b').select_option(label='Маша')
    page.locator('#attempt-count').select_option('1')
    page.locator('#mode-select').select_option('stopwatch')
    page.get_by_role('button',name='Начать занятие').click()
    page.get_by_text('Попытка 1 из 1').wait_for()
    assert 'Спортсмен' in page.locator('.participant-name').inner_text()
    tap(page);tap(page)
    page.get_by_text('Следующий участник появится автоматически').wait_for(timeout=5000)
    # Move resultDisplaySec threshold forward without waiting 5 real seconds.
    page.evaluate('Date.now = (()=>{let original=Date.now;return ()=>original()+10000;})()')
    page.get_by_text('Маша',exact=True).first.wait_for(timeout=5000)
    page.get_by_text('Попытка 1 из 1').wait_for(timeout=5000)
    tap(page);tap(page)
    page.locator('.attempt-result').wait_for(timeout=5000)
    page.evaluate('Date.now = (()=>{let original=Date.now;return ()=>original()+10000;})()')
    page.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=5000)
    assert page.locator('[data-act="child-view"]').count()==2
    assert not errors,errors
    state=json.loads(page.evaluate('localStorage.getItem("interval-lab:data:v6")'))
    assert len([w for w in state['workouts'] if w['status']=='completed'])==2
    page.screenshot(path=str(ROOT/'tests'/'child_screenshot.png'))
    page.close()
    return state

def test_resume_between_attempts(browser):
    page,errors=make_page(browser)
    trainer(page)
    page.locator('#new-athlete').fill('Маша');page.get_by_role('button',name='Добавить',exact=True).click()
    page.locator('#trainer-b').select_option(label='Маша')
    page.locator('#attempt-count').select_option('2')
    page.locator('#mode-select').select_option('stopwatch')
    page.get_by_role('button',name='Начать занятие').click()
    tap(page);tap(page)
    page.evaluate('Date.now = (()=>{let original=Date.now;return ()=>original()+10000;})()')
    page.get_by_text('Попытка 1 из 2').wait_for(timeout=5000)
    assert 'Маша' in page.locator('.participant-name').inner_text()
    tap(page);tap(page)
    # Refresh using new page and persisted storage before next transition.
    data=page.evaluate('window.__dump()');page.close()
    restored,errs=make_page(browser,data)
    restored.get_by_text('Попытка 2 из 2').wait_for(timeout=5000)
    assert 'Спортсмен' in restored.locator('.participant-name').inner_text()
    assert not errors+errs,errors+errs
    restored.close()

def test_pin_no_config(browser):
    page,errors=make_page(browser,pin=False)
    page.get_by_role('link',name='Войти',exact=True).click()
    page.get_by_text('PIN пока не сконфигурирован',exact=False).wait_for(timeout=5000)
    assert 'pin-input' not in page.locator('body').inner_html()
    assert page.get_by_text('Доступ Тренера',exact=True).count()==0
    card=page.locator('main > .panel')
    back=page.get_by_role('button',name='Назад',exact=True)
    assert card.get_by_role('button',name='Назад').count()==0
    assert abs(back.bounding_box()['width']-card.bounding_box()['width'])<1
    back.click()
    assert page.get_by_role('tab',name='История').is_visible()
    page.close()


def test_rest_and_early_start(browser):
    page,errors=make_page(browser,pin=False)
    new_exercise(page, mode='stopwatch')
    page.get_by_role('heading',name='Попытка 1 из 2').wait_for()
    assert page.get_by_role('button',name='История',exact=True).count()==0
    tap(page);tap(page)
    page.get_by_text('Попытка 1',exact=True).wait_for()
    assert page.get_by_role('heading',name='Попытка 1',exact=True).is_visible()
    assert page.locator('.attempt-result .display').inner_text().split(',')[1].endswith(' с')
    assert len(page.locator('.attempt-result .display').inner_text().split(',')[1].split()[0])==3
    result_button_width=page.get_by_role('button',name='Начать раньше').bounding_box()['width']
    page.get_by_text('Отдых').wait_for()
    assert page.get_by_role('button',name='Начать раньше').count()==1
    page.evaluate('Date.now = (()=>{const d=Date.now;return ()=>d()+10000;})()')
    page.get_by_role('heading',name='Отдых',exact=True).wait_for()
    assert page.get_by_role('button',name='Начать раньше').bounding_box()['width']==result_button_width
    assert page.get_by_text('Спортсмен',exact=True).count()==0
    assert page.locator('footer').get_by_role('link',name='Войти').is_visible()
    page.get_by_role('button',name='Начать раньше').click()
    page.get_by_text('Попытка 2 из 2').wait_for()
    tap(page);tap(page)
    page.get_by_text('Тренировка завершена').wait_for()
    assert page.locator('main > .panel').count()==3
    assert page.get_by_role('heading',name='Тренировки',exact=True).count()==0
    details=page.get_by_text('Подробнее',exact=True)
    details.click()
    assert page.get_by_text('Попытка 1',exact=True).is_visible()
    page.get_by_role('button',name='На главную',exact=True).click()
    assert page.get_by_role('tab',name='История').get_attribute('aria-selected')=='true'
    assert not errors,errors
    page.close()

def test_timeout_and_resume(browser):
    page,errors=make_page(browser,pin=False)
    new_exercise(page, mode='stopwatch')
    tap(page);tap(page)
    data=page.evaluate('window.__dump()')
    page.close()
    restored,errs=make_page(browser,data,pin=False)
    # Restore during rest and advance wall-clock by >5 minutes, without starting attempt #2.
    restored.evaluate('Date.now = (()=>{let d=Date.now;return ()=>d()+310000;})()')
    restored.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    state=json.loads(restored.evaluate('localStorage.getItem("interval-lab:data:v6")'))
    assert state['workouts'][0]['status']=='completed'
    assert state['workouts'][0]['closeReason']=='timeout'
    assert len([a for a in state['attempts'] if a['status']=='completed'])==1
    assert not errors+errs,errors+errs
    restored.close()

def test_restart_mid_attempt(browser):
    page,errs=make_page(browser,pin=False)
    new_exercise(page, attempts=1, mode='stopwatch')
    tap(page)
    data=page.evaluate('window.__dump()');page.close()
    restored,errs2=make_page(browser,data,pin=False)
    state=json.loads(restored.evaluate('localStorage.getItem("interval-lab:data:v6")'))
    assert state['attempts'][0]['status']=='interrupted'
    assert state['attempts'][0]['totalMs'] is None
    restored.get_by_text('Попытка 1 из 1').wait_for(timeout=5000)
    assert not errs+errs2,errs+errs2
    restored.close()

def test_trainer_relocked_on_reload(browser):
    page,errs=make_page(browser)
    trainer(page)
    data=page.evaluate('window.__dump()');page.close()
    restored,errs2=make_page(browser,data)
    restored.get_by_role('heading',name='Вход Тренера').wait_for(timeout=5000)
    assert 'Управление занятием' not in restored.locator('body').inner_text()
    assert not errs+errs2,errs+errs2
    restored.close()


def test_intervals_20_taps(browser):
    page,errors=make_page(browser,pin=False,config_overrides={'intervalCount':20,'minTapGapMs':0})
    new_exercise(page, attempts=1)
    counter=page.locator('.personal-measure .counter')
    assert counter.locator('.play-glyph').is_visible()
    assert page.get_by_text('0 / 20 интервалов',exact=True).is_visible()
    tap(page)
    assert counter.inner_text()=='0'
    tap(page)
    assert counter.inner_text()=='1'
    for _ in range(19):tap(page)
    page.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    state=json.loads(page.evaluate('localStorage.getItem("interval-lab:data:v6")'))
    assert len(state['attempts'])==1
    assert len(state['attempts'][0]['intervalsMs'])==20
    assert state['attempts'][0]['totalMs']==sum(state['attempts'][0]['intervalsMs'])
    assert not errors,errors
    page.close()

def test_min_tap_gap_500ms(browser):
    page,errors=make_page(browser,pin=False,config_overrides={'intervalCount':1,'minTapGapMs':500})
    new_exercise(page, attempts=1)
    tap(page)
    # 90ms elapsed is rejected
    tap(page)
    assert page.get_by_text('Тренировка завершена').count()==0
    page.wait_for_timeout(480)
    tap(page)
    page.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert not errors,errors
    page.close()

def test_migrate_legacy_v4_browser(browser):
    old={'version':4,'target':20,'mode':'stopwatch','athletes':[{'id':'athlete-default','name':'Спортсмен 1'}],
         'selectedAthleteId':'athlete-default','sessions':[{'id':'old-1','athleteId':'athlete-default','createdAt':'2026-01-01T00:00:00.000Z','target':20,'status':'pending','exercises':[{'mode':'stopwatch','startedAt':'2026-01-01T00:00:00.000Z','endedAt':'2026-01-01T00:00:24.000Z','intervals':[],'totalMs':24000}]}],
         'archived':[],'incomplete':[]}
    original=json.dumps(old)
    page,errors=make_page(browser,data={'interval-lab:data:v1':original,'sidesteps:migration:pending:v1':json.dumps({'version':1,'athleteId':'athlete-default'})},pin=False)
    state=json.loads(page.evaluate('localStorage.getItem("interval-lab:data:v6")'))
    assert state['schemaVersion']==6
    assert state['workouts'][0]['status']=='legacy_pending'
    assert state['attempts'][0]['totalMs']==24000
    assert page.evaluate('localStorage.getItem("interval-lab:data:v1")')==original
    assert not errors,errors
    page.close()

if __name__=='__main__':
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium') or None,headless=True,args=['--no-sandbox'])
        for test in [test_adult,test_child_pair,test_resume_between_attempts,test_pin_no_config,test_rest_and_early_start,test_timeout_and_resume,test_restart_mid_attempt,test_trainer_relocked_on_reload,test_intervals_20_taps,test_min_tap_gap_500ms,test_migrate_legacy_v4_browser]:
            try:
                out=test(browser);print('PASS',test.__name__)
            except Exception as e:
                print('FAIL',test.__name__,str(e)[:1200]);raise
        browser.close()
