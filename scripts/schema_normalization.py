"""Remove non-DDL internal attribute versions emitted by older pg_dump clients.

New PostgreSQL minors expose pg_attver in pg_attribute.attoptions. These internal
options cannot be set through DDL and differ between fresh databases:
https://www.postgresql.org/docs/17/catalog-pg-attribute.html
"""
import re
import sys
from pathlib import Path


def normalize_schema(text):
    return re.sub(
        r'^ALTER TABLE ONLY [^\r\n]+ ALTER COLUMN [^\r\n]+ SET \(pg_attver=[0-9]+\);\r?\n',
        '', text, flags=re.MULTILINE,
    )


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: schema_normalization.py schema.sql')
    filename = Path(sys.argv[1])
    filename.write_text(normalize_schema(filename.read_text(encoding='utf-8')), encoding='utf-8')
