# Malformed

A broken JSON line, a truncated final line without a newline and a shape-invalid
ledger produce diagnostics without throwing. A separate valid session still
imports cleanly. The invalid ledger is valid JSON so fixture formatting is safe.
