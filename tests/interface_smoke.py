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
        login=footer.get_by_role('button',name='Вход в интерфейс тренера',exact=True)
        assert version.inner_text()=='Версия 0.3.5'
        assert login.is_visible()
        page.get_by_role('tab',name='Новая тренировка').click()
        page.get_by_role('button',name='Настройки',exact=True).click()
        assert login.count()==0
        assert page.locator('.settings-icon,.close-training').count()==0
        assert_form_fields(page,['#mode-select','#attempt-count'])
        training_buttons=page.locator('.settings-actions button').all()
        assert [b.inner_text() for b in training_buttons]==['Сохранить','Отмена']
        heights=[b.bounding_box()['height'] for b in training_buttons]
        assert heights[0]==heights[1] and heights[0]>=60
        page.get_by_role('button',name='Отмена',exact=True).click()
        page.locator('[data-act=end-training]').click()
        page.get_by_role('tab',name='История',exact=True).wait_for()
        page.get_by_role('button',name='Настройки',exact=True).click()
        assert page.get_by_role('heading',name='Настройки',exact=True).is_visible()
        assert page.locator('main > .panel > h2').all_text_contents()==['Название профиля','История']
        assert page.locator('.settings-icon,.close-training').count()==0
        assert_form_fields(page,['#profile-name'])
        page.locator('#profile-name').fill('Длинное имя спортивного профиля для проверки')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        save=page.get_by_role('button',name='Сохранить',exact=True)
        discard=page.get_by_role('button',name='Отмена',exact=True)
        assert abs(save.bounding_box()['y']-discard.bounding_box()['y'])<1
        assert save.bounding_box()['x']<discard.bounding_box()['x']
        assert [save.bounding_box()['height'],discard.bounding_box()['height']]==heights
        save_background=save.evaluate('(e)=>getComputedStyle(e).backgroundColor')
        switch=page.get_by_role('switch',name='Показывать кнопки удаления в Истории')
        assert save.bounding_box()['y']>switch.bounding_box()['y']+switch.bounding_box()['height']
        discard.click()
        assert footer.get_by_text('Ещё',exact=True).count()==0
        assert login.is_visible()
        assert abs(version.bounding_box()['x']+version.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        backup=footer.get_by_role('button',name='Резервное копирование',exact=True)
        assert backup.bounding_box()['height']==heights[0]
        assert backup.evaluate('(e)=>getComputedStyle(e).backgroundColor')==save_background
        backup.click()
        assert page.get_by_role('heading',name='Резервное копирование',exact=True).is_visible()
        assert page.locator('#profile-name').count()==0
        assert page.get_by_role('button',name='Сохранить копию',exact=True).is_visible()
        assert page.get_by_role('button',name='Восстановить данные',exact=True).is_visible()
        page.get_by_role('button',name='Назад',exact=True).click()
        login.click()
        assert page.get_by_role('heading', name='Вход в интерфейс тренера', exact=True).is_visible()
        assert page.evaluate('scrollY')==0
        assert page.locator('#pin-input').evaluate('(input)=>getComputedStyle(input).fontSize')=='16px'
        assert page.get_by_role('button', name='Звук', exact=True).count() == 0
        assert page.get_by_role('button', name='Настройки', exact=True).count() == 0
        page.get_by_role('button', name='Назад', exact=True).click()
        assert page.get_by_role('tab',name='История',exact=True).is_visible()
        trainer(page)
        assert_form_fields(page,['#new-athlete','#work-rest','#trainer-a'])
        page.on('dialog',lambda dialog: dialog.accept())
        page.get_by_role('button',name='Удалить все локальные данные',exact=True).click()
        page.get_by_role('tab',name='История',exact=True).wait_for()
        assert page.evaluate('scrollY')==0
        assert login.is_visible()
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
        assert footer.locator('.app-version').inner_text()=='Версия 0.3.5'
        exit_link=footer.get_by_role('link',name='Интерфейс спортсмена',exact=True)
        assert exit_link.bounding_box()['y']+exit_link.bounding_box()['height']<=footer.locator('.app-version').bounding_box()['y']
        footer.get_by_role('link', name='Интерфейс спортсмена', exact=True).click()
        assert page.get_by_role('tab', name='История', exact=True).is_visible()
        assert page.evaluate('scrollY')==0
        assert login.is_visible()
        assert not page.get_by_role('link', name='Интерфейс спортсмена', exact=True).count()
        assert not errors, errors
        page.close()
        print('PASS interface navigation', width, flush=True)
    browser.close()
