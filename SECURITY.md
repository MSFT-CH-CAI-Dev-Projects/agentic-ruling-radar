# Security

## Demo software — no security guarantees

This repository is unsupported demonstration code. It has **not** been
security-reviewed or hardened for production use, and is provided "AS IS"
without warranty (see [`LICENSE`](LICENSE)). If you deploy it, you are
responsible for your own security review, hardening, secret management,
network controls, and compliance.

## Reporting a vulnerability

If you believe you have found a security vulnerability in this sample,
please **do not** open a public GitHub issue. Instead, report it
privately using GitHub's
[private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
for this repository (the "Report a vulnerability" button under the
**Security** tab), or contact the repository maintainers directly.

Please include enough detail to reproduce the issue. As this is
unsupported demo software, fixes are handled on a best-effort basis with
no committed timeline.

## Good practices when using this sample

- Never commit real secrets. Real values belong in the gitignored `.env`
  / `.env.local` files; only `*.env.example` templates are committed.
- Use Azure AD / Entra ID (managed identities, `DefaultAzureCredential`)
  for data-plane access rather than keys, as this sample does.
- Rotate any credentials that may have been exposed during experimentation.
