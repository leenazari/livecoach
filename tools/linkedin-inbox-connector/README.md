# LiveCoach LinkedIn Inbox connector

This unpacked Chrome extension performs a user-triggered, inbound-only capture
from the LinkedIn Messaging page that is already signed in on the user's Mac.

It does not request Chrome cookie access. It does not receive the LinkedIn
password or session cookie. It contains no code for sending messages, making
connections, liking content or publishing posts.

## Install

1. Download and unzip the connector package.
2. Open `chrome://extensions` in Chrome.
3. Turn on Developer mode.
4. Choose Load unpacked and select the unzipped connector folder.
5. In LiveCoach Settings, create a local LinkedIn inbox key.
6. Open the extension, paste the key and choose the maximum conversation count.

## Run a sync

1. Open `https://www.linkedin.com/messaging/` and select the main Inbox filter.
2. Open the LiveCoach extension.
3. Confirm that opening conversations may mark them as read.
4. Press Sync recent inbound messages.

The first run opens up to ten recent conversations by default. Later runs skip
conversation previews that have not changed. The server independently enforces
the conversation, message, payload and lookback limits.

## Safety boundaries

- The connector runs only after a human presses Sync.
- It imports only message elements marked by LinkedIn as coming from the other person.
- Sponsored conversations and LinkedIn Offer messages are skipped.
- A LinkedIn challenge or missing expected page structure stops the run.
- The LiveCoach key is separate from the LinkedIn session and can be revoked in Settings.
- The key is stored in Chrome extension local storage. Anyone with access to that Chrome profile may be able to retrieve it.
- [LinkedIn says browser extensions that scrape or automate its website violate its User Agreement](https://www.linkedin.com/help/linkedin/answer/a1341387) and may lead to temporary or permanent account restriction. Use the lowest useful limit and stop if LinkedIn presents a warning or challenge.

## Operational limits

- Maximum 20 conversations per run.
- Default 10 conversations per run.
- Maximum 200 inbound messages per request.
- Maximum 500 new imported messages in any 24-hour period.
- Maximum 14-day message lookback. Messages before that window are never imported.
- Maximum 512 KiB request body.
- Minimum 20 seconds between sync requests.
