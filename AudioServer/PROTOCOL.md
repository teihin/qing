# Qing Audio Protocol v1

The service accepts 16 kHz, mono, signed 16-bit little-endian PCM and stores
AAC-LC audio in an M4A container. Upload and download do not require a token.

## WebSocket recording

Connect to `/v1/stream` with WS or WSS, then exchange messages in this order.

1. Start a recording. `requestId` must contain 8 to 128 ASCII letters, digits,
hyphens or underscores. Retrying the same `requestId` returns the same voice
rather than creating a duplicate.

```json
{"type":"start","requestId":"client_generated_request_0001"}
```

Response:

```json
{"type":"started","sessionId":"64_hex_character_voice_id","maxDurationMs":10000}
```

2. Send PCM as binary WebSocket messages. Every message has a 14-byte header.

| Offset | Size | Field |
|---|---:|---|
| 0 | 1 | Protocol version, always `1` |
| 1 | 1 | Frame type, always `1` for PCM audio |
| 2 | 4 | Unsigned sequence number, big-endian, starting at `0` |
| 6 | 8 | Unsigned capture timestamp in milliseconds, big-endian |
| 14 | N | PCM16LE payload |

WebSocket delivery is ordered, but sequence numbers make accidental loss or
client framing bugs explicit. The payload must contain complete 16-bit samples.

3. Finish:

```json
{"type":"finish"}
```

Successful response:

```json
{
  "type":"ready",
  "voice":{
    "voiceId":"64_hex_character_voice_id",
    "durationMs":1200,
    "fileSize":4800,
    "createdAt":"2026-07-28T10:00:00Z",
    "expiresAt":"2026-08-04T10:00:00Z"
  }
}
```

Use `{"type":"cancel"}` to discard an active recording. A connection can create
more than one recording, but only one recording may be active at a time.

## HTTP fallback upload

`POST /v1/voices`

Headers:

```text
Content-Type: application/octet-stream
X-Request-ID: <same idempotency request ID used for WS>
```

The body is raw PCM16LE. The response body contains a public voice object.

For the current HTTP/1.1 deployment, send `Expect: 100-continue` before the
fallback PCM body. This avoids a connection reset observed on some networks
when a 32 KB or larger body is transmitted immediately. The primary WebSocket
streaming path does not use this header.

## Download

`GET /v1/files/<voiceId>`

No authorization header is required. The endpoint supports HTTP range requests
and ETag validation. After upload, pass `voiceId` through the existing KB
`say` message; KB does not upload or proxy the audio file.
