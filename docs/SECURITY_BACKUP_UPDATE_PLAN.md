# Security runtime and backup update plan

User authorization: update the embedded Node and PostgreSQL security versions,
make the selected newest-daily-plus-current-rollback policy persistent, remove
redundant historical site backups after a verified replacement, and cover delivery
archives separately. Identity-marker work is also explicitly approved.

1. In this isolated release worktree, pin pkg 6.26.0 and require Node 22.23.5 in
   both packaged executables. Keep migrations and configured RX Actions unchanged.
2. Add a Windows streaming delivery recovery helper. Include complete delivery
   files (including hidden ledger, gzip/checksum files), application package
   metadata and the compiled renderer executable when present. Verify every ZIP
   entry hash, source stability and archive checksum before success. Keep PHI
   outside the general site ZIP and protect recovery storage.
3. Produce the delivery companion on successful daily backup. Failed companion
   verification must retain prior backups. Prune matching companions together
   with old daily dumps. Exclude nested backups from site ZIPs.
4. Test synthetic archive round-trip, hidden files, renderer, link rejection,
   source integrity and failure retention. Run the exact-source full local release
   gates, CodeQL comparison, compiled smoke and official draft download checks.
5. Before production downtime, validate isolated recovery and preserve the paired
   recovery set and data fingerprints. Obtain signed official PostgreSQL 18.7
   media; verify and rehearse its supported minor-update path. Preserve all data
   directories, configuration, accounts and extensions. Stop only the required
   application/database services for the approved update; recover on failure.
6. Deploy only the verified official NEXT release through Project Control. Set
   retention using a scoped, backed-up service environment override, preserving
   production .env. Keep one daily/companion pair and one weekly site/companion
   pair plus current update rollback. Create/verify replacements before pruning.
7. Verify final runtime versions, health, business fingerprints, recovery coverage,
   retained artifacts and process cleanup. Update the sanitized handoff/report.

Release checks run on this computer under this project's explicit local-release
policy. Production-private data/configuration stays on production. No extra
scheduler, service, firewall change, Windows account change or M2 work is in scope.
Current adopted Project Control 2.2.2 already exceeds the shared presentation
standard 1.2.0 and retains the project's guarded updater/test-copy extensions.
