"""Short mobile UI check for interface links, PIN, exit and visible version."""
import os
from playwright.sync_api import sync_playwright
from browser_smoke import make_page, trainer

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or None,
        headless=True, args=['--no-sandbox'])
    for width in (375, 430):
        page, errors = make_page(browser, viewport_width=width, mobile=True)
        footer=page.locator('footer')
        version=footer.locator('.app-version')
        login=footer.get_by_role('link',name='Интерфейс тренера',exact=True)
        assert version.inner_text()=='v. 0.3.3-rc.8'
        assert login.inner_text()=='Интерфейс тренера'
        assert abs(version.bounding_box()['x']+version.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        assert abs(login.bounding_box()['x']+login.bounding_box()['width']/2-footer.bounding_box()['x']-footer.bounding_box()['width']/2)<1
        assert login.bounding_box()['y']+login.bounding_box()['height']<=version.bounding_box()['y']
        page.get_by_role('button',name='Настройки',exact=True).click()
        assert page.locator('.panel > h2').all_text_contents()==[
            'Тренировка','Анимация запуска','Название профиля','Обменяться данными',
            'Добавить архивный результат','Выборочно удалить данные']
        assert page.get_by_label('Имя (указывается в файле выгрузки)',exact=True).is_visible()
        page.get_by_role('button',name='Сохранить настройки',exact=True).click()
        page.get_by_role('link', name='Интерфейс тренера', exact=True).click()
        assert page.get_by_role('heading', name='Вход в интерфейс тренера', exact=True).is_visible()
        assert page.get_by_role('button', name='Звук', exact=True).count() == 0
        assert page.get_by_role('button', name='Настройки', exact=True).count() == 0
        page.get_by_role('button', name='Назад', exact=True).click()
        assert page.get_by_role('button', name='Звук', exact=True).is_visible()
        assert page.get_by_role('button', name='Настройки', exact=True).is_visible()
        trainer(page)
        assert page.get_by_role('link', name='Интерфейс спортсмена', exact=True).count() == 1
        assert page.locator('header').get_by_role('link', name='Интерфейс спортсмена', exact=True).count() == 0
        footer = page.locator('footer')
        assert '·' not in footer.inner_text()
        assert footer.locator('.app-version').inner_text()=='v. 0.3.3-rc.8'
        exit_link=footer.get_by_role('link',name='Интерфейс спортсмена',exact=True)
        assert exit_link.bounding_box()['y']+exit_link.bounding_box()['height']<=footer.locator('.app-version').bounding_box()['y']
        footer.get_by_role('link', name='Интерфейс спортсмена', exact=True).click()
        assert page.get_by_role('tab', name='История', exact=True).is_visible()
        assert page.get_by_role('link', name='Интерфейс тренера', exact=True).is_visible()
        assert not page.get_by_role('link', name='Интерфейс спортсмена', exact=True).count()
        assert not errors, errors
        page.close()
        print('PASS interface navigation', width, flush=True)
    browser.close()
