#!/usr/bin/env python3
"""Verify retained license/notice bytes referenced by redistribution inventories.

Read-only, standard-library-only. Does not download, execute upstream code, or
certify a binary. Run from any directory: python docs/redistribution/verify_inventory.py.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def references(value):
    if isinstance(value, dict):
        path = value.get('retained_path') or value.get('path')
        digest = value.get('sha256')
        if isinstance(path, str) and path.startswith('docs/') and isinstance(digest, str):
            yield path, digest
        for child in value.values():
            yield from references(child)
    elif isinstance(value, list):
        for child in value:
            yield from references(child)


def main():
    checked = {}
    inventories = sorted(Path(__file__).parent.glob('*inventory.json'))
    if not inventories:
        raise SystemExit('No inventories found')
    for inventory in inventories:
        data = json.loads(inventory.read_text())
        for name, expected in references(data):
            path = ROOT / name
            if '..' in Path(name).parts or path.is_symlink() or not path.is_file():
                raise SystemExit(f'Unsafe or missing notice: {name}')
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != expected:
                raise SystemExit(f'Notice digest mismatch: {name}')
            if name in checked and checked[name] != expected:
                raise SystemExit(f'Conflicting notice records: {name}')
            checked[name] = expected
    print(f'Verified {len(checked)} retained files in {len(inventories)} inventories')
    print('This checks recorded bytes, not legal completeness or binary linkage')


if __name__ == '__main__':
    main()
