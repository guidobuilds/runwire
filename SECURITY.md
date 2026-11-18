# Security policy

Runwire is a local, read-only analysis tool. It still reads sensitive session metadata, so security
reports are welcome and taken seriously.

## Supported versions

Runwire is in **beta**. Only the `main` branch and the latest 0.x release receive fixes. Older 0.x
versions are not supported.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. If that form is unavailable, open a minimal public issue asking for a
private channel and include no details about the vulnerability.

Please include:

- Affected version or commit.
- A description of the issue and its impact.
- Reproduction steps, with a minimal example if possible.
- Whether the issue requires a non-default configuration (for example `--expose`).

You can expect an acknowledgement as soon as the maintainer is able to look at it. This is a
spare-time project, so there is no guaranteed response time and no bug bounty.

## Security model

Runwire is designed for a single trusted machine:

- **Loopback only by default.** `runwire serve` binds to `127.0.0.1` and refuses a non-loopback
  host unless `--expose` is passed. The API has no authentication.
- **No network calls.** Import and discovery never contact a remote service.
- **Read-only harness access.** Harness logs and databases are opened read-only and never modified.
- **Metadata only.** Allowlists drop prompts, responses, code, tool input/output and reasoning
  before validation or storage.
- **Local SQLite.** The database is created with owner-only permissions where the platform supports
  it.

Treat the database as sensitive: it contains project paths, branch names, model names and usage
statistics. Do not commit it, publish it, or expose the API to an untrusted network.

## Out of scope

- Vulnerabilities that require an already-compromised local account.
- Attacks that rely on running an untrusted harness or on tampering with the session files Runwire
  reads.
- The documented risk of `--expose`, which is an explicit opt-in.
- Missing authentication on the loopback API, which is a documented design choice.

## Dependencies

Dependencies are pinned and updated through Dependabot pull requests. CI runs lint, typecheck and
the full test suite on Linux, macOS and Windows.
