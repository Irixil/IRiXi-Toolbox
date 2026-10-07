Additive art increment: 15 new choices and 33 PNGs. The existing 21 choices and all frozen base PNG bytes remain unchanged.

Read collection-expansion-manifest.json and collection-catalog-36.json. Apply IDs idempotently: the high table may already have been received as an earlier increment.

Main-image and thumbnail paths are explicit. This ZIP deliberately avoids a generic manifest.json filename, so merging its files does not overwrite the legacy19 manifest.

The 36 total preserves 6 existing rugs. The other 6 collection categories each contain 5 choices. Collection categories and renderer slots are different for lamps and plants.

Use integration-patches.json for capability-based tabletop attachment and real chair geometry. QA layouts must not overwrite user-custom placement or equip every object by default.

Static art, alpha and room-scale checks are complete. Actual application behaviour and full owl animations still require integration validation.
