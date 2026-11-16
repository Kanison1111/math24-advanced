"""Reject partial metadata instead of accepting a vacuous baseline comparison."""
import re
from local_db import Blocked

CATEGORIES = {'postgres_major', 'extensions', 'functions', 'tables', 'columns',
              'constraints', 'indexes', 'policies', 'event_triggers', 'publications'}
RPCS = {'math24_create_room', 'math24_join_room', 'math24_set_ready',
        'math24_start_room', 'math24_leave_room', 'math24_is_member'}
TABLES = {'math24_rooms', 'math24_room_members', 'math24_join_limits'}


def validate_metadata(metadata):
    if not isinstance(metadata, dict) or set(metadata) != CATEGORIES:
        raise Blocked('Metadata must include the complete catalog categories')
    if type(metadata['postgres_major']) is not int or metadata['postgres_major'] < 17:
        raise Blocked('Unexpected PostgreSQL baseline version')
    for category in CATEGORIES - {'postgres_major'}:
        value = metadata[category]
        if value is not None and (not isinstance(value, list) or any(not isinstance(row, dict) for row in value)):
            raise Blocked('Invalid metadata category: ' + category)
    functions = metadata['functions'] or []
    if not RPCS <= {f.get('name') for f in functions}:
        raise Blocked('Metadata is missing required RPC definitions')
    if any(not re.fullmatch('[a-f0-9]{32}', f.get('body_hash', '')) for f in functions):
        raise Blocked('Missing function body hashes')
    if {t.get('name') for t in metadata['tables'] or []} != TABLES:
        raise Blocked('Metadata is missing application tables')
    if not TABLES <= {c.get('table_name') for c in metadata['columns'] or []}:
        raise Blocked('Metadata is missing application columns')
    for category in ('constraints', 'indexes', 'policies', 'extensions'):
        if not metadata[category]:
            raise Blocked('Metadata is unexpectedly empty: ' + category)
