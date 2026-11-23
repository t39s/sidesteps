"""Regression checks for reducing CI without silently skipping domain changes."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('scope', Path(__file__).resolve().parents[1] / 'tools/ci-scope.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class ScopeTests(unittest.TestCase):
    def test_commit_marker_selects_ui(self):
        self.assertEqual(scope.requested_scope('auto', 'Fix heading\n\nCI-Scope: ui\n'), 'ui')
        self.assertEqual(scope.requested_scope('auto', 'Mention CI-Scope: ui in prose'), 'auto')

    def test_full_and_invalid_markers_take_precedence(self):
        for message in ['CI-Scope: full', 'CI-Scope: unknown', 'CI-Scope: ui\nCI-Scope: full']:
            self.assertEqual(scope.requested_scope('ui', message), 'full')
        self.assertEqual(scope.requested_scope('full', 'CI-Scope: ui'), 'full')

    def test_marker_cannot_override_domain_changes(self):
        requested = scope.requested_scope('auto', 'CI-Scope: ui')
        self.assertEqual(scope.choose_scope([('model.js', 'a', 'b')], requested), 'full')

    def test_versions_and_docs(self):
        self.assertEqual(scope.choose_scope([
            ('app.js', 'sidesteps v. 0.3.1-rc.1', 'sidesteps v. 0.3.1-rc.2'),
            ('sw.js', "'v0_3_1_rc_1' ?v=031rc1", "'v0_3_1_rc_2' ?v=031rc2"),
            ('README.md', 'before', 'after')]), 'ui')

    def test_logic_change_with_version_is_full(self):
        self.assertEqual(scope.choose_scope([
            ('app.js', 'sidesteps v. 0.3.1-rc.1; allow=false',
             'sidesteps v. 0.3.1-rc.2; allow=true')]), 'full')

    def test_labels_need_explicit_ui_selection(self):
        change = [('app.js', '<a>Войти</a>', '<a>Интерфейс тренера</a>')]
        self.assertEqual(scope.choose_scope(change), 'full')
        self.assertEqual(scope.choose_scope(change, 'ui'), 'ui')

    def test_domain_and_unknown_files_override_ui(self):
        for path in ['model.js', 'migration.js', 'config.json', '.github/workflows/verify.yml', 'tools/ci-scope.py']:
            with self.subTest(path=path):
                self.assertEqual(scope.choose_scope([(path, 'a', 'b')], 'ui'), 'full')

    def test_missing_files_and_forced_full(self):
        self.assertEqual(scope.choose_scope([('app.js', None, 'new')], 'ui'), 'full')
        self.assertEqual(scope.choose_scope([], 'full'), 'full')


if __name__ == '__main__':
    unittest.main()
