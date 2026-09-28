# Smart Spend — online backup and sync contract (v1)

The web app (`index.html`) and the Android app implement this contract
identically, so a profile can be used on the phone one day and in the browser
the next. Anything not described here is device-local (PINs, UI filters).

## Storage

A private GitHub repository (default `khajamohiddinsyed/smart-spend-backups`),
accessed through the REST contents API with a fine-grained token that has
**Contents: Read and write** on that repository only.

```
backups/<slug>/<YYYY-MM-DD>T<HHMMSS>Z-<4 hex>.json   snapshot backups (history)
sync/<slug>/ledger.json                              the live synced ledger
```

`<slug>` is the profile name lower-cased with every run of characters outside
`[a-z0-9]` replaced by `-`, and leading or trailing `-` removed
("Sharooq" → `sharooq`). The same person uses the same profile name and the
same backup passphrase on every device.

## Encryption envelope

Every file under `backups/` and `sync/` is this JSON object:

```json
{ "format": "smartspend-encrypted", "v": 1, "cipher": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256", "iterations": 310000,
  "salt": "<base64, 16 bytes>", "iv": "<base64, 12 bytes>",
  "data": "<base64 ciphertext with the 16-byte GCM tag appended>",
  "createdAt": "<ISO-8601>" }
```

- Key: PBKDF2-HMAC-SHA256 over the passphrase's **UTF-8 bytes**, the salt and
  `iterations` (readers accept 100,000–5,000,000), producing 32 bytes.
- Cipher: AES-256-GCM, 96-bit IV, 128-bit tag, no additional data.
- Base64 is standard (RFC 4648 §4) with padding.
- Plaintext is the UTF-8 JSON payload below.
- A writer may reuse one salt, and therefore one derived key, for a session,
  but every encryption uses a fresh random IV.

## Records

```json
{ "id": "<unique string>", "title": "Spent 40 on Fuel", "amount": 40,
  "type": "in" | "out", "category": "Transport", "date": "2026-09-24",
  "createdAt": 1790000000000, "updatedAt": 1790000000000, "deleted": false }
```

- `id` is globally unique (a UUID or 16+ random hex chars) and never changes.
- `amount` is SAR, positive, at most two decimals. `date` is `yyyy-MM-dd`.
- `category` is one of Groceries, Dining, Transport, Utilities, Cash, Shopping,
  Healthcare, Salary, Freelance, General.
- `createdAt` and `updatedAt` are Unix epoch milliseconds. Every add, edit or
  restore sets `updatedAt` to the current time.
- A deletion keeps the record as a tombstone: `deleted: true` and `updatedAt`
  set to the deletion time. Other fields may be omitted on a tombstone.
  Tombstones older than 180 days may be dropped.

## Snapshot backup payload (`backups/…`)

```json
{ "app": "smart-spend-inflow-analyzer", "version": 2,
  "exportedAt": "<ISO-8601>", "profile": "Sharooq", "baseCurrency": "SAR",
  "rate": 26.5, "transactions": [ <live records, no tombstones> ],
  "learned": { … optional, web-only … } }
```

Restoring a snapshot replaces the profile's ledger on that device, then the
normal sync runs, so the restore reaches the other devices too. Readers also
accept the Android v1.0 file shape
`{ "transactions": [ { "text", "type": "income"|"expense", "date": "Sep 24, 2026" | "yyyy-MM-dd", … } ], "exchangeRate": 26.5 }`.

## Sync payload (`sync/<slug>/ledger.json`)

```json
{ "app": "smart-spend-sync", "version": 1, "profile": "Sharooq",
  "updatedAt": 1790000000000, "rate": 26.5, "rateUpdatedAt": 1790000000000,
  "records": [ <live records and tombstones> ] }
```

## Merge rule (latest edit wins)

Given the local and remote record sets:

1. Take the union by `id`.
2. When an `id` is on both sides, keep the version with the larger `updatedAt`.
3. On an equal `updatedAt`: a tombstone beats a live record; otherwise keep
   the version whose canonical string is greater, where the canonical string is
   `title|amount|type|category|date` with `amount` printed with exactly two
   decimals. This tie-break keeps every device converging on the same result.
4. The rate follows the larger `rateUpdatedAt` (a tie keeps the remote value).
5. Drop tombstones whose `updatedAt` is more than 180 days old.

## Sync procedure

1. `GET /repos/{o}/{r}/contents/sync/<slug>/ledger.json`. A 404 means there is
   no remote ledger yet. Otherwise remember `sha`, then fetch the body with
   `Accept: application/vnd.github.raw+json`.
2. Decrypt, parse, then merge with the local ledger.
3. If the merged result differs from the remote copy (compare the canonical
   record list and the rate), `PUT` it back with the remembered `sha` (none
   when the file is new). On 409 or 422 (someone else wrote first), repeat from
   step 1, at most 3 times.
4. Replace the local ledger with the merged result.

Apps sync when a profile is unlocked, a few seconds after any local change,
when the app returns to the foreground, and on "Sync now". Sync needs the
passphrase: remembered on the device, or entered once per session.

## Test vectors

`app/src/test/resources/sync/` holds files produced by the web implementation
(`crypto_vector.json`, `merge_vector.json`). The Android unit tests decrypt and
merge them and must match the expected output exactly.
