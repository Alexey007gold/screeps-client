---
"screeps-connectivity": patch
---

Fix `RoomStore` corrupting array fields on diff updates. The server diffs a changed array field (e.g. a creep's `body`) positionally as an index-keyed object (`{ "2": … }`, with a `null` value marking a removed element), and the previous merge stored that object verbatim — turning `body` into a non-array. Selecting or rendering such a creep afterwards crashed the client with "`{} is not iterable`". Array-field diffs are now merged element-wise onto a copy of the array (null removals compacted away) so the field stays an array; a full array in the diff still replaces wholesale as before.
