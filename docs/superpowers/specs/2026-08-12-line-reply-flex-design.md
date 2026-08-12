# LINE Reply Flex design

## Goal

Make every supported incoming LINE Bot command respond with a Flex Message via
LINE Reply API, while retaining LINE Push Flex for system-initiated
notifications.

## Scope

### Incoming LINE webhook commands

The webhook handler will build one Flex bubble for each supported command:

- `ขอไอดี`, `id`, `user id`: show the sender's LINE user ID.
- Vehicle status commands: show an abbreviated vehicle-status list.
- Equipment status commands: show an abbreviated equipment-stock list.
- Borrowing-status commands: show recent borrowing requests.
- `BR-...` and `EQ-...`: show matching request or equipment details.
- Unknown input: show a Flex help card containing the supported commands.

The existing `replyMessage_` helper will remain available for plain text when
needed, but command responses will use a new dedicated Reply Flex helper. The
helper will obtain credentials exclusively through `getLineToken()` and send
one Flex message using the event's `replyToken`.

### System-initiated messages

Existing event-driven notifications remain Push Flex messages:

- new borrowing requests and status changes;
- new vehicle-usage records;
- overdue, maintenance, and driving-licence alerts;
- explicit group and user test notifications.

Push remains necessary because these events have no LINE `replyToken`.

## Error handling and logging

- Both Reply and Push helpers use the same token source.
- Both helpers capture LINE HTTP status and a bounded response body in logs.
- A failed LINE notification does not roll back an already-persisted Firestore
  business record.
- Webhook processing still returns `OK` so LINE does not repeatedly redeliver a
  completed event; helper failures are logged for investigation.

## Constraints

- A Reply token is single-use and short-lived; exactly one reply is sent per
  incoming event.
- Flex text is constrained to LINE's message limits. User-supplied and
  data-derived text will be normalized and safely truncated before inclusion.
- No outgoing notification test is run automatically, since it would message
  real LINE recipients.

## Verification

1. Static JavaScript syntax check passes.
2. Unit-style payload checks confirm each supported command produces a valid
   Flex message shape with `type`, `altText`, and `contents`.
3. Manual deployed test: send each command to the bot and verify a single
   Reply Flex response; then create a borrowing request and confirm its Push
   notification still reaches the configured target.
