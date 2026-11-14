#!/usr/bin/env bash
# Exercise the image's configured readiness probe on a disposable container.
set -euo pipefail

image=${1:?Pass the tested HAMMA processor image}
scratch=$(mktemp -d)
container=
cleanup() {
  if [[ -n "$container" ]]; then
    docker rm --force "$container" >/dev/null
  fi
  rm -f -- "$scratch/web/index.html" "$scratch/web/index.held"
  rmdir -- "$scratch/web" "$scratch"
}
trap cleanup EXIT

mkdir -m 755 "$scratch/web"
docker run --rm --network none --entrypoint cat "$image" /app/web/dist/index.html > "$scratch/web/index.html"
chmod a+r "$scratch/web/index.html"
since=$(date +%s)
container=$(docker run --rm --detach --init --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 \
  --memory 3g --cpus 2 --tmpfs /tmp:size=64m,mode=1777 \
  --health-interval 2s --health-retries 2 \
  --mount "type=bind,src=$scratch/web,dst=/app/web/dist,readonly" "$image")

wait_for_health() {
  local expected=$1
  for ((attempt = 0; attempt < 30; attempt++)); do
    if [[ $(docker inspect --format '{{.State.Health.Status}}' "$container") == "$expected" ]]; then
      return
    fi
    sleep 1
  done
  docker inspect --format '{{json .State.Health}}' "$container" >&2
  printf 'Container did not become %s\n' "$expected" >&2
  return 1
}

wait_for_health healthy
mv -- "$scratch/web/index.html" "$scratch/web/index.held"
wait_for_health unhealthy
docker exec "$container" python -c '
import json
from urllib.error import HTTPError
from urllib.request import urlopen
try:
    urlopen("http://127.0.0.1:5010/api/process/ready", timeout=3)
except HTTPError as error:
    assert error.code == 503 and json.load(error) == {"ready": False, "reason": "web-build"}
else:
    raise AssertionError("Readiness accepted a missing web build")
'
mv -- "$scratch/web/index.held" "$scratch/web/index.html"
wait_for_health healthy

events=$(docker events --since "$since" --until "$(( $(date +%s) + 1 ))" \
  --filter type=container --filter "container=$container" --format '{{.Action}}')
printf '%s\n' "$events" | awk '/^health_status: / {print}' | diff -u <(
  printf '%s\n' 'health_status: healthy' 'health_status: unhealthy' 'health_status: healthy'
) -
printf 'Docker emitted healthy, unhealthy, and healthy events in order.\n'
