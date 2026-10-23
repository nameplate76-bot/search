# V168 design QA

final result: blocked

Target: user-approved navy/light designs for search, schedule dashboard/annual/monthly, unwritten reports, sales owner/monthly/detail, and user management.

Implemented: existing portal components, APIs and permission logic retained; sales view navigation; user side editor mirrors original row controls; full names wrap; compact schedule controls; responsive annual two-column layout retained.

Verification evidence: 17 Node/JSDOM test files passed (including school-phone test whose pre-existing fixture omitted closeSiteEditor, now stubbed). Script syntax checked. HTML embedded scripts match source. Config/schema/database/report bridge unchanged.

Visual gate: attempted sites-preview at the required local endpoint. Initial connection had an empty response; after starting the dev server the cloud browser rejected page observation under its URL security policy. No workaround attempted. No current implementation screenshot or paired visual comparison is available, so rendered PC/mobile fidelity cannot be marked passed.

Limits: no production writes, no real NAS/Excel/OS-print or phone verification. Remaining priority: real browser responsive/visual QA of all approved menu states before deployment.

## V169 functional follow-up
No CSS or layout change. Fixed save-triggered refresh of unwritten data behind the detail page, coherent owner filtering, detail return/group retention, secure-detail invalidation, and stale response guards. Nine relevant Node/JSDOM test files pass including the new save/reassignment/completion/race regression. Production DB and real-device verification not performed. The prior V168 visual gate remains blocked, not relabeled as passed.
