"""Short mobile UI check for interface links, PIN, exit and visible version."""
import os
from playwright.sync_api import sync_playwright
from browser_smoke import make_page, trainer, PIN

def assert_form_fields(page, selectors):
    for selector in selectors:
        field=page.locator(selector)
        assert field.is_visible(), selector
        size=field.evaluate('(field) => parseFloat(getComputedStyle(field).fontSize)')
        assert size>=16, (selector,size)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or None,
        headless=True, args=['--no-sandbox'])
    for width in (320, 375, 430):
        page, errors = make_page(browser, viewport_width=width, mobile=True)
        page.set_viewport_size({'width':width,'height':600})
        footer=page.locator('footer')
        version=footer.locator('.app-version')
        login=footer.get_by_role('link',name='Интерфейс тренера',exact=True)
        assert version.inner_text()=='v. 0.3.4-rc.2'
        assert login.count()==0
        page.get_by_role('tab',name='Новая тренировка').click()
        page.get_by_role('button',name='Настройки',exact=True).click()
        assert login.count()==0
        page.get_by_role('button',name='Не сохранять',exact=True).click()
        page.locator('[data-act=end-training]').click()
        page.get_by_role('tab',name='История',exact=True).wait_for()
        page.get_by_role('button',name='Настройки',exact=True).click()
        assert login.inner_text()=='Интерфейс тренера'
        assert abs(version.bounding_box()['x']+version.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        assert abs(login.bounding_box()['x']+login.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        assert login.bounding_box()['y']+login.bounding_box()['height']<=version.bounding_box()['y']
        assert page.locator('.panel > h2').all_text_contents()==[
            'Тренировка','Анимация запуска','Название профиля','Обменяться данными',
            'Добавить архивный результат','Выборочно удалить данные']
        assert page.get_by_label('Имя (указывается в файле выгрузки)',exact=True).is_visible()
        assert_form_fields(page,['#profile-name','#archive-date','#archive-time','#mode-select'])
        date=page.locator('#archive-date').bounding_box()
        time=page.locator('#archive-time').bounding_box()
        assert abs(date['x']-time['x'])<1 and abs(date['width']-time['width'])<1
        page.locator('#profile-name').fill('Длинное имя спортивного профиля для проверки')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.get_by_role('link', name='Интерфейс тренера', exact=True).click()
        assert page.get_by_role('heading', name='Вход в интерфейс тренера', exact=True).is_visible()
        assert page.evaluate('scrollY')==0
        assert page.locator('#pin-input').evaluate('(input)=>getComputedStyle(input).fontSize')=='16px'
        assert page.get_by_role('button', name='Звук', exact=True).count() == 0
        assert page.get_by_role('button', name='Настройки', exact=True).count() == 0
        page.get_by_role('button', name='Назад', exact=True).click()
        assert page.get_by_role('button', name='Звук', exact=True).is_visible()
        assert page.locator('#profile-name').input_value()=='Длинное имя спортивного профиля для проверки'
        trainer(page)
        assert_form_fields(page,['#new-athlete','#work-rest','#trainer-a','#archive-date','#archive-time'])
        page.on('dialog',lambda dialog: dialog.accept())
        page.get_by_role('button',name='Удалить все локальные данные',exact=True).click()
        page.get_by_role('tab',name='История',exact=True).wait_for()
        assert page.evaluate('scrollY')==0
        assert login.count()==0
        page.get_by_role('button',name='Настройки',exact=True).click()
        login.click()
        assert page.evaluate('scrollY')==0
        page.locator('#pin-input').fill(PIN)
        page.get_by_role('button',name='Войти',exact=True).click()
        page.get_by_role('link', name='Интерфейс спортсмена', exact=True).wait_for()
        assert page.evaluate('scrollY')==0
        assert page.get_by_role('link', name='Интерфейс спортсмена', exact=True).count() == 1
        assert page.locator('header').get_by_role('link', name='Интерфейс спортсмена', exact=True).count() == 0
        footer = page.locator('footer')
        assert '·' not in footer.inner_text()
        assert footer.locator('.app-version').inner_text()=='v. 0.3.4-rc.2'
        exit_link=footer.get_by_role('link',name='Интерфейс спортсмена',exact=True)
        assert exit_link.bounding_box()['y']+exit_link.bounding_box()['height']<=footer.locator('.app-version').bounding_box()['y']
        footer.get_by_role('link', name='Интерфейс спортсмена', exact=True).click()
        assert page.get_by_role('tab', name='История', exact=True).is_visible()
        assert page.evaluate('scrollY')==0
        assert login.count()==0
        assert not page.get_by_role('link', name='Интерфейс спортсмена', exact=True).count()
        assert not errors, errors
        page.close()
        print('PASS interface navigation', width, flush=True)
    browser.close()
