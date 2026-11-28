"""Profile UI with fault injection, plus real localhost storage/WebCrypto/SW/offline."""
import os,json,threading,http.server,functools
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_smoke import make_page,trainer,open_trainer_login,new_exercise,tap,PIN
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
    exit_button=p.get_by_role('button',name='Выход из интерфейса тренера')
    assert exit_button.count()==0
    p.get_by_role('link',name='К управлению занятием').click()
    # Exit on the trainer overview cannot drop an active session or its current turn.
    active=state(p)['device']['activeChildSessionId']
    exit_button.click()
    assert state(p)['device']['activeChildSessionId']==active
    p.get_by_role('button',name='Вернуться к занятию').click()
    tap(p);tap(p)
    p.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert state(p)['attempts'][0]['athleteId']==aid
    assert state(p)['workouts'][0]['kind']=='child'
    p.get_by_role('button',name='История',exact=True).click()
    p.get_by_text('Подробнее',exact=True).first.click()
    p.get_by_label('Комментарий спортсмена').fill('Со слов спортсмена')
    p.get_by_label('Комментарий тренера').fill('<b>Наблюдение</b>')
    p.get_by_role('button',name='Сохранить комментарии').click()
    assert state(p)['workouts'][0]['athleteComment']=='Со слов спортсмена'
    assert state(p)['workouts'][0]['trainerComment']=='<b>Наблюдение</b>'
    p.get_by_role('link',name='К управлению занятием').click()
    assert p.get_by_role('button',name='Начать занятие').is_visible()
    assert p.locator('#pin-input').count()==0
    p.get_by_role('button',name='Выход из интерфейса тренера').click()
    new_exercise(p,attempts=1,mode='stopwatch');tap(p);tap(p)
    p.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert state(p)['attempts'][1]['athleteId']==state(p)['baseProfileId']
    p.get_by_role('button',name='На главную').click()
    p.get_by_text('Подробнее',exact=True).first.click()
    assert p.get_by_label('Комментарий тренера').count()==0
    p.get_by_label('Комментарии',exact=True).fill('Личный комментарий')
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
        open_trainer_login(p);p.locator('#pin-input').fill('wrong')
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

def test_personal_data_management(browser):
    seed, errors = make_page(browser)
    raw = seed.evaluate("""() => {
      const M=window.ILModel;
      let s=M.addAthlete(M.blank(),'Другой профиль').state;
      for (const aid of s.athletes.map(a=>a.id)) {
        const count=aid===s.baseProfileId?2:1;
        const workout=aid===s.baseProfileId?M.startSolo(s,aid,count):M.startChild(s,[aid],count);
        s=workout.state;
        const wid=aid===s.baseProfileId?workout.value.id:M.nextTurn(s).workoutId;
        for(let i=0;i<count;i++) {
          let attempt=M.startAttempt(s,wid,'stopwatch',1);
          s=M.finishAttempt(attempt.state,attempt.value.id,2000+i*1000,[]).state;
        }
      }
      s=M.addArchived(s,s.baseProfileId,'2026-11-01',1500).state;
      s.device.lastInterface='athlete';s.device.childParticipants=[];s.device.viewAthleteId=s.baseProfileId;
      return JSON.stringify(s);
    }""")
    seed.close()
    original=json.loads(raw)
    aid=original['baseProfileId']
    own=next(w for w in original['workouts'] if w['athleteId']==aid)
    other=next(w for w in original['workouts'] if w['athleteId']!=aid)
    p, errs=make_page(browser,{KEY:raw},viewport_width=375,mobile=True)
    p.get_by_role('button',name='Настройки',exact=True).click()
    headings=p.locator('.panel > h2').all_text_contents()
    assert headings==['Название профиля','История'],headings
    assert p.get_by_role('button',name='Сохранить копию',exact=True).count()==0
    switch=p.get_by_role('switch',name='Показывать кнопки удаления в Истории')
    assert not switch.is_checked()
    switch.check()
    p.get_by_role('button',name='Сохранить',exact=True).click()
    assert p.locator(f'[data-history-workout="{other["id"]}"]').count()==0
    workout=p.locator(f'[data-history-workout="{own["id"]}"]')
    workout.get_by_text('Подробнее',exact=True).click()
    assert workout.get_by_role('button',name='Удалить попытку',exact=True).count()==2
    before=p.evaluate('(key)=>localStorage.getItem(key)',KEY)
    p.once('dialog',lambda dialog:dialog.dismiss())
    workout.get_by_role('button',name='Удалить попытку',exact=True).first.click()
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY)==before
    p.once('dialog',lambda dialog:dialog.accept())
    workout.get_by_role('button',name='Удалить попытку',exact=True).first.click()
    assert len(next(w for w in state(p)['workouts'] if w['id']==own['id'])['attemptIds'])==1
    workout.get_by_text('Подробнее',exact=True).click()
    assert workout.get_by_role('button',name='Удалить попытку',exact=True).count()==0
    assert workout.get_by_text('3,000 с',exact=True).first.is_visible()
    p.once('dialog',lambda dialog:dialog.accept())
    workout.get_by_role('button',name='Удалить тренировку',exact=True).click()
    assert all(w['id']!=own['id'] for w in state(p)['workouts'])
    assert next(w for w in state(p)['workouts'] if w['id']==other['id'])==other
    p.get_by_text('Добавить результат',exact=True).click()
    p.locator('#archive-date').fill('2026-11-02')
    p.locator('#archive-time').fill('12,345')
    p.get_by_role('button',name='Добавить в архив',exact=True).click()
    assert state(p)['archived'][-1]['athleteId']==aid
    assert state(p)['archived'][-1]['bestMs']==12345
    assert p.locator('[data-history-archive]').count()==2
    assert p.locator('[data-history-archive] summary').count()==0
    assert p.locator('[data-history-archive] [data-act="delete-archived"]').count()==2
    assert [x['bestMs'] for x in sorted(state(p)['archived'],key=lambda a:a['date'],reverse=True)]==[12345,1500]
    newest=state(p)['archived'][-1]['id']
    assert p.locator('[data-history-archive]').first.get_attribute('data-history-archive')==newest
    p.get_by_role('button',name='Настройки',exact=True).click()
    before_name=state(p)
    p.get_by_label('Имя (указывается в файле выгрузки)',exact=True).fill('Личный профиль')
    p.get_by_role('button',name='Сохранить',exact=True).click()
    assert state(p)['athletes'][0]['name']=='Личный профиль'
    assert state(p)['athletes'][0]['id']==aid
    for field in ('workouts','attempts','archived','childSessions'):
        assert state(p)[field]==before_name[field]

    assert not state(p)['device']['trainerActivated']
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    saved=p.evaluate('window.__dump()')
    p.close()
    q, errs2=make_page(browser,saved,viewport_width=375,mobile=True)
    assert len(state(q)['workouts'])==1
    assert state(q)['athletes'][0]['name']=='Личный профиль'
    assert q.locator('[data-history-archive] [data-act="delete-archived"]').count()==2
    trainer(q)
    coach_switch=q.get_by_role('switch',name='Показывать кнопки удаления в Истории')
    assert not coach_switch.is_checked()
    coach_switch.check()
    q.locator(f'[data-act="trainer-history"][data-id="{aid}"]').click()
    q.locator(f'[data-act="history-profile"][data-id="{other["athleteId"]}"]').click()
    history=q.locator(f'[data-history-workout="{other["id"]}"]')
    history.get_by_text('Подробнее',exact=True).click()
    assert history.get_by_role('button',name='Удалить попытку',exact=True).count()==1
    q.locator('#archive-date').fill('2026-11-03')
    q.locator('#archive-time').fill('15,000')
    q.get_by_role('button',name='Добавить в архив',exact=True).click()
    assert state(q)['archived'][-1]['athleteId']==other['athleteId']
    q.once('dialog',lambda dialog:dialog.accept())
    q.locator('[data-history-archive] [data-act="delete-archived"]').click()
    assert len(state(q)['archived'])==2
    assert all(a['athleteId']==aid for a in state(q)['archived'])
    assert not errors+errs+errs2,errors+errs+errs2
    q.close()

def test_personal_profile_selection(browser):
    seed, errors=make_page(browser)
    raw=seed.evaluate("""()=>{
      const M=window.ILModel;
      const s=M.addAthlete(M.blank(),'Выбранный профиль').state;
      return JSON.stringify(M.addArchived(s,s.athletes[1].id,'2026-11-01',12345).state);
    }""")
    seed.close()
    p,errs=make_page(browser,viewport_width=375,mobile=True)
    p.get_by_role('button',name='Резервное копирование',exact=True).click()
    before=p.evaluate('(key)=>localStorage.getItem(key)',KEY)
    p.locator('#file-import').set_input_files({
        'name':'profiles.json','mimeType':'application/json','buffer':raw.encode()})
    p.get_by_role('heading',name='Выберите профиль для загрузки').wait_for()
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY)==before
    p.get_by_role('button',name='Отмена',exact=True).click()
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY)==before
    p.locator('#file-import').set_input_files({
        'name':'profiles.json','mimeType':'application/json','buffer':raw.encode()})
    selected=json.loads(raw)['athletes'][1]['id']
    p.locator('#base-choice').select_option(selected)
    p.get_by_role('button',name='Загрузить профиль',exact=True).click()
    p.get_by_role('heading',name='Резервное копирование',exact=True).wait_for()
    assert state(p)['baseProfileId']==selected
    assert len(state(p)['athletes'])==1
    assert len(state(p)['archived'])==1
    assert p.get_by_role('button',name='Вход в интерфейс тренера',exact=True).count()==0
    assert not state(p)['device']['trainerActivated']
    assert not errors+errs,errors+errs
    p.close()

def test_modes_settings_and_statistics(browser):
    p,errors=make_page(browser,config_overrides={'workingIntervalCount':20},viewport_width=375,mobile=True)
    trainer(p)
    p.get_by_label('Рабочее число отсечек',exact=True).fill('30')
    p.get_by_label('Тестовое число отсечек',exact=True).fill('3')
    p.get_by_label('Отдых рабочего режима, секунд',exact=True).fill('90')
    p.get_by_label('Отдых тестовых режимов, секунд',exact=True).fill('15')
    p.get_by_role('button',name='Сохранить настройки',exact=True).click()
    assert p.locator('#working-count').count()==0
    settings=json.loads(p.evaluate('(key)=>localStorage.getItem(key)','sidesteps:trainer-settings:v1'))
    assert settings['workingIntervalCount']==30 and settings['workingCountLocked']
    p.get_by_role('button',name='Выход из интерфейса тренера',exact=True).click()
    new_exercise(p,attempts=1,mode='test-intervals')
    assert p.get_by_text('Тестовый режим · результат сохранится в архив',exact=True).is_visible()
    for _ in range(4):tap(p)
    p.get_by_text('Тестовый результат · сохранён в архив',exact=True).wait_for(timeout=2000)
    assert p.get_by_text('★ Новый рекорд!',exact=True).count()==0
    p.get_by_role('heading',name='Тренировка завершена',exact=True).wait_for(timeout=6500)
    assert p.get_by_role('heading',name='Мой прогресс',exact=True).count()==0
    p.get_by_role('button',name='На главную',exact=True).click()
    assert p.locator('[data-archive-workout]').count()==1
    assert p.locator('.chart').count()==0
    new_exercise(p,attempts=1,mode='intervals')
    assert p.get_by_text('0 / 30 интервалов',exact=True).is_visible()
    for _ in range(31):tap(p)
    p.get_by_role('heading',name='Тренировка завершена',exact=True).wait_for(timeout=6500)
    p.get_by_role('button',name='На главную',exact=True).click()
    assert p.locator('.chart rect').count()==1
    before=state(p)
    assert [w['measurementPlan']['purpose'] for w in before['workouts']]==['test','working']
    baseline=p.evaluate('(()=>{const s=JSON.parse(localStorage.getItem("interval-lab:data:v6"));return ILModel.baseline(s,s.baseProfileId)})()')
    assert baseline==before['attempts'][1]['totalMs']
    p.get_by_text('Добавить результат',exact=True).click()
    p.locator('#archive-date').fill('2026-11-01');p.locator('#archive-time').fill('0,1')
    p.get_by_role('button',name='Добавить в архив',exact=True).click()
    assert p.evaluate('(()=>{const s=JSON.parse(localStorage.getItem("interval-lab:data:v6"));return ILModel.baseline(s,s.baseProfileId)})()')==baseline
    saved=p.evaluate('window.__dump()');p.close()
    q,errs=make_page(browser,saved,viewport_width=375,mobile=True)
    restored=json.loads(q.evaluate('(key)=>localStorage.getItem(key)','sidesteps:trainer-settings:v1'))
    assert restored==settings
    assert state(q)['device']['soloMeasurementMode']=='intervals'
    assert state(q)['device']['soloPlannedAttempts']==2 and not state(q)['device']['soundEnabled']
    assert q.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors+errs,errors+errs
    q.close()

def test_frozen_test_workout_after_settings_and_reload(browser):
    p,errors=make_page(browser,config_overrides={'workingIntervalCount':20},viewport_width=375,mobile=True)
    trainer(p)
    p.locator('#test-count').fill('3');p.locator('#test-rest').fill('30')
    p.get_by_role('button',name='Сохранить настройки',exact=True).click()
    p.get_by_role('button',name='Выход из интерфейса тренера',exact=True).click()
    new_exercise(p,attempts=2,mode='test-intervals')
    for _ in range(4):tap(p)
    assert state(p)['workouts'][0]['measurementPlan']['targetIntervals']==3
    assert state(p)['workouts'][0]['measurementPlan']['restDurationSec']==30
    saved=p.evaluate('window.__dump()');p.close()
    # Entry to the trainer interface is unavailable during a personal workout.
    # Seed newer device settings to exercise recovery of the existing workout plan.
    key='sidesteps:trainer-settings:v1'
    settings=json.loads(saved[key])
    settings.update(testIntervalCount=5,testRestDurationSec=1)
    saved[key]=json.dumps(settings)
    q,errs=make_page(browser,saved,viewport_width=375,mobile=True)
    clock=q.locator('[data-rest-clock]').inner_text()
    assert int(clock.split(':')[1])>10,clock
    q.get_by_role('button',name='Начать раньше',exact=True).click()
    assert q.get_by_text('0 / 3 интервалов',exact=True).is_visible()
    for _ in range(4):tap(q)
    q.get_by_role('heading',name='Тренировка завершена',exact=True).wait_for(timeout=6500)
    assert [a['targetIntervals'] for a in state(q)['attempts']]==[3,3]
    assert not errors+errs,errors+errs
    q.close()


def test_settings_draft_and_bounded_lists(browser):
    seed, errors=make_page(browser)
    raw=seed.evaluate("""()=>{
      const M=ILModel;let s=M.blank();
      for(let i=0;i<7;i++){
        const w=M.startSolo(s,s.baseProfileId,1),a=M.startAttempt(w.state,w.value.id,'intervals',20);
        s=M.finishAttempt(a.state,a.value.id,1000+i*100,Array(20).fill(50+i*5)).state;
        s.workouts.at(-1).createdAt=`2026-11-${String(i+1).padStart(2,'0')}T12:00:00.000Z`;
        s=M.addArchived(s,s.baseProfileId,`2026-10-${String(i+1).padStart(2,'0')}`,2000+i*100).state;
      }
      const w=M.startSolo(s,s.baseProfileId,1);s=w.state;
      for(let i=0;i<7;i++){
        const a=M.startAttempt(s,w.value.id,'intervals',20,`2026-11-${String(i+1).padStart(2,'0')}T13:00:00.000Z`);
        s=M.interruptAttempt(a.state,a.value.id).state;
      }
      return JSON.stringify(M.endWorkout(s,w.value.id).state);
    }""")
    seed.close()
    for width in (320,375):
        p, errs=make_page(browser,{KEY:raw},viewport_width=width,mobile=True)
        aid=state(p)['baseProfileId']
        archive=p.locator(f'[data-list-container="archive:athlete:{aid}"]')
        history=p.locator(f'[data-list-container="history:athlete:{aid}"]')
        assert p.locator('.archive-history').count()==1
        assert archive.locator(':scope > .history-item').count()==5
        assert history.locator(':scope > .history-item').count()==4
        archive.get_by_role('button',name='Все тренировки (7)',exact=True).click()
        assert archive.locator(':scope > .history-item').count()==7
        assert history.locator(':scope > .history-item').count()==4
        p.get_by_role('button',name='Настройки',exact=True).click()
        before=p.evaluate('(key)=>localStorage.getItem(key)',KEY)
        interrupted=p.locator(f'[data-list-container="interrupted:athlete:{aid}"]')
        p.locator('#profile-name').fill('Черновик')
        p.get_by_role('switch').check()
        assert p.evaluate('(key)=>localStorage.getItem(key)',KEY)==before
        p.get_by_role('button',name='Отмена',exact=True).click()
        assert state(p)['athletes'][0]['name']=='Спортсмен'
        assert interrupted.get_by_role('button',name='Удалить попытку',exact=True).count()==0
        p.get_by_role('button',name='Настройки',exact=True).click()
        assert p.locator('#profile-name').input_value()=='Спортсмен'
        p.locator('#profile-name').fill('Сохранено')
        p.get_by_role('switch').check()
        p.get_by_role('button',name='Сохранить',exact=True).click()
        assert state(p)['athletes'][0]['name']=='Сохранено'
        assert interrupted.get_by_role('button',name='Удалить попытку',exact=True).count()==5
        interrupted.get_by_role('button',name='Все попытки (7)',exact=True).click()
        assert interrupted.get_by_role('button',name='Удалить попытку',exact=True).count()==7
        p.once('dialog',lambda dialog:dialog.accept())
        archive.locator('[data-history-archive]').first.get_by_role('button',name='Удалить тренировку',exact=True).click()
        assert state(p)['athletes'][0]['name']=='Сохранено'
        assert len(state(p)['archived'])==6
        assert state(p)['device']['soloPlannedAttempts']==2
        assert archive.locator(':scope > .history-item').count()==6
        p.get_by_text('Добавить результат',exact=True).click()
        date=p.locator('#archive-date').bounding_box()
        time=p.locator('#archive-time').bounding_box()
        assert abs(date['x']-time['x'])<1 and abs(date['width']-time['width'])<1
        assert date['y']>=p.locator('label[for="archive-date"] span').bounding_box()['y']+p.locator('label[for="archive-date"] span').bounding_box()['height']
        p.get_by_role('button',name='Резервное копирование',exact=True).click()
        assert p.locator('#profile-name').count()==0
        p.get_by_role('button',name='Назад',exact=True).click()
        p.get_by_role('tab',name='Новая тренировка',exact=True).click()
        p.get_by_role('button',name='Настройки',exact=True).click()
        p.locator('#attempt-count').select_option('1')
        p.locator('#mode-select').select_option('stopwatch')
        p.get_by_role('button',name='Сохранить',exact=True).click()
        assert state(p)['athletes'][0]['name']=='Сохранено'
        assert state(p)['device']['soloPlannedAttempts']==1
        assert state(p)['device']['soloMeasurementMode']=='stopwatch'
        p.get_by_role('button',name='Настройки',exact=True).click()
        assert p.locator('#profile-name').count()==0
        save,discard=[button.bounding_box() for button in p.locator('.settings-actions').get_by_role('button').all()]
        assert abs(save['y']-discard['y'])<1
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors+errs,errors+errs
        p.close()

def test_trainer_backup_geometry(browser):
    for width in (320,375):
        p,errors=make_page(browser,viewport_width=width,mobile=True)
        trainer(p)
        assert p.get_by_role('heading',name='Данные профилей',exact=True).is_visible()
        backups=p.locator('.backup-actions')
        export=backups.get_by_role('button',name='Резервная копия всех данных',exact=True).bounding_box()
        load_button=backups.get_by_role('button',name='Загрузить новые данные',exact=True)
        primary=p.get_by_role('button',name='Начать занятие',exact=True)
        background='(e)=>getComputedStyle(e).backgroundColor'
        assert load_button.evaluate(background)==primary.evaluate(background)
        load=load_button.bounding_box()
        reset=backups.get_by_role('button',name='Удалить все локальные данные',exact=True).bounding_box()
        assert export['y']>=load['y']+load['height']
        assert reset['y']>=export['y']+export['height']
        assert all(abs(box['width']-backups.bounding_box()['width'])<1 for box in (export,load,reset))
        add=p.get_by_role('button',name='Добавить в архив',exact=True)
        assert add.count()==0
        p.locator('[data-act="trainer-history"]').first.click()
        assert abs(add.bounding_box()['width']-add.locator('..').bounding_box()['width'])<1
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        p.close()


def test_archive_statistics_switch(browser):
    seed,errors=make_page(browser)
    raw=seed.evaluate("""()=>{
      const M=ILModel;let s=M.blank();
      for(const [mode,target,values] of [['intervals',20,[6000,5000]],['intervals',4,[1000,800]],['stopwatch',1,[900,600]]]){
        const w=M.startSolo(s,s.baseProfileId,2);s=w.state;
        let clock=Date.UTC(2026,10,1)+s.workouts.length*100000;
        s.workouts.at(-1).createdAt=new Date(clock).toISOString();
        for(const ms of values){
          const a=M.startAttempt(s,w.value.id,mode,target,new Date(clock).toISOString());
          s=M.finishAttempt(a.state,a.value.id,ms,mode==='intervals'?Array.from({length:target},(_,i)=>Math.floor(ms/target)+(i<ms%target?1:0)):[],new Date(clock+ms).toISOString()).state;
          clock+=ms+1000;
        }
      }
      s=M.addArchived(s,s.baseProfileId,'2026-10-01',200).state;
      s=M.addAthlete(s,'Другой').state;
      return JSON.stringify(M.addArchived(s,s.athletes[1].id,'2026-10-01',100).state);
    }""")
    seed.close()
    p,errs=make_page(browser,{KEY:raw},viewport_width=375,mobile=True)
    original=state(p)
    assert p.locator('.chart rect').count()==1
    trainer(p)
    switch=p.get_by_label('Учитывать тестовые и архивные данные',exact=True)
    assert not switch.is_checked()
    switch.check()
    assert not json.loads(p.evaluate('(key)=>localStorage.getItem(key)','sidesteps:trainer-settings:v1'))['includeArchiveStats']
    p.get_by_role('button',name='Сохранить настройки',exact=True).click()
    assert switch.is_checked()
    other=original['athletes'][1]['id']
    p.locator(f'[data-act="trainer-history"][data-id="{other}"]').click()
    assert p.locator('.chart rect').count()==1
    assert 'Рабочие, тестовые и архивные данные' in p.locator('.statistics-scope').inner_text()
    p.get_by_role('button',name='Назад',exact=True).click()
    p.get_by_role('button',name='Выход из интерфейса тренера',exact=True).click()
    assert p.locator('#include-archive-stats').count()==0
    assert p.locator('.chart rect').count()==4
    assert '1,650' in p.locator('.chart-average title').text_content()
    assert '0,200' in p.locator('.archive-history .record').inner_text()
    assert p.locator('.chart-bar title').first.text_content().startswith('2026-10-01:')
    assert p.locator('.archive-history .record').count()>=1
    for field in ('workouts','attempts','archived','athletes'):
        assert state(p)[field]==original[field],field
    saved=p.evaluate('window.__dump()');p.close()
    p,e=make_page(browser,saved,viewport_width=375,mobile=True)
    assert p.locator('.chart rect').count()==4
    assert p.locator('#include-archive-stats').count()==0
    trainer(p)
    p.get_by_label('Учитывать тестовые и архивные данные',exact=True).uncheck()
    p.get_by_role('button',name='Сохранить настройки',exact=True).click()
    p.get_by_role('button',name='Выход из интерфейса тренера',exact=True).click()
    assert p.locator('.chart rect').count()==1
    assert 'Только рабочие данные' in p.locator('.statistics-scope').inner_text()
    assert p.locator('.archive-history .record').count()==0
    for field in ('workouts','attempts','archived','athletes'):
        assert state(p)[field]==original[field],field
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors+errs+e,errors+errs+e
    p.close()

if __name__=='__main__':
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium') or None,headless=True,args=['--no-sandbox'])
        for check in [test_migration,test_deleted_session_migration,test_profiles,test_http_pwa,test_personal_data_management,test_personal_profile_selection,test_modes_settings_and_statistics,test_frozen_test_workout_after_settings_and_reload,test_settings_draft_and_bounded_lists,test_trainer_backup_geometry,test_archive_statistics_switch]:
            check(b);print('PASS',check.__name__,flush=True)
        b.close()
