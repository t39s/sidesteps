"""Additional portrait/mobile checks; uses in-memory Chromium, not live HTTPS/PWA."""
import os
from playwright.sync_api import sync_playwright
from browser_smoke import make_page, new_exercise, tap, trainer


def test_adult_long_press(browser):
    p,errors=make_page(browser,pin=False,viewport_width=320,mobile=True)
    p.set_viewport_size({'width':320,'height':720})
    new_exercise(p, mode='stopwatch')
    tap(p);tap(p)
    early=p.get_by_role('button',name='Начать раньше')
    early.wait_for(timeout=6000)
    # Real pointer down/up separated by more than the old 80ms re-render cycle.
    bounds=early.bounding_box()
    p.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2)
    p.mouse.down()
    p.wait_for_timeout(230)
    p.mouse.up()
    p.get_by_text('Попытка 2 из 2').wait_for(timeout=2500)
    assert p.locator('[data-rest-clock]').count()==0
    assert p.get_by_text('Можно начинать').count()==0
    tap(p);tap(p)
    p.get_by_text('Тренировка завершена').wait_for(timeout=6500)
    assert not errors,errors
    p.close()



def test_child_early_without_reload(browser):
    p,errors=make_page(browser,viewport_width=320,mobile=True)
    trainer(p)
    p.locator('#mode-select').select_option('stopwatch')
    p.get_by_role('button',name='Начать занятие').click()
    tap(p);tap(p)
    early=p.get_by_role('button',name='Начать раньше')
    early.wait_for(timeout=5000)
    box=early.bounding_box()
    p.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    p.mouse.down();p.wait_for_timeout(220);p.mouse.up()
    p.get_by_text('Попытка 2 из 2').wait_for(timeout=2500)
    tap(p);tap(p)
    p.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert not errors,errors
    p.close()

def test_child_single_reload_and_early(browser):
    p,errors=make_page(browser,viewport_width=320,mobile=True)
    p.set_viewport_size({'width':320,'height':720})
    trainer(p)
    p.locator('#mode-select').select_option('stopwatch')
    p.get_by_role('button',name='Начать занятие').click()
    assert p.locator('.child .app-head .mode-tag').count()==0
    assert p.get_by_role('link',name='К управлению занятием').is_visible()
    tap(p);tap(p)
    p.get_by_role('button',name='Начать раньше').wait_for(timeout=5000)
    data=p.evaluate('window.__dump()');p.close()
    restored,errs=make_page(browser,data,viewport_width=320,mobile=True)
    restored.set_viewport_size({'width':320,'height':720})
    early=restored.get_by_role('button',name='Начать раньше')
    early.wait_for(timeout=5000)
    bounds=early.bounding_box()
    restored.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2)
    restored.mouse.down();restored.wait_for_timeout(210);restored.mouse.up()
    restored.get_by_text('Попытка 2 из 2').wait_for(timeout=2500)
    assert restored.locator('.child .app-head .mode-tag').count()==0
    assert restored.get_by_role('link',name='Интерфейс тренера').is_visible()
    tap(restored);tap(restored)
    restored.get_by_role('heading',name='Тренировка завершена').wait_for(timeout=6500)
    assert not errors+errs,errors+errs
    restored.close()


def test_history_chart_portrait(browser):
    p,errs=make_page(browser,pin=False)
    data=p.evaluate('''() => {
      const M=window.ILModel;let s=M.blank();
      for(let i=0;i<105;i++){
        const w=M.startSolo(s,'athlete-default',1);s=w.state;
        const when=new Date(Date.UTC(2026,9,1+i)).toISOString();
        const a=M.startAttempt(s,w.value.id,'intervals',20,when);s=a.state;
        s=M.finishAttempt(s,a.value.id,13000+i*1300,Array(20).fill(650+i*65),when).state;
        s=M.mutation(s,n=>{n.workouts.find(x=>x.id===w.value.id).createdAt=when;}).state;
      }
      return JSON.stringify(s);
    }''')
    p.close()
    for width in (320,360,390):
        q,errors=make_page(browser,{'interval-lab:data:v6':data},pin=False,viewport_width=width,mobile=True)
        q.set_viewport_size({'width':width,'height':740})
        history=q.get_by_role('tab',name='История')
        exercise=q.get_by_role('tab',name='Новая тренировка')
        assert history.get_attribute('aria-selected')=='true'
        history.press('ArrowRight')
        assert exercise.evaluate('(e)=>e===document.activeElement')
        assert q.get_by_role('tabpanel',name='История').is_visible()
        assert q.locator('footer').count()==1
        head=q.locator('.app-head').bounding_box()
        brand=q.locator('.app-head .brand').bounding_box()
        gear=q.locator('.gear-glyph').bounding_box()
        button=q.get_by_role('button',name='Настройки',exact=True).bounding_box()
        tabs=q.get_by_role('tablist').bounding_box()
        h=brand['height']
        assert abs(head['height']-h)<0.1
        assert all(abs(gear[side]-.85*h)<0.1 for side in ('width','height'))
        assert all(abs(button[side]-1.25*h)<0.1 for side in ('width','height'))
        assert abs(gear['x']+gear['width']/2-button['x']-button['width']/2)<0.1
        assert abs(gear['y']+gear['height']/2-button['y']-button['height']/2)<0.1
        assert button['y']+button['height']<tabs['y']
        cards=q.get_by_role('tabpanel',name='История').locator(':scope > .panel')
        date=q.evaluate("window.ILModel.datetime('2027-01-13T00:00:00.000Z')")
        title=f'Тренировка {date}'
        assert [cards.nth(i).locator('h2').first.inner_text() for i in range(3)]==[
            'Мой прогресс',title,'Предыдущие тренировки']
        assert cards.nth(1).get_by_text(title,exact=True).count()==1
        latest_details=cards.nth(1).locator('details').first
        assert latest_details.get_attribute('open') is None
        latest_details.get_by_text('Подробнее',exact=True).click()
        assert latest_details.get_by_text('Попытка 1',exact=True).is_visible()
        workouts=cards.nth(2)
        assert workouts.locator('.history-list > .history-item').count()==4
        workouts.get_by_role('button',name='Все тренировки (105)',exact=True).click()
        assert workouts.locator('.history-list > .history-item').count()==104
        latest_date=q.evaluate("window.ILModel.date('2027-01-13T00:00:00.000Z')")
        assert workouts.get_by_text(latest_date,exact=True).count()==0
        workouts.get_by_role('button',name='5 тренировок').click()
        assert workouts.locator('.history-list > .history-item').count()==4
        assert workouts.get_by_role('button',name='Все тренировки (105)',exact=True).is_visible()
        chart=cards.nth(0).locator('.chart')
        chart.wait_for()
        assert chart.locator('rect').count()==100,(width,chart.locator('rect').count())
        assert chart.locator('.chart-bar title').count()==100
        mean=chart.locator('.chart-average')
        assert mean.get_attribute('stroke-width')=='1.4'
        expected=q.evaluate('window.ILModel.fmt(80600)')
        assert mean.locator('title').text_content()==f'Среднее по всем тренировкам: {expected}'
        assert mean.evaluate("(e)=>e.nextElementSibling.classList.contains('chart-bar')")
        scroll=cards.nth(0).get_by_role('region',name='Диаграмма прогресса')
        assert scroll.evaluate('(e)=>Math.abs(e.scrollWidth-e.clientWidth-e.scrollLeft)<2'),width
        axis=cards.nth(0).locator('.history-chart-axis')
        axis_left=axis.bounding_box()['x']
        assert scroll.evaluate('(e)=>{e.scrollLeft=0;return e.scrollLeft===0}'),width
        assert axis.bounding_box()['x']==axis_left
        assert axis.get_by_text('0',exact=True).count()==1
        assert q.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),(width,q.evaluate('document.documentElement.scrollWidth'))
        footer=q.locator('footer')
        version=footer.locator('.app-version')
        assert footer.get_by_role('link',name='Интерфейс тренера').count()==0
        q.get_by_role('button',name='Настройки',exact=True).click()
        login=footer.get_by_role('link',name='Интерфейс тренера')
        assert version.inner_text()=='v. 0.3.4-rc.1'
        assert '·' not in footer.inner_text()
        assert abs(version.bounding_box()['x']+version.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        assert abs(login.bounding_box()['x']+login.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        assert login.bounding_box()['y']+login.bounding_box()['height']<=version.bounding_box()['y']
        assert login.get_attribute('title')=='Для Тренера'
        assert login.evaluate("(e)=>getComputedStyle(e).textDecorationLine")=='underline'
        font = "(e)=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.fontStyle]}"
        assert login.evaluate(font)==version.evaluate(font)
        assert q.locator('.app-head .brand').inner_text()=='Приставные шаги\nна время'
        login.focus()
        login.press('Enter')
        q.get_by_role('heading',name='Вход в интерфейс тренера').wait_for()
        q.get_by_role('button',name='Назад').click()
        q.get_by_role('button',name='Не сохранять',exact=True).click()
        chart.wait_for()
        assert history.get_attribute('aria-selected')=='true'
        assert q.locator('.app-head .brand').inner_text()=='Приставные шаги\nна время'
        assert q.get_by_text('Две попытки по умолчанию.',exact=False).count()==0
        exercise.press('Enter')
        q.get_by_role('heading',name='Попытка 1 из 2').wait_for()
        assert q.locator('.tap-surface').is_visible()
        assert not errors+errs,errors+errs
        q.close()

if __name__ == '__main__':
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium') or None,headless=True,args=['--no-sandbox'])
        for test in [test_adult_long_press,test_child_early_without_reload,test_child_single_reload_and_early,test_history_chart_portrait]:
            test(b);print('PASS',test.__name__)
        b.close()
