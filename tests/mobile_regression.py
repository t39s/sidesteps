"""Additional portrait/mobile checks; uses in-memory Chromium, not live HTTPS/PWA."""
from playwright.sync_api import sync_playwright
from browser_smoke import make_page, tap, trainer


def test_adult_long_press(browser):
    p,errors=make_page(browser,pin=False,viewport_width=320,mobile=True)
    p.set_viewport_size({'width':320,'height':720})
    p.get_by_role('tab',name='Новое упражнение').click()
    p.locator('#mode-select').select_option('stopwatch')
    p.get_by_role('button',name='Начать тренировку').click()
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
    p.get_by_text('Тренировка завершена').wait_for(timeout=5000)
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
    p.get_by_text('Результаты:',exact=False).wait_for(timeout=5000)
    assert not errors,errors
    p.close()

def test_child_single_reload_and_early(browser):
    p,errors=make_page(browser,viewport_width=320,mobile=True)
    p.set_viewport_size({'width':320,'height':720})
    trainer(p)
    p.locator('#mode-select').select_option('stopwatch')
    p.get_by_role('button',name='Начать занятие').click()
    assert p.locator('.child .app-head .mode-tag').count()==0
    assert p.locator('footer').get_by_role('link',name='Войти').is_visible()
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
    assert restored.locator('footer').get_by_role('link',name='Войти').is_visible()
    tap(restored);tap(restored)
    restored.get_by_text('Результаты:',exact=False).wait_for(timeout=5000)
    assert not errors+errs,errors+errs
    restored.close()


def test_chart_5_bars_portrait(browser):
    p,errs=make_page(browser,pin=False)
    data=p.evaluate('''() => {
      const M=window.ILModel;let s=M.blank();
      for(let i=0;i<7;i++){
        const w=M.startSolo(s,'athlete-default',1);s=w.state;
        const when=new Date(Date.UTC(2026,9,1+i)).toISOString();
        const a=M.startAttempt(s,w.value.id,'stopwatch',1,when);s=a.state;
        s=M.finishAttempt(s,a.value.id,13000+i*1300,[],when).state;
        s=M.mutation(s,n=>{n.workouts.find(x=>x.id===w.value.id).createdAt=when;}).state;
      }
      return JSON.stringify(s);
    }''')
    p.close()
    for width in (320,360,390):
        q,errors=make_page(browser,{'interval-lab:data:v5':data},pin=False,viewport_width=width,mobile=True)
        q.set_viewport_size({'width':width,'height':740})
        history=q.get_by_role('tab',name='История')
        exercise=q.get_by_role('tab',name='Новое упражнение')
        start=q.get_by_role('button',name='Начать тренировку')
        assert history.get_attribute('aria-selected')=='true'
        assert not start.is_visible()
        history.press('ArrowRight')
        assert exercise.get_attribute('aria-selected')=='true'
        assert start.is_visible()
        assert q.locator('footer').count()==1
        history.click()
        assert history.get_attribute('aria-selected')=='true'
        assert not start.is_visible()
        cards=q.get_by_role('tabpanel',name='История').locator(':scope > .panel')
        assert [cards.nth(i).locator('h2').first.inner_text() for i in range(3)]==[
            'Текущая тренировка','Мой прогресс','Тренировки']
        chart=cards.nth(1).locator('.chart')
        chart.wait_for()
        assert chart.locator('rect').count()==5,(width,chart.locator('rect').count())
        assert chart.locator('.chart-bar title').count()==5
        assert q.locator('.chart-wrap').evaluate('(e)=>e.scrollWidth<=e.clientWidth'),width
        assert q.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),(width,q.evaluate('document.documentElement.scrollWidth'))
        assert '0' in chart.locator('.svg-txt').first.text_content() or 'с' in chart.locator('.svg-txt').first.text_content()
        footer=q.locator('footer')
        version=footer.locator('.app-version')
        login=footer.get_by_role('link',name='Войти')
        assert footer.inner_text()=='sidesteps v. 0.2.2-rc.6 · Войти'
        assert login.get_attribute('title')=='Для администратора'
        assert login.evaluate("(e)=>getComputedStyle(e).textDecorationLine")=='underline'
        font = "(e)=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.fontStyle]}"
        assert login.evaluate(font)==version.evaluate(font)
        assert abs(version.bounding_box()['y']-login.bounding_box()['y'])<1
        assert q.locator('.app-head .brand').inner_text()=='Приставные шаги\nна время'
        login.focus()
        login.press('Enter')
        q.get_by_role('heading',name='Вход администратора').wait_for()
        q.get_by_role('button',name='Назад').click()
        chart.wait_for()
        assert history.get_attribute('aria-selected')=='true'
        assert q.locator('.app-head .brand').inner_text()=='Приставные шаги\nна время'
        assert q.get_by_text('Две попытки по умолчанию.',exact=False).count()==0
        assert not errors+errs,errors+errs
        q.close()

if __name__ == '__main__':
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        for test in [test_adult_long_press,test_child_early_without_reload,test_child_single_reload_and_early,test_chart_5_bars_portrait]:
            test(b);print('PASS',test.__name__)
        b.close()
