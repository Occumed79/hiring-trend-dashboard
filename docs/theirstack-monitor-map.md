# TheirStack monitor map

The authoritative runtime map is `lib/ingest/theirStackMonitors.ts`.

This document exists only to make the deployment intent obvious during review: the app must not treat the five TheirStack credentials as interchangeable rotation keys. Each credential represents a distinct saved employer monitor set supplied by the user. Peraton appears in more than one key set and is intentionally queried through each assigned key; State of Maryland was supplied twice within key 4 and is deduplicated inside that key.
