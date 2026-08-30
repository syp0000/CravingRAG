"""One shared Snowflake connection for the demo server, with a one-shot retry.

Local dev reads .dlt/secrets.toml (private key on disk). A deployed host has no such
file, so when SNOWFLAKE_ACCOUNT is set the credentials come from env vars and the
private key travels as inline PEM in SNOWFLAKE_PRIVATE_KEY.
"""
import os
import threading
import tomllib
from pathlib import Path

import snowflake.connector

ROOT = Path(__file__).resolve().parent.parent
# Per-statement ceiling (seconds). A runaway Cortex or vector query must not pin the
# single shared connection; the frontend gives up long before this anyway.
QUERY_TIMEOUT = int(os.environ.get("SNOWFLAKE_QUERY_TIMEOUT", "60"))


def connect_kwargs():
    base = dict(schema="EVAL2", login_timeout=30, network_timeout=QUERY_TIMEOUT)
    if os.environ.get("SNOWFLAKE_ACCOUNT"):
        from cryptography.hazmat.primitives import serialization  # ships with the connector
        pwd = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PWD") or None
        key = serialization.load_pem_private_key(
            os.environ["SNOWFLAKE_PRIVATE_KEY"].encode(),
            password=pwd.encode() if pwd else None)
        base.update(
            account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
            warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "CRAVING_WH"),
            database=os.environ.get("SNOWFLAKE_DATABASE", "CRAVING_RAG"),
            # least-privilege by default: sql/17_app_role.sql creates CRAVING_APP
            # (read + one INSERT + Cortex). Never default a public server to ACCOUNTADMIN.
            role=os.environ.get("SNOWFLAKE_ROLE", "CRAVING_APP"),
            private_key=key.private_bytes(serialization.Encoding.DER,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return base
    with open(ROOT / ".dlt/secrets.toml", "rb") as f:
        c = tomllib.load(f)["destination"]["snowflake"]["credentials"]
    base.update(account=c["host"], user=c["username"], private_key_file=c["private_key_path"],
                warehouse=c["warehouse"], database=c["database"], role=c["role"])
    if c.get("private_key_passphrase"):
        base["private_key_file_pwd"] = c["private_key_passphrase"]
    return base


CONN_KWARGS = connect_kwargs()


def connect():
    return snowflake.connector.connect(**CONN_KWARGS)


CONN = connect()
CONN_LOCK = threading.Lock()   # one connection shared by all handler threads
                               # (ThreadingHTTPServer): the connector is not safe
                               # for concurrent cursors on one connection.
# ponytail: global lock serializes DB access; switch to a connection pool if
# concurrent traffic ever matters more than the ~1s per-connection setup.


def q(sql, params=None):
    # one retry on a fresh connection — covers dead cursors AND dead executes
    global CONN
    with CONN_LOCK:
        try:
            cur = CONN.cursor()
            cur.execute(sql, params or (), timeout=QUERY_TIMEOUT)
        except Exception:
            CONN = connect()
            cur = CONN.cursor()
            cur.execute(sql, params or (), timeout=QUERY_TIMEOUT)
        return cur.fetchall()
