# eBay fixtures

Saved responses the eBay tests run against, so no test touches the network.

**These were written by hand, not captured from eBay.** They follow the field
names and shapes in eBay's Browse API OpenAPI spec (v1.20.4), with made-up
listings, item ids and sellers. When API keys exist, capture real responses
and add them here: real titles are messier than anything we can invent.

| File | What it stands for |
| --- | --- |
| `search-sheets-page1.json` | First page of a search, with a `next` link. Mixed bag: clean matches, a sheet set, a blend, missing shipping, a variation listing, an auction, a non-USD price. |
| `search-sheets-page2.json` | Second page. Repeats one listing from page 1. |
| `search-pillowcases.json` | Another search. Repeats one listing from the sheets search. |
| `search-towels.json` | Another search. |
| `search-empty.json` | A search with no results: eBay leaves `itemSummaries` out entirely. |
| `item-compact-with-shipping.json` | `getItem?fieldgroups=COMPACT` for a listing whose search result had no shipping cost. |
| `item-compact-no-shipping.json` | The same call, still with no shipping cost. |
| `token.json`, `token-error.json` | The sign-in response, good and bad. |
| `error-429.json`, `error-400-filter.json` | eBay's error body. |

Seller details are in the search fixtures on purpose. Real responses always
carry them, and a test checks that none of it reaches a stored listing.
