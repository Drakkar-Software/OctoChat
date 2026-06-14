"""OctoChat stream PUBLISH — a standalone Python script that publishes ONE message
into a PUBLIC stream room as a bot, then exits. No ``/events``, no webhook, no
waiting: just the "post" half of an integration. Line-for-line mirror of the
TypeScript sibling (``../ts/src/publish.ts``).

    publish  ──append──▶  streampub room (access:'public')
              (audience-cap bot token)

A stream room is an append-only log, so posting is a single signed ``POST /push``
— no pull / merge / hash, no sync protocol. The bot is authorized by the
owner-minted "Connect a bot" token, a Starfish ``create_public_link`` AUDIENCE cap
(no embedded secret): the bot generates its OWN keypair and signs the request with
it, naming that key via ``X-Starfish-Pub`` (``redeem_public_link``). A leaked token
is therefore useless to anyone who can't also sign, and writes stay attributable
per bot.

We reproduce ``StarfishClient.append``'s exact wire format
(``body = json({"data": element})``, ``Content-Type: application/json``) so the
server accepts it identically.

The Starfish Python SDK is not yet on PyPI — install it editable from a satellite
source checkout (see ``../README.md``). Then:
    python publish.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from starfish_identities import generate_device_keys, mint_device_cap
from starfish_protocol import sign_request, stable_stringify
from starfish_sharing import parse_public_link, redeem_public_link


def load_env_file(path: Path) -> None:
    """Minimal ``.env`` loader (no python-dotenv dep): ``KEY=value`` lines, ``#``
    comments and blanks skipped. Already-exported env vars win, like most loaders.
    Mirrors the TS side's ``process.loadEnvFile`` so both read the same file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return  # no .env file — rely on exported env vars
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip one layer of matching surrounding quotes, like Node's loadEnvFile.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def required(name: str) -> str:
    """Read a required env var, or exit with a clean ``[publish] fatal: …`` line."""
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"[publish] fatal: missing required env var {name} (see .env.example)")
    return value


def user_id_from_ed_pub(ed_pub_hex: str) -> str:
    """The bot's in-app author id: sha256(edPub) first 32 hex, mirroring the SDK's
    userId derivation so the stream renders a stable author for the bot's posts."""
    return hashlib.sha256(bytes.fromhex(ed_pub_hex)).hexdigest()[:32]


def publish_profile(
    server_url: str,
    namespace: str,
    keys: dict[str, str],
    author_id: str,
    pseudo: str,
) -> None:
    """Publish the bot's PUBLIC PROFILE {pseudo} so the app shows a friendly name
    instead of the hex author-id prefix. The ``profile`` collection is public-read
    but write-gated on ``device:root``, granted ONLY to a SELF-SIGNED device cap
    (``iss === sub``). So the bot mints a device cap over its OWN key (issuer ===
    subject), admitted as ``device:root``; the path ``user/<authorId>/profile``
    binds ``{identity}`` to that same key's user id — the ``authorId`` it stamps on
    its message. One signed POST, same wire format as the append below
    (``{data, baseHash}``); a fresh per-run key means the doc never exists yet, so
    ``baseHash=None`` is a first write. Line-for-line mirror of the TS sibling's
    ``publishProfile``."""
    cap = mint_device_cap(
        keys["edPriv"],
        keys["edPub"],
        {"edPubHex": keys["edPub"], "kemPubHex": keys["kemPub"]},
        {"ops": ["read", "write", "list"], "collections": ["profile"], "paths": [f"user/{author_id}/profile"]},
    )
    action_path = (f"/v1/{namespace}" if namespace else "") + f"/push/user/{author_id}/profile"
    url = server_url.rstrip("/") + action_path
    host = urlsplit(server_url).netloc
    body = json.dumps({"data": {"pseudo": pseudo}, "baseHash": None}, separators=(",", ":")).encode("utf-8")

    signature = sign_request("POST", action_path, body, keys["edPriv"], host=host)
    cap_b64 = base64.b64encode(stable_stringify(cap).encode("utf-8")).decode("ascii")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Cap {cap_b64}",
        "X-Starfish-Sig": signature.sig,
        "X-Starfish-Ts": str(signature.ts),
        "X-Starfish-Nonce": signature.nonce,
        "X-Starfish-Alg": signature.alg,
    }
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"[publish] fatal: profile write failed: {exc.code} {detail}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"[publish] fatal: {exc.reason}")


def main() -> None:
    # Load the example's shared `.env` at the example root (one level up from here).
    load_env_file(Path(__file__).resolve().parent.parent / ".env")

    server_url = (os.environ.get("STARFISH_URL") or "").strip() or "http://localhost:8787"
    namespace = (os.environ.get("STARFISH_NAMESPACE") or "").strip()
    bot_token = required("OCTOCHAT_BOT_TOKEN")
    sign_path = required("OCTOCHAT_BOT_SIGN_PATH")
    message = (os.environ.get("MESSAGE") or "").strip() or "Hello from the OctoChat publish example 🐙"
    name = (os.environ.get("BOT_NAME") or "").strip()

    # The bot's own keypair redeems the audience-cap token. Fresh per run is fine:
    # the "Connect a bot" panel mints with no allowed identities, so any key may
    # redeem. To PIN the bot, mint a credential allow-listing this edPub (logged below).
    keys = generate_device_keys()
    author_id = user_id_from_ed_pub(keys["edPub"])

    # The path the SERVER observes: namespace prefix + the panel's action path. We
    # sign THIS exact string and POST it under server_url (whose mount, e.g. `/sync`,
    # nginx strips before the server sees the signed path) — matching how
    # StarfishClient signs `applyNamespace(path)` while POSTing `baseUrl + that`.
    action_path = (f"/v1/{namespace}" if namespace else "") + sign_path
    url = server_url.rstrip("/") + action_path
    host = urlsplit(server_url).netloc

    # The OctoChat chat UI reads a typed envelope; a message is { t:'msg', e: StoredMsg }.
    # The server stamps each appended element with an authoritative { ts }; the `ts`
    # we send is only a client hint.
    element = {
        "t": "msg",
        "e": {"id": str(uuid.uuid4()), "authorId": author_id, "ts": int(time.time() * 1000), "text": message},
    }

    # Exact StarfishClient.append body: the element wrapped as { data }. Bind it ONCE
    # so the signed bytes equal the bytes sent on the wire.
    body = json.dumps({"data": element}, separators=(",", ":")).encode("utf-8")

    headers = redeem_public_link(
        parse_public_link(bot_token),
        redeemer_ed_priv_hex=keys["edPriv"],
        redeemer_ed_pub_hex=keys["edPub"],
        method="POST",
        path_and_query=action_path,
        body=body,  # signed bytes MUST equal the bytes sent on the wire
        host=host,
    )
    headers["Content-Type"] = "application/json"
    headers["Accept"] = "application/json"

    print("[publish] OctoChat stream publish")
    print(f"[publish] server   {server_url}" + (f"  (namespace {namespace})" if namespace else "  (local, no namespace)"))
    print(f"[publish] identity {keys['edPub']}  (allow-list this edPub to pin the bot)")

    # Optional display name: publish the bot's profile pseudo first so the message
    # below renders under a friendly name (not the hex id). Fresh keys per run mean
    # a new profile each run; persist the keypair externally for one identity that
    # survives restarts (the example has no built-in stable-key option).
    if name:
        publish_profile(server_url, namespace, keys, author_id, name)
        print(f'[publish] profile  set display name → "{name}"')

    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"[publish] fatal: append failed: {exc.code} {detail}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"[publish] fatal: {exc.reason}")

    print(f"[publish] appended → {message}")


if __name__ == "__main__":
    main()
