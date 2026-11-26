"""The wallet API of a validator on a running Splice LocalNet, with the token
that LocalNet's unsafe auth accepts. localnet-transfer-test.py and
localnet-wallets.py use it."""
import base64
import hashlib
import hmac
import json
import pathlib
import re
import urllib.error
import urllib.request
from decimal import Decimal

VALIDATOR_URL = {
    "app-user": "http://127.0.0.1:2903/api/validator",
    "app-provider": "http://127.0.0.1:3903/api/validator",
    "sv": "http://127.0.0.1:4903/api/validator",
}
REQUEST_TIMEOUT_S = 120


REFERENCE = re.compile(r"\$\{(\w+)(?::?-([^}]*))?\}")


def env_files(paths):
    """Reads compose env files in order. A value can refer to an earlier value
    as ${NAME} or ${NAME:-default}."""
    values = {}
    for path in paths:
        for line in pathlib.Path(path).read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator and not key.lstrip().startswith("#"):
                value = value.strip().strip('"')
                values[key.strip()] = REFERENCE.sub(lambda match: values.get(match.group(1), match.group(2) or ""), value)
    return values


def base64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def token(user, audience, secret):
    header = base64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = base64url(json.dumps({"sub": user, "aud": audience}).encode())
    signature = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{base64url(signature)}"


class Wallet:
    def __init__(self, name, base_url, bearer):
        self.name = name
        self.base_url = base_url
        self.bearer = bearer

    def call(self, method, path, body=None):
        request = urllib.request.Request(
            self.base_url + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.bearer}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:400]
            raise SystemExit(f"{self.name}: {method} {path} returned {error.code}: {detail}") from error

    def party(self):
        status = self.call("GET", "/v0/wallet/user-status")
        if not status["user_onboarded"]:
            raise SystemExit(f"{self.name}: the wallet user is not onboarded")
        return status["party_id"]

    def balance(self):
        return Decimal(self.call("GET", "/v0/wallet/balance")["effective_unlocked_qty"])

    def open_transfer_ids(self):
        transfers = self.call("GET", "/v0/wallet/token-standard/transfers")["transfers"]
        return {transfer["contract_id"] for transfer in transfers}


def wallet(localnet_dir, role, user=None):
    """The wallet of a user of the role's validator: its wallet admin user, or
    the named user, which registers itself on the validator."""
    settings = env_files([localnet_dir / "compose.env", localnet_dir / "env" / "common.env",
                          localnet_dir / "env" / f"{role}-auth-on.env"])
    prefix = "AUTH_" + role.upper().replace("-", "_")
    auth_conf = (localnet_dir / "conf" / "splice" / role / "app-auth.conf").read_text()
    secret = re.search(r'secret\s*=\s*"([^"]+)"', auth_conf)
    if secret is None:
        raise SystemExit(f"{role}: no token secret in app-auth.conf")
    subject = user or settings[f"{prefix}_WALLET_ADMIN_USER_NAME"]
    result = Wallet(f"{role}/{subject}", VALIDATOR_URL[role], token(subject, settings[f"{prefix}_AUDIENCE"], secret.group(1)))
    if user is not None:
        result.call("POST", "/v0/register", {})
    return result
