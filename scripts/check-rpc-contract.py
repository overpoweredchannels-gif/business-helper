import re, sys

client = ''
for path in ['./src/lib/payments/submit-payment.ts', './src/lib/returns/cancel-return.ts']:
    client += open(path).read()
calls = {}
for m in re.finditer(r'client\.rpc\("([^"]+)",\s*\{([^}]+)\}', client):
    name, body = m.group(1), m.group(2)
    keys = set(re.findall(r'(\w+)\s*:', body))
    calls[name] = keys

import glob
defs = {}
for path in sorted(glob.glob('./src/lib/migrations/production_phase*.sql')):
    sql = open(path).read()
    for m in re.finditer(r'create or replace function public\.(\w+)\((.*?)\)\s*returns', sql, re.S):
        params = [p.strip().split()[0] for p in m.group(2).split(',') if p.strip()]
        defs[m.group(1)] = set(params)  # last definition wins (regeneration order)

ok = True
for name in sorted(calls):
    want, got = calls[name], defs.get(name)
    if got is None:
        print(f'FAIL {name}: no SQL definition found'); ok = False
    elif want != got:
        print(f'FAIL {name}: client sends {sorted(want)} but SQL declares {sorted(got)}'); ok = False
    else:
        print(f'PASS {name}: {len(want)} params match')
print('ALL RPC CONTRACTS MATCH' if ok else 'MISMATCH FOUND')
sys.exit(0 if ok else 1)
