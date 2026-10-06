# Dependency review

Reviewed on 2026-10-06 with `cargo-audit 0.22.2`, RustSec database commit `ef6173cbc5c50ec8166f9a5b28f07834144373ee`, and a fresh npm audit. This covers the desktop's locked Rust and JavaScript dependencies, not the separately installed Python core.

## Patched findings

The lockfile updates `plist` to 1.10.0, `quick-xml` to 0.41.0, `time` to 0.3.47, `time-core` to 0.1.8, `time-macros` to 0.2.27 and `num-conv` to 0.2.1. These are ordinary compatible registry updates; no upstream source patch or Rust-version bypass is used. The supported compiler minimum is now **Rust 1.88.0**.

- [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194.html) and [RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195.html): high-severity `quick-xml` denial-of-service findings. The prior 0.38.4 instance was reached through `plist`; its plain XML reader did not call the affected attribute-duplicate or namespace-resolution paths. Tauri uses plist for packaging/configuration and macOS application metadata. Updating removes the affected version rather than relying on that reachability assessment.
- [RUSTSEC-2026-0009](https://rustsec.org/advisories/RUSTSEC-2026-0009.html): the prior `time` 0.3.45 had an RFC2822 parsing issue. `cookie` uses fixed date formats, `plist` uses RFC3339, and `serde_with`'s optional time support is disabled in this lock. No affected application call path was found; the ordinary patched release is selected anyway.

The patched lock audit reports **0 vulnerability findings** and the seven informational warnings below. npm reports **0 vulnerabilities**. This is a dated dependency scan and source review, not a claim that the application is vulnerability-free.

## Upstream warnings retained visibly

- `glib 0.18.5`: [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), an unsoundness notice for `VariantStrIter`. No use of `VariantStrIter`/`array_iter_str` was found in application source or the downloaded non-glib locked crates. Linux's Tauri/GTK3 dependency line requires glib 0.18; the glib 0.20 fix is not a compatible lockfile substitution. This remains upstream framework debt, not a suppressed or claimed-fixed finding.
- Unmaintained notices: `proc-macro-error` ([2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)), `unic-char-property` ([2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html)), `unic-char-range` ([2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html)), `unic-common` ([2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html)), `unic-ucd-ident` ([2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html)), and `unic-ucd-version` ([2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html)).

Recheck these warnings when updating Tauri and its Linux bindings. No broad advisory ignore list is added. The external core's telemetry opt-out and trust boundary remain unchanged.

## Reproduce

```sh
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --json
npm audit --json
cargo tree -i quick-xml
cargo tree -i time
cargo tree --target all -i glib
```

Advisory results can change as the public databases evolve. Native builds and tests still need to pass after dependency changes; an audit result alone is not runtime acceptance.
