"""Conservative leak/content gate; a pass never substitutes for manual review."""
import argparse
import hashlib
import re
from pathlib import Path

PATTERNS = {
    'secret-key': r'sb_secret_[A-Za-z0-9_\-]+',
    'jwt': r'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}',
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'credential-url': r'postgres(?:ql)?://[^\s:/]+:[^\s@]+@',
    'email-or-personal-literal': r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    'github-token': r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
    'data-insert': r'^\s*(?:INSERT\s+INTO|COPY\s+[^\n]+\s+FROM\s+stdin)',
    'external-connection': r'\b(?:dblink_connect|CREATE\s+SERVER|CREATE\s+USER\s+MAPPING)\b',
}


def without_dollar_bodies(text):
    return re.sub(r'(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)[\s\S]*?\1', '', text)


def findings(text):
    # Do not print matched contents, which may be sensitive.
    without_bodies = without_dollar_bodies(text)
    return [name for name, pattern in PATTERNS.items()
            if re.search(pattern, without_bodies if name == 'data-insert' else text, re.I | re.M)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('sql', type=Path)
    args = parser.parse_args()
    raw = args.sql.read_bytes()
    flags = findings(raw.decode())
    print('SHA-256:', hashlib.sha256(raw).hexdigest())
    if flags:
        print('REVIEW REQUIRED categories:', ', '.join(flags))
        return 2
    print('Automated scan: no known patterns. Manually inspect function literals, owners, grants and dependencies before approval.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
