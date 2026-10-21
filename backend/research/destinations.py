"""Registered local save folders and the nonparticipant recording index.

A destination is a folder on the computer running Python. The browser never
supplies a path for reading or downloading: everything is addressed by a
registered destination ID plus a recording UUID.
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = Path(os.environ.get('BCI_RESEARCH_DIR', str(REPO_ROOT / 'data' / 'research'))).resolve()
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
NAME_RE = re.compile(r'^[\w .()\-]{1,40}$')


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def git_ignored_ok(path: Path, repo: Path = REPO_ROOT) -> str | None:
    """Recordings may live inside the checkout only under the ignored data/ folder."""
    if path.is_relative_to(repo) and not path.is_relative_to(repo / 'data'):
        return 'This folder is inside the Git checkout but outside the ignored data/ folder. Choose data/… or a folder outside the project.'
    return None


class Destinations:
    def __init__(self, root: Path = DEFAULT_ROOT, repo: Path = REPO_ROOT):
        self.root = Path(root).resolve()
        self.repo = Path(repo).resolve()
        self.lock = threading.Lock()
        self.config = self.root / 'destinations.json'
        self.index_path = self.root / 'index.json'

    # ---------------------------------------------------------------- registry
    def _load(self):
        try:
            data = json.loads(self.config.read_text(encoding='utf-8'))
            return [d for d in data if isinstance(d, dict) and 'id' in d and 'path' in d]
        except (OSError, ValueError):
            return []

    def _save(self, items):
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.config.with_suffix('.tmp')
        tmp.write_text(json.dumps(items, indent=2), encoding='utf-8')
        tmp.replace(self.config)

    def all(self):
        default = dict(id='default', name='Project data folder (data/research)' if 'BCI_RESEARCH_DIR' not in os.environ
                       else 'Default folder (BCI_RESEARCH_DIR)', path=str(self.root), builtin=True)
        out = []
        for d in [default] + self._load():
            p = Path(d['path'])
            out.append(dict(id=d['id'], name=d['name'], path=str(p), builtin=d.get('builtin', False),
                            available=p.is_dir()))
        return out

    def get(self, dest_id: str) -> Path:
        for d in self.all():
            if d['id'] == dest_id:
                p = Path(d['path']).resolve()
                if dest_id == 'default':
                    p.mkdir(parents=True, exist_ok=True)
                if not p.is_dir():
                    raise FileNotFoundError(f'Destination "{d["name"]}" is not available (removed drive or deleted folder).')
                return p
        raise KeyError('Unknown destination')

    def add(self, name: str, path: str):
        if not NAME_RE.match(name or ''):
            raise ValueError('Name must be 1–40 letters, numbers, spaces or . ( ) -')
        raw = Path(path).expanduser()
        if not raw.is_absolute():
            raise ValueError('Enter an absolute folder path on the computer running the backend.')
        resolved = raw.resolve()
        if not resolved.is_dir():
            raise ValueError('That folder does not exist on the computer running the backend.')
        problem = git_ignored_ok(resolved, self.repo)
        if problem:
            raise ValueError(problem)
        with self.lock:
            items = self._load()
            for d in items + [dict(id='default', path=str(self.root))]:
                if Path(d['path']).resolve() == resolved:
                    raise ValueError('That folder is already registered.')
            item = dict(id=uuid.uuid4().hex[:10], name=name.strip(), path=str(resolved), added_at=now_iso())
            items.append(item)
            self._save(items)
        return item

    def probe(self, dest_id: str):
        """Prove the backend can create, write and remove a file there."""
        p = self.get(dest_id)
        problem = git_ignored_ok(p, self.repo)
        if problem:
            raise ValueError(problem)
        test = p / f'.write-probe-{uuid.uuid4().hex}'
        test.write_text('ok', encoding='utf-8')
        ok = test.read_text(encoding='utf-8') == 'ok'
        test.unlink()
        if not ok:
            raise OSError('Write probe read back different content.')
        stat = os.statvfs(p) if hasattr(os, 'statvfs') else None
        free = stat.f_bavail * stat.f_frsize if stat else None
        return dict(id=dest_id, writable=True, free_bytes=free)

    def recording_folder(self, dest_id: str, recording_id: str) -> Path:
        if not UUID_RE.match(recording_id or ''):
            raise ValueError('Unknown recording id')
        base = self.get(dest_id)
        folder = (base / recording_id).resolve()
        if not folder.is_relative_to(base) or folder == base:
            raise ValueError('Recording path escapes its destination')
        return folder

    # ---------------------------------------------------------------- index
    def index(self):
        try:
            data = json.loads(self.index_path.read_text(encoding='utf-8'))
            return [e for e in data if isinstance(e, dict) and UUID_RE.match(e.get('recording_id', ''))]
        except (OSError, ValueError):
            return []

    def add_to_index(self, recording_id: str, dest_id: str):
        with self.lock:
            items = self.index()
            items.append(dict(recording_id=recording_id, destination_id=dest_id, created_at=now_iso()))
            self.root.mkdir(parents=True, exist_ok=True)
            tmp = self.index_path.with_suffix('.tmp')
            tmp.write_text(json.dumps(items, indent=2), encoding='utf-8')
            tmp.replace(self.index_path)

    def locate(self, recording_id: str) -> Path:
        for e in self.index():
            if e['recording_id'] == recording_id:
                folder = self.recording_folder(e['destination_id'], recording_id)
                if not folder.is_dir():
                    raise FileNotFoundError('Recording folder is missing (destination removed or moved).')
                return folder
        raise KeyError('Unknown recording')
