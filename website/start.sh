#!/bin/sh
set -eu

# AUTH0_DOMAIN is a hostname, not a URL. Reject configuration that could alter
# the generated Nginx configuration or broaden the content security policy.
AUTH_ORIGIN=""
if [ -n "${AUTH0_DOMAIN:-}" ]; then
  if ! printf '%s' "$AUTH0_DOMAIN" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'; then
    echo "AUTH0_DOMAIN must be a valid hostname" >&2
    exit 1
  fi
  AUTH_ORIGIN="https://$AUTH0_DOMAIN"
fi
export AUTH_ORIGIN
envsubst '${AUTH_ORIGIN}' < /etc/codex/nginx.conf.template > /tmp/codex-nginx.conf
exec nginx -c /tmp/codex-nginx.conf -g 'daemon off;'
