"""Storage sinks for research recordings: CSV tables and/or one SQLite database.

Both sinks receive identical, normalized rows from a single writer thread. The
SQLite connection is created and used only on that thread.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
from pathlib import Path

from backend.research import schema


def normalize(table, row):
    """Convert one logical row to storage values shared by every sink."""
    out = []
    for v, t in zip(row, schema.col_types(table)):
        if v is None:
            out.append(None)
        elif t == 'BOOL':
            out.append(1 if v else 0)
        elif t == 'INTEGER':
            out.append(int(v))
        elif t == 'REAL':
            v = float(v)
            out.append(v if math.isfinite(v) else None)
        elif t == 'JSON':
            out.append(v if isinstance(v, str) else json.dumps(v, separators=(',', ':'), allow_nan=False, default=str))
        else:
            out.append(str(v))
    return tuple(out)


class CsvSink:
    name = 'csv'

    def __init__(self, folder: Path):
        self.folder = folder
        self.files = {}
        self.counts = {t: 0 for t in schema.ORDER}
        self.hashes = {t: hashlib.sha256() for t in schema.ORDER}
        for t in schema.ORDER:
            f = open(folder / f'{t}.csv', 'x', encoding='utf-8', newline='')
            f.write(schema.header(t) + '\n')
            self.files[t] = f
        self.types = {t: schema.col_types(t) for t in schema.ORDER}
        self.frees = {t: schema.free_flags(t) for t in schema.ORDER}

    def append(self, table, rows):
        if not rows:
            return
        lines = [schema.row_line(table, r, self.types[table], self.frees[table]) for r in rows]
        text = '\n'.join(lines) + '\n'
        self.files[table].write(text)
        for line in lines:
            self.hashes[table].update(line.encode('utf-8') + b'\n')
        self.counts[table] += len(rows)

    def flush(self):
        for f in self.files.values():
            f.flush()

    def close(self):
        for f in self.files.values():
            f.flush()
            os.fsync(f.fileno())
            f.close()

    def digest(self, table):
        return self.counts[table], self.hashes[table].hexdigest()


class SqliteSink:
    name = 'sqlite'

    def __init__(self, folder: Path):
        self.path = folder / 'recording.sqlite'
        if self.path.exists():
            raise FileExistsError(self.path)
        self.db = sqlite3.connect(self.path, isolation_level=None)  # explicit transactions
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=NORMAL')
        self.counts = {t: 0 for t in schema.ORDER}
        self.inserts = {}
        for t in schema.ORDER:
            self.db.execute(schema.ddl(t))
            cols = schema.columns(t)
            self.inserts[t] = f'INSERT INTO "{t}" ({", ".join(chr(34) + c + chr(34) for c in cols)}) VALUES ({", ".join("?" * len(cols))})'
        self.db.execute('CREATE TABLE IF NOT EXISTS "_meta" (key TEXT PRIMARY KEY, value TEXT)')
        self.db.execute('INSERT INTO "_meta" VALUES (?, ?)', ('schema_version', str(schema.SCHEMA_VERSION)))
        self.in_tx = False

    def append(self, table, rows):
        if not self.in_tx:
            self.db.execute('BEGIN')
            self.in_tx = True
        self.db.executemany(self.inserts[table], rows)
        self.counts[table] += len(rows)

    def flush(self):
        if self.in_tx:
            self.db.execute('COMMIT')
            self.in_tx = False

    def close(self):
        self.flush()
        self.db.execute('CREATE INDEX IF NOT EXISTS eeg_idx ON eeg (acquisition_id, sample_index)')
        self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        # A finished recording is a single self-contained file (no -wal/-shm beside it).
        self.db.execute('PRAGMA journal_mode=DELETE')
        self.db.close()

    def digest(self, table):
        """Re-read persisted rows and hash their canonical CSV lines (logical parity check)."""
        return table_digest_sqlite(self.db, table)


def table_digest_sqlite(db, table):
    types = schema.col_types(table)
    frees = schema.free_flags(table)
    h = hashlib.sha256()
    n = 0
    for row in db.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
        h.update(schema.row_line(table, row, types, frees).encode('utf-8') + b'\n')
        n += 1
    return n, h.hexdigest()


def make_sinks(fmt: str, folder: Path):
    if fmt == 'csv':
        return [CsvSink(folder)]
    if fmt == 'sqlite':
        return [SqliteSink(folder)]
    if fmt == 'both':
        return [CsvSink(folder), SqliteSink(folder)]
    raise ValueError(f'Unknown storage format {fmt!r}')
