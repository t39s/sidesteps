"""Choose a bounded check scope. Unknown changes always require full regression."""
import argparse
import re
import subprocess
from pathlib import Path

UI_FILES = {'app.js', 'styles.css', 'index.html', 'sw.js', 'manifest.webmanifest'}
METADATA = {'README.md', 'RELEASE_INFO.txt', 'RELEASE_REPORT.md',
            'KNOWN_ISSUES.md', 'MANIFEST_SHA256.txt'}


def normalize_version(path, text):
    if path == 'app.js' or path.startswith('tests/'):
        text = re.sub(r'sidesteps v[.]? ?\d+\.\d+\.\d+(?:-rc\.\d+)?', 'sidesteps VERSION', text)
        text = re.sub(r'0\\\.3\\\.\d+(?:-rc\\\.\d+)?', 'VERSION_REGEX', text)
    if path in {'index.html', 'sw.js'}:
        text = re.sub(r'\?v=\d+(?:rc\d+)?', '?v=VERSION', text)
        text = re.sub(r"'v\d+_\d+_\d+(?:_rc_\d+)?'", "'VERSION'", text)
    return text


def choose_scope(changes, requested='auto'):
    if requested == 'full':
        return 'full'
    for path, before, after in changes:
        if before is None or after is None:
            return 'full'
        if path in METADATA:
            continue
        if path not in UI_FILES and not path.startswith('tests/'):
            return 'full'
        if requested == 'ui':
            continue
        if normalize_version(path, before) != normalize_version(path, after):
            return 'full'
    return 'ui'


def git(*args):
    return subprocess.check_output(['git', *args], text=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--requested', choices=['auto', 'ui', 'full'], default='auto')
    args = parser.parse_args()
    try:
        git('rev-parse', '--verify', args.base + '^{commit}')
        paths = git('diff', '--name-only', '-z', args.base, 'HEAD').split('\0')
        changes = []
        for path in filter(None, paths):
            try:
                before = git('show', args.base + ':' + path)
            except subprocess.CalledProcessError:
                before = None
            after = Path(path).read_text() if Path(path).is_file() else None
            changes.append((path, before, after))
        scope = choose_scope(changes, args.requested)
    except (subprocess.CalledProcessError, UnicodeError):
        scope = 'full'
    print(scope)
