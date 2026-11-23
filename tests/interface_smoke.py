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
        assert version.inner_text()=='sidesteps\n0.3.3-rc.4'
        assert login.inner_text()=='Интерфейс\nтренера'
        assert abs(version.bounding_box()['x']-footer.bounding_box()['x'])<1
        assert abs(login.bounding_box()['x']+login.bounding_box()['width']-footer.bounding_box()['x']-footer.bounding_box()['width'])<1
        page.get_by_role('button',name='Настройки',exact=True).click()
        assert page.locator('.panel > h2').all_text_contents()==[
            'Тренировка','Анимация запуска','Название профиля','Обменяться данными',
            'Добавить архивный результат','Выборочно удалить данные']
        assert page.get_by_label('Имя (указывается в файле выгрузки)',exact=True).is_visible()
        page.get_by_role('button',name='Назад из настроек',exact=True).click()
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
        assert footer.inner_text().endswith(' · Интерфейс спортсмена')
        footer.get_by_role('link', name='Интерфейс спортсмена', exact=True).click()
        assert page.get_by_role('tab', name='История', exact=True).is_visible()
        assert page.get_by_role('link', name='Интерфейс тренера', exact=True).is_visible()
        assert not page.get_by_role('link', name='Интерфейс спортсмена', exact=True).count()
        assert not errors, errors
        page.close()
        print('PASS interface navigation', width, flush=True)
    browser.close()
