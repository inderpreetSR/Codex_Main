"""Private file storage, keyed independently of user-supplied filenames."""

import os
from pathlib import Path
from uuid import UUID

UPLOAD_LIMIT = 10 * 1024 * 1024


def path_for(storage_key):
    """Resolve a storage UUID to its private file path."""
    return Path(os.getenv("UPLOAD_DIRECTORY", "/data/uploads")) / str(
        UUID(str(storage_key))
    )
