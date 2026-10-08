# pallets/flask #6096

Changed paired imports plus a one-to-many statement replacement for IPv6 host/port parsing. Extra context preserves the class and full multiline method signature, leaving the long docstring and unrelated setup hidden.

[Original PR](https://github.com/pallets/flask/pull/6096) · [Before](before.py) · [After](after.py) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

See the enclosing context selections below. This Python method has no explicit terminal return or closing brace.

## Fold and context selections

Placeholder: Imports

### `folds/0/lhs` · {'line': 0, 'byte_column': 0} → {'line': 53, 'byte_column': 30}

```python
from __future__ import annotations

import collections.abc as cabc
import inspect
import os
import sys
import typing as t
import weakref
from datetime import timedelta
from functools import update_wrapper
from inspect import iscoroutinefunction
from itertools import chain
from types import TracebackType
from urllib.parse import quote as _url_quote

import click
from werkzeug.datastructures import Headers
from werkzeug.datastructures import ImmutableDict
from werkzeug.exceptions import BadRequestKeyError
from werkzeug.exceptions import HTTPException
from werkzeug.exceptions import InternalServerError
from werkzeug.routing import BuildError
from werkzeug.routing import MapAdapter
from werkzeug.routing import RequestRedirect
from werkzeug.routing import RoutingException
from werkzeug.routing import Rule
from werkzeug.serving import is_running_from_reloader
from werkzeug.wrappers import Response as BaseResponse
from werkzeug.wsgi import get_host

from . import cli
from . import typing as ft
from .ctx import AppContext
from .globals import _cv_app
from .globals import app_ctx
from .globals import g
from .globals import request
from .globals import session
from .helpers import _CollectErrors
from .helpers import get_debug_flag
from .helpers import get_flashed_messages
from .helpers import get_load_dotenv
from .helpers import send_from_directory
from .sansio.app import App
from .sessions import SecureCookieSessionInterface
from .sessions import SessionInterface
from .signals import appcontext_tearing_down
from .signals import got_request_exception
from .signals import request_finished
from .signals import request_started
from .signals import request_tearing_down
from .templating import Environment
from .wrappers import Request
from .wrappers import Response
```

### `folds/0/rhs` · {'line': 0, 'byte_column': 0} → {'line': 54, 'byte_column': 30}

```python
from __future__ import annotations

import collections.abc as cabc
import inspect
import os
import sys
import typing as t
import weakref
from datetime import timedelta
from functools import update_wrapper
from inspect import iscoroutinefunction
from itertools import chain
from types import TracebackType
from urllib.parse import quote as _url_quote
from urllib.parse import urlsplit

import click
from werkzeug.datastructures import Headers
from werkzeug.datastructures import ImmutableDict
from werkzeug.exceptions import BadRequestKeyError
from werkzeug.exceptions import HTTPException
from werkzeug.exceptions import InternalServerError
from werkzeug.routing import BuildError
from werkzeug.routing import MapAdapter
from werkzeug.routing import RequestRedirect
from werkzeug.routing import RoutingException
from werkzeug.routing import Rule
from werkzeug.serving import is_running_from_reloader
from werkzeug.wrappers import Response as BaseResponse
from werkzeug.wsgi import get_host

from . import cli
from . import typing as ft
from .ctx import AppContext
from .globals import _cv_app
from .globals import app_ctx
from .globals import g
from .globals import request
from .globals import session
from .helpers import _CollectErrors
from .helpers import get_debug_flag
from .helpers import get_flashed_messages
from .helpers import get_load_dotenv
from .helpers import send_from_directory
from .sansio.app import App
from .sessions import SecureCookieSessionInterface
from .sessions import SessionInterface
from .signals import appcontext_tearing_down
from .signals import got_request_exception
from .signals import request_finished
from .signals import request_started
from .signals import request_tearing_down
from .templating import Environment
from .wrappers import Request
from .wrappers import Response
```

Placeholder: Extract host and port from SERVER_NAME.

### `folds/1/lhs` · {'line': 722, 'byte_column': 0} → {'line': 723, 'byte_column': 60}

```python
        if server_name:
            sn_host, _, sn_port = server_name.partition(":")
```

### `folds/1/rhs` · {'line': 723, 'byte_column': 0} → {'line': 726, 'byte_column': 37}

```python
        if server_name:
            server_url = urlsplit(f"//{server_name}")
            sn_host = server_url.hostname
            sn_port = server_url.port
```

### `context/0/lhs` · {'line': 108, 'byte_column': 0} → {'line': 108, 'byte_column': 17}

```python
class Flask(App):
```

### `context/0/rhs` · {'line': 109, 'byte_column': 0} → {'line': 109, 'byte_column': 17}

```python
class Flask(App):
```

### `context/1/lhs` · {'line': 631, 'byte_column': 0} → {'line': 638, 'byte_column': 14}

```python
    def run(
        self,
        host: str | None = None,
        port: int | None = None,
        debug: bool | None = None,
        load_dotenv: bool = True,
        **options: t.Any,
    ) -> None:
```

### `context/1/rhs` · {'line': 632, 'byte_column': 0} → {'line': 639, 'byte_column': 14}

```python
    def run(
        self,
        host: str | None = None,
        port: int | None = None,
        debug: bool | None = None,
        load_dotenv: bool = True,
        **options: t.Any,
    ) -> None:
```
