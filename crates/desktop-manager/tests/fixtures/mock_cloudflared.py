"""Offline command fixture: records local calls; never contacts Cloudflare."""
import json
import os
import sys
import time
from pathlib import Path

directory = Path(__file__).parent
scenario = json.loads((directory / 'scenario.json').read_text())
arguments = sys.argv[1:]
calls_file = directory / 'calls.jsonl'
calls = [json.loads(line) for line in calls_file.read_text().splitlines()] if calls_file.exists() else []

if 'create' in arguments:
    kind = 'create'
elif 'route' in arguments:
    kind = 'route'
else:
    kind = 'run'

overwrite = os.environ.get('TUNNEL_FORCE_PROVISIONING_DNS', '').lower() == 'true'
if '--overwrite-dns=false' in arguments:
    overwrite = False
record = {
    'pid': os.getpid(),
    'kind': kind,
    'arguments': arguments,
    'overwrite': overwrite,
    'token': os.environ.get('TUNNEL_TOKEN'),
    'tokenFile': os.environ.get('TUNNEL_TOKEN_FILE'),
    'credentialContents': os.environ.get('TUNNEL_CRED_CONTENTS'),
    'name': os.environ.get('TUNNEL_NAME'),
    'config': json.loads(Path(arguments[arguments.index('--config') + 1]).read_text()) if '--config' in arguments else None,
}
if kind == 'create':
    record['name'] = arguments[arguments.index('create') + 1]
with calls_file.open('a') as stream:
    stream.write(json.dumps(record) + '\n')

if kind == 'create':
    path = Path(arguments[arguments.index('--credentials-file') + 1])
    path.write_text(json.dumps({
        'TunnelID': '11111111-1111-4111-8111-111111111111',
        'AccountTag': 'offline-fixture',
        'TunnelSecret': 'offline-fixture-secret',
    }))
elif kind == 'route':
    if scenario.get('failFirstRoute') and not any(call['kind'] == 'route' for call in calls):
        print('Controlled DNS conflict: existing record belongs to another tunnel', file=sys.stderr)
        raise SystemExit(1)
else:
    if '--url' in arguments:
        print('https://offline-fixture.trycloudflare.com', flush=True)
    print('Registered tunnel connection', flush=True)
    while True:
        time.sleep(1)
