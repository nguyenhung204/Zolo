# Sticker API

> Base URL: `http://localhost:3000`
> All endpoints require `Authorization: Bearer <ACCESS_TOKEN>`.
> Gateway responses are wrapped by the standard envelope `{ statusCode, message, data }`.

---

## Overview

Sticker catalog reads are served by the Gateway over HTTP and delegated to Message Store over TCP.

There are only two sticker catalog endpoints:

- `GET /stickers/packages`
- `GET /stickers/packages/:packageId/stickers`

Sending a sticker does not use a dedicated sticker endpoint. It uses the normal message send flow with `type: "sticker"`.

---

## `GET /stickers/packages`

Return all sticker packages ordered by `createdAt ASC`.

Success payload:

```json
[
  {
    "id": "pck_sprite",
    "name": "Zolo Sprites",
    "thumbnailUrl": "https://storage.example/zolo-stickers/sprite_45212.webp",
    "isFree": true,
    "createdAt": "2026-04-12T00:00:00.000Z"
  }
]
```

Notes:

- The current Message Store implementation reads directly from PostgreSQL via TypeORM
- There is no Redis cache in the code path for package listing

---

## `GET /stickers/packages/:packageId/stickers`

Return paginated stickers in a package.

Query params:

- `limit`: default `50`, hard-capped to `100` by the Gateway
- `offset`: default `0`

Success payload:

```json
{
  "items": [
    {
      "id": "sprite_45212",
      "packageId": "pck_sprite",
      "url": "https://storage.example/zolo-stickers/sprite_45212.webp",
      "createdAt": "2026-04-12T00:00:00.000Z"
    }
  ],
  "total": 128
}
```

Notes:

- Items are ordered by sticker `id ASC`
- The response is `{ items, total }`, not a bare array
- An unknown `packageId` results in an empty `items` array and `total: 0`

---

## Sending Sticker Messages

Sticker messages are sent through the regular message endpoint:

`POST /chat/messages`

Minimal request body pattern:

```json
{
  "conversationId": "uuid",
  "clientMessageId": "uuid",
  "type": "sticker",
  "content": "",
  "metadata": {
    "url": "https://storage.example/zolo-stickers/sprite_45212.webp"
  }
}
```

Code-backed behavior:

- `type: "sticker"` is accepted by Chat Core
- Empty content is allowed for sticker messages
- The sticker URL is stored in `messages.metadata.url`
- Receivers render directly from the URL in the message payload; there is no extra sticker lookup during delivery

---

## Client Notes

- The sticker catalog is effectively read-only from the client perspective, so client-side caching is reasonable
- The server code does not currently implement the Redis catalog cache described in some older docs/comments
