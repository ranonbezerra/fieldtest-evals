#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx", "starlette", "uvicorn"]
# ///
"""
Line-buffering proxy between a chat client and oMLX.

oMLX streams one SSE frame per token, so a path arrives split:

    ">wishtrip"  "-shared/contracts"  "/src/auth/sign"  "-in.ts"

Clients that act on the stream as it arrives - Cline writes the file live to show a
diff - can close a tag on a chunk boundary and write to `wishtrip` instead. That is
where the stray files at the repo root came from.

This holds content back until a newline and forwards whole lines. Every tag a client
parses opens and closes within one line, so no client ever sees half of one.

Thinking deltas are not forwarded: they carry no tags, they inflate the transcript, and
some clients render them as output. They become SSE comments instead, which keeps the
connection alive through a long think without putting a byte into the parser.

    ./tools/omlx-lineproxy.py            # :9001 -> :9050
    OMLX_UPSTREAM=... PROXY_PORT=... ./tools/omlx-lineproxy.py
"""
import json, os, sys
import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route

UPSTREAM = os.environ.get("OMLX_UPSTREAM", "http://localhost:9050").rstrip("/")
PORT = int(os.environ.get("PROXY_PORT", "9001"))
HOP = {"host", "content-length", "connection", "accept-encoding", "transfer-encoding"}

client = httpx.AsyncClient(timeout=httpx.Timeout(None, connect=10.0))


def _fwd_headers(request: Request) -> dict:
    return {k: v for k, v in request.headers.items() if k.lower() not in HOP}


async def relay(request: Request) -> Response:
    body = await request.body()
    url = f"{UPSTREAM}{request.url.path}"
    if request.url.query:
        url += f"?{request.url.query}"

    streaming = False
    if body:
        try:
            streaming = bool(json.loads(body).get("stream"))
        except (ValueError, AttributeError):
            pass

    if not streaming:
        r = await client.request(request.method, url, content=body, headers=_fwd_headers(request))
        drop = {"content-encoding", "content-length", "transfer-encoding", "connection"}
        return Response(
            r.content,
            status_code=r.status_code,
            headers={k: v for k, v in r.headers.items() if k.lower() not in drop},
            media_type=r.headers.get("content-type"),
        )

    # Send the request before deciding what to return: a StreamingResponse fixes its
    # status at 200 the moment it is constructed, so an upstream refusal would reach the
    # client as an empty 200 body. oMLX answers an over-long prompt with 400 and a reason,
    # and a client that never sees it reports "empty or unparsable response" instead.
    # Entered by hand rather than with `async with`, so the status can be inspected here
    # and the same context still closed inside the generator. client.send(stream=True) is
    # the obvious alternative and does not survive this upstream: it ends the body early
    # with "peer closed connection without sending complete message body".
    context = client.stream(
        request.method, url, content=body, headers=_fwd_headers(request)
    )
    upstream = await context.__aenter__()

    if upstream.status_code >= 400:
        detail = await upstream.aread()
        await context.__aexit__(None, None, None)
        return Response(
            detail,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type"),
        )

    async def stream():
        buffer = ""      # content held back until a newline completes the line
        template = None  # the last frame seen, reused so ids and model stay consistent

        def frame(text: str) -> bytes:
            base = json.loads(template) if template else {}
            base["choices"] = [{"index": 0, "delta": {"content": text}, "finish_reason": None}]
            return f"data: {json.dumps(base)}\n\n".encode()

        try:
            async for line in upstream.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:]

                if payload.strip() == "[DONE]":
                    if buffer:
                        yield frame(buffer)
                        buffer = ""
                    yield b"data: [DONE]\n\n"
                    continue

                try:
                    chunk = json.loads(payload)
                except ValueError:
                    yield f"{line}\n\n".encode()
                    continue

                choices = chunk.get("choices") or [{}]
                delta = choices[0].get("delta") or {}

                if "content" in delta or "reasoning_content" in delta:
                    template = payload

                if delta.get("reasoning_content"):
                    yield b": thinking\n\n"
                    continue

                text = delta.get("content")
                if text:
                    buffer += text
                    if "\n" in buffer:
                        head, _, buffer = buffer.rpartition("\n")
                        yield frame(head + "\n")
                    continue

                # A frame carrying no content: the opening role, or the one with
                # finish_reason. Flush first so nothing is emitted out of order.
                if buffer:
                    yield frame(buffer)
                    buffer = ""
                yield f"{line}\n\n".encode()

            if buffer:
                yield frame(buffer)
        finally:
            await context.__aexit__(None, None, None)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app = Starlette(routes=[Route("/{path:path}", relay, methods=["GET", "POST", "OPTIONS"])])

if __name__ == "__main__":
    import uvicorn
    print(f"omlx-lineproxy: :{PORT} -> {UPSTREAM}", file=sys.stderr)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
