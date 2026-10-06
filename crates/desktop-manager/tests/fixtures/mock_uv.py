"""Offline managed-installer fixture; never downloads or installs packages."""
import json
import os
import shlex
import sys
from pathlib import Path

directory = Path(__file__).parent
scenario = json.loads((directory / 'scenario.json').read_text())
arguments = sys.argv[1:]
if arguments[0] == 'venv':
    environment = Path(arguments[1])
    (environment / 'bin').mkdir(parents=True)
    (environment / 'bin/python').write_text('offline fixture')
elif arguments[:2] == ['pip', 'install']:
    environment = Path(arguments[arguments.index('--python') + 1]).parent.parent
    if scenario.get('failInstall'):
        print('Controlled package install failure', file=sys.stderr)
        raise SystemExit(1)
    expected = next(argument.split('==')[1] for argument in arguments if argument.startswith('coding-tools-mcp=='))
    version = scenario.get('reportedCoreVersion', expected)
    executable = environment / 'bin/coding-tools-mcp'
    executable.write_text('#!/bin/sh\nprintf "%s\\n" ' + shlex.quote(f'coding-tools-mcp {version}') + '\n')
    os.chmod(executable, 0o700)
else:
    raise AssertionError(f'Unexpected mock installer arguments: {arguments}')
